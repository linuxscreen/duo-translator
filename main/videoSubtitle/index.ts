import {
    AI_PREFIX,
    browserTargetLanguage,
    CONFIG_KEY,
    normalizeLanguageTag,
    VIDEO_SUBTITLE_DISPLAY_MODE,
    VIDEO_SUBTITLE_SOURCE_POLICY,
} from "@/main/constants";
import { readConfig } from "@/utils/reactiveConfig";
import { setConfig } from "@/utils/db";
import { buildNoTranslateLanguageSet, isNoTranslateLanguage } from "@/main/noTranslateLanguage";
import { buildAiTranslateService } from "@/utils/service";
import { translateTexts } from "@/main/translateClient";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";
import { SubtitleOverlay } from "./overlay";
import { mountSubtitleControls, type SubtitleControlsController } from "./controls";
import { nextAiChunkEnd, segmentChunkWithAi, segmentWords, wordIndexAtTime } from "./segmenter";
import { YoutubeAdapter, currentYoutubeVideoId } from "./youtube";
import {
    normalizeVideoSubtitleStyle,
    type SourcePreference,
    type SubtitleCue,
    type SubtitleWord,
} from "./types";
import { bottomControlsInsetPx } from "./playerMetrics";
import {
    buildSrt,
    downloadTextFile,
    subtitleFileName,
    type SubtitleDownloadKind,
    type SubtitleDownloadState,
} from "./download";

/**
 * Video bilingual subtitles — controller. Currently YouTube only; the fetch /
 * parse side is behind {@link YoutubeAdapter} so other sites can slot in.
 *
 * Lifecycle: created once per top-frame page load on a supported site. It
 * follows CONFIG_KEY.VIDEO_SUBTITLE_SWITCH live (config values are re-read
 * through `readConfig` inside the tick loop — cached after the first read, and
 * covers every setting without per-key wiring). Video changes are detected from
 * the URL each tick (YouTube is an SPA).
 *
 * Nearly everything here is async only because `readConfig` is: a config read
 * that cannot be trusted on its first call is worse than one that awaits.
 */

export interface VideoSubtitleController {
    destroy(): void;
    /**
     * Flip the per-tab "Enable bilingual subtitles" switch — the very one the
     * player menu shows. Reached from a custom shortcut.
     */
    toggleEnabled(): void;
}

const TICK_MS = 150;
/** Translate this many cues ahead of the playhead. */
const TRANSLATE_AHEAD = 30;
const TRANSLATE_BATCH = 12;
/** Keep a cue on screen across a short gap to the next one (anti-flicker). */
const LINGER_MS = 500;

const CAPTION_HIDE_STYLE_ID = "duo-yt-native-caption-hide";

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
    /**
     * Language of the loaded caption track, normalized for comparison with the
     * target language. "" when unknown (never equals a target, so translation
     * still runs — the safe direction).
     */
    sourceLang: string;
    /** Id of the loaded track, to notice the user switching CC language. */
    trackId: string;
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
    /**
     * The loaded track's language is on the user's no-translate list. A sticky
     * fact about this video's captions, so the menu keeps offering "Original
     * only (this time)" even after the user has picked something else.
     */
    captionLanguageExcluded: boolean;
    /**
     * That rule is currently in force: show the original only, WITHOUT writing
     * it into the display-mode setting.
     *
     * Starts equal to `captionLanguageExcluded` and is cleared the moment the
     * user picks bilingual / translation-only — that choice is explicit and
     * goes to config as usual. Per session, because it answers a question about
     * this video's track; the next video re-decides from its own.
     */
    originalOnlyByLanguage: boolean;
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
 * How often to ask the site which caption track the user has selected.
 *
 * The player response lists every track in a fixed order and says nothing about
 * the current choice, so switching subtitle language mid-video is invisible
 * until this poll notices it. One postMessage round-trip per interval, and only
 * while subtitles are actually on screen.
 */
const TRACK_RECHECK_MS = 2000;

/**
 * Where a source language pinned from the player menu lives.
 *
 * `sessionStorage`, not config: the pin is chosen from ONE video's track list,
 * so it is scoped to the tab the user is watching in. Session storage is
 * exactly that scope — per tab, per origin, gone when the tab closes — and it
 * survives YouTube's SPA navigations for free, which a variable in the
 * controller would not once the page re-creates it.
 */
const PINNED_SOURCE_LANG_KEY = "duo-video-subtitle-source-lang";

