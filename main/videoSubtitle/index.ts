import {
    AI_PREFIX,
    CONFIG_KEY,
    DEFAULT_VALUE,
} from "@/main/constants";
import { readConfig, whenConfigHydrated } from "@/utils/reactiveConfig";
import { setConfig } from "@/utils/db";
import { buildAiTranslateService } from "@/utils/service";
import { translateTextsWithCache } from "@/main/translateService";
import { parseTranslateServiceKey } from "@/main/aiWriting/translateRunner";
import { openSelectionTranslate } from "@/main/aiWriting/selectionPopup";
import { SubtitleOverlay } from "./overlay";
import { mountSubtitleControls, type SubtitleControlsController } from "./controls";
import { nextAiChunkEnd, segmentChunkWithAi, segmentWords, wordIndexAtTime } from "./segmenter";
import { YoutubeAdapter, currentYoutubeVideoId } from "./youtube";
import { normalizeVideoSubtitleStyle, type SubtitleCue, type SubtitleWord } from "./types";

/**
 * Video bilingual subtitles — controller. Currently YouTube only; the fetch /
 * parse side is behind {@link YoutubeAdapter} so other sites can slot in.
 *
 * Lifecycle: created once per top-frame page load on a supported site. It
 * follows CONFIG_KEY.VIDEO_SUBTITLE_SWITCH live (config values are polled
 * through the cached `readConfig` inside the tick loop — cheap, and covers
 * every setting without per-key wiring). Video changes are detected from the
 * URL each tick (YouTube is an SPA).
 */

export interface VideoSubtitleController {
    destroy(): void;
}

const TICK_MS = 150;
/** Translate this many cues ahead of the playhead. */
const TRANSLATE_AHEAD = 30;
const TRANSLATE_BATCH = 12;
/** Keep a cue on screen across a short gap to the next one (anti-flicker). */
const LINGER_MS = 500;

const CAPTION_HIDE_STYLE_ID = "duo-yt-native-caption-hide";

/** Fallback share of the player height reserved at the bottom if nothing measurable is found. */
const FALLBACK_BOTTOM_INSET_RATIO = 0.09;

/**
 * Height of the player's bottom control band — the strip the subtitle must not
 * cover, so the progress bar stays visible and clickable.
 *
 * Measured rather than hardcoded (it scales with the player), and measured even
 * while the controls are auto-hidden: YouTube keeps their layout boxes and only
 * animates opacity, so the value is stable whether the controls are shown or
 * not. That stability is the point — a floor that changed with control
 * visibility would make the subtitle jump exactly when the user moves the mouse.
 *
 * The progress bar is taken into account separately because it is positioned
 * slightly ABOVE `.ytp-chrome-bottom`'s own top edge.
 */
function bottomControlsInsetPx(player: HTMLElement): number {
    const playerBottom = player.getBoundingClientRect().bottom;
    let topMost = playerBottom;
    for (const sel of [".ytp-chrome-bottom", ".ytp-progress-bar-container"]) {
        const el = player.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top < topMost) topMost = r.top;
    }
    const measured = playerBottom - topMost;
    return measured > 0 ? measured : Math.round(player.clientHeight * FALLBACK_BOTTOM_INSET_RATIO);
}

/**
 * Caption-load state for one video.
 *
 * `pending` exists because a load can fail for reasons that later go away —
 * above all a playing ad, during which the player reports the AD's video and
 * has no captions for the real one. Treating the first failure as final left
 * the feature permanently stuck on "no captions" for videos that opened on a
 * pre-roll, so failures fall back to `pending` and are retried.
 */
type CaptionLoadState = "pending" | "loading" | "ready" | "gaveup";

interface VideoSession {
    videoId: string;
    abort: AbortController;
    /** Whole track, blank words dropped. Empty until the load succeeds. */
    words: SubtitleWord[];
    cues: SubtitleCue[];
    /** Ordered cue start times for the binary search. */
    starts: number[];
    translating: boolean;
    /** Service+lang the current translations belong to. */
    translationKey: string;
    loadState: CaptionLoadState;
    loadAttempts: number;
    /** Epoch ms before which no retry should be made (backoff). */
    nextRetryAt: number;
    /** AI segmentation on for this video (turns itself off after failures). */
    aiSegment: boolean;
    /** Index of the first word not yet turned into cues (AI mode only). */
    segCursor: number;
    /** An AI chunk request is in flight. */
    segmenting: boolean;
    segFailures: number;
}

