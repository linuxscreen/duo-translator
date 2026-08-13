import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChevronRight, Download, Settings2, X, XCircle } from "lucide-react";
import { browser } from "wxt/browser";
import {
    ACTION,
    browserTargetLanguage,
    CONFIG_KEY,
    LANGUAGES,
    VIDEO_SUBTITLE_DISPLAY_MODE,
} from "@/main/constants";
import { setConfig } from "@/utils/db";
import { notifyBackground } from "@/utils/message";
import { useConfig } from "@/utils/reactiveConfig";
import { buildAiTranslateService, buildServiceOptions } from "@/utils/service";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { attachOwnShadow } from "@/main/dom/shadowRoots";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import { DUO_LOGO_SVG } from "@/main/floatBall/logo";
import type { SourceTrackOption } from "./types";
import type { SubtitleDownloadKind, SubtitleDownloadState } from "./download";

/**
 * Player quick controls for video bilingual subtitles: a DuoTranslator button
 * injected into the YouTube control bar (`.ytp-right-controls`) plus a Shadow
 * DOM React menu anchored above it. The menu edits config directly (mode /
 * service via `useConfig` + `setConfig`, the reactive-store pattern) while
 * session state (enabled / availability) is pushed in by the subtitle
 * controller through the imperative handle.
 */

export type SubtitleAvailability = "loading" | "available" | "unavailable";

export interface SubtitleControlsDeps {
    player: HTMLElement;
    initialEnabled: boolean;
    onToggleEnabled(next: boolean): void;
    /** "Disable permanently" confirmed — global switch already persisted. */
    onDisableForever(): void;
    /**
     * A source language picked in the menu ("" = back to the policy). Not
     * written to config by the menu: the pin is per-tab state owned by the
     * controller (sessionStorage), because a language read off one video's
     * track list is not a preference that can be replayed on another machine.
     */
    onPinnedSourceLanguage(languageCode: string): void;
    /** Build + save a subtitle file for the loaded track. */
    onDownload(kind: SubtitleDownloadKind): void;
    /** Cancel the running download job. */
    onCancelDownload(): void;
    /** Dismiss a failed job's message (the panel stays up until then). */
    onDismissDownloadError(): void;
}

export interface SubtitleControlsController {
    setEnabled(v: boolean): void;
    setAvailability(v: SubtitleAvailability): void;
    /** Languages this video actually has captions for (the source picker). */
    setSourceTracks(tracks: SourceTrackOption[]): void;
    /** The pinned language, or "" — session state pushed in by the controller. */
    setPinnedSourceLanguage(languageCode: string): void;
    /**
     * Download progress / failure, or null when idle. Rendered OUTSIDE the menu
     * card, so closing the menu cannot hide a job that is still running.
     */
    setDownloadState(state: SubtitleDownloadState | null): void;
    /** Re-inject the control-bar button if YouTube re-rendered the controls. */
    ensureButton(): void;
    destroy(): void;
}

const BUTTON_ID = "duo-yt-subtitle-button";
const MENU_HOST_ID = "duo-yt-subtitle-menu-host";

/**
 * The logo, prepared to sit inside a native `.ytp-button` (48x40, `padding:0`,
 * `overflow:hidden`).
 *
 * It must be ABSOLUTELY positioned, not a flex child: the source SVG carries
 * intrinsic `width="1024" height="1024"` attributes, and as a flex item its
 * automatic minimum size (`min-width/min-height: auto`) is content-based — the
 * browser then refuses to shrink it to the requested percentage and it
 * overflows the button (measured: 48.9x36.8 inside a 24.96x20.8 slot), which
 * reads as an off-center icon once `overflow:hidden` clips it. Taking it out of
 * flow removes those rules entirely, so the percentages resolve against the
 * button's padding box and `preserveAspectRatio` centers the artwork the same
 * way YouTube's own icons are centered inside their viewBox.
 */
function logoButtonSvg(): string {
    return DUO_LOGO_SVG.replace(/^<svg[^>]*>/, (openTag) =>
        openTag
            .replace(/\swidth="[^"]*"/, "")
            .replace(/\sheight="[^"]*"/, "")
            .replace(
                "<svg",
                '<svg preserveAspectRatio="xMidYMid meet" style="' +
                "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
                // Matches the visual weight of the native control-bar glyphs.
                "width:52%;height:52%;display:block;pointer-events:none;\"",
            ),
    );
}