/** Both wrapped: session storage throws outright in some privacy modes. */
function readPinnedSourceLang(): string {
    try {
        return window.sessionStorage.getItem(PINNED_SOURCE_LANG_KEY) ?? "";
    } catch {
        return "";
    }
}

function writePinnedSourceLang(lang: string): void {
    try {
        if (lang) window.sessionStorage.setItem(PINNED_SOURCE_LANG_KEY, lang);
        else window.sessionStorage.removeItem(PINNED_SOURCE_LANG_KEY);
    } catch { /* storage unavailable — the pin just does not stick */ }
}

export function initVideoSubtitle(): VideoSubtitleController {
    const adapter = new YoutubeAdapter();

    let destroyed = false;
    /**
     * Feature switch as of the last tick (teardown/re-setup edge detection).
     * Null until the first tick has read it.
     */
    let featureOn: boolean | null = null;
    /** Per-tab user override from the player menu; null = follow auto-enable. */
    let sessionEnabled: boolean | null = null;
    /**
     * Load this video's captions even though the overlay is off, because the
     * user asked for the one thing that needs the track anyway: an SRT
     * download. Reset per video — a new one has nothing pending.
     */
    let captionsRequested = false;
    let session: VideoSession | null = null;
    let player: HTMLElement | null = null;
    let video: HTMLVideoElement | null = null;
    let overlay: SubtitleOverlay | null = null;
    let controls: SubtitleControlsController | null = null;
    let lastStyleJson = "";
    let lastMode = "";
    let lastPauseOnSelect: boolean | null = null;
    /** Serialized dictionary-hover context (switch + both languages). */
    let lastDictKey = "";
    /** Source policy as of the last tick, to notice a change from Options. */
    let lastSourcePolicy: string | null = null;
    /** Last position value seen in config (live-edit edge detection). */
    let lastPositionPct: number | null = null;
    /** Last enabled-state pushed into the player menu's checkmark. */
    let lastEnabled: boolean | null = null;

    const isEnabled = async () =>
        sessionEnabled ??
        (await readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE));

    /**
     * Subtitle target language: the feature's own setting, falling back to the
     * page-translation target (and finally the browser UI language) when the
     * user has never picked one.
     */
    const targetLanguage = async () =>
        (await readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE)) ||
        (await readConfig<string>(CONFIG_KEY.TARGET_LANGUAGE)) ||
        browserTargetLanguage();

    /**
     * Which service translates the subtitles, in priority order: the setting
     * made for subtitles → the page-translation setting → the first enabled
     * translator (Microsoft if even that list is empty).
     *
     * `buildAiTranslateService` alone cannot express this — handed an unusable
     * value it drops straight to the first enabled translator, stepping over
     * the page-translation choice the user has already made. So the two
     * candidates are tested against the enabled lists here and the resolver is
     * asked for nothing but the final fallback.
     */
    const resolveServiceKey = async () => {
        const [subtitleKey, pageKey, providers, disabled] = await Promise.all([
            readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE),
            readConfig<string>(CONFIG_KEY.TRANSLATE_SERVICE),
            readConfig<unknown[]>(CONFIG_KEY.AI_PROVIDERS),
            readConfig<string[]>(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES),
        ]);
        const ctx = buildAiTranslateService(undefined, providers, disabled);
        const usable = (key: string | undefined): key is string => {
            if (!key) return false;
            return key.startsWith(AI_PREFIX)
                ? ctx.enabledAiProviders.some((p) => `${AI_PREFIX}${p.id}` === key)
                : ctx.enabledTranslateServices.some((s) => s.value === key);
        };
        if (usable(subtitleKey)) return subtitleKey;
        if (usable(pageKey)) return pageKey;
        return ctx.activeService;
    };

    /** The source-language preference `pickTrack` is asked with. */
    const sourcePreference = async (): Promise<SourcePreference> => ({
        policy: await readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_SOURCE_POLICY),
        // Read fresh rather than cached: the pin is in session storage so it is
        // already correct after an SPA navigation, with nothing to re-sync.
        manualLang: readPinnedSourceLang() || undefined,
    });

    const currentStyle = async () =>
        normalizeVideoSubtitleStyle(await readConfig<unknown>(CONFIG_KEY.VIDEO_SUBTITLE_STYLE));

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

    const ensureSurfaces = async () => {
        const p = document.getElementById("movie_player");
        if (!(p instanceof HTMLElement)) return;
        if (player !== p || !overlay || !document.getElementById("duo-video-subtitle-box")) {
            // Read everything the surfaces need BEFORE creating them: an await
            // between `player = p` and the mount would let the next tick see a
            // half-built state and mount a second copy.
            const [style, positionPct, mode, pauseOnSelect, enabled] = await Promise.all([
                currentStyle(),
                readPositionPct(),
                readMode(),
                readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT),
                isEnabled(),
            ]);
            if (destroyed) return;

            player = p;
            video = p.querySelector("video");
            overlay?.destroy();
            overlay = new SubtitleOverlay(p, style, positionPct, {
                onPositionChange: (pct) => {
                    // Record it as "already applied" so the sync below treats
                    // the resulting storage change as a no-op.
                    lastPositionPct = pct;
                    void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_POSITION, pct);
                },
                reservedBottomPx: () => bottomControlsInsetPx(p),
            });
            lastStyleJson = JSON.stringify(style);
            lastMode = effectiveMode(mode);
            overlay.setMode(lastMode);
            lastPauseOnSelect = pauseOnSelect;
            overlay.setPauseOnSelect(pauseOnSelect);
            // Fresh overlay, so whatever was pushed into the old one is gone —
            // the tick's comparison must not skip re-pushing it.
            lastDictKey = "";
            lastPositionPct = positionPct;

            controls?.destroy();
            controls = mountSubtitleControls({
                player: p,
                initialEnabled: enabled,
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
                onPinnedSourceLanguage: setPinnedSourceLanguage,
                onOriginalOnlyOnce: () => {
                    if (session) session.originalOnlyByLanguage = true;
                    publishLanguageOverride();
                },
                onDisplayModePicked: () => {
                    // Bilingual / translation-only: an explicit override of the
                    // language rule for the rest of this video. The value
                    // itself is written to config by the menu; all this side
                    // has to do is stop forcing original-only.
                    if (session) session.originalOnlyByLanguage = false;
                    publishLanguageOverride();
                },
                onDownload: (kind) => void startDownload(kind),
                onCancelDownload: abortDownload,
                onDismissDownloadError: () => publishDownloadState(null),
            });
            lastEnabled = enabled;
            controls.setPinnedSourceLanguage(readPinnedSourceLang());
            // A menu rebuilt mid-video (YouTube re-rendered the controls) has
            // to be told again, or its "Original only (this time)" entry would
            // silently turn back into the plain one.
            publishLanguageOverride();
            // A job (or a failure the user has not dismissed) predating this
            // menu must show up in it rather than be lost with the old one.
            if (downloadState) controls.setDownloadState(downloadState);
            if (session) {
                controls.setAvailability(availabilityOf(session));
                // A fresh menu starts with an empty picker; re-publish this
                // video's languages instead of waiting for the next load.
                void adapter.listTracks().then((tracks) => {
                    controls?.setSourceTracks(adapter.sourceOptions(tracks));
                });
            }
        }
        if (!video || !video.isConnected) video = p.querySelector("video");
    };

    const readPositionPct = () =>
        readConfig<number>(CONFIG_KEY.VIDEO_SUBTITLE_POSITION);

    const readMode = () =>
        readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE);

    const readNoTranslateLanguages = async () =>
        buildNoTranslateLanguageSet(await readConfig<string[]>(CONFIG_KEY.NO_TRANSLATE_LANGUAGES));

    /**
     * The mode actually rendered. The stored setting is overridden — for this
     * video only — when its captions are already in a language the user asked
     * us not to translate. Everything that consumes a mode goes through here so
     * the overlay and the pre-translation scheduler cannot disagree.
     */
    const effectiveMode = (configMode: string) =>
        session?.originalOnlyByLanguage ? VIDEO_SUBTITLE_DISPLAY_MODE.ORIGINAL : configMode;

    /** Push the language rule's two flags into the menu. */
    const publishLanguageOverride = () => {
        controls?.setLanguageOverride({
            excluded: !!session?.captionLanguageExcluded,
            active: !!session?.originalOnlyByLanguage,
        });
    };

    const availabilityOf = (s: VideoSession) =>
        s.loadState === "ready" ? "available" as const
            : s.loadState === "gaveup" ? "unavailable" as const
                : "loading" as const;

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
            sourceLang: "",
            trackId: "",
            words: [],
            cues: [],
            starts: [],
            translating: false,
            translationKey: "",
            loadState: "pending",
            loadAttempts: 0,
            nextRetryAt: 0,
            captionLanguageExcluded: false,
            originalOnlyByLanguage: false,
            aiSegment: false,
            segCursor: 0,
            segmenting: false,
            segFailures: 0,
        };
        captionsRequested = false;
        pendingDownloadKind = null;
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
        if (exhausted) {
            console.warn("duo video subtitle: giving up on captions —", reason);
            // A queued download would otherwise wait forever on a track that is
            // never coming.
            if (pendingDownloadKind) {
                const queued = pendingDownloadKind;
                pendingDownloadKind = null;
                publishDownloadState({ kind: queued, percent: 0, error: reason });
            }
        }
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
                // The menu's manual picker lists this video's languages, so it
                // is refreshed from the same place the list is read.
                controls?.setSourceTracks(adapter.sourceOptions(tracks));
                const track = adapter.pickTrack(tracks, await sourcePreference());
                if (abort.signal.aborted || session !== s) return;
                if (!track) {
                    failLoad(s, "no caption track");
                    return;
                }
                s.sourceLang = normalizeLanguageTag(track.languageCode);
                s.trackId = track.id;
                // Decided here rather than in the tick: this is the one moment
                // the track's language becomes known, and the answer must be in
                // place before the pre-translation scheduler asks for a mode —
                // otherwise the first cues are translated and then hidden.
                const excluded = isNoTranslateLanguage(s.sourceLang, await readNoTranslateLanguages());
                if (abort.signal.aborted || session !== s) return;
                s.captionLanguageExcluded = excluded;
                s.originalOnlyByLanguage = excluded;
                publishLanguageOverride();
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
                s.aiSegment = await readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_AI_SEGMENT);
                if (abort.signal.aborted || session !== s) return;

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
                if (pendingDownloadKind) {
                    const queued = pendingDownloadKind;
                    pendingDownloadKind = null;
                    void startDownload(queued);
                }
                // Get the first chunk / the first translations moving now rather
                // than on the next tick.
                void ensureSegmentedAhead(nowMs());
                void ensureTranslatedAhead(currentCueIndex(nowMs()) ?? 0);
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
    // Following the user's caption-track choice
    // ------------------------------------------------------------------

    let nextTrackCheckAt = 0;
    let checkingTrack = false;

    /**
     * Reload the session when the track we SHOULD be reading changes.
     *
     * The comparison is "what would be picked now" against what is loaded — not
     * "did the user explicitly select something", which is what this did before
     * the source-language policy existed. That older, narrower rule cannot
     * express the policy: turning captions off has to fall through to the audio
     * language, and switching dub has to be followed too, and neither is an
     * explicit caption selection.
     *
     * Re-picking is also what keeps this from looping. A video with no track in
     * the audio language re-picks the same fallback track every time, so the
     * ids match and nothing reloads — whereas comparing raw languages would
     * see a permanent mismatch and restart the session forever.
     */
    const followSourceTrack = async () => {
        const s = session;
        if (!s || s.loadState !== "ready" || checkingTrack) return;
        if (Date.now() < nextTrackCheckAt || !adapter.refreshSourceState) return;
        checkingTrack = true;
        try {
            const fresh = await adapter.refreshSourceState();
            nextTrackCheckAt = Date.now() + TRACK_RECHECK_MS;
            if (!fresh || session !== s) return;
            const tracks = await adapter.listTracks();
            const want = adapter.pickTrack(tracks, await sourcePreference());
            if (session !== s || !want || want.id === s.trackId) return;
            // Same machinery as a video change: abort what is in flight, drop
            // the cues, and let the tick loop load the new track.
            startSession(s.videoId);
        } finally {
            checkingTrack = false;
        }
    };

    /**
     * Native caption switch as of the last observation; null = not observed yet
     * (also the state the follow setting is re-armed to when switched off, so
     * turning it back on re-syncs instead of waiting for the next CC toggle).
     */
    let lastNativeCcOn: boolean | null = null;

    /**
     * Mirror the player's own caption switch onto ours, when the user asked for
     * it (CONFIG_KEY.VIDEO_SUBTITLE_FOLLOW_NATIVE_CC).
     *
     * Strictly one-way. Our own toggle never touches the player's captions, so
     * this only ever reads — and it acts on CHANGES rather than on the level.
     * Following the level would make our menu toggle look broken: switching our
     * subtitles on while native captions are off would be undone within the
     * tick, every time.
     *
     * Never WHILE a track is being fetched: that makes the bridge drive the
     * player's caption module (and restore it afterwards), which flickers the
     * very button this reads. Before the load is another matter — it has to
     * work there, because an overlay that is off no longer loads anything at
     * all (see the tick), so waiting for `ready` would leave this setting with
     * nothing to observe on precisely the videos it exists for. Reading the
     * button early is also what keeps the follow honest: native captions off
     * now means our subtitles stay off, and no track is fetched.
     */
    const followNativeCaptions = (followEnabled: boolean) => {
        if (!followEnabled) {
            lastNativeCcOn = null;
            return;
        }
        if (!player || !adapter.nativeCaptionsOn || session?.loadState === "loading") return;
        const on = adapter.nativeCaptionsOn(player);
        if (on === null || on === lastNativeCcOn) return;
        lastNativeCcOn = on;
        // Nothing else to do here: the rest of the tick reads `isEnabled()`,
        // pushes the new state into the menu and hides/shows the overlay.
        sessionEnabled = on;
    };

    /**
     * The session switch, flipped from outside (a custom shortcut).
     *
     * Deliberately NOT `VIDEO_SUBTITLE_SWITCH`: that one means "disable
     * everywhere", sits behind a confirm dialog, and tears the player button
     * down with it. A shortcut is pressed casually, so it has to be as cheap to
     * undo as it was to fire — which is exactly what the menu's own switch is.
     *
     * Nothing else to do here. The tick reads `sessionEnabled`, pushes the new
     * state into the menu and hides or shows the overlay, the same way it
     * follows the menu switch and the native-CC follow; at 150 ms that is not a
     * delay anyone can see, and it keeps one code path owning the transition.
     */
    const toggleEnabled = () => {
        void isEnabled().then((on) => { sessionEnabled = !on; });
    };

    /**
     * A language picked in the player menu's source-language dropdown ("" =
     * back to the policy). Applies immediately — the user is looking at the
     * subtitle they want changed.
     */
    const setPinnedSourceLanguage = (lang: string) => {
        writePinnedSourceLang(lang);
        controls?.setPinnedSourceLanguage(lang);
        // Force the next poll to act rather than wait out its interval.
        nextTrackCheckAt = 0;
        void followSourceTrack();
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
    const ensureSegmentedAhead = async (t: number) => {
        const s = session;
        if (!s || !s.aiSegment || s.segmenting || s.loadState !== "ready") return;

        // Resolve the provider first: awaiting after the `segmenting` flag is
        // set would be fine, but awaiting between the checks below and setting
        // it would let a second tick start the same chunk twice.
        const key = await resolveServiceKey();
        const providerId = key.startsWith(AI_PREFIX) ? key.slice(AI_PREFIX.length) : undefined;
        // Re-check: the state may have moved while that read was in flight.
        if (session !== s || !s.aiSegment || s.segmenting || s.loadState !== "ready") return;

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

        s.segmenting = true;
        void (async () => {
            let cues: SubtitleCue[] | null = null;
            try {
                cues = await segmentChunkWithAi(chunk, providerId, abort.signal);
            } catch (e) {
                if (abort.signal.aborted || session !== s) return;
                s.segFailures++;
                // `silent`: segmentWords below is a working fallback, so the
                // user still gets subtitles and has nothing to act on. The
                // console line stays complete for diagnosis.
                reportRequestError(ERROR_SCOPE.SUBTITLE, e, {
                    silent: true,
                    detail: { phase: "AI segmentation", providerId, failures: s.segFailures },
                });
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
            void ensureTranslatedAhead(currentCueIndex(nowMs()) ?? Math.max(0, s.cues.length - cues.length));
        })();
    };

    // ------------------------------------------------------------------
    // Pre-translation scheduler
    // ------------------------------------------------------------------

    const ensureTranslatedAhead = async (fromIdx: number) => {
        const s = session;
        if (!s || s.translating || s.cues.length === 0) return;

        const [enabled, service, lang, mode] = await Promise.all([
            isEnabled(),
            resolveServiceKey(),
            targetLanguage(),
            readMode(),
        ]);
        // Everything from here to `s.translating = true` runs without another
        // await, so two overlapping calls cannot both get past the flag.
        if (!enabled || session !== s || s.translating || s.cues.length === 0) return;
        // Original-only: no provider call for a translation nobody will see.
        // Returning before the translationKey bookkeeping is deliberate —
        // whatever was already translated stays on the cues, so switching back
        // to bilingual shows it instantly instead of re-fetching the track.
        // Also covers "this track is in a no-translate language" — that is the
        // whole point of routing the mode through effectiveMode: the saving is
        // the provider call, not just the hidden line.
        if (effectiveMode(mode) === VIDEO_SUBTITLE_DISPLAY_MODE.ORIGINAL) return;

        const key = `${service}|${lang}`;
        if (s.translationKey && s.translationKey !== key) {
            // Service / target language changed — existing translations are stale.
            for (const c of s.cues) c.translated = undefined;
        }
        s.translationKey = key;

        // Captions already in the target language: nothing to translate, and a
        // second identical line under every cue is just noise. Checked here
        // rather than at load so switching the target language to (or away
        // from) the caption language takes effect immediately — the stale-key
        // sweep above has already dropped any translations from before.
        if (s.sourceLang !== "" && s.sourceLang === normalizeLanguageTag(lang)) return;

        const end = Math.min(s.cues.length, fromIdx + TRANSLATE_AHEAD);
        const pendingIdx: number[] = [];
        for (let i = fromIdx; i < end && pendingIdx.length < TRANSLATE_BATCH; i++) {
            if (s.cues[i].translated === undefined) pendingIdx.push(i);
        }
        if (pendingIdx.length === 0) return;

        s.translating = true;
        const texts = pendingIdx.map((i) => s.cues[i].text);
        void translateTexts(service, texts, lang, s.abort.signal)
            .then((results) => {
                if (session !== s || s.abort.signal.aborted) return;
                if (!results || results.length !== texts.length) return;
                if (s.translationKey !== key) return; // superseded mid-flight
                for (let k = 0; k < pendingIdx.length; k++) {
                    s.cues[pendingIdx[k]].translated = results[k]?.translatedMappedHtmlText ?? "";
                }
            })
            .catch((e) => {
                // Retried on the next tick, so a transient blip self-heals —
                // but a persistent one (dead endpoint, bad key) used to mean
                // subtitles that simply never became bilingual, silently. The
                // bubble's dedupe collapses the per-tick repeats into one entry
                // with a counter, so reporting here cannot spam.
                if (session !== s || s.abort.signal.aborted) return;
                reportRequestError(ERROR_SCOPE.SUBTITLE, e, { detail: { service, lang } });
            })
            .finally(() => {
                if (session === s) s.translating = false;
            });
    };

    // ------------------------------------------------------------------
    // Subtitle download
    // ------------------------------------------------------------------

    /**
     * One download job at a time. It deliberately does NOT hang off the
     * session's AbortController: the cues are snapshotted when the job starts,
     * so an unrelated reload (a caption-track switch, the pre-translation
     * scheduler restarting) must not throw away a file the user is waiting for.
     * A video change does cancel it — see `abortDownload`.
     */
    interface DownloadJob {
        kind: SubtitleDownloadKind;
        abort: AbortController;
    }
    let downloadJob: DownloadJob | null = null;
    /**
     * A download asked for before the track was in — either it is still
     * loading, or nothing had started it because the overlay is off. Runs as
     * soon as the captions land.
     */
    let pendingDownloadKind: SubtitleDownloadKind | null = null;
    /**
     * Last state pushed into the menu, kept here too: the controls are rebuilt
     * whenever YouTube re-renders its player, and the job outlives that.
     */
    let downloadState: SubtitleDownloadState | null = null;

    /** Bigger batches than playback uses: nobody is waiting on a first cue. */
    const DOWNLOAD_BATCH = 20;

    const abortDownload = () => {
        // A queued download has no job to abort yet, and its panel is only
        // taken down here (the job's `finally` is what clears a running one).
        if (pendingDownloadKind) {
            pendingDownloadKind = null;
            publishDownloadState(null);
        }
        downloadJob?.abort.abort();
    };

    const publishDownloadState = (state: SubtitleDownloadState | null) => {
        downloadState = state;
        controls?.setDownloadState(state);
    };

    const startDownload = async (kind: SubtitleDownloadKind) => {
        if (downloadJob) return;
        const s = session;
        if (!s || s.loadState === "gaveup") return;
        if (s.loadState !== "ready") {
            // The captions are not in. Ask for them — this is the one request
            // that loads a track with the overlay switched off — and let the
            // load's own completion start the job. The panel goes up now so the
            // click is not silently swallowed, and so Cancel is reachable.
            pendingDownloadKind = kind;
            captionsRequested = true;
            publishDownloadState({ kind, percent: 0 });
            return;
        }
        if (s.words.length === 0) return;
        const job: DownloadJob = { kind, abort: new AbortController() };
        downloadJob = job;
        publishDownloadState({ kind, percent: 0 });

        let failure = "";
        try {
            // Rule-based segmentation over the WHOLE track, even when this
            // session is running AI segmentation: that path is lazy by design —
            // only the stretch around the playhead is ever segmented — so a file
            // built from its cues would stop wherever the viewer happened to be.
            // Copies, so filling in translations cannot touch what is on screen.
            const cues = segmentWords(s.words).map((c) => ({ ...c }));
            if (cues.length === 0) throw new Error("segmentation produced no cues");

            const [service, lang] = await Promise.all([resolveServiceKey(), targetLanguage()]);
            // Same rule as the on-screen path: a track already in the target
            // language is not translated, and the file falls back to originals.
            const sameLanguage = s.sourceLang !== "" && s.sourceLang === normalizeLanguageTag(lang);

            if (kind !== "original" && !sameLanguage) {
                for (let i = 0; i < cues.length; i += DOWNLOAD_BATCH) {
                    const batch = cues.slice(i, i + DOWNLOAD_BATCH);
                    const results = await translateTexts(
                        service,
                        batch.map((c) => c.text),
                        lang,
                        job.abort.signal,
                    );
                    if (job.abort.signal.aborted) return;
                    if (results && results.length === batch.length) {
                        for (let k = 0; k < batch.length; k++) {
                            batch[k].translated = results[k]?.translatedMappedHtmlText ?? "";
                        }
                    }
                    // Held below 100 until the file is actually built, so the
                    // number never sits at "done" with nothing downloaded.
                    const done = Math.min(cues.length, i + DOWNLOAD_BATCH);
                    publishDownloadState({
                        kind,
                        percent: Math.min(99, Math.round((done / cues.length) * 100)),
                    });
                }
            }
            if (job.abort.signal.aborted) return;
            publishDownloadState({ kind, percent: 100 });
            downloadTextFile(
                subtitleFileName(currentVideoTitle(), kind, lang, s.videoId),
                buildSrt(cues, kind),
            );
        } catch (e) {
            if (job.abort.signal.aborted) return;
            failure = String((e as Error)?.message ?? e);
            reportRequestError(ERROR_SCOPE.SUBTITLE, e, {
                detail: { phase: "subtitle download", kind },
            });
        } finally {
            if (downloadJob === job) {
                downloadJob = null;
                // A failure keeps the panel up (with its message) until the user
                // dismisses it; success and cancellation just clear it.
                publishDownloadState(failure ? { kind, percent: 0, error: failure } : null);
            }
        }
    };

    /** Best-effort video title for the file name. */
    const currentVideoTitle = (): string => {
        const heading = document.querySelector<HTMLElement>(
            "h1.ytd-watch-metadata yt-formatted-string, #movie_player .ytp-title-link",
        );
        const fromDom = heading?.textContent?.trim();
        if (fromDom) return fromDom;
        return document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    };

    // ------------------------------------------------------------------
    // Feature teardown / tick loop
    // ------------------------------------------------------------------

    const teardownFeature = () => {
        abortDownload();
        resetSession();
        overlay?.destroy();
        overlay = null;
        controls?.destroy();
        controls = null;
        player = null;
        video = null;
    };

    const tick = async () => {
        if (destroyed) return;

        const on = await readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_SWITCH);
        if (destroyed) return;
        if (on !== featureOn) {
            featureOn = on;
            if (!on) teardownFeature();
        }
        if (!featureOn) return;

        const videoId = currentYoutubeVideoId();
        if (!videoId) {
            // Not a watch page — drop the session, keep surfaces for the next one.
            if (session) {
                abortDownload();
                resetSession();
            }
            return;
        }

        await ensureSurfaces();
        if (destroyed || !player || !overlay) return;
        controls?.ensureButton();

        if (!session || session.videoId !== videoId) {
            // Another video — the job's cues belong to the old one.
            abortDownload();
            startSession(videoId);
        }
        const sessionAtStart = session;

        // Live style / mode / position / enabled updates from Options. One
        // batch, so the whole group is applied against a single overlay
        // instance — reading them one await at a time could straddle a
        // teardown.
        const [style, mode, pauseOnSelect, positionPct, autoEnable, followNativeCc, hoverDict, dictLang] =
            await Promise.all([
                currentStyle(),
                readMode(),
                readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT),
                readPositionPct(),
                readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE),
                readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_FOLLOW_NATIVE_CC),
                readConfig<boolean>(CONFIG_KEY.VIDEO_SUBTITLE_HOVER_DICT),
                targetLanguage(),
            ]);
        if (destroyed || !overlay || session !== sessionAtStart) return;

        // Before `enabledNow` is derived, so a caption switch the user just
        // flipped takes effect on THIS tick rather than 150ms later. This is
        // also why the batch reads auto-enable rather than calling `isEnabled()`
        // — the answer has to be computed after the follow, and computing it
        // from `sessionEnabled` needs no further await.
        followNativeCaptions(followNativeCc);
        const enabledNow = sessionEnabled ?? autoEnable;

        // Kick off the caption load — and retry a failed one — but never while
        // an ad is playing: the player then reports the ad's video, so every
        // attempt is doomed and would just burn the retry budget. This is also
        // why the load is driven from here rather than from startSession: a
        // video that opens on a pre-roll must still pick up its captions once
        // the ad is over.
        //
        // ONLY WHEN THE SUBTITLES ARE ACTUALLY WANTED, which is why this sits
        // after `enabledNow` rather than at the top of the tick. Fetching a
        // track is not a read: the bridge makes the player SELECT it, and
        // YouTube records that as the viewer's own caption preference — it
        // survives the bridge's `unloadModule` restore, so it comes back on the
        // next video and on the next page load. Loading captions for an overlay
        // that is switched off therefore turns the site's native captions on
        // for good, which is exactly what the user did not ask for.
        // `captionsRequested` is the one escape hatch: an SRT download needs
        // the track whether or not anything is on screen.
        if (
            (enabledNow || captionsRequested) &&
            session!.loadState === "pending" &&
            !isAdShowing() &&
            Date.now() >= session!.nextRetryAt
        ) {
            loadCaptions(session!);
        }

        const styleJson = JSON.stringify(style);
        if (styleJson !== lastStyleJson) {
            lastStyleJson = styleJson;
            overlay.setStyle(style);
        }
        // Compared AFTER the override, so the tick also picks up the moment the
        // track's language turns the override on (the load resolves between
        // ticks and never touches the stored mode).
        const shownMode = effectiveMode(mode);
        if (shownMode !== lastMode) {
            lastMode = shownMode;
            overlay.setMode(shownMode);
        }
        if (pauseOnSelect !== lastPauseOnSelect) {
            lastPauseOnSelect = pauseOnSelect;
            overlay.setPauseOnSelect(pauseOnSelect);
        }
        // The caption track's language is what lets the panel pick a dictionary
        // provider without asking both, so it travels with the switch — and it
        // only becomes known once the track has loaded, hence the re-push.
        const dictSourceLang = session?.sourceLang ?? "";
        const dictKey = `${hoverDict}|${dictSourceLang}|${dictLang}`;
        if (dictKey !== lastDictKey) {
            lastDictKey = dictKey;
            overlay.setDictContext({
                enabled: hoverDict,
                sourceLang: dictSourceLang,
                targetLang: dictLang,
            });
        }
        // Position edited elsewhere (Options, another tab). Comparing against
        // the last CONFIG value — not the overlay's own — means an in-flight
        // drag is never fought.
        if (positionPct !== lastPositionPct) {
            lastPositionPct = positionPct;
            overlay.setPosition(positionPct);
        }
        // Source-language policy switched in Options — re-pick right away
        // rather than at the next poll interval.
        const sourcePolicy = await readConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_SOURCE_POLICY);
        if (lastSourcePolicy !== null && sourcePolicy !== lastSourcePolicy) {
            nextTrackCheckAt = 0;
            void followSourceTrack();
        }
        lastSourcePolicy = sourcePolicy;

        // Menu checkmark — keeps the mark honest when auto-enable is changed
        // from Options while the page is open.
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
        // the segmented region. These are all fire-and-forget — they hold their
        // own in-flight flags, and the display below must not wait on a network
        // round-trip.
        void followSourceTrack();
        void ensureSegmentedAhead(t);
        const idx = currentCueIndex(t);
        if (idx === null) {
            overlay.hide();
        } else {
            overlay.show(session!.cues[idx]);
        }
        void ensureTranslatedAhead(idx ?? (currentCueIndex(t + 3000) ?? 0));
    };

    // `tick` awaits config reads, so a slow first read could otherwise let the
    // next interval start a second pass over the same half-built state.
    let ticking = false;
    const runTick = () => {
        if (ticking) return;
        ticking = true;
        void tick().finally(() => { ticking = false; });
    };

    const timer = window.setInterval(runTick, TICK_MS);
    runTick();

    return {
        destroy() {
            destroyed = true;
            window.clearInterval(timer);
            teardownFeature();
        },
        toggleEnabled,
    };
}