const MAX_LOAD_ATTEMPTS = 6;
const LOAD_RETRY_MS = 3000;

/**
 * AI segmentation is lazy — a chunk is requested only when the segmented region
 * runs closer than this to the playhead. Rule-based segmentation stays eager:
 * it is pure local computation, so there is nothing to save by delaying it.
 *
 * Why lazy: segmenting a whole track up front fired one request per ~150 words
 * back to back the moment a video opened — minutes of provider traffic and a
 * transcript's worth of tokens for a video the user may abandon in ten seconds,
 * with the first subtitle stuck behind all of it. Ten seconds of lookahead is
 * enough to cover the request round-trip and still leave the pre-translation
 * scheduler room to work.
 */
const SEGMENT_AHEAD_MS = 10_000;
/**
 * How far the playhead may sit outside the segmented window before it counts as
 * a seek and the window is rebuilt around it. Small, because everything outside
 * the window shows no subtitle anyway — the only cost of rebuilding is one
 * chunk request.
 */
const SEEK_SLACK_MS = 2000;
/** Consecutive AI failures after which the rest of the track goes rule-based. */
const MAX_SEGMENT_FAILURES = 2;

/**
 * Every config key this controller reads. The tick loop does not start until
 * all of them have hydrated — keep this list in step with the `readConfig`
 * calls below.
 *
 * `readConfig` is a cached read whose hydration is async AND per key: before a
 * key lands it silently returns the caller's DEFAULT, indistinguishable from a
 * stored value that happens to equal it. The tick loop mostly tolerates that
 * because it re-reads every 150ms and reacts to changes — but the reads that
 * happen ONCE per session do not get a second chance: AI segmentation, the
 * target language and the service key are baked into the caption load and the
 * translation batches it kicks off, so a pre-hydration read there means the
 * whole video is segmented/translated with the wrong settings.
 *
 * Waiting on the full set (rather than sprinkling hydration checks over the
 * individual call sites) is what makes every `readConfig` below safe by
 * construction, including ones added later.
 */
const REQUIRED_CONFIG_KEYS = [
    CONFIG_KEY.VIDEO_SUBTITLE_SWITCH,
    CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE,
    CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE,
    CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE,
    CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE,
    CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT,
    CONFIG_KEY.VIDEO_SUBTITLE_STYLE,
    CONFIG_KEY.VIDEO_SUBTITLE_AI_SEGMENT,
    CONFIG_KEY.VIDEO_SUBTITLE_POSITION,
    CONFIG_KEY.TARGET_LANGUAGE,
    CONFIG_KEY.AI_PROVIDERS,
    CONFIG_KEY.DISABLED_TRANSLATE_SERVICES,
] as const;