export function mountSubtitleControls(deps: SubtitleControlsDeps): SubtitleControlsController {
    const { player } = deps;

    // --- control-bar button (native ytp-button so YouTube lays it out) ---
    let button: HTMLButtonElement | null = null;
    let menuOpen = false;
    let setMenuOpenSignal: ((open: boolean) => void) | null = null;

    const ensureButton = () => {
        if (button && button.isConnected) return;
        button?.remove();
        const rightControls = player.querySelector<HTMLElement>(".ytp-right-controls");
        if (!rightControls) return;
        button = document.createElement("button");
        button.id = BUTTON_ID;
        button.className = "ytp-button";
        button.title = "DuoTranslator";
        // `.ytp-button` is a 48x48 box whose glyph is expected to fill it; the
        // logo is centered with an absolutely-positioned flex layer so it lines
        // up with the native icons on both axes regardless of button padding.
        button.innerHTML = logoButtonSvg();
        // The logo is absolutely centered — the button must be its containing block.
        button.style.position = "relative";
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            setMenuOpenSignal?.(!menuOpen);
        });
        rightControls.insertBefore(button, rightControls.firstChild);
    };
    ensureButton();

    // --- Shadow DOM menu ---
    document.getElementById(MENU_HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = MENU_HOST_ID;
    host.setAttribute("data-duo-ai-ui", "");
    player.appendChild(host);
    const shadow = attachOwnShadow(host);
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    const stopThemeWatch = bindThemeToElement(mount);
    const root: Root = createRoot(mount);

    const api = {
        setEnabled: (_: boolean) => { },
        setAvailability: (_: SubtitleAvailability) => { },
        setSourceTracks: (_: SourceTrackOption[]) => { },
        setPinnedSourceLanguage: (_: string) => { },
        setDownloadState: (_: SubtitleDownloadState | null) => { },
    };
    let pendingEnabled: boolean | undefined;
    let pendingAvailability: SubtitleAvailability | undefined;
    let pendingSourceTracks: SourceTrackOption[] | undefined;
    let pendingPinnedLang: string | undefined;
    let pendingDownloadState: SubtitleDownloadState | null | undefined;
    let registered = false;

    root.render(
        <SubtitleMenuApp
            deps={deps}
            isMenuOpenRef={{
                set: (open) => { menuOpen = open; },
            }}
            anchorButton={() => button}
            register={(fns) => {
                api.setEnabled = fns.setEnabled;
                api.setAvailability = fns.setAvailability;
                api.setSourceTracks = fns.setSourceTracks;
                api.setPinnedSourceLanguage = fns.setPinnedSourceLanguage;
                api.setDownloadState = fns.setDownloadState;
                setMenuOpenSignal = fns.setMenuOpen;
                registered = true;
                if (pendingEnabled !== undefined) fns.setEnabled(pendingEnabled);
                if (pendingAvailability !== undefined) fns.setAvailability(pendingAvailability);
                if (pendingSourceTracks !== undefined) fns.setSourceTracks(pendingSourceTracks);
                if (pendingPinnedLang !== undefined) fns.setPinnedSourceLanguage(pendingPinnedLang);
                if (pendingDownloadState !== undefined) fns.setDownloadState(pendingDownloadState);
            }}
        />,
    );

    return {
        setEnabled: (v) => {
            if (registered) api.setEnabled(v);
            else pendingEnabled = v;
        },
        setAvailability: (v) => {
            if (registered) api.setAvailability(v);
            else pendingAvailability = v;
        },
        setSourceTracks: (v) => {
            if (registered) api.setSourceTracks(v);
            else pendingSourceTracks = v;
        },
        setPinnedSourceLanguage: (v) => {
            if (registered) api.setPinnedSourceLanguage(v);
            else pendingPinnedLang = v;
        },
        setDownloadState: (v) => {
            if (registered) api.setDownloadState(v);
            else pendingDownloadState = v;
        },
        ensureButton,
        destroy: () => {
            stopThemeWatch();
            try { root.unmount(); } catch { }
            host.remove();
            button?.remove();
            button = null;
        },
    };
}

