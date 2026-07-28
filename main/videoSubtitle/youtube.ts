import {
    YT_BRIDGE_REQUEST,
    YT_BRIDGE_RESPONSE,
    YT_BRIDGE_TRACK_REQUEST,
    YT_BRIDGE_TRACK_RESPONSE,
    type YtBridgePlayerData,
} from "./bridgeProtocol";
import type { CaptionTrackInfo, SubtitleWord, VideoSiteAdapter } from "./types";

/**
 * Isolated-world YouTube adapter.
 *
 * Player data (caption track list) and the caption bodies both come from the
 * MAIN-world bridge via postMessage RPCs. The bodies must go through the
 * bridge because a bare fetch of a track's `baseUrl` returns an EMPTY 200 —
 * YouTube requires a botguard proof-of-origin token that only the real player
 * can mint, so the bridge makes the player fetch the track itself and hands
 * the captured json3 back (see youtube-bridge.content.ts). The direct fetch
 * is kept only as a fallback for environments where the token isn't enforced.
 */

const RPC_TIMEOUT_MS = 2000;
const TRACK_RPC_TIMEOUT_MS = 10000;

function rpcId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function bridgeRpc(): Promise<YtBridgePlayerData | null> {
    return new Promise((resolve) => {
        const id = rpcId();
        let done = false;
        const finish = (v: YtBridgePlayerData | null) => {
            if (done) return;
            done = true;
            window.removeEventListener("message", onMessage);
            clearTimeout(timer);
            resolve(v);
        };
        const onMessage = (ev: MessageEvent) => {
            if (ev.source !== window) return;
            const msg = ev.data;
            if (!msg || msg.type !== YT_BRIDGE_RESPONSE || msg.id !== id) return;
            finish((msg.data as YtBridgePlayerData | null) ?? null);
        };
        const timer = window.setTimeout(() => finish(null), RPC_TIMEOUT_MS);
        window.addEventListener("message", onMessage);
        window.postMessage({ type: YT_BRIDGE_REQUEST, id }, "*");
    });
}

/** Ask the bridge to have the player fetch the track; resolves the json3 body. */
function bridgeFetchTrack(videoId: string, languageCode: string, kind: string): Promise<string | null> {
    return new Promise((resolve) => {
        const id = rpcId();
        let done = false;
        const finish = (v: string | null) => {
            if (done) return;
            done = true;
            window.removeEventListener("message", onMessage);
            clearTimeout(timer);
            resolve(v);
        };
        const onMessage = (ev: MessageEvent) => {
            if (ev.source !== window) return;
            const msg = ev.data;
            if (!msg || msg.type !== YT_BRIDGE_TRACK_RESPONSE || msg.id !== id) return;
            finish(typeof msg.body === "string" && msg.body !== "" ? msg.body : null);
        };
        const timer = window.setTimeout(() => finish(null), TRACK_RPC_TIMEOUT_MS);
        window.addEventListener("message", onMessage);
        window.postMessage(
            { type: YT_BRIDGE_TRACK_REQUEST, id, videoId, languageCode, kind },
            "*",
        );
    });
}

/** Video id of the watch page currently shown, from the URL. */
export function currentYoutubeVideoId(): string | null {
    try {
        const url = new URL(window.location.href);
        if (url.pathname === "/watch") return url.searchParams.get("v");
        // Shorts and embeds are out of scope for now.
        return null;
    } catch {
        return null;
    }
}