export function initVideoSubtitle(): VideoSubtitleController {
    const adapter = new YoutubeAdapter();

    let destroyed = false;
    /**
     * Feature switch as of the last tick (teardown/re-setup edge detection).
     * Null until the first tick that runs — reading it here would be a
     * pre-hydration read, which is exactly what the tick gate exists to avoid.
     */
    let featureOn: boolean | null = null;
    /** Per-tab user override from the player menu; null = follow auto-enable. */
    let sessionEnabled: boolean | null = null;
    let session: VideoSession | null = null;
    let player: HTMLElement | null = null;
    let video: HTMLVideoElement | null = null;
    let overlay: SubtitleOverlay | null = null;
    let controls: SubtitleControlsController | null = null;
    let lastStyleJson = "";
    let lastMode = "";
    let lastPauseOnSelect: boolean | null = null;
    /** Last position value seen in config (live-edit edge detection). */
    let lastPositionPct: number | null = null;
    /** Last enabled-state pushed into the player menu's checkmark. */
    let lastEnabled: boolean | null = null;

    const isEnabled = () =>
        sessionEnabled ??
        readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE, DEFAULT_VALUE.VIDEO_SUBTITLE_AUTO_ENABLE);

    /**
     * Subtitle target language: the feature's own setting, falling back to the
     * page-translation target (and finally the browser UI language) when the
     * user has never picked one.
     */
    const targetLanguage = () =>
        readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE, "") ||
        readConfig<string>(CONFIG_KEY.TARGET_LANGUAGE, "") ||
        navigator.language.split("-")[0];

    /** Resolve the subtitle service key with the shared fallback rules. */
    const resolveServiceKey = () => {
        const raw = readConfig<string>(
            CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE,
            DEFAULT_VALUE.VIDEO_SUBTITLE_TRANSLATE_SERVICE,
        );
        const ctx = buildAiTranslateService(
            raw,
            readConfig<unknown[]>(CONFIG_KEY.AI_PROVIDERS, []),
            readConfig<string[]>(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES, []),
        );
        return ctx.activeService;
    };

    const currentStyle = () =>
        normalizeVideoSubtitleStyle(readConfig<unknown>(CONFIG_KEY.VIDEO_SUBTITLE_STYLE, undefined));

    // ------------------------------------------------------------------
    // Native caption hiding (only while our subtitles are shown)
    // ------------------------------------------------------------------

    const setNativeCaptionsHidden = (hidden: boolean) => {
        const existing = document.getElementById(CAPTION_HIDE_STYLE_ID);
        if (hidden) {
            if (existing) return;
            const style = document.createElement("style");
            style.id = CAPTION_HIDE_STYLE_ID;
            style.textContent = "#movie_player .ytp-caption-window-container{display:none !important;}";
            document.documentElement.appendChild(style);
        } else {
            existing?.remove();
        }
    };

    // ------------------------------------------------------------------
    // Surfaces
    // ------------------------------------------------------------------

    const ensureSurfaces = () => {
        const p = document.getElementById("movie_player");
        if (!(p instanceof HTMLElement)) return;
        if (player !== p || !overlay || !document.getElementById("duo-video-subtitle-box")) {
            player = p;
            video = p.querySelector("video");
            overlay?.destroy();
            overlay = new SubtitleOverlay(p, currentStyle(), readPositionPct(), {
                onPositionChange: (pct) => {
                    // Record it as "already applied" so the sync below treats
                    // the resulting storage change as a no-op.
                    lastPositionPct = pct;
                    void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_POSITION, pct);
                },
                onTranslateSelection: (text, rect) => {
                    openSelectionTranslate({
                        text,
                        targetLang: targetLanguage(),
                        choice: parseTranslateServiceKey(resolveServiceKey()),
                        rect,
                    });
                },
                reservedBottomPx: () => bottomControlsInsetPx(p),
            });
            lastStyleJson = JSON.stringify(currentStyle());
            lastMode = readMode();
            overlay.setMode(lastMode);
            lastPauseOnSelect = readConfig<boolean>(
                CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT,
                DEFAULT_VALUE.VIDEO_SUBTITLE_PAUSE_ON_SELECT,
            );
            overlay.setPauseOnSelect(lastPauseOnSelect);
            lastPositionPct = readPositionPct();

            controls?.destroy();
            controls = mountSubtitleControls({
                player: p,
                initialEnabled: isEnabled(),
                onToggleEnabled: (next) => {
                    sessionEnabled = next;
                    // The menu already flipped its own mark — record it as
                    // applied so the sync below doesn't push it straight back.
                    lastEnabled = next;
                    if (!next) {
                        overlay?.hide();
                        setNativeCaptionsHidden(false);
                    }
                },
                onDisableForever: () => {
                    // Config is persisted by the menu; tear down right away —
                    // the tick loop would catch it too, this is just snappier.
                    teardownFeature();
                },
            });
            lastEnabled = isEnabled();
            if (session) {
                controls.setAvailability(
                    session.loadState === "ready" ? "available"
                        : session.loadState === "gaveup" ? "unavailable"
                            : "loading",
                );
            }
        }
        if (!video || !video.isConnected) video = p.querySelector("video");
    };

    const readPositionPct = () =>
        readConfig<number>(CONFIG_KEY.VIDEO_SUBTITLE_POSITION, DEFAULT_VALUE.VIDEO_SUBTITLE_POSITION);

    const readMode = () =>
        readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE, DEFAULT_VALUE.VIDEO_SUBTITLE_DISPLAY_MODE);

    // ------------------------------------------------------------------
    // Per-video session
    // ------------------------------------------------------------------

    const resetSession = () => {
        session?.abort.abort();
        session = null;
        overlay?.hide();
        setNativeCaptionsHidden(false);
    };

    /** True while YouTube is playing an ad instead of the requested video. */
    const isAdShowing = () => !!player?.classList.contains("ad-showing");

    const startSession = (videoId: string) => {
        resetSession();
        session = {
            videoId,
            abort: new AbortController(),
            words: [],
            cues: [],
            starts: [],
            translating: false,
            translationKey: "",
            loadState: "pending",
            loadAttempts: 0,
            nextRetryAt: 0,
            aiSegment: false,
            segCursor: 0,
            segmenting: false,
            segFailures: 0,
        };
        controls?.setAvailability("loading");
        // The load itself is driven by the tick loop, which holds it back while
        // an ad is playing.
    };

    /**
     * Record a failed caption load and schedule a retry. Only after the
     * attempts run out is the user told there are no captions — an early
     * "unavailable" is usually just an ad talking.
     */
    const failLoad = (s: VideoSession, reason: string) => {
        if (session !== s) return;
        s.loadAttempts++;
        const exhausted = s.loadAttempts >= MAX_LOAD_ATTEMPTS;
        s.loadState = exhausted ? "gaveup" : "pending";
        s.nextRetryAt = Date.now() + LOAD_RETRY_MS;
        if (exhausted) console.warn("duo video subtitle: giving up on captions —", reason);
        controls?.setAvailability(exhausted ? "unavailable" : "loading");
    };

    const loadCaptions = (s: VideoSession) => {
        s.loadState = "loading";
        const abort = s.abort;
        void (async () => {
            try {
                const data = await adapter.waitForPlayerData(abort.signal);
                if (abort.signal.aborted || session !== s) return;
                adapter.setPlayerData(data);
                const tracks = data && !data.isLive ? await adapter.listTracks() : [];
                const track = adapter.pickTrack(tracks);
                if (!track) {
                    failLoad(s, "no caption track");
                    return;
                }
                const words = await adapter.fetchTrack(track);
                if (abort.signal.aborted || session !== s) return;
                if (words.length === 0) {
                    failLoad(s, "empty caption track");
                    return;
                }

                const usable = words.filter((w) => w.text.trim() !== "");
                if (usable.length === 0) {
                    failLoad(s, "empty caption track");
                    return;
                }
                s.words = usable;
                s.aiSegment = readConfig<boolean>(
                    CONFIG_KEY.VIDEO_SUBTITLE_AI_SEGMENT,
                    DEFAULT_VALUE.VIDEO_SUBTITLE_AI_SEGMENT,
                );

                if (s.aiSegment) {
                    // Cues arrive chunk by chunk from the tick loop, starting at
                    // wherever playback currently is.
                    s.segCursor = wordIndexAtTime(usable, nowMs());
                } else {
                    const cues = segmentWords(usable);
                    if (cues.length === 0) {
                        failLoad(s, "segmentation produced no cues");
                        return;
                    }
                    setCues(s, cues);
                    s.segCursor = usable.length;
                }
                s.loadState = "ready";
                controls?.setAvailability("available");
                // Get the first chunk / the first translations moving now rather
                // than on the next tick.
                ensureSegmentedAhead(nowMs());
                ensureTranslatedAhead(currentCueIndex(nowMs()) ?? 0);
            } catch (e) {
                if (!abort.signal.aborted && session === s) {
                    failLoad(s, String((e as Error)?.message ?? e));
                }
            }
        })();
    };

    const nowMs = () => (video ? video.currentTime * 1000 : 0);

    /** Index of the cue covering `t` (with linger), or null. */
    const currentCueIndex = (t: number): number | null => {
        const s = session;
        if (!s || s.cues.length === 0) return null;
        // Binary search: last cue with startMs <= t.
        let lo = 0, hi = s.starts.length - 1, idx = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (s.starts[mid] <= t) { idx = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        if (idx < 0) return null;
        const cue = s.cues[idx];
        const next = s.cues[idx + 1];
        const linger = next ? Math.min(LINGER_MS, Math.max(0, next.startMs - cue.endMs)) : LINGER_MS;
        return t <= cue.endMs + linger ? idx : null;
    };

    // ------------------------------------------------------------------
    // Lazy segmentation (AI mode)
    // ------------------------------------------------------------------

    const setCues = (s: VideoSession, cues: SubtitleCue[]) => {
        s.cues = cues;
        s.starts = cues.map((c) => c.startMs);
    };

    const appendCues = (s: VideoSession, cues: SubtitleCue[]) => {
        for (const c of cues) {
            s.cues.push(c);
            s.starts.push(c.startMs);
        }
    };

    /**
     * Keep the segmented region a little ahead of the playhead, one AI chunk at
     * a time. No-op unless AI segmentation is on — the rule-based path segments
     * the whole track at load.
     */
    const ensureSegmentedAhead = (t: number) => {
        const s = session;
        if (!s || !s.aiSegment || s.segmenting || s.loadState !== "ready") return;

        const frontierMs = s.cues.length > 0 ? s.cues[s.cues.length - 1].endMs : -Infinity;
        const windowStartMs = s.cues.length > 0 ? s.cues[0].startMs : Infinity;
        const seeked =
            s.cues.length > 0 && (t < windowStartMs - SEEK_SLACK_MS || t > frontierMs + SEEK_SLACK_MS);

        if (seeked) {
            // Rebuild the window around the playhead instead of segmenting
            // everything in between: the skipped stretch was never watched, and
            // paying for it is exactly what this scheduler exists to avoid.
            // Dropping the old cues also keeps `starts` sorted for the binary
            // search, which appending across a gap would not.
            const idx = wordIndexAtTime(s.words, t);
            if (idx >= s.words.length) return; // past the last word — nothing left
            setCues(s, []);
            s.segCursor = idx;
        } else {
            if (s.segCursor >= s.words.length) return; // whole track segmented
            if (frontierMs >= t + SEGMENT_AHEAD_MS) return; // far enough ahead
        }

        const from = s.segCursor;
        const end = nextAiChunkEnd(s.words, from);
        if (end <= from) return;
        const chunk = s.words.slice(from, end);
        const abort = s.abort;
        const key = resolveServiceKey();
        const providerId = key.startsWith(AI_PREFIX) ? key.slice(AI_PREFIX.length) : undefined;

        s.segmenting = true;
        void (async () => {
            let cues: SubtitleCue[] | null = null;
            try {
                cues = await segmentChunkWithAi(chunk, providerId, abort.signal);
            } catch (e) {
                if (abort.signal.aborted || session !== s) return;
                s.segFailures++;
                console.warn("duo video subtitle: AI segmentation failed, falling back", e);
            } finally {
                if (session === s) s.segmenting = false;
            }
            if (abort.signal.aborted || session !== s) return;
            // Defensive: `segmenting` keeps chunks serialized, so the cursor
            // cannot move under a request today. If it ever does (concurrent
            // chunks), appending this one would put `starts` out of order.
            if (s.segCursor !== from) return;

            if (!cues || cues.length === 0) cues = segmentWords(chunk);
            appendCues(s, cues);
            s.segCursor = end;

            if (s.segFailures >= MAX_SEGMENT_FAILURES) {
                // Stop paying for a provider that is not cooperating; the rest
                // of the track is segmented locally, right now.
                s.aiSegment = false;
                appendCues(s, segmentWords(s.words.slice(end)));
                s.segCursor = s.words.length;
            }
            ensureTranslatedAhead(currentCueIndex(nowMs()) ?? Math.max(0, s.cues.length - cues.length));
        })();
    };

    // ------------------------------------------------------------------
    // Pre-translation scheduler
    // ------------------------------------------------------------------

    const ensureTranslatedAhead = (fromIdx: number) => {
        const s = session;
        if (!s || s.translating || s.cues.length === 0 || !isEnabled()) return;
        const service = resolveServiceKey();
        const lang = targetLanguage();
        const key = `${service}|${lang}`;
        if (s.translationKey && s.translationKey !== key) {
            // Service / target language changed — existing translations are stale.
            for (const c of s.cues) c.translated = undefined;
        }
        s.translationKey = key;

        const end = Math.min(s.cues.length, fromIdx + TRANSLATE_AHEAD);
        const pendingIdx: number[] = [];
        for (let i = fromIdx; i < end && pendingIdx.length < TRANSLATE_BATCH; i++) {
            if (s.cues[i].translated === undefined) pendingIdx.push(i);
        }
        if (pendingIdx.length === 0) return;

        s.translating = true;
        const texts = pendingIdx.map((i) => s.cues[i].text);
        void translateTextsWithCache(service, texts, lang, s.abort.signal)
            .then((results) => {
                if (session !== s || s.abort.signal.aborted) return;
                if (!results || results.length !== texts.length) return;
                if (s.translationKey !== key) return; // superseded mid-flight
                for (let k = 0; k < pendingIdx.length; k++) {
                    s.cues[pendingIdx[k]].translated = results[k]?.translatedMappedHtmlText ?? "";
                }
            })
            .catch(() => { /* transient provider failure — retried next tick */ })
            .finally(() => {
                if (session === s) s.translating = false;
            });
    };

    // ------------------------------------------------------------------
    // Feature teardown / tick loop
    // ------------------------------------------------------------------

    const teardownFeature = () => {
        resetSession();
        overlay?.destroy();
        overlay = null;
        controls?.destroy();
        controls = null;
        player = null;
        video = null;
    };

    const tick = () => {
        if (destroyed) return;

        const on = readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_SWITCH, DEFAULT_VALUE.VIDEO_SUBTITLE_SWITCH);
        if (on !== featureOn) {
            featureOn = on;
            if (!on) teardownFeature();
        }
        if (!featureOn) return;

        const videoId = currentYoutubeVideoId();
        if (!videoId) {
            // Not a watch page — drop the session, keep surfaces for the next one.
            if (session) resetSession();
            return;
        }

        ensureSurfaces();
        if (!player || !overlay) return;
        controls?.ensureButton();

        if (!session || session.videoId !== videoId) startSession(videoId);

        // Kick off the caption load — and retry a failed one — but never while
        // an ad is playing: the player then reports the ad's video, so every
        // attempt is doomed and would just burn the retry budget. This is also
        // why the load is driven from here rather than from startSession: a
        // video that opens on a pre-roll must still pick up its captions once
        // the ad is over.
        if (
            (session!.loadState === "pending") &&
            !isAdShowing() &&
            Date.now() >= session!.nextRetryAt
        ) {
            loadCaptions(session!);
        }

        // Live style / mode / position updates from Options.
        const styleJson = JSON.stringify(currentStyle());
        if (styleJson !== lastStyleJson) {
            lastStyleJson = styleJson;
            overlay.setStyle(currentStyle());
        }
        const mode = readMode();
        if (mode !== lastMode) {
            lastMode = mode;
            overlay.setMode(mode);
        }
        const pauseOnSelect = readConfig<boolean>(
            CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT,
            DEFAULT_VALUE.VIDEO_SUBTITLE_PAUSE_ON_SELECT,
        );
        if (pauseOnSelect !== lastPauseOnSelect) {
            lastPauseOnSelect = pauseOnSelect;
            overlay.setPauseOnSelect(pauseOnSelect);
        }
        // Position edited elsewhere (Options, another tab). Comparing against
        // the last CONFIG value — not the overlay's own — means an in-flight
        // drag is never fought.
        const positionPct = readPositionPct();
        if (positionPct !== lastPositionPct) {
            lastPositionPct = positionPct;
            overlay.setPosition(positionPct);
        }
        // Menu checkmark — keeps the mark honest when auto-enable is changed
        // from Options while the page is open.
        const enabledNow = isEnabled();
        if (enabledNow !== lastEnabled) {
            lastEnabled = enabledNow;
            controls?.setEnabled(enabledNow);
        }

        if (!enabledNow || session!.loadState !== "ready") {
            overlay.hide();
            setNativeCaptionsHidden(false);
            return;
        }

        // Ads: no processing at all — hide and wait for the content video.
        if (isAdShowing()) {
            overlay.hide();
            return;
        }

        setNativeCaptionsHidden(true);
        const t = nowMs();
        // AI mode: pull in the next chunk before the playhead reaches the end of
        // the segmented region.
        ensureSegmentedAhead(t);
        const idx = currentCueIndex(t);
        if (idx === null) {
            overlay.hide();
        } else {
            overlay.show(session!.cues[idx]);
        }
        ensureTranslatedAhead(idx ?? (currentCueIndex(t + 3000) ?? 0));
    };

    // Nothing runs until config is on hand. Two symptoms this prevents: the
    // player button flashing on screen on a page where the feature is disabled
    // (the switch reads as its `true` default pre-hydration, so the button
    // mounts and is torn straight back off), and a caption load committing to
    // the default segmentation / service / language for the whole video.
    let timer = 0;
    void whenConfigHydrated(REQUIRED_CONFIG_KEYS).then(() => {
        if (destroyed) return;
        timer = window.setInterval(tick, TICK_MS);
        tick();
    });

    return {
        destroy() {
            destroyed = true;
            if (timer) window.clearInterval(timer);
            teardownFeature();
        },
    };
}