/**
 * Switch for a menu row.
 *
 * Written here instead of reusing components/ui/switch: that one is Radix plus
 * the popup/options token set, and this menu lives in a Shadow DOM carrying the
 * aiWriting tokens — `bg-toggle-off` and friends simply do not resolve there,
 * so it would render as an uncolored pill. Same visual language though: white
 * thumb, accent track when on.
 *
 * Presentational only. The whole row is the button, so the switch must not be
 * one too — it inherits the row's disabled and hover states.
 */
function MenuSwitch({ checked }: { checked: boolean }) {
    return (
        <span
            aria-hidden="true"
            className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-ink-mute"}`}
        >
            <span
                className="absolute top-[2px] left-[2px] h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,.18)] transition-transform duration-200"
                style={{ transform: `translateX(${checked ? 12 : 0}px)` }}
            />
        </span>
    );
}

/** Card width, shared by the menu and the download progress panel. */
const MENU_WIDTH = 280;
/** Breathing room between the cards and the player's edge. */
const MENU_EDGE_GAP = 12;
/** Gap between the menu card and the flyout beside it. */
const FLYOUT_GAP = 6;
/**
 * Ceiling on the flyout's width. It sizes itself to its longest label, so this
 * only bounds a locale with unusually long wording — the lane the menu gives up
 * is the MEASURED width, not this.
 */
const FLYOUT_MAX_WIDTH = 220;
/** Lane assumed before the first measurement; corrected before anything paints. */
const FLYOUT_LANE_GUESS = 150;

/**
 * The download sub-menu, in the order the file kinds are most likely wanted.
 * Module-level so the array identity is stable across renders.
 */
const DOWNLOAD_ITEMS: { kind: SubtitleDownloadKind; i18nKey: string; label: string }[] = [
    { kind: "bilingual", i18nKey: "videoSubtitleDownloadBilingual", label: "Bilingual subtitles" },
    { kind: "original", i18nKey: "videoSubtitleDownloadOriginal", label: "Original subtitles" },
    { kind: "translation", i18nKey: "videoSubtitleDownloadTranslation", label: "Translated subtitles" },
];

/**
 * Progress / failure panel for a subtitle download.
 *
 * A sibling of the menu card rather than a row inside it: the job runs for as
 * long as the whole track takes to translate, and the menu closes on the first
 * click anywhere else — a percentage the user cannot see is not progress, and
 * neither is a Cancel button they cannot reach.
 */
function SubtitleDownloadPanel({
    state,
    onCancel,
    onDismiss,
}: {
    state: SubtitleDownloadState;
    onCancel(): void;
    onDismiss(): void;
}) {
    const item = DOWNLOAD_ITEMS.find((i) => i.kind === state.kind);
    const failed = !!state.error;
    return (
        <div
            style={{ width: MENU_WIDTH }}
            className="rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden text-[12px] px-3 py-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-ink">
                    {item ? t(item.i18nKey, item.label) : t("videoSubtitleDownload", "Download subtitles")}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                    {!failed && (
                        <span className="font-mono text-[11px] text-ink-soft tabular-nums">{state.percent}%</span>
                    )}
                    <button
                        type="button"
                        title={failed ? t("close", "Close") : t("cancel", "Cancel")}
                        onClick={failed ? onDismiss : onCancel}
                        className="rounded p-0.5 text-ink-soft hover:bg-hover-2 hover:text-ink"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </span>
            </div>
            {failed ? (
                <div className="mt-1.5 max-h-16 overflow-y-auto text-[11px] leading-normal text-danger-ink break-words">
                    {t("videoSubtitleDownloadFailed", "Subtitle download failed")}
                    {`: ${state.error}`}
                </div>
            ) : (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line-2">
                    <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                        style={{ width: `${state.percent}%` }}
                    />
                </div>
            )}
        </div>
    );
}

