import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Check, ChevronRight, Copy, Loader2, Pin, Volume2, X } from "lucide-react";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { attachOwnShadow } from "@/main/dom/shadowRoots";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "./i18n";
import { useCopyFeedback } from "./useCopyFeedback";
import { useTts } from "./useTts";
import {
    startTranslate,
    parseTranslateServiceKey,
    buildTranslateServiceKey,
    type TranslateServiceChoice,
} from "./translateRunner";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";
import { browserTargetLanguage, CONFIG_KEY, LANGUAGES, LANGUAGES_MAP } from "@/main/constants";
import { getTextLanguage } from "@/main/lang";
import { getConfig, setConfig } from "@/utils/db";
import { buildServiceOptions, getTranslateService, type ServiceOption } from "@/utils/service";
import { DUO_LOGO_SVG } from "@/main/floatBall/logo";
import { DictView } from "./DictView";
import { lookupDict } from "@/main/dict/dictClient";
import { chooseDictEntry, dictProvidersFor, isDictWord } from "@/main/dict/select";
import type { DictEntry, DictProvider } from "@/main/dict/types";

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
        lang: (typeof langConfig === "string" && langConfig) || browserTargetLanguage(),
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
    const shadow = attachOwnShadow(host);
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

const POPUP_WIDTH = 460;
const GAP = 8;
const MARGIN = 8;
const MIN_HEIGHT = 120;
const MIN_WIDTH = 280;

/**
 * Height ceiling for the auto-sized card: two thirds of the viewport.
 *
 * The card has no fixed height — it is a flex column with a scrolling body, so
 * it shrink-wraps the translation and only starts scrolling at this ceiling.
 * Deliberately NOT reduced to "whatever fits below the selection": a cramped
 * anchor should move the card (see the clamp in the layout effect), not squeeze
 * a long translation into a two-line strip.
 */
function autoMaxHeight(): number {
    return Math.min(Math.round(window.innerHeight * 2 / 3), window.innerHeight - 2 * MARGIN);
}

type Placement =
    | { left: number; top: number; maxHeight: number }
    | { left: number; bottom: number; maxHeight: number };

function computePlacement(rect: DOMRect | null): Placement {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxHeight = autoMaxHeight();
    // No rect (selection rect unavailable) — center horizontally near the top.
    if (!rect) {
        return {
            left: Math.max(MARGIN, Math.round((vw - POPUP_WIDTH) / 2)),
            top: Math.min(80, vh - MIN_HEIGHT - MARGIN),
            maxHeight,
        };
    }
    const left = Math.max(MARGIN, Math.min(rect.left, vw - POPUP_WIDTH - MARGIN));
    const spaceBelow = vh - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    // Prefer below; flip above only when below is too cramped AND above is roomier.
    if (spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow) {
        // Anchor by `bottom` so the card grows upward as the stream arrives
        // while staying pinned to the selection's top edge.
        return { left, bottom: vh - rect.top + GAP, maxHeight };
    }
    return { left, top: rect.bottom + GAP, maxHeight };
}

// ---------------------------------------------------------------------------
// Move / resize — a one-shot override of the computed placement
// ---------------------------------------------------------------------------

/**
 * Explicit geometry set by dragging the header or an edge. Deliberately NOT
 * persisted and reset on every open: the card is anchored to a selection, so a
 * remembered box would be wrong the moment the next selection is somewhere
 * else. `height: null` means "still auto" — dragging the card around must not
 * freeze the height that the content is driving.
 */
interface ManualBox {
    left: number;
    top: number;
    width: number;
    height: number | null;
}

/** The eight resize handles, keyed by the compass directions they move. */
const RESIZE_HANDLES: { dir: string; className: string; cursor: string }[] = [
    { dir: "n", className: "top-0 left-2 right-2 h-1.5", cursor: "ns-resize" },
    { dir: "s", className: "bottom-0 left-2 right-2 h-1.5", cursor: "ns-resize" },
    { dir: "w", className: "left-0 top-2 bottom-2 w-1.5", cursor: "ew-resize" },
    { dir: "e", className: "right-0 top-2 bottom-2 w-1.5", cursor: "ew-resize" },
    { dir: "nw", className: "top-0 left-0 h-2.5 w-2.5", cursor: "nwse-resize" },
    { dir: "se", className: "bottom-0 right-0 h-2.5 w-2.5", cursor: "nwse-resize" },
    { dir: "ne", className: "top-0 right-0 h-2.5 w-2.5", cursor: "nesw-resize" },
    { dir: "sw", className: "bottom-0 left-0 h-2.5 w-2.5", cursor: "nesw-resize" },
];

