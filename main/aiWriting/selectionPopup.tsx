import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Check, ChevronRight, Copy, Loader2, Pin, Volume2, X } from "lucide-react";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "./i18n";
import { useCopyFeedback } from "./useCopyFeedback";
import { useTts } from "./useTts";
import {
    startTranslate,
    parseTranslateServiceKey,
    type TranslateServiceChoice,
} from "./translateRunner";
import { CONFIG_KEY, LANGUAGES, LANGUAGES_MAP } from "@/main/constants";
import { getTextLanguage } from "@/main/lang";
import { getConfig, setConfig } from "@/utils/db";
import { buildServiceOptions, getTranslateService, type ServiceOption } from "@/utils/service";

// ---------------------------------------------------------------------------
// Singleton mount — one popup per page (per frame). A fresh request replaces
// the previous result, mirroring the workbench / floating-dot pattern.
// ---------------------------------------------------------------------------

const HOST_ID = "duo-selection-translate-host";
let popupRoot: Root | null = null;
let openSignal: ((seed: SelectionSeed) => void) | null = null;

export interface SelectionSeed {
    /** The text to translate (the user's selection). */
    text: string;
    /** Viewport rect of the selection, used to anchor the popup. */
    rect: DOMRect | null;
}

/** What the header's "Follow page (X)" options resolve to. */
interface PageDefaults {
    service: string;
    lang: string;
    options: ServiceOption[];
}

/**
 * Page-translation service + target language, used whenever the user has not
 * overridden them in the header.
 *
 * Read here rather than handed in by the opener: every caller was resolving the
 * same two config keys, and one that passed its OWN service (the video-subtitle
 * overlay) made "Follow page" mean something different depending on where the
 * selected text happened to come from. Re-read on every open so a language
 * changed in Options applies without a reload.
 */
async function loadPageDefaults(): Promise<PageDefaults> {
    const [serviceConfig, langConfig] = await Promise.all([
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.TARGET_LANGUAGE),
    ]);
    const { activeService, enabledTranslateServices, enabledAiProviders } = await getTranslateService(
        typeof serviceConfig === "string" ? serviceConfig : undefined,
    );
    return {
        service: activeService,
        lang: (typeof langConfig === "string" && langConfig) || navigator.language.split("-")[0],
        options: buildServiceOptions(enabledTranslateServices, enabledAiProviders),
    };
}

/**
 * Keep the popup visible when a fullscreen element is active (e.g. selecting
 * video subtitle text in a fullscreen player): only the fullscreen element's
 * subtree is rendered, so the host must live inside it. Reparenting the SAME
 * host preserves the ShadowRoot + React root (no state loss). Called on every
 * open and on fullscreen changes.
 */
function reparentForFullscreen(): void {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const target = document.fullscreenElement ?? document.documentElement;
    // A fullscreen host that can't contain children (e.g. <video>) is skipped —
    // the popup can't be shown over it anyway.
    if (target instanceof HTMLVideoElement) return;
    if (host.parentElement !== target) target.appendChild(host);
}

function ensureMounted(): void {
    if (popupRoot) {
        reparentForFullscreen();
        return;
    }
    let host = document.getElementById(HOST_ID) as HTMLElement | null;
    if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-ai-ui", "");
        document.documentElement.appendChild(host);
    }
    document.addEventListener("fullscreenchange", reparentForFullscreen);
    reparentForFullscreen();
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    // Page-lifetime singleton — the watcher lives as long as the popup host.
    bindThemeToElement(mount);
    popupRoot = createRoot(mount);
    popupRoot.render(
        <SelectionPopupApp
            registerOpen={(fn) => {
                openSignal = fn;
            }}
        />,
    );
}

export function openSelectionTranslate(seed: SelectionSeed): void {
    ensureMounted();
    // openSignal is wired by the first render's effect — it may not be ready on
    // the very first call, so retry briefly (same pattern as the workbench).
    let tries = 0;
    const tick = () => {
        if (openSignal) {
            openSignal(seed);
            return;
        }
        if (tries++ < 20) setTimeout(tick, 30);
    };
    tick();
}

// ---------------------------------------------------------------------------
// Positioning — anchor the card to the selection rect, flipping above/below
// and clamping horizontally so it never spills off any edge or corner.
// ---------------------------------------------------------------------------

const POPUP_WIDTH = 360;
const GAP = 8;
const MARGIN = 8;
const MAX_HEIGHT = 360;
const MIN_HEIGHT = 120;