function SubtitleMenuApp({
    deps,
    anchorButton,
    register,
    isMenuOpenRef,
}: {
    deps: SubtitleControlsDeps;
    anchorButton: () => HTMLElement | null;
    register: (fns: {
        setEnabled(v: boolean): void;
        setAvailability(v: SubtitleAvailability): void;
        setSourceTracks(v: SourceTrackOption[]): void;
        setPinnedSourceLanguage(v: string): void;
        setDownloadState(v: SubtitleDownloadState | null): void;
        setMenuOpen(open: boolean): void;
    }) => void;
    isMenuOpenRef: { set(open: boolean): void };
}) {
    useLang();
    const [open, setOpen] = useState(false);
    const [enabled, setEnabled] = useState(deps.initialEnabled);
    const [availability, setAvailability] = useState<SubtitleAvailability>("loading");
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [sourceTracks, setSourceTracks] = useState<SourceTrackOption[]>([]);
    const [pinnedLang, setPinnedSourceLanguage] = useState("");
    const [downloadState, setDownloadState] = useState<SubtitleDownloadState | null>(null);
    const [downloadOpen, setDownloadOpen] = useState(false);
    /**
     * Measured placement of the cluster and its flyout.
     *
     * `lane` is the flyout's own measured width: the cluster moves left by
     * exactly that much, which puts the flyout's right edge back at the player's
     * margin instead of leaving the leftover as a gap. `laneReserved` goes false
     * only on a player too narrow for both, and `top` aligns the flyout with its
     * row. The initial guess is corrected before the first paint.
     */
    const [placement, setPlacement] = useState({
        top: 0,
        lane: FLYOUT_LANE_GUESS,
        laneReserved: true,
    });
    const cardRef = useRef<HTMLDivElement>(null);
    const downloadRowRef = useRef<HTMLButtonElement>(null);
    const flyoutRef = useRef<HTMLDivElement>(null);

    const mode = useConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE);
    const serviceKey = useConfig<string | undefined>(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE);
    // Subtitle target language: its own key, falling back to the page
    // translation target so a fresh install already has a sensible value.
    // Neither key has a DEFAULT_VALUE — "never chosen" is the meaningful state.
    const subtitleTargetLang = useConfig<string | undefined>(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE);
    const pageTargetLang = useConfig<string | undefined>(CONFIG_KEY.TARGET_LANGUAGE);
    const targetLang = subtitleTargetLang || pageTargetLang || browserTargetLanguage();
    const aiProviders = useConfig<unknown>(CONFIG_KEY.AI_PROVIDERS);
    const disabledServices = useConfig<string[] | undefined>(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES);
    const { activeService, serviceOptions } = useMemo(() => {
        const ctx = buildAiTranslateService(serviceKey, aiProviders, disabledServices);
        return {
            activeService: ctx.activeService,
            serviceOptions: buildServiceOptions(ctx.enabledTranslateServices, ctx.enabledAiProviders),
        };
    }, [serviceKey, aiProviders, disabledServices]);

    useEffect(() => {
        register({
            setEnabled,
            setAvailability,
            setSourceTracks,
            setPinnedSourceLanguage,
            setDownloadState,
            setMenuOpen: (o) => {
                setOpen(o);
                if (!o) {
                    setConfirmOpen(false);
                    setDownloadOpen(false);
                }
            },
        });
    }, [register]);

    useEffect(() => {
        isMenuOpenRef.set(open);
    }, [open, isMenuOpenRef]);

    // Click-away (Shadow DOM retargets events → composedPath) — also treat a
    // click on the anchor button as "handled" so its own toggle wins.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            // The ref is the whole cluster, menu card plus progress panel, so
            // hitting Cancel on a running download does not also close the menu.
            const card = cardRef.current;
            if (!card) return;
            const path = e.composedPath();
            if (path.includes(card)) return;
            const btn = anchorButton();
            if (btn && path.includes(btn)) return;
            setOpen(false);
            setConfirmOpen(false);
            setDownloadOpen(false);
        };
        const id = window.setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [open, anchorButton]);

    // Menu placement. The cluster sits a flyout's lane further from the player's
    // right edge than it otherwise would, so the download flyout always opens to
    // the RIGHT — no measuring the flyout, no flipping sides between openings.
    //
    // The lane is given up only when the player is too narrow to hold the menu
    // and the lane together; then the menu returns to the edge and the flyout
    // opens left instead. The player's own width is the constraint, not the
    // window's: everything here is a descendant of `#movie_player`, which clips
    // its overflow, so a card reaching past that edge is cut off there no matter
    // how much room the page has beyond it.
    //
    // Vertically there is nothing to clamp: the row sits in the middle of the
    // card and the card's own bottom is already 64px inside the player, so a
    // three-item flyout anchored to that row always lands within the player.
    //
    // The flyout is always laid out while the menu is open (hidden until asked
    // for) precisely so its width can be read here. Measuring only on open would
    // mean the cluster shifted sideways the first time a sub-menu was used.
    const measure = useCallback(() => {
        const row = downloadRowRef.current;
        const column = cardRef.current;
        const flyoutEl = flyoutRef.current;
        if (!row || !column || !flyoutEl) return;
        const lane = Math.ceil(flyoutEl.getBoundingClientRect().width);
        // Relative to the column, which is the flyout's containing block — the
        // card cannot host the flyout itself, its `overflow-hidden` would cut
        // anything reaching outside.
        const top = row.getBoundingClientRect().top - column.getBoundingClientRect().top;
        const laneReserved =
            deps.player.getBoundingClientRect().width
            >= MENU_WIDTH + lane + FLYOUT_GAP + MENU_EDGE_GAP * 2;
        setPlacement((prev) =>
            prev.top === top && prev.lane === lane && prev.laneReserved === laneReserved
                ? prev
                : { top, lane, laneReserved },
        );
    }, [deps.player]);

    // After every render: the labels change with the UI language and the row
    // moves as the rows above it come and go, both of which change the numbers
    // above. Committing only on a real change keeps this from looping.
    useLayoutEffect(measure);

    // Theatre / fullscreen move the player's edges while the menu stays open.
    useEffect(() => {
        if (!open) return;
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open, measure]);

    // The panel outlives the menu — a running job stays on screen after a
    // click-away, which is the only way its Cancel button is reachable.
    if (!open && !downloadState) return null;

    const unavailable = availability === "unavailable";
    /** A job in flight; a failed one leaves its panel up but frees the menu. */
    const downloading = !!downloadState && !downloadState.error;
    const selectCls =
        "h-6 min-w-0 max-w-[150px] rounded border border-line-strong bg-surface px-1.5 text-[11px] text-ink-2 outline-none focus:border-accent";
    const rowCls = "flex items-center justify-between gap-3 px-3 py-2";

    return (
        // One bottom-anchored column holding the menu and the progress panel,
        // so neither has to know the other's height (the panel's grows with an
        // error message) and both stay clear of the control bar.
        <div
            ref={cardRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                position: "absolute",
                // Shifted left by the flyout's lane so the flyout always has
                // room on the right. Constant across openings — a menu that
                // slid sideways when a sub-menu opened would be worse than
                // either resting place.
                right: MENU_EDGE_GAP + (placement.laneReserved ? placement.lane + FLYOUT_GAP : 0),
                bottom: 64,
                zIndex: 2147483000,
            }}
            className="flex flex-col items-end gap-2"
        >
            {open && (
                <div
                    // Positioned, so the confirm scrim's `inset: 0` resolves
                    // against this card rather than against the column.
                    style={{ position: "relative", width: MENU_WIDTH }}
                    className="rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden text-[12px]"
                >
                    <div className="px-3 py-2 border-b border-line-2 bg-surface-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                        {t("videoSubtitleMenuTitle", "Bilingual subtitles")}
                    </div>

                    {/* Enable toggle */}
                    <button
                        type="button"
                        role="switch"
                        // Reports the state the user can SEE. A video with no captions
                        // shows off even when the setting is on — the same thing the
                        // check mark used to say by being absent.
                        aria-checked={enabled && !unavailable}
                        disabled={unavailable}
                        onClick={() => {
                            const next = !enabled;
                            setEnabled(next);
                            deps.onToggleEnabled(next);
                        }}
                        className={`${rowCls} w-full text-left hover:bg-hover-2 disabled:opacity-45 disabled:hover:bg-transparent`}
                    >
                        <span className="text-ink">
                            {t("videoSubtitleEnable", "Enable bilingual subtitles")}
                        </span>
                        <MenuSwitch checked={enabled && !unavailable} />
                    </button>
                    {availability === "loading" && (
                        <div className="px-3 pb-1 -mt-1 text-[11px] text-ink-soft">
                            {t("videoSubtitleLoading", "Loading captions…")}
                        </div>
                    )}
                    {unavailable && (
                        <div className="px-3 pb-1 -mt-1 text-[11px] text-ink-soft">
                            {t("videoSubtitleUnavailable", "No captions available for this video")}
                        </div>
                    )}

                    {/* Display mode */}
                    <div className={rowCls}>
                        <span className="text-ink-2">{t("videoSubtitleDisplayMode", "Display mode")}</span>
                        <select
                            className={selectCls}
                            value={mode}
                            onChange={(e) => void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE, e.target.value)}
                        >
                            <option value={VIDEO_SUBTITLE_DISPLAY_MODE.BILINGUAL}>
                                {t("videoSubtitleModeBilingual", "Bilingual")}
                            </option>
                            <option value={VIDEO_SUBTITLE_DISPLAY_MODE.TRANSLATION}>
                                {t("videoSubtitleModeTranslation", "Translation only")}
                            </option>
                            <option value={VIDEO_SUBTITLE_DISPLAY_MODE.ORIGINAL}>
                                {t("videoSubtitleModeOriginal", "Original only")}
                            </option>
                        </select>
                    </div>

                    {/* Target language */}
                    <div className={rowCls}>
                        <span className="text-ink-2">{t("targetLanguage", "Target language")}</span>
                        <select
                            className={selectCls}
                            value={targetLang}
                            onChange={(e) => void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE, e.target.value)}
                        >
                            {LANGUAGES.map((l) => (
                                <option key={l.value} value={l.value}>
                                    {t(l.title, l.name)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Source language — which of this video's caption tracks is read
                        as the original. "Automatic" hands the choice back to the
                        source-language priority in Options; without it a pick would be
                        a one-way door for the rest of the tab's life. */}
                    <div className={rowCls}>
                        <span className="text-ink-2">{t("videoSubtitleSourceLanguage", "Source language")}</span>
                        <select
                            className={selectCls}
                            // The list is this video's own caption tracks, so it is
                            // empty until they load — and an empty select would read as
                            // "this video has no languages" rather than "not yet".
                            disabled={sourceTracks.length === 0}
                            value={pinnedLang}
                            onChange={(e) => deps.onPinnedSourceLanguage(e.target.value)}
                        >
                            <option value="">
                                {sourceTracks.length === 0
                                    ? t("videoSubtitleSourceNoTracks", "No caption tracks")
                                    : t("videoSubtitleSourceAuto", "Automatic")}
                            </option>
                            {sourceTracks.map((track) => (
                                <option key={track.languageCode} value={track.languageCode}>
                                    {track.label || track.languageCode}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Translate service */}
                    <div className={rowCls}>
                        <span className="text-ink-2">{t("translateService", "Translate service")}</span>
                        <select
                            className={selectCls}
                            value={activeService}
                            onChange={(e) => void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE, e.target.value)}
                        >
                            {serviceOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.i18nKey ? t(o.i18nKey, o.label) : o.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Subtitle download. A sub-menu rather than three more top-level
                        rows: this menu is already tall, and the choice of file is made
                        once per download instead of being a setting. */}
                    <button
                        ref={downloadRowRef}
                        type="button"
                        aria-expanded={downloadOpen}
                        aria-haspopup="menu"
                        disabled={availability !== "available" || downloading}
                        onClick={() => setDownloadOpen((v) => !v)}
                        className={`${rowCls} w-full text-left hover:bg-hover-2 text-ink disabled:opacity-45 disabled:hover:bg-transparent ${downloadOpen ? "bg-hover-2" : ""}`}
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <Download className="h-3.5 w-3.5 text-ink-soft" />
                            {t("videoSubtitleDownload", "Download subtitles")}
                        </span>
                        {/* Points at the side the flyout actually opens on. */}
                        <ChevronRight
                            className={`h-3.5 w-3.5 text-ink-soft transition-transform duration-150 ${placement.laneReserved ? "" : "rotate-180"}`}
                        />
                    </button>

                    <div className="border-t border-line-2 my-1" />

                    {/* More settings */}
                    <button
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            notifyBackground({ action: ACTION.OPEN_OPTIONS_PAGE, data: { tab: "videoSubtitle" } });
                        }}
                        className={`${rowCls} w-full text-left hover:bg-hover-2 text-ink`}
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <Settings2 className="h-3.5 w-3.5 text-ink-soft" />
                            {t("videoSubtitleMoreSettings", "More settings")}
                        </span>
                    </button>

                    {/* Disable permanently */}
                    <button
                        type="button"
                        onClick={() => setConfirmOpen(true)}
                        className={`${rowCls} w-full text-left hover:bg-hover-2 text-danger-ink`}
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5" />
                            {t("videoSubtitleDisableForever", "Disable permanently")}
                        </span>
                    </button>

                    {confirmOpen && (
                        <div
                            // Absolute, not fixed: this scrim covers the menu card it
                            // belongs to. It only ever LOOKED right as `fixed` because
                            // the card's `backdrop-blur-md` makes it the containing
                            // block for fixed descendants — drop the blur and a fixed
                            // scrim would suddenly cover the whole viewport.
                            style={{ position: "absolute", inset: 0, zIndex: 2147483001, background: "var(--color-backdrop)" }}
                            className="flex items-center justify-center"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            {/* Inset from the card's edges so it reads as a nested
                                dialog. A fixed width wider than the card (it was 300px
                                inside a 280px card) is simply clipped by the card's
                                `overflow-hidden` and ends up looking full-width. */}
                            <div className="w-[calc(100%-32px)] rounded-xl bg-surface border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.6)] p-3.5">
                                <div className="text-[13px] font-medium text-ink">
                                    {t("videoSubtitleDisableConfirmTitle", "Disable video subtitles?")}
                                </div>
                                <div className="mt-1.5 text-[12px] leading-normal text-ink-soft">
                                    {t(
                                        "videoSubtitleDisableConfirmDesc",
                                        "This turns off video bilingual subtitles everywhere. You can re-enable it in Settings.",
                                    )}
                                </div>
                                <div className="mt-3 flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setConfirmOpen(false)}
                                        className="h-7 px-3 rounded-md border border-line-strong text-[12px] text-ink-2 hover:bg-hover-2"
                                    >
                                        {t("cancel", "Cancel")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            setConfirmOpen(false);
                                            setOpen(false);
                                            await setConfig(CONFIG_KEY.VIDEO_SUBTITLE_SWITCH, false);
                                            deps.onDisableForever();
                                        }}
                                        className="h-7 px-3 rounded-md bg-danger-ink/90 hover:bg-danger-ink text-[12px] text-white"
                                    >
                                        {t("videoSubtitleDisableConfirmOk", "Disable")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Download flyout. A sibling of the card, not a child: the card
                clips its own overflow (rounded corners), so anything reaching
                past its edge would be cut off there.

                Rendered as soon as the menu is, and merely hidden while closed,
                so `measure` always has a real width to read. `visibility` (not
                `display`) is what keeps it laid out — and it still takes the
                element out of the tab order and the a11y tree. */}
            {open && (
                <div
                    ref={flyoutRef}
                    role="menu"
                    style={{
                        position: "absolute",
                        top: placement.top,
                        visibility: downloadOpen ? "visible" : "hidden",
                        // Shrink to the longest label, so the padding on the
                        // right matches the padding on the left instead of
                        // trailing empty card.
                        width: "max-content",
                        maxWidth: FLYOUT_MAX_WIDTH,
                        ...(placement.laneReserved
                            ? { left: "100%", marginLeft: FLYOUT_GAP }
                            : { right: "100%", marginRight: FLYOUT_GAP }),
                    }}
                    className="rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden text-[12px] py-1"
                >
                    {DOWNLOAD_ITEMS.map((item) => (
                        <button
                            key={item.kind}
                            role="menuitem"
                            type="button"
                            disabled={availability !== "available" || downloading}
                            onClick={() => {
                                setDownloadOpen(false);
                                deps.onDownload(item.kind);
                            }}
                            className="flex w-full items-center px-3 py-1.5 text-left text-ink-2 hover:bg-hover-2 disabled:opacity-45 disabled:hover:bg-transparent"
                        >
                            {t(item.i18nKey, item.label)}
                        </button>
                    ))}
                </div>
            )}

            {downloadState && (
                <SubtitleDownloadPanel
                    state={downloadState}
                    onCancel={deps.onCancelDownload}
                    onDismiss={deps.onDismissDownloadError}
                />
            )}
        </div>
    );
}
