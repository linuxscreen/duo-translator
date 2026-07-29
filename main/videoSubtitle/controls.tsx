import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Check, Settings2, XCircle } from "lucide-react";
import { browser } from "wxt/browser";
import {
    ACTION,
    CONFIG_KEY,
    LANGUAGES,
    VIDEO_SUBTITLE_DISPLAY_MODE,
} from "@/main/constants";
import { setConfig } from "@/utils/db";
import { useConfig } from "@/utils/reactiveConfig";
import { buildAiTranslateService, buildServiceOptions } from "@/utils/service";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import { DUO_LOGO_SVG } from "@/main/floatBall/logo";

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
}

export interface SubtitleControlsController {
    setEnabled(v: boolean): void;
    setAvailability(v: SubtitleAvailability): void;
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
    const shadow = host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    const stopThemeWatch = bindThemeToElement(mount);
    const root: Root = createRoot(mount);

    const api = {
        setEnabled: (_: boolean) => { },
        setAvailability: (_: SubtitleAvailability) => { },
    };
    let pendingEnabled: boolean | undefined;
    let pendingAvailability: SubtitleAvailability | undefined;
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
                setMenuOpenSignal = fns.setMenuOpen;
                registered = true;
                if (pendingEnabled !== undefined) fns.setEnabled(pendingEnabled);
                if (pendingAvailability !== undefined) fns.setAvailability(pendingAvailability);
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
        setMenuOpen(open: boolean): void;
    }) => void;
    isMenuOpenRef: { set(open: boolean): void };
}) {
    useLang();
    const [open, setOpen] = useState(false);
    const [enabled, setEnabled] = useState(deps.initialEnabled);
    const [availability, setAvailability] = useState<SubtitleAvailability>("loading");
    const [confirmOpen, setConfirmOpen] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    const mode = useConfig<string>(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE);
    const serviceKey = useConfig<string | undefined>(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE);
    // Subtitle target language: its own key, falling back to the page
    // translation target so a fresh install already has a sensible value.
    // Neither key has a DEFAULT_VALUE — "never chosen" is the meaningful state.
    const subtitleTargetLang = useConfig<string | undefined>(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE);
    const pageTargetLang = useConfig<string | undefined>(CONFIG_KEY.TARGET_LANGUAGE);
    const targetLang = subtitleTargetLang || pageTargetLang || navigator.language.split("-")[0];
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
            setMenuOpen: (o) => {
                setOpen(o);
                if (!o) setConfirmOpen(false);
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
            const card = cardRef.current;
            if (!card) return;
            const path = e.composedPath();
            if (path.includes(card)) return;
            const btn = anchorButton();
            if (btn && path.includes(btn)) return;
            setOpen(false);
            setConfirmOpen(false);
        };
        const id = window.setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [open, anchorButton]);

    if (!open) return null;

    const unavailable = availability === "unavailable";
    const selectCls =
        "h-6 min-w-0 max-w-[150px] rounded border border-line-strong bg-surface px-1.5 text-[11px] text-ink-2 outline-none focus:border-accent";
    const rowCls = "flex items-center justify-between gap-3 px-3 py-2";

    return (
        <div
            ref={cardRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                position: "absolute",
                right: 12,
                bottom: 64,
                zIndex: 2147483000,
            }}
            className="w-[280px] rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden text-[12px]"
        >
            <div className="px-3 py-2 border-b border-line-2 bg-surface-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                {t("videoSubtitleMenuTitle", "Bilingual subtitles")}
            </div>

            {/* Enable toggle */}
            <button
                type="button"
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
                {enabled && !unavailable && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
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

            <div className="border-t border-line-2 my-1" />

            {/* More settings */}
            <button
                type="button"
                onClick={() => {
                    setOpen(false);
                    browser.runtime
                        .sendMessage({ action: ACTION.OPEN_OPTIONS_PAGE, data: { tab: "videoSubtitle" } })
                        .catch(() => { });
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
    );
}