type Placement =
    | { left: number; top: number; maxHeight: number }
    | { left: number; bottom: number; maxHeight: number };

function computePlacement(rect: DOMRect | null): Placement {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // No rect (selection rect unavailable) — center horizontally near the top.
    if (!rect) {
        return {
            left: Math.max(MARGIN, Math.round((vw - POPUP_WIDTH) / 2)),
            top: Math.min(80, vh - MIN_HEIGHT - MARGIN),
            maxHeight: Math.min(MAX_HEIGHT, vh - 80 - MARGIN),
        };
    }
    const left = Math.max(MARGIN, Math.min(rect.left, vw - POPUP_WIDTH - MARGIN));
    const spaceBelow = vh - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    // Prefer below; flip above only when below is too cramped AND above is roomier.
    if (spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow) {
        // Anchor by `bottom` so the card grows upward as the stream arrives
        // while staying pinned to the selection's top edge.
        return {
            left,
            bottom: vh - rect.top + GAP,
            maxHeight: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, spaceAbove)),
        };
    }
    return {
        left,
        top: rect.bottom + GAP,
        maxHeight: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, spaceBelow)),
    };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Small play + copy button cluster shared by the original / translation rows. */
function AudioActions({
    ttsKey,
    text,
    lang,
    tts,
}: {
    ttsKey: string;
    text: string;
    lang: string;
    tts: ReturnType<typeof useTts>;
}) {
    const [copied, copy] = useCopyFeedback();
    const playing = tts.playingKey === ttsKey;
    const disabled = !text.trim();
    const iconBtn =
        "h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-3 disabled:opacity-40 disabled:hover:bg-transparent";
    return (
        <div className="flex items-center gap-0.5 shrink-0">
            <button
                type="button"
                disabled={disabled}
                onClick={() => tts.toggle(ttsKey, text, lang)}
                title={playing ? t("selectionStopSpeech", "Stop") : t("selectionPlaySpeech", "Play")}
                aria-label={playing ? t("selectionStopSpeech", "Stop") : t("selectionPlaySpeech", "Play")}
                className={`${iconBtn} ${playing ? "text-accent" : "text-ink-soft"}`}
            >
                <Volume2 className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                disabled={disabled}
                onClick={() => copy(text)}
                title={copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                aria-label={copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                className={`${iconBtn} ${copied ? "text-success" : "text-ink-soft"}`}
            >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
        </div>
    );
}

function SelectionPopupApp({ registerOpen }: { registerOpen: (fn: (s: SelectionSeed) => void) => void }) {
    useLang();
    const [open, setOpen] = useState(false);
    const [output, setOutput] = useState("");
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pinned, setPinned] = useState(false);
    const [placement, setPlacement] = useState<Placement>({ left: -9999, top: -9999, maxHeight: MAX_HEIGHT });

    // The current selection (source text + anchor rect).
    const [seed, setSeed] = useState<SelectionSeed | null>(null);
    // Page-translation defaults behind the "Follow page" options.
    const [pageDefaults, setPageDefaults] = useState<PageDefaults>({ service: "", lang: "", options: [] });
    // Detected language of the original text, used for its TTS playback.
    const [origLang, setOrigLang] = useState("und");
    // "Show original text" is collapsed by default.
    const [origExpanded, setOrigExpanded] = useState(false);
    // Header overrides — null means "follow the page translation" (the default).
    // Persisted (CONFIG_KEY.SELECTION_*) so a chosen service / target language
    // sticks across opens. The refs mirror the latest values so the stable
    // `registerOpen` closure can read them without a stale capture.
    const [serviceOverride, setServiceOverride] = useState<string | null>(null);
    const [langOverride, setLangOverride] = useState<string | null>(null);
    const serviceOverrideRef = useRef<string | null>(null);
    const langOverrideRef = useRef<string | null>(null);
    serviceOverrideRef.current = serviceOverride;
    langOverrideRef.current = langOverride;

    const tts = useTts();
    // Abort handle for the in-flight translate stream; also acts as a run token
    // so a superseded stream's finally-block can't clobber a newer run's state.
    const abortRef = useRef<(() => void) | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef(false);
    pinnedRef.current = pinned;

    const close = () => {
        if (abortRef.current) abortRef.current();
        abortRef.current = null;
        tts.stop();
        setRunning(false);
        setOpen(false);
    };

    /**
     * Refresh the "Follow page" defaults (and the service picker list).
     * Returns them so callers can act on the fresh values without waiting for
     * the re-render.
     */
    const refreshPageDefaults = useCallback(async () => {
        const next = await loadPageDefaults();
        setPageDefaults(next);
        return next;
    }, []);

    // Load the page defaults / service picker list once, plus the persisted
    // header overrides so a previously chosen service / language is restored.
    useEffect(() => {
        (async () => {
            const [, svc, lng] = await Promise.all([
                refreshPageDefaults(),
                getConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.SELECTION_TARGET_LANGUAGE),
            ]);
            const svcVal = typeof svc === "string" && svc ? svc : null;
            const lngVal = typeof lng === "string" && lng ? lng : null;
            serviceOverrideRef.current = svcVal;
            langOverrideRef.current = lngVal;
            setServiceOverride(svcVal);
            setLangOverride(lngVal);
        })();
    }, [refreshPageDefaults]);

    // Run (or re-run) the translation for the given text/lang/service.
    const runTranslate = useCallback((text: string, targetLang: string, choice: TranslateServiceChoice) => {
        if (abortRef.current) { abortRef.current(); abortRef.current = null; }
        setOutput("");
        setError(null);
        if (!text.trim()) { setRunning(false); return; }
        setRunning(true);
        // Regular translators report the detected source language — far more
        // reliable than franc on a short selection (which can pick a variant
        // with no Bing voice, silently falling TTS back to Google). Use it for
        // the original-text playback language when available.
        const { stream, abort } = startTranslate(text, targetLang, choice, (src) => {
            if (src && src !== "und") setOrigLang(src);
        });
        abortRef.current = abort;
        const myAbort = abort;
        (async () => {
            try {
                for await (const delta of stream) {
                    if (abortRef.current !== myAbort) return; // superseded
                    setOutput((prev) => prev + delta);
                }
            } catch (e: any) {
                if (abortRef.current === myAbort) setError(e?.message || String(e));
            } finally {
                if (abortRef.current === myAbort) {
                    setRunning(false);
                    abortRef.current = null;
                }
            }
        })();
    }, []);

    useEffect(() => {
        registerOpen((s) => {
            tts.stop();
            setSeed(s);
            setOpen(true);
            setPinned(false);
            setOrigExpanded(false);
            setOrigLang(getTextLanguage(s.text) || "und");
            setPlacement(computePlacement(s.rect));
            void (async () => {
                // Re-read the page defaults so a service / language changed in
                // Options since the last open is picked up. Only awaited to
                // start the run — the card is already on screen with a spinner.
                const page = await refreshPageDefaults();
                // Honor the persisted header overrides (null ⇒ follow the page).
                const svc = serviceOverrideRef.current;
                const lng = langOverrideRef.current;
                runTranslate(s.text, lng ?? page.lang, parseTranslateServiceKey(svc ?? page.service));
            })();
        });
    }, [registerOpen, runTranslate, refreshPageDefaults]);

    const onServiceChange = (value: string) => {
        const next = value || null;
        setServiceOverride(next);
        void setConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE, value);
        if (!seed) return;
        runTranslate(
            seed.text,
            langOverride ?? pageDefaults.lang,
            parseTranslateServiceKey(next ?? pageDefaults.service),
        );
    };

    const onLangChange = (value: string) => {
        const next = value || null;
        setLangOverride(next);
        void setConfig(CONFIG_KEY.SELECTION_TARGET_LANGUAGE, value);
        if (!seed) return;
        runTranslate(
            seed.text,
            next ?? pageDefaults.lang,
            parseTranslateServiceKey(serviceOverride ?? pageDefaults.service),
        );
    };

    // Esc always closes (even when pinned).
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                close();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);

    // Click-away closes only when NOT pinned. Shadow DOM retargets events at
    // `document`, so inspect the real path via composedPath().
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (pinnedRef.current) return;
            const card = cardRef.current;
            if (!card) return;
            if (e.composedPath().includes(card)) return;
            close();
        };
        // Defer registration so the opening interaction doesn't immediately
        // dismiss the popup.
        const id = window.setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [open]);

    // After paint, re-clamp the card within the viewport in case the measured
    // size differs from the estimate (covers the all-four-corners edge cases).
    useLayoutEffect(() => {
        if (!open) return;
        const el = cardRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        let next: Placement | null = null;
        if (r.right > window.innerWidth - MARGIN) {
            const left = Math.max(MARGIN, window.innerWidth - r.width - MARGIN);
            next = { ...placement, left } as Placement;
        }
        if (r.left < MARGIN) {
            next = { ...(next ?? placement), left: MARGIN } as Placement;
        }
        if (next) setPlacement(next);
    }, [open, output, origExpanded]);

    if (!open) return null;

    const style: React.CSSProperties = {
        position: "fixed",
        left: placement.left,
        width: POPUP_WIDTH,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: placement.maxHeight,
        zIndex: 2147483647,
        ...("top" in placement ? { top: placement.top } : { bottom: placement.bottom }),
    };

    // "Follow page" labels for the first option of each header dropdown.
    const followKey = pageDefaults.service;
    const followServiceOpt = pageDefaults.options.find((o) => o.value === followKey);
    const followServiceName = followServiceOpt
        ? (followServiceOpt.i18nKey ? t(followServiceOpt.i18nKey, followServiceOpt.label) : followServiceOpt.label)
        : followKey;
    const followLangMeta = LANGUAGES_MAP.get(pageDefaults.lang);
    const followLangName = followLangMeta ? t(followLangMeta.title, followLangMeta.name) : pageDefaults.lang;
    const followWith = (name: string) =>
        t("selectionFollowWeb", "Follow page ({{name}})").replace("{{name}}", name);

    const effectiveTargetLang = langOverride ?? pageDefaults.lang;
    const selectCls =
        "h-6 min-w-0 flex-1 max-w-[160px] rounded border border-line-strong bg-surface px-1.5 text-[11px] text-ink-2 outline-none focus:border-accent";

    return (
        <div
            ref={cardRef}
            className="flex flex-col rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden"
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Header — a single row: service + language pickers, then pin/close. */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line-2 bg-surface-2">
                <select
                    value={serviceOverride ?? ""}
                    onChange={(e) => onServiceChange(e.target.value)}
                    title={t("translateService", "Translate service")}
                    className={selectCls}
                >
                    <option value="">{followWith(followServiceName)}</option>
                    {pageDefaults.options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.i18nKey ? t(o.i18nKey, o.label) : o.label}
                        </option>
                    ))}
                </select>
                <select
                    value={langOverride ?? ""}
                    onChange={(e) => onLangChange(e.target.value)}
                    title={t("targetLanguage", "Target language")}
                    className={selectCls}
                >
                    <option value="">{followWith(followLangName)}</option>
                    {LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>
                            {t(l.title, l.name)}
                        </option>
                    ))}
                </select>
                <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                    <button
                        type="button"
                        onClick={() => setPinned((v) => !v)}
                        title={pinned ? t("selectionUnpin", "Unpin") : t("selectionPin", "Pin")}
                        aria-label={pinned ? t("selectionUnpin", "Unpin") : t("selectionPin", "Pin")}
                        className={`h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-3 ${pinned ? "text-accent" : "text-ink-soft"}`}
                    >
                        <Pin className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} />
                    </button>
                    <button
                        type="button"
                        onClick={close}
                        title={t("aiClose", "Close")}
                        aria-label={t("aiClose", "Close")}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-3 text-ink-soft"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-auto">
                {/* Original text (collapsible) */}
                <div className="px-3 py-2 border-b border-line">
                    <div className="flex items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => setOrigExpanded((v) => !v)}
                            className="flex items-center gap-1 text-[12px] text-ink-soft hover:text-ink-2"
                        >
                            <ChevronRight
                                className={`h-3.5 w-3.5 transition-transform ${origExpanded ? "rotate-90" : ""}`}
                            />
                            {t("selectionShowOriginal", "Show original text")}
                        </button>
                        <AudioActions ttsKey="orig" text={seed?.text ?? ""} lang={origLang} tts={tts} />
                    </div>
                    {origExpanded && (
                        <div className="mt-1.5 text-[13px] leading-normal text-ink-2 whitespace-pre-wrap wrap-break-word">
                            {seed?.text}
                        </div>
                    )}
                </div>

                {/* Translation */}
                <div className="flex items-start gap-2 px-3 py-2.5">
                    <div className="flex-1 min-w-0 text-[13px] leading-normal text-ink whitespace-pre-wrap wrap-break-word">
                        {error ? (
                            <span className="text-error">{error}</span>
                        ) : running && !output ? (
                            <span className="inline-flex items-center gap-1.5 text-ink-soft">
                                <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
                            </span>
                        ) : (
                            output
                        )}
                    </div>
                    <AudioActions ttsKey="trans" text={output} lang={effectiveTargetLang} tts={tts} />
                </div>
            </div>
        </div>
    );
}
