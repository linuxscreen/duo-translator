import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Copy, Loader2, Pin, X } from "lucide-react";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { t, useLang } from "./i18n";
import { useCopyFeedback } from "./useCopyFeedback";
import { startTranslate, type TranslateServiceChoice } from "./translateRunner";

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
    /** Page-translation target language. */
    targetLang: string;
    /** Page-translation service (same one the page uses). */
    choice: TranslateServiceChoice;
    /** Viewport rect of the selection, used to anchor the popup. */
    rect: DOMRect | null;
}

function ensureMounted(): void {
    if (popupRoot) return;
    let host = document.getElementById(HOST_ID) as HTMLElement | null;
    if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-ai-ui", "");
        document.documentElement.appendChild(host);
    }
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
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

function SelectionPopupApp({ registerOpen }: { registerOpen: (fn: (s: SelectionSeed) => void) => void }) {
    useLang();
    const [open, setOpen] = useState(false);
    const [output, setOutput] = useState("");
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pinned, setPinned] = useState(false);
    const [placement, setPlacement] = useState<Placement>({ left: -9999, top: -9999, maxHeight: MAX_HEIGHT });
    const [copied, copy] = useCopyFeedback();

    const abortRef = useRef<(() => void) | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef(false);
    pinnedRef.current = pinned;

    const close = () => {
        if (abortRef.current) abortRef.current();
        abortRef.current = null;
        setRunning(false);
        setOpen(false);
    };

    useEffect(() => {
        registerOpen((seed) => {
            // Abort any in-flight stream from a previous selection.
            if (abortRef.current) { abortRef.current(); abortRef.current = null; }
            setOpen(true);
            setOutput("");
            setError(null);
            setPinned(false);
            setPlacement(computePlacement(seed.rect));

            if (!seed.text.trim()) {
                setRunning(false);
                return;
            }
            setRunning(true);
            const { stream, abort } = startTranslate(seed.text, seed.targetLang, seed.choice);
            abortRef.current = abort;
            (async () => {
                try {
                    for await (const delta of stream) {
                        setOutput((prev) => prev + delta);
                    }
                } catch (e: any) {
                    setError(e?.message || String(e));
                } finally {
                    setRunning(false);
                    abortRef.current = null;
                }
            })();
        });
    }, [registerOpen]);

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
    }, [open, output]);

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

    return (
        <div
            ref={cardRef}
            className="flex flex-col rounded-xl bg-[#0f1623]/97 border border-[rgba(140,180,230,0.18)] shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden"
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[rgba(140,180,230,0.1)] bg-[#141d2e]">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-[#8a93a8]">
                    {/* {running && <Loader2 className="h-3 w-3 animate-spin" />} */}
                    {t("selectionTranslateTitle", "Translation")}
                </div>
                <div className="flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => setPinned((v) => !v)}
                        title={pinned ? t("selectionUnpin", "Unpin") : t("selectionPin", "Pin")}
                        aria-label={pinned ? t("selectionUnpin", "Unpin") : t("selectionPin", "Pin")}
                        className={`h-6 w-6 inline-flex items-center justify-center rounded hover:bg-[rgba(120,200,230,0.1)] ${pinned ? "text-[oklch(0.86_0.16_195)]" : "text-[#8a93a8]"}`}
                    >
                        <Pin className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} />
                    </button>
                    <button
                        type="button"
                        onClick={close}
                        title={t("aiClose", "Close")}
                        aria-label={t("aiClose", "Close")}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-[rgba(120,200,230,0.1)] text-[#8a93a8]"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-auto px-3 py-2.5 text-[13px] leading-[1.5] text-[#eef1f8] whitespace-pre-wrap break-words">
                {error ? (
                    <span className="text-red-400">{error}</span>
                ) : running && !output ? (
                    <span className="inline-flex items-center gap-1.5 text-[#8a93a8]">
                        <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
                    </span>
                ) : (
                    output
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-3 py-1.5 border-t border-[rgba(140,180,230,0.08)] bg-[#0a111c]">
                <button
                    type="button"
                    onClick={() => copy(output)}
                    disabled={!output}
                    className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md border border-[rgba(140,180,230,0.18)] text-[12px] text-[#eef1f8] hover:border-[oklch(0.86_0.16_195)] disabled:opacity-40"
                >
                    <Copy className="h-3 w-3" /> {copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                </button>
            </div>
        </div>
    );
}
