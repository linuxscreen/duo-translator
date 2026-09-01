import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { attachOwnShadow, isInOwnUi } from "@/main/dom/shadowRoots";
import { isInSelectableSurface } from "@/main/dom/selectableSurfaces";
import { deepContains } from "@/main/dom/shadowTraversal";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "./i18n";
import { useTts } from "./useTts";
import { SelectionCard, type TranslationRun } from "./SelectionCard";
import {
    loadSelectionPopupPrefs,
    orderSelectionServices,
    resolveSelectionServices,
    useSelectionPopupPrefs,
    type SelectionPopupPrefs,
} from "./selectionPopupPrefs";
import { startTranslate, parseTranslateServiceKey } from "./translateRunner";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";
import { browserTargetLanguage, CONFIG_KEY, LANGUAGES_MAP } from "@/main/constants";
import { getTextLanguage } from "@/main/lang";
import { getConfig, setConfig } from "@/utils/db";
import { buildServiceOptions, getTranslateService, type ServiceOption } from "@/utils/service";
import { lookupDict } from "@/main/dict/dictClient";
import { chooseDictEntry, dictProvidersFor, isDictWord } from "@/main/dict/select";
import type { DictEntry, DictProvider } from "@/main/dict/types";

// ---------------------------------------------------------------------------
// Singleton mount — one popup per page (per frame). A fresh request replaces
// the previous result, mirroring the workbench / floating-dot pattern.
// ---------------------------------------------------------------------------

const HOST_ID = "duo-selection-translate-host";
let popupHost: HTMLElement | null = null;
let popupRoot: Root | null = null;
let openSignal: ((seed: SelectionSeed) => void) | null = null;

/**
 * Stacking order. The card sits one below the maximum so the selection pill —
 * which is how a lookup is started from *inside* the card — can be painted above
 * it. Equal z-indexes would leave the two surfaces' paint order decided by which
 * host happened to be appended first, which is not something either side
 * controls.
 */
const POPUP_Z = 2147483646;

export interface SelectionSeed {
    /** The text to translate (the user's selection). */
    text: string;
    /** Viewport rect of the selection, used to anchor the popup. */
    rect: DOMRect | null;
    /**
     * Live clone of the selected range. Lets the card re-anchor to the text on
     * scroll / resize — a snapshot rect alone would leave it pinned to the
     * viewport position the selection had when it opened. Optional: surfaces
     * that only have a snapshot rect (a detached range, the centered fallback)
     * simply stay put.
     */
    range?: Range;
    /**
     * Reuse the card exactly where it already is instead of re-anchoring it to
     * `rect`. Set when the selection came from inside the card itself: the
     * anchor is then a few pixels of the card's own body, so honoring it would
     * make the card jump out from under the pointer that just asked for the
     * lookup. Only the height follows the new content.
     */
    keepPosition?: boolean;
}

/** Whether `node` is the popup surface, or lives inside it. */
export function isInSelectionPopup(node: Node | null | undefined): boolean {
    return !!popupHost && deepContains(popupHost, node);
}

// ---------------------------------------------------------------------------
// Open state, observable from outside
// ---------------------------------------------------------------------------

/**
 * The card is a singleton that any surface can open, so a surface that SPAWNED
 * one needs to know it is still there. The subtitle dictionary panel is the
 * case this exists for: a lookup started from inside it must not have its
 * parent vanish (or the video resume) the moment the pointer leaves the word —
 * the card would be orphaned mid-read.
 *
 * A plain module variable plus listeners, not a store: there is exactly one
 * card, and the only question anyone asks is "is it up right now".
 */
let popupOpen = false;
const openWatchers = new Set<(open: boolean) => void>();

export function isSelectionPopupOpen(): boolean {
    return popupOpen;
}

/** Subscribe to the card appearing / disappearing. Returns the disposer. */
export function watchSelectionPopupOpen(cb: (open: boolean) => void): () => void {
    openWatchers.add(cb);
    return () => {
        openWatchers.delete(cb);
    };
}