/**
 * Apply one pointer delta to a resize, keeping the box inside the viewport and
 * above the minimums. The edge being dragged is the one that moves: pushing a
 * side past its opposite pins it instead of inverting the box.
 */
function resizeBox(
    dir: string,
    start: { left: number; top: number; width: number; height: number },
    dx: number,
    dy: number,
): ManualBox {
    let { left, top } = start;
    let width = start.width;
    let height = start.height;
    if (dir.includes("e")) width = start.width + dx;
    if (dir.includes("w")) { width = start.width - dx; left = start.left + dx; }
    if (dir.includes("s")) height = start.height + dy;
    if (dir.includes("n")) { height = start.height - dy; top = start.top + dy; }

    if (width < MIN_WIDTH) {
        if (dir.includes("w")) left = start.left + start.width - MIN_WIDTH;
        width = MIN_WIDTH;
    }
    if (height < MIN_HEIGHT) {
        if (dir.includes("n")) top = start.top + start.height - MIN_HEIGHT;
        height = MIN_HEIGHT;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left < MARGIN) { width -= MARGIN - left; left = MARGIN; }
    if (top < MARGIN) { height -= MARGIN - top; top = MARGIN; }
    width = Math.max(MIN_WIDTH, Math.min(width, vw - MARGIN - left));
    height = Math.max(MIN_HEIGHT, Math.min(height, vh - MARGIN - top));
    return { left, top, width, height };
}

// ---------------------------------------------------------------------------
// One-line vs multi-line — which layout a text block gets
// ---------------------------------------------------------------------------

/**
 * Width the inline play+copy cluster takes off a row: two 24px buttons with a
 * 2px gap, plus the 8px gap to the text.
 */
const INLINE_ACTIONS_W = 58;

/**
 * Does `text` need more than one line at the width it would have with the
 * buttons sitting inline next to it?
 *
 * Measured on an INVISIBLE one-line probe, not on the rendered text. The answer
 * decides the layout, and the layout decides the rendered text's width — so
 * measuring the real element lets the two chase each other: the buttons move to
 * their own row, the text gets ~58px wider, now it fits on one line, the
 * buttons come back inline, it overflows again… An absolutely positioned
 * `white-space: pre` copy has the text's natural single-line width regardless
 * of which layout is currently on screen, which breaks that loop.
 *
 * `cardWidth` is a dependency because the card is resizable; the probe itself
 * is width-independent, but the row it is compared against is not.
 */
function useNeedsOwnRow(text: string, cardWidth: number) {
    const rowRef = useRef<HTMLDivElement>(null);
    const probeRef = useRef<HTMLSpanElement>(null);
    const [needsOwnRow, setNeedsOwnRow] = useState(false);
    useLayoutEffect(() => {
        const row = rowRef.current;
        const probe = probeRef.current;
        if (!row || !probe || text === "") {
            setNeedsOwnRow(false);
            return;
        }
        // `clientWidth` is the padding box, so the row's own padding has to come
        // off before comparing — otherwise every text gets 24px of slack it
        // does not actually have.
        const cs = getComputedStyle(row);
        const available =
            row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - INLINE_ACTIONS_W;
        // An explicit newline is multi-line whatever the width says — the probe
        // is `pre`, so it would only report the longest line.
        setNeedsOwnRow(text.includes("\n") || probe.getBoundingClientRect().width > available);
    }, [text, cardWidth]);
    return { rowRef, probeRef, needsOwnRow };
}