export class YoutubeAdapter implements VideoSiteAdapter {
    /**
     * Poll the bridge until the player reports data for the video the URL is
     * showing (SPA navigations and pre-roll ads can leave the player response
     * stale for a while). Resolves null on timeout / no captions surface.
     */
    async waitForPlayerData(signal: AbortSignal, timeoutMs = 30000): Promise<YtBridgePlayerData | null> {
        const wantedId = currentYoutubeVideoId();
        if (!wantedId) return null;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            const data = await bridgeRpc();
            if (data && data.videoId === wantedId) return data;
            await new Promise((r) => setTimeout(r, 800));
        }
        return null;
    }

    private lastPlayerData: YtBridgePlayerData | null = null;

    async listTracks(): Promise<CaptionTrackInfo[]> {
        const data = this.lastPlayerData;
        if (!data) return [];
        return data.captionTracks.map((t) => ({
            id: t.baseUrl,
            languageCode: t.languageCode,
            label: t.label,
            auto: t.kind === "asr",
        }));
    }

    setPlayerData(data: YtBridgePlayerData | null): void {
        this.lastPlayerData = data;
    }

    /**
     * Pick the source track: prefer a manual track in the video's spoken
     * language (the language the ASR track was generated for), then the ASR
     * track itself, then the first track.
     */
    pickTrack(tracks: CaptionTrackInfo[]): CaptionTrackInfo | null {
        if (tracks.length === 0) return null;
        const asr = tracks.find((t) => t.auto);
        if (asr) {
            const manualSameLang = tracks.find(
                (t) => !t.auto && t.languageCode.split("-")[0] === asr.languageCode.split("-")[0],
            );
            return manualSameLang ?? asr;
        }
        return tracks[0];
    }

    async fetchTrack(track: CaptionTrackInfo): Promise<SubtitleWord[]> {
        // Primary path: the bridge drives the real player so YouTube attaches
        // its proof-of-origin token (a bare fetch gets an empty 200).
        const videoId = this.lastPlayerData?.videoId;
        if (videoId) {
            const body = await bridgeFetchTrack(videoId, track.languageCode, track.auto ? "asr" : "");
            if (body) return parseJson3(JSON.parse(body));
        }
        // Fallback: direct same-origin fetch of the signed baseUrl.
        const url = new URL(track.id, window.location.origin);
        url.searchParams.set("fmt", "json3");
        const resp = await fetch(url.toString());
        if (!resp.ok) throw new Error(`timedtext HTTP ${resp.status}`);
        const body = await resp.text();
        if (!body) throw new Error("timedtext empty response");
        return parseJson3(JSON.parse(body));
    }
}

/**
 * Parse YouTube's `fmt=json3` timedtext payload into a flat timed word stream.
 * ASR tracks: one event per caption line, one seg per word with `tOffsetMs`.
 * Manual tracks: one seg per cue (no offsets) — becomes one "word" with
 * `cueEnd` set so the segmenter can use cue edges as break candidates.
 */
export function parseJson3(json: any): SubtitleWord[] {
    const events: any[] = Array.isArray(json?.events) ? json.events : [];
    const words: SubtitleWord[] = [];
    for (const ev of events) {
        const segs: any[] = Array.isArray(ev?.segs) ? ev.segs : [];
        if (segs.length === 0) continue;
        // `aAppend` events re-emit the previous window's text for scrolling
        // display — skipping them avoids duplicated words.
        if (ev.aAppend) continue;
        const base = typeof ev.tStartMs === "number" ? ev.tStartMs : 0;
        const dur = typeof ev.dDurMs === "number" ? ev.dDurMs : 0;
        for (let i = 0; i < segs.length; i++) {
            const raw = typeof segs[i]?.utf8 === "string" ? (segs[i].utf8 as string) : "";
            const text = raw.replace(/\n/g, " ").trim();
            if (text === "") continue;
            const start = base + (typeof segs[i].tOffsetMs === "number" ? segs[i].tOffsetMs : 0);
            const nextOffset = segs
                .slice(i + 1)
                .find((s) => typeof s?.tOffsetMs === "number")?.tOffsetMs as number | undefined;
            const end = nextOffset !== undefined ? base + nextOffset : base + dur;
            words.push({
                startMs: start,
                endMs: Math.max(end, start),
                text,
                cueEnd: i === segs.length - 1,
            });
        }
    }
    words.sort((a, b) => a.startMs - b.startMs);
    // Some manual tracks ship events with no `dDurMs` at all (observed live),
    // leaving zero-duration words — a cue would then "expire" the instant it
    // starts. Give such words the time until the next word starts (a caption
    // line stays up until the next one replaces it); pad the last one.
    for (let i = 0; i < words.length; i++) {
        if (words[i].endMs <= words[i].startMs) {
            const next = words[i + 1];
            words[i].endMs = next ? next.startMs : words[i].startMs + 4000;
        }
    }
    return words;
}