function publishOpen(open: boolean): void {
    if (popupOpen === open) return;
    popupOpen = open;
    // Copied: a watcher may unsubscribe itself while being told.
    for (const cb of [...openWatchers]) cb(open);
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
    const host = popupHost;
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
    popupHost = host;
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
    // Whichever side has more room — NOT "below unless below is unusable".
    //
    // The card's height is content-driven and most of that content arrives
    // late (the translation streams, the dictionary is a second request). The
    // old rule put a selection at 70% of the viewport below itself, where the
    // remaining 30% was enough to clear the MIN_HEIGHT bar but not enough for
    // the finished card — so it was placed, then yanked upward by the clamp
    // once the rest showed up. Choosing the roomier side means the growth
    // happens into space that is already there.
    if (spaceAbove > spaceBelow) {
        // Anchor by `bottom` so the card grows upward as the stream arrives
        // while staying pinned to the selection's top edge — a late arrival
        // extends it, it does not move it.
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
// Component
// ---------------------------------------------------------------------------

function SelectionPopupApp({ registerOpen }: { registerOpen: (fn: (s: SelectionSeed) => void) => void }) {
    useLang();
    const [open, setOpen] = useState(false);
    /**
     * One entry per service being asked. Single-service mode is a list of one,
     * so there is exactly one rendering path — the alternative (a scalar plus a
     * list) would have meant two of everything: two abort paths, two error
     * paths, two places to forget the streaming state.
     */
    const [runs, setRuns] = useState<TranslationRun[]>([]);
    const [pinned, setPinned] = useState(false);
    /**
     * The card's settings, in two forms that have to be kept apart.
     *
     * `livePrefs` (the hook) cannot await, so it answers with the SHIPPED
     * DEFAULTS until storage has hydrated. That is fine for reacting to a later
     * edit and wrong for the first paint: the very first popup of a page load
     * would draw the stock card — original row, one service, no dictionary
     * switch honoured — and then snap into the user's actual layout a frame
     * later. So `prefs` is the awaited answer, seeded at mount, refreshed on
     * every open, and thereafter kept in step with the hook (which, by the time
     * it can CHANGE, has certainly been read).
     *
     * `prefsRef` mirrors it for the stable `registerOpen` closure and the
     * header handlers, which must not capture a stale value.
     */
    const livePrefs = useSelectionPopupPrefs();
    const [prefs, setPrefs] = useState<SelectionPopupPrefs | null>(null);
    const prefsRef = useRef<SelectionPopupPrefs>(livePrefs);
    /** Has an AWAITED read landed yet? Gates adopting the hook's value. */
    const prefsResolvedRef = useRef(false);

    const adoptPrefs = useCallback((next: SelectionPopupPrefs) => {
        prefsResolvedRef.current = true;
        prefsRef.current = next;
        setPrefs(next);
    }, []);
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
    // Abort handles for the in-flight streams (one per service), plus a run
    // token so a superseded batch's deltas and finally-blocks cannot clobber a
    // newer one's state. The token is what makes this safe with N streams:
    // comparing against a single stored abort function no longer identifies
    // "my run" once there is more than one.
    const abortsRef = useRef<(() => void)[]>([]);
    const runTokenRef = useRef(0);
    const cardRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef(false);
    pinnedRef.current = pinned;
    // rAF throttle + last measured rect for the scroll-follow (see below).
    const viewportRafRef = useRef<number | null>(null);
    const lastAnchorRectRef = useRef<DOMRect | null>(null);

    /** Stop every in-flight stream and invalidate whatever they still deliver. */
    const abortAll = useCallback(() => {
        runTokenRef.current++;
        for (const abort of abortsRef.current) abort();
        abortsRef.current = [];
    }, []);

    const close = () => {
        abortAll();
        tts.stop();
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

    // Adopt later edits. Gated on an awaited read having landed: this effect
    // also runs on mount, when the hook is still on the shipped defaults, and
    // taking those would reintroduce exactly the first-paint problem the pair
    // above exists to avoid.
    useEffect(() => {
        if (prefsResolvedRef.current) adoptPrefs(livePrefs);
    }, [livePrefs, adoptPrefs]);

    // Load the page defaults / service picker list once, plus the persisted
    // header overrides so a previously chosen service / language is restored.
    // The card's own settings are seeded here too, so the first open normally
    // finds them already resolved instead of waiting on storage.
    useEffect(() => {
        (async () => {
            const [, svc, lng, cardPrefs] = await Promise.all([
                refreshPageDefaults(),
                getConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.SELECTION_TARGET_LANGUAGE),
                loadSelectionPopupPrefs(),
            ]);
            adoptPrefs(cardPrefs);
            const svcVal = typeof svc === "string" && svc ? svc : null;
            const lngVal = typeof lng === "string" && lng ? lng : null;
            serviceOverrideRef.current = svcVal;
            langOverrideRef.current = lngVal;
            setServiceOverride(svcVal);
            setLangOverride(lngVal);
        })();
    }, [refreshPageDefaults, adoptPrefs]);

    /**
     * Run (or re-run) the translation, once per requested service.
     *
     * Every service is asked CONCURRENTLY and each answer lands in its own
     * slot, so a slow or broken provider neither delays nor hides the others —
     * the failure is drawn in that one block and the rest keep streaming.
     */
    const runTranslate = useCallback(
        (text: string, targetLang: string, keys: string[], options: ServiceOption[]) => {
            abortAll();
            const token = runTokenRef.current;
            const label = (key: string) => {
                const o = options.find((x) => x.value === key);
                return o ? (o.i18nKey ? t(o.i18nKey, o.label) : o.label) : key;
            };
            const seedRuns: TranslationRun[] = keys.map((key) => ({
                key,
                label: label(key),
                output: "",
                running: true,
                error: null,
            }));
            if (!text.trim() || keys.length === 0) {
                setRuns(seedRuns.map((r) => ({ ...r, running: false })));
                return;
            }
            setRuns(seedRuns);
            // Index rather than key: two entries can never share a key (the
            // picker is a set), but an index is stable against a re-render that
            // arrives mid-stream.
            const patch = (i: number, fn: (r: TranslationRun) => TranslationRun) => {
                if (runTokenRef.current !== token) return;
                setRuns((prev) => (prev.length === keys.length ? prev.map((r, j) => (j === i ? fn(r) : r)) : prev));
            };
            keys.forEach((key, i) => {
                // Regular translators report the detected source language — far
                // more reliable than franc on a short selection (which can pick
                // a variant with no Bing voice, silently falling TTS back to
                // Google). Only the FIRST service's answer is taken: with
                // several of them reporting, the last to arrive would otherwise
                // win, which is nobody's idea of a preference order.
                const { stream, abort } = startTranslate(text, targetLang, parseTranslateServiceKey(key), (src) => {
                    if (i === 0 && src && src !== "und" && runTokenRef.current === token) setOrigLang(src);
                });
                abortsRef.current.push(abort);
                (async () => {
                    try {
                        for await (const delta of stream) {
                            if (runTokenRef.current !== token) return; // superseded
                            patch(i, (r) => ({ ...r, output: r.output + delta }));
                        }
                    } catch (e: any) {
                        patch(i, (r) => ({ ...r, error: e?.message || String(e) }));
                        // `silent`: the popup renders the reason inline (in that
                        // service's own block). Only the full console line —
                        // incl. the background stack — is added here, so the
                        // failure stays diagnosable after the popup is closed
                        // without double-reporting it on screen.
                        reportRequestError(ERROR_SCOPE.SELECTION_TRANSLATE, e, {
                            silent: true,
                            detail: { service: key, targetLang },
                        });
                    } finally {
                        patch(i, (r) => ({ ...r, running: false }));
                    }
                })();
            });
        },
        [abortAll],
    );

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
            lastAnchorRectRef.current = null;
            setOpen(true);
            setOrigExpanded(false);
            setOrigLang(getTextLanguage(s.text) || "und");
            setDictEntries({});
            setDictError(null);
            setDictLoading(false);
            // A lookup started from inside the card keeps the card's own box:
            // same top-left, same width, height back to auto so it shrink-wraps
            // the new result instead of inheriting the old one's. Freezing the
            // MEASURED box (rather than reusing `placement`) is what makes the
            // bottom-anchored and user-dragged variants hold still too — neither
            // of them has a `top` of its own to carry over. Pinning is left
            // alone: it is a property of the card, not of the lookup.
            const card = s.keepPosition ? cardRef.current : null;
            if (card) {
                const r = card.getBoundingClientRect();
                setManual({ left: r.left, top: r.top, width: r.width, height: null });
                // The auto-height ceiling now has to respect the frozen top as
                // well, so growth stops at the viewport edge instead of running
                // past it (the re-clamp below is skipped while `manual` is set).
                setPlacement({
                    left: r.left,
                    top: r.top,
                    maxHeight: Math.max(MIN_HEIGHT, Math.min(autoMaxHeight(), window.innerHeight - r.top - MARGIN)),
                });
            } else {
                setPinned(false);
                setManual(null);
                setPlacement(computePlacement(s.rect));
            }
            void (async () => {
                // Re-read the page defaults so a service / language changed in
                // Options since the last open is picked up. Only awaited to
                // start the run — the card is already on screen with a spinner.
                //
                // The card's own settings are read the same way, and NOT taken
                // from the `prefs` hook: that one answers with the shipped
                // defaults until storage has hydrated, so the first popup of a
                // page load would quietly ask one service and skip the
                // dictionary regardless of what the user configured.
                const [page, cardPrefs] = await Promise.all([
                    refreshPageDefaults(),
                    loadSelectionPopupPrefs(),
                ]);
                adoptPrefs(cardPrefs);
                // Honor the persisted header overrides (null ⇒ follow the page).
                const lng = langOverrideRef.current ?? page.lang;
                const keys = resolveSelectionServices(
                    cardPrefs,
                    page.service,
                    page.options,
                    serviceOverrideRef.current,
                );
                runTranslate(s.text, lng, keys, page.options);
                if (cardPrefs.dict) runDict(s.text, lng);
            })();
        });
    }, [registerOpen, runTranslate, refreshPageDefaults, runDict, adoptPrefs]);

    // Mirror the open flag out to whoever spawned the card — see publishOpen.
    useEffect(() => {
        publishOpen(open);
    }, [open]);

    /** Services currently being asked — the picker's checked set, resolved. */
    const selectedServices = resolveSelectionServices(
        prefs ?? prefsRef.current,
        pageDefaults.service,
        pageDefaults.options,
        serviceOverride,
    );
    const effectiveTargetLang = langOverride ?? pageDefaults.lang;

    /** Single-service mode: `""` restores "follow the page". */
    const onServiceChange = (value: string) => {
        const next = value || null;
        setServiceOverride(next);
        void setConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE, value);
        if (!seed) return;
        runTranslate(seed.text, effectiveTargetLang, [next ?? pageDefaults.service], pageDefaults.options);
    };

    /**
     * Multi-service mode: add / remove one service and re-ask.
     *
     * Unchecking the last one is refused rather than allowed and worked around
     * downstream — a card with no answer in it looks broken, and the resolver
     * would immediately put the page default back anyway, so the checkbox would
     * appear to do nothing.
     */
    const onToggleService = (key: string) => {
        // Ordered by the picker, not by the tick: the re-ask below renders its
        // blocks in exactly this order, so appending would drop the freshly
        // ticked service to the bottom of the card until the next open.
        const next = orderSelectionServices(
            selectedServices.includes(key)
                ? selectedServices.filter((k) => k !== key)
                : [...selectedServices, key],
            pageDefaults.options,
        );
        if (next.length === 0) return;
        void setConfig(CONFIG_KEY.SELECTION_POPUP_SERVICES, next);
        if (!seed) return;
        runTranslate(seed.text, effectiveTargetLang, next, pageDefaults.options);
    };

    const onLangChange = (value: string) => {
        const next = value || null;
        setLangOverride(next);
        void setConfig(CONFIG_KEY.SELECTION_TARGET_LANGUAGE, value);
        if (!seed) return;
        const lng = next ?? pageDefaults.lang;
        runTranslate(seed.text, lng, selectedServices, pageDefaults.options);
        // The target language picks the dictionary provider as well as the
        // language its glosses are written in, so this is a fresh lookup.
        if (prefsRef.current.dict) runDict(seed.text, lng);
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
            // A press on our own CHROME is not a click-away. The one that
            // matters is the selection pill: it is a separate host, so it falls
            // outside the card, and closing here would tear the popup down on
            // the very press that asks it to translate the text the user just
            // selected inside it.
            //
            // Reading surfaces are excluded from that exemption, and the
            // subtitle dictionary panel is why: it is our UI, but its text is
            // content, so a press in it is an ordinary interaction elsewhere —
            // exactly what click-away means. Blanket-exempting every own
            // surface left the card stuck open on top of it.
            const target = e.composedPath()[0] as Node;
            if (isInOwnUi(target) && !isInSelectableSurface(target)) return;
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

    // The card is resizable, and every text block's one-line/multi-line decision
    // is made against the current width — see useNeedsOwnRow in SelectionCard.
    const origText = seed?.text ?? "";
    const cardWidth = manual?.width ?? POPUP_WIDTH;

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

    // Re-clamp whenever the card's own size changes.
    //
    // A ResizeObserver rather than a dependency list of everything that can add
    // a row, because that list is impossible to keep complete and failing to is
    // silent: the dictionary panel landing a second after the translation was
    // not in it, so a card anchored near the bottom of the screen never moved
    // and its new rows were simply cut off below the fold. (It looked fine on a
    // cache hit purely by accident — the translation was still streaming then,
    // and `output` changing re-ran the clamp for it.)
    //
    // No feedback loop: the clamp only ever writes position, never size.
    const [sizeTick, setSizeTick] = useState(0);
    useEffect(() => {
        const el = cardRef.current;
        if (!open || !el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => setSizeTick((n) => n + 1));
        ro.observe(el);
        return () => ro.disconnect();
    }, [open]);

    // Follow the selection on scroll / resize.
    //
    // The card is viewport-positioned from a SNAPSHOT of the selection rect, so
    // a page that scrolls under a live selection would otherwise leave the card
    // sitting where the text used to be. When the seed carried a live clone of
    // the selection range, re-measure it and re-run the placement. Skipped once
    // the user has taken over the geometry (`manual`), pinned the card, or when
    // the lookup was made inside the card itself (`keepPosition`) — then there
    // is no page selection to chase. rAF-throttled, capture phase so nested
    // scrollers are covered too.
    const onViewportChange = useCallback(() => {
        if (viewportRafRef.current !== null) return;
        viewportRafRef.current = requestAnimationFrame(() => {
            viewportRafRef.current = null;
            if (!open || manual || pinned || seed?.keepPosition) return;
            const range = seed?.range;
            if (!range) return;
            let rect: DOMRect | null = null;
            try {
                const r = range.getBoundingClientRect();
                if (r && (r.width > 0 || r.height > 0)) rect = r;
            } catch {
                return; // detached range — leave the card where it is
            }
            if (!rect) return;
            // Scrolling the card's OWN body fires a scroll here too, and the
            // page range's rect is unchanged then — re-anchoring would just be
            // a needless re-render.
            const last = lastAnchorRectRef.current;
            if (
                last &&
                last.left === rect.left &&
                last.top === rect.top &&
                last.right === rect.right &&
                last.bottom === rect.bottom
            ) {
                return;
            }
            lastAnchorRectRef.current = rect;
            setPlacement(computePlacement(rect));
        });
    }, [open, manual, pinned, seed]);

    useEffect(() => {
        if (!open || manual || pinned || seed?.keepPosition || !seed?.range) return;
        window.addEventListener("scroll", onViewportChange, true);
        window.addEventListener("resize", onViewportChange);
        return () => {
            window.removeEventListener("scroll", onViewportChange, true);
            window.removeEventListener("resize", onViewportChange);
            if (viewportRafRef.current !== null) {
                cancelAnimationFrame(viewportRafRef.current);
                viewportRafRef.current = null;
            }
        };
    }, [open, manual, pinned, seed, onViewportChange]);

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
    }, [open, manual, placement, sizeTick]);

    // Also gated on `prefs`: see the two-form comment above — the card's whole
    // shape depends on them, so it waits for the real answer rather than
    // painting a stock card it is about to replace. Only ever a wait on the
    // first open of a page; later reads resolve from the warm cache.
    if (!open || !prefs) return null;

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
            zIndex: POPUP_Z,
        }
        : {
            position: "fixed",
            left: placement.left,
            width: POPUP_WIDTH,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: placement.maxHeight,
            zIndex: POPUP_Z,
            ...("top" in placement ? { top: placement.top } : { bottom: placement.bottom }),
        };

    // "Follow page" labels for the first option of each header dropdown.
    const followServiceOpt = pageDefaults.options.find((o) => o.value === pageDefaults.service);
    const followServiceName = followServiceOpt
        ? (followServiceOpt.i18nKey ? t(followServiceOpt.i18nKey, followServiceOpt.label) : followServiceOpt.label)
        : pageDefaults.service;
    const followLangMeta = LANGUAGES_MAP.get(pageDefaults.lang);
    const followLangName = followLangMeta ? t(followLangMeta.title, followLangMeta.name) : pageDefaults.lang;

    // Whose dictionary entry to show. Decided HERE rather than before the
    // requests: by now the providers have answered and the translation has
    // reported its detected source language, so the choice is made on a known
    // language instead of a guess. `origLang` is the translation's detection
    // (falling back to the local one), used only when Google returned nothing.
    const dictEntry = chooseDictEntry(dictEntries, origLang, effectiveTargetLang);

    return (
        <SelectionCard
            prefs={prefs}
            origText={origText}
            origLang={origLang}
            origExpanded={origExpanded}
            onToggleOrigExpanded={() => setOrigExpanded((v) => !v)}
            runs={runs}
            targetLang={effectiveTargetLang}
            dictEntry={dictEntry}
            dictLoading={dictLoading}
            dictError={dictError}
            serviceOptions={pageDefaults.options}
            serviceValue={serviceOverride ?? ""}
            onServiceChange={onServiceChange}
            followServiceLabel={followServiceName}
            selectedServices={selectedServices}
            onToggleService={onToggleService}
            langValue={langOverride ?? ""}
            onLangChange={onLangChange}
            followLangLabel={followLangName}
            pinned={pinned}
            onTogglePin={() => setPinned((v) => !v)}
            onClose={close}
            tts={tts}
            cardWidth={cardWidth}
            cardRef={cardRef}
            style={style}
            onHeaderMouseDown={onHeaderMouseDown}
            onResizeMouseDown={onResizeMouseDown}
        />
    );
}