/** The hidden measuring copy — see {@link useNeedsOwnRow}. */
function LineProbe({ text, probeRef }: { text: string; probeRef: React.RefObject<HTMLSpanElement> }) {
    return (
        <span
            ref={probeRef}
            aria-hidden="true"
            // The probe is a one-line `pre` copy, so its box is as wide as the
            // whole text — which is exactly what makes it measurable, and also
            // what would hand the scrolling body a horizontal scrollbar. It
            // must NOT be shrunk (a zero-width box measures zero): the row it
            // sits in is `relative overflow-hidden`, so it is its containing
            // block AND clips it, and the overflow never reaches the body.
            className="invisible absolute left-0 top-0 whitespace-pre pointer-events-none text-[13px] leading-normal"
        >
            {text}
        </span>
    );
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
    const [placement, setPlacement] = useState<Placement>({ left: -9999, top: -9999, maxHeight: MIN_HEIGHT });
    // Set once the user moves or resizes the card; cleared on every open.
    const [manual, setManual] = useState<ManualBox | null>(null);

    // The current selection (source text + anchor rect).
    const [seed, setSeed] = useState<SelectionSeed | null>(null);
    // Page-translation defaults behind the "Follow page" options.
    const [pageDefaults, setPageDefaults] = useState<PageDefaults>({ service: "", lang: "", options: [] });
    // Detected language of the original text, used for its TTS playback.
    const [origLang, setOrigLang] = useState("und");
    // Dictionary panel — only populated when the selection is a single word.
    // Every candidate provider's answer is kept; which one is DISPLAYED is
    // decided at render time, once the source language is known.
    const [dictEntries, setDictEntries] = useState<Partial<Record<DictProvider, DictEntry | null>>>({});
    const [dictLoading, setDictLoading] = useState(false);
    const [dictError, setDictError] = useState<string | null>(null);
    // Run token: a lookup superseded by a language change must not paint.
    const dictRunRef = useRef(0);
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
                // `silent`: the popup renders the reason inline (see `error`
                // below). Only the full console line — incl. the background
                // stack — is added here, so the failure stays diagnosable after
                // the popup is closed without double-reporting it on screen.
                reportRequestError(ERROR_SCOPE.SELECTION_TRANSLATE, e, {
                    silent: true,
                    detail: { service: buildTranslateServiceKey(choice), targetLang },
                });
            } finally {
                if (abortRef.current === myAbort) {
                    setRunning(false);
                    abortRef.current = null;
                }
            }
        })();
    }, []);

    /**
     * Look the selection up, when it is a single word.
     *
     * Every candidate provider is queried CONCURRENTLY and the winner is picked
     * afterwards (`chooseDictEntry`). The alternative — decide first, then ask
     * one — needs the source language before any request has been made, and a
     * single word does not carry enough signal for that: judging "English" from
     * the word being ASCII routes French "important" or "table" to Bing, which
     * answers with the English entry.
     *
     * Runs alongside the translation rather than after it: independent
     * requests, and the dictionary is usually a cache hit while the translation
     * is always a network round trip.
     */
    const runDict = useCallback((text: string, targetLang: string) => {
        const runId = ++dictRunRef.current;
        setDictEntries({});
        setDictError(null);
        const word = text.trim();
        if (!isDictWord(word)) {
            setDictLoading(false);
            return;
        }
        const providers = dictProvidersFor(targetLang);
        setDictLoading(true);
        (async () => {
            const settled = await Promise.allSettled(
                providers.map((p) => lookupDict(p, word, targetLang)),
            );
            if (runId !== dictRunRef.current) return;
            const entries: Partial<Record<DictProvider, DictEntry | null>> = {};
            const failures: any[] = [];
            settled.forEach((r, i) => {
                if (r.status === "fulfilled") entries[providers[i]] = r.value;
                else failures.push(r.reason);
            });
            setDictEntries(entries);
            setDictLoading(false);
            // Every failure reaches the console; only a TOTAL failure reaches
            // the panel. One provider being down while the other answers is not
            // something the user can act on, and the answer is already there.
            for (const e of failures) {
                reportRequestError(ERROR_SCOPE.DICTIONARY, e, {
                    silent: true,
                    detail: { word, targetLang },
                });
            }
            const answered = Object.values(entries).some(Boolean);
            if (!answered && failures.length > 0) {
                setDictError(failures[0]?.message || String(failures[0]));
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
            setManual(null);
            setDictEntries({});
            setDictError(null);
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
                runDict(s.text, lng ?? page.lang);
            })();
        });
    }, [registerOpen, runTranslate, refreshPageDefaults, runDict]);

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
        // The target language picks the dictionary provider as well as the
        // language its glosses are written in, so this is a fresh lookup.
        runDict(seed.text, next ?? pageDefaults.lang);
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

    // ---- Text block layout -------------------------------------------------
    // Both blocks put the play/copy buttons inline while their text fits on one
    // line, and give them a row of their own once it doesn't.
    const origText = seed?.text ?? "";
    const cardWidth = manual?.width ?? POPUP_WIDTH;
    const {
        rowRef: origRow,
        probeRef: origProbe,
        needsOwnRow: origNeedsOwnRow,
    } = useNeedsOwnRow(origText, cardWidth);
    const {
        rowRef: transRow,
        probeRef: transProbe,
        needsOwnRow: transNeedsOwnRow,
    } = useNeedsOwnRow(output, cardWidth);

    // ---- Move / resize -----------------------------------------------------
    //
    // Both gestures start by freezing the card's CURRENT measured box, so the
    // switch from the anchored placement to explicit geometry is invisible —
    // including the bottom-anchored variant, which has no `top` of its own.
    const beginGesture = (e: React.MouseEvent, onDelta: (dx: number, dy: number) => void) => {
        const el = cardRef.current;
        if (e.button !== 0 || !el) return;
        // Stops the drag from selecting page text under the pointer, and keeps
        // the gesture from clearing the selection the card is translating.
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const onMove = (ev: MouseEvent) => onDelta(ev.clientX - startX, ev.clientY - startY);
        const onUp = () => {
            window.removeEventListener("mousemove", onMove, true);
            window.removeEventListener("mouseup", onUp, true);
        };
        window.addEventListener("mousemove", onMove, true);
        window.addEventListener("mouseup", onUp, true);
    };

    const onHeaderMouseDown = (e: React.MouseEvent) => {
        // The header carries the pickers and the pin/close buttons; only its
        // empty space is a drag surface.
        if ((e.target as HTMLElement).closest("select, button, input, textarea, a")) return;
        const el = cardRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const start = { left: r.left, top: r.top, width: r.width, height: r.height };
        // `height: null` — moving the card must not freeze its auto height.
        setManual({ ...start, height: manual?.height ?? null });
        beginGesture(e, (dx, dy) => {
            setManual((prev) => ({
                left: Math.max(MARGIN, Math.min(start.left + dx, window.innerWidth - start.width - MARGIN)),
                top: Math.max(MARGIN, Math.min(start.top + dy, window.innerHeight - start.height - MARGIN)),
                width: start.width,
                height: prev?.height ?? null,
            }));
        });
    };

    const onResizeMouseDown = (dir: string) => (e: React.MouseEvent) => {
        const el = cardRef.current;
        if (!el) return;
        e.stopPropagation();
        const r = el.getBoundingClientRect();
        const start = { left: r.left, top: r.top, width: r.width, height: r.height };
        setManual(start);
        beginGesture(e, (dx, dy) => setManual(resizeBox(dir, start, dx, dy)));
    };

    // After paint, re-clamp the card within the viewport in case the measured
    // size differs from the estimate (covers the all-four-corners edge cases).
    // Overflowing the top or bottom converts the anchored placement into a
    // plain clamped `top`: with the height ceiling at two thirds of the
    // viewport there is always a position that fits, so the card moves rather
    // than being cut off. Skipped once the user has taken over the geometry.
    useLayoutEffect(() => {
        if (!open || manual) return;
        const el = cardRef.current;
        if (!el) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const r = el.getBoundingClientRect();
        let left = placement.left;
        if (r.right > vw - MARGIN) left = Math.max(MARGIN, vw - r.width - MARGIN);
        if (r.left < MARGIN) left = MARGIN;
        const overflowsY = r.bottom > vh - MARGIN || r.top < MARGIN;
        if (!overflowsY) {
            if (left !== placement.left) setPlacement({ ...placement, left } as Placement);
            return;
        }
        const top = Math.max(MARGIN, Math.min(r.top, vh - r.height - MARGIN));
        if ("top" in placement && placement.top === top && left === placement.left) return;
        setPlacement({ left, top, maxHeight: placement.maxHeight });
    }, [open, output, origExpanded, manual, placement]);

    if (!open) return null;

    const style: React.CSSProperties = manual
        ? {
            position: "fixed",
            left: manual.left,
            top: manual.top,
            width: manual.width,
            // A resized card gets an explicit height; a moved one keeps the
            // content-driven height and its ceiling.
            ...(manual.height === null
                ? { maxHeight: placement.maxHeight }
                : { height: manual.height }),
            zIndex: 2147483647,
        }
        : {
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
    // Whose dictionary entry to show. Decided HERE rather than before the
    // requests: by now the providers have answered and the translation has
    // reported its detected source language, so the choice is made on a known
    // language instead of a guess. `origLang` is the translation's detection
    // (falling back to the local one), used only when Google returned nothing.
    const dictEntry = chooseDictEntry(dictEntries, origLang, effectiveTargetLang);
    const translationBody = error ? (
        <span className="text-error">{error}</span>
    ) : running && !output ? (
        <span className="inline-flex items-center gap-1.5 text-ink-soft">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
        </span>
    ) : (
        output
    );
    const selectCls =
        // Fixed width, NOT `flex-1`: the card is resizable, and a stretching
        // picker would turn every widening into a pair of ever-longer boxes.
        // Still shrinkable (`min-w-0`, no `shrink-0`) — at the minimum card
        // width two rigid 150px boxes would push pin/close out of the header.
        "h-6 w-[150px] min-w-0 rounded border border-line-strong bg-surface px-1.5 text-[11px] text-ink-2 outline-none focus:border-accent";

    return (
        <div
            ref={cardRef}
            className="relative flex flex-col rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden"
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Resize handles — thin strips inset on each edge and corner. They
                sit above the body so the bottom-right one is grabbable even
                where the scrollbar is. */}
            {RESIZE_HANDLES.map((h) => (
                <div
                    key={h.dir}
                    onMouseDown={onResizeMouseDown(h.dir)}
                    className={`absolute z-20 ${h.className}`}
                    style={{ cursor: h.cursor }}
                />
            ))}

            {/* Header — logo, service + language pickers, then pin/close. Its
                empty space is the drag surface (hence `cursor-move`). */}
            <div
                className="flex items-center gap-1.5 px-3 py-2 border-b border-line-2 bg-surface-2 cursor-move select-none"
                onMouseDown={onHeaderMouseDown}
            >
                <span
                    aria-hidden="true"
                    className="block h-4 w-4 shrink-0 mr-2"
                    // Inlined SVG rather than <img src=chrome-extension://…>:
                    // the icon files are not in `web_accessible_resources`, so
                    // a host page cannot load them. Same reason as the float
                    // ball, which is where this constant comes from.
                    dangerouslySetInnerHTML={{ __html: DUO_LOGO_SVG }}
                />
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
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                {/* Original text — always shown. A multi-line original is
                    clipped to one line with an ellipsis and gets a chevron; a
                    one-line original keeps the buttons beside it. */}
                <div ref={origRow} className="relative overflow-hidden px-3 py-2 border-b border-line">
                    <LineProbe text={origText} probeRef={origProbe} />
                    {origNeedsOwnRow ? (
                        <>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setOrigExpanded((v) => !v)}
                                    title={origExpanded ? t("collapse", "Collapse") : t("expand", "Expand")}
                                    aria-label={origExpanded ? t("collapse", "Collapse") : t("expand", "Expand")}
                                    aria-expanded={origExpanded}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-3 hover:text-ink-2"
                                >
                                    <ChevronRight
                                        className={`h-3.5 w-3.5 transition-transform ${origExpanded ? "rotate-90" : ""}`}
                                    />
                                </button>
                                <div className="ml-auto">
                                    <AudioActions ttsKey="orig" text={origText} lang={origLang} tts={tts} />
                                </div>
                            </div>
                            <div
                                className={`text-[13px] leading-normal text-ink-2 ${origExpanded ? "whitespace-pre-wrap wrap-break-word" : "truncate"}`}
                            >
                                {origText}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0 truncate text-[13px] leading-normal text-ink-2">
                                {origText}
                            </div>
                            <AudioActions ttsKey="orig" text={origText} lang={origLang} tts={tts} />
                        </div>
                    )}
                </div>

                {/* Translation */}
                <div ref={transRow} className="relative overflow-hidden px-3 py-2.5">
                    <LineProbe text={output} probeRef={transProbe} />
                    {transNeedsOwnRow ? (
                        <>
                            <div className="flex justify-end">
                                <AudioActions ttsKey="trans" text={output} lang={effectiveTargetLang} tts={tts} />
                            </div>
                            <div className="text-[13px] leading-normal text-ink whitespace-pre-wrap wrap-break-word">
                                {translationBody}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0 text-[13px] leading-normal text-ink whitespace-pre-wrap wrap-break-word">
                                {translationBody}
                            </div>
                            <AudioActions ttsKey="trans" text={output} lang={effectiveTargetLang} tts={tts} />
                        </div>
                    )}
                </div>

                {/* Dictionary — only for single-word selections. Renders nothing
                    at all when the word has no entry, so ordinary prose
                    selections look exactly as they did before. */}
                {(dictLoading || dictError || dictEntry) && (
                    <DictView
                        entry={dictEntry}
                        loading={dictLoading}
                        error={dictError}
                        wordLang={origLang}
                        audio={{
                            playingKey: tts.playingKey,
                            playUrl: tts.toggleUrl,
                            speak: tts.toggle,
                        }}
                    />
                )}
            </div>
        </div>
    );
}
