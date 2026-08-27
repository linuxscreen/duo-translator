import {
    YT_BRIDGE_REQUEST,
    YT_BRIDGE_RESPONSE,
    YT_BRIDGE_TRACK_REQUEST,
    YT_BRIDGE_TRACK_RESPONSE,
    type YtBridgePlayerData,
} from "./bridgeProtocol";
import { VIDEO_SUBTITLE_SOURCE_POLICY } from "@/main/constants";
import type {
    CaptionTrackInfo,
    SourcePreference,
    SourceTrackOption,
    SubtitleWord,
    VideoSiteAdapter,
} from "./types";

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
     * One-shot re-read of the live player state that feeds `pickTrack` (CC
     * selection + audio track). Cheap enough to poll — a single postMessage
     * round-trip. False when the RPC timed out or the player has moved on to
     * another video, in which case the previous state is left untouched.
     */
    async refreshSourceState(): Promise<boolean> {
        const data = await bridgeRpc();
        if (!data || data.videoId !== currentYoutubeVideoId()) return false;
        this.lastPlayerData = data;
        return true;
    }

    /**
     * Whether the player's own captions are on, or null when it cannot be told
     * (the button is not in the control bar yet).
     *
     * Read off the control-bar button rather than through the bridge: it is the
     * state the user is actually looking at, it costs no RPC — so the follow
     * setting can poll it every tick — and it is the same signal the bridge
     * itself samples to restore the CC state after driving the caption module.
     */
    nativeCaptionsOn(player: HTMLElement): boolean | null {
        const pressed = player
            .querySelector(".ytp-subtitles-button")
            ?.getAttribute("aria-pressed");
        return typeof pressed === "string" ? pressed === "true" : null;
    }

    /** Unique source languages of this video, for the manual picker. */
    sourceOptions(tracks: CaptionTrackInfo[]): SourceTrackOption[] {
        const byLang = new Map<string, CaptionTrackInfo>();
        for (const t of tracks) {
            const kept = byLang.get(t.languageCode);
            // A language usually has BOTH an auto-generated and a hand-written
            // track; label the entry with the hand-written one, whose name is
            // the real title rather than "… (auto-generated)".
            if (!kept || (kept.auto && !t.auto)) byLang.set(t.languageCode, t);
        }
        return [...byLang.values()].map((t) => ({ languageCode: t.languageCode, label: t.label }));
    }

    /**
     * Pick the track to read as the ORIGINAL, honoring the user's
     * source-language preference.
     *
     * A language pinned by hand in the player menu always wins — it is the
     * most explicit statement of intent available. Behind it the policy orders
     * the two player signals: the CC choice (what is on screen) and the audio
     * (what is being spoken). Behind those, YouTube's own default track, then a
     * spoken-language heuristic, then the first track.
     *
     * The audio fallback is what answers "captions are off": with CC off the
     * player reports no selected track at all, and the caption list alone says
     * nothing about which language is being spoken.
     *
     * A policy or a pin that this video cannot satisfy is never an error — it
     * just falls through. That is what lets a pin survive a video change (it
     * re-applies wherever the language exists, since it is stored as a language
     * rather than a track) without ever stranding the overlay on a video that
     * lacks it.
     */
    pickTrack(tracks: CaptionTrackInfo[], pref?: SourcePreference): CaptionTrackInfo | null {
        if (tracks.length === 0) return null;

        const byLanguage = (lang: string | undefined): CaptionTrackInfo | null => {
            if (!lang) return null;
            const base = lang.split("-")[0].toLowerCase();
            const same = tracks.filter((t) => t.languageCode.split("-")[0].toLowerCase() === base);
            if (same.length === 0) return null;
            // Exact region match first, then a hand-written track over an ASR
            // one — the auto track is the lower-quality read of the same words.
            return same.find((t) => t.languageCode.toLowerCase() === lang.toLowerCase() && !t.auto)
                ?? same.find((t) => !t.auto)
                ?? same[0];
        };

        const fromSelection = (): CaptionTrackInfo | null => {
            const selected = this.lastPlayerData?.selectedTrack;
            if (!selected) return null;
            return tracks.find(
                (t) => t.languageCode === selected.languageCode && t.auto === (selected.kind === "asr"),
            )
                // Same language, either kind — the player reports `kind` for
                // ASR tracks only in some responses.
                ?? tracks.find((t) => t.languageCode === selected.languageCode)
                ?? null;
        };

        const fromAudio = () => byLanguage(this.lastPlayerData?.audioLanguage);
        const pinned = () => byLanguage(pref?.manualLang);

        const chain = pref?.policy === VIDEO_SUBTITLE_SOURCE_POLICY.AUDIO
            ? [pinned, fromAudio, fromSelection]
            : [pinned, fromSelection, fromAudio];

        for (const resolve of chain) {
            const match = resolve();
            if (match) return match;
        }

        const defaultIdx = this.lastPlayerData?.defaultTrackIndex ?? -1;
        if (defaultIdx >= 0 && defaultIdx < tracks.length) return tracks[defaultIdx];

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
 *
 * A `seg` is NOT a word — it is however much text the source happened to ship
 * in one timed chunk, and the three shapes in the wild differ by an order of
 * magnitude:
 *   - ASR tracks: one seg per word, each carrying its leading space
 *     (`"you're"`, `" about"`, `" to"`).
 *   - Manual tracks: one seg per cue, no offsets — the whole line at once.
 *   - Broadcast closed-caption tracks ("English - CC1" / "- DTVCC1", i.e.
 *     CEA-608/708 relayed from a TV feed, common on live streams): **two
 *     characters per seg**, one per video frame, because 608 encodes exactly
 *     two characters per control byte pair. Measured on a live feed: 33,668
 *     segs, 29,016 of length 2 and 4,652 of length 1, none longer.
 *
 * So words are recovered by splitting on WHITESPACE, not by trusting the seg
 * boundaries. The whitespace inside a seg is the only record of where the real
 * word boundaries are: trimming each seg and letting `joinWords` re-insert a
 * space between every one of them turned "and as you can see in the" into
 * "an d as y ou c an s ee i n th e" on the CC tracks above.
 *
 * A word's `startMs` comes from the seg it starts in and its `endMs` from the
 * one it ends in; `cueEnd` lands on the last word of each event so the
 * segmenter can still use source cue edges as break candidates.
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
        const firstOfEvent = words.length;
        let open: SubtitleWord | null = null;
        for (let i = 0; i < segs.length; i++) {
            const raw = typeof segs[i]?.utf8 === "string" ? (segs[i].utf8 as string) : "";
            if (raw === "") continue;
            const start = base + (typeof segs[i].tOffsetMs === "number" ? segs[i].tOffsetMs : 0);
            const nextOffset = segs
                .slice(i + 1)
                .find((s) => typeof s?.tOffsetMs === "number")?.tOffsetMs as number | undefined;
            const end = nextOffset !== undefined ? base + nextOffset : base + dur;
            // A newline is a line wrap inside one cue — a word boundary, same
            // as a space. Runs of either close the word being built.
            for (const part of raw.match(/\s+|\S+/g) ?? []) {
                if (/^\s/.test(part)) {
                    open = null;
                    continue;
                }
                if (open) {
                    open.text += part;
                    open.endMs = Math.max(end, open.startMs);
                } else {
                    open = { startMs: start, endMs: Math.max(end, start), text: part };
                    words.push(open);
                }
            }
        }
        // The source cue ends after whatever word came last. Not `i === last`:
        // a trailing whitespace-only seg would leave the whole event unmarked.
        if (words.length > firstOfEvent) words[words.length - 1].cueEnd = true;
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
