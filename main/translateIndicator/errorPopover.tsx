// The reason panel of the translating indicator — a small popover anchored to
// whichever button was pressed.
//
// The failure is reported where the user is already looking: right under the
// inline marker's "!" button, or right above the corner pill's. It deliberately
// does NOT reuse the page-level error bubble at the top of the viewport — that
// one exists for failures with no other visible channel (main/errorReport.ts),
// and sending the user's eye to the other end of the page to read about the
// paragraph they just clicked is exactly the disconnect this indicator was added
// to remove.
//
// One instance per frame: only one reason is ever being read at a time, and a
// single positioned panel is far less machinery than one per marker.
//
// Anchoring is `position: fixed` inside our own Shadow DOM, NOT a child of the
// marker. A panel inside page content gets clipped by any ancestor with
// `overflow: hidden` and inherits whatever the site does to its descendants —
// the same lesson main/ruleMode.ts records for its highlight boxes.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertCircle, X } from "lucide-react";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import type { IndicatorFailure } from "./types";

const HOST_ID = "duo-translate-error-popover-host";

/** Gap between the anchor and the panel, and the minimum viewport margin. */
const GAP = 6;
const MARGIN = 8;

interface PopoverState {
    anchor: HTMLElement;
    failure: IndicatorFailure;
}

// ---------------------------------------------------------------------------
// Store (outside React, so callers need no mount ceremony)
// ---------------------------------------------------------------------------

let current: PopoverState | null = null;
const listeners = new Set<(v: PopoverState | null) => void>();

function emit(): void {
    const snapshot = current;
    listeners.forEach((fn) => fn(snapshot));
}

function close(): void {
    if (!current) return;
    current = null;
    emit();
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

interface Position {
    top: number;
    left: number;
}

/**
 * Place the panel against its anchor, honouring all four edges and the four
 * corners: below by default, flipped above when the bottom half has no room,
 * centred on the anchor and then clamped into the viewport on both axes so a
 * marker at the very edge of the page still shows the whole panel.
 */
function place(anchor: HTMLElement, width: number, height: number): Position {
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = rect.bottom + GAP;
    if (top + height > vh - MARGIN) {
        const above = rect.top - GAP - height;
        // Flip only if there is genuinely more room up there; otherwise keep it
        // below and let the clamp below deal with a viewport too small for it.
        top = above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - height);
    }

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - MARGIN - width));
    return { top, left };
}

function ErrorPopover(): JSX.Element | null {
    useLang();
    const [state, setState] = useState<PopoverState | null>(current);
    // Off-screen until measured, so the first paint never flashes at 0,0.
    const [pos, setPos] = useState<Position>({ top: -9999, left: -9999 });
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        listeners.add(setState);
        return () => { listeners.delete(setState); };
    }, []);

    const anchor = state?.anchor ?? null;

    // Measure + place after every render of a new reason (the text decides the
    // height, so this cannot be computed before it is in the DOM).
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!anchor || !panel) return;
        const reposition = () => {
            if (!anchor.isConnected) {
                // The marker was retried away or the page restored underneath
                // us: a panel pointing at nothing is worse than no panel.
                close();
                return;
            }
            setPos(place(anchor, panel.offsetWidth, panel.offsetHeight));
        };
        reposition();

        // `scroll` in the capture phase catches nested scrollers, not just the
        // document — the marker is inside page content and frequently inside one.
        let frame = 0;
        const onViewportChange = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                reposition();
            });
        };
        window.addEventListener("scroll", onViewportChange, true);
        window.addEventListener("resize", onViewportChange);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onViewportChange, true);
            window.removeEventListener("resize", onViewportChange);
        };
    }, [anchor, state?.failure]);

    // Dismiss on Escape or on a press outside. The press that OPENED it is
    // excluded by the anchor test — otherwise the pointerdown would close what
    // the click is about to open, and the button would look dead.
    useEffect(() => {
        if (!anchor) return;
        const host = document.getElementById(HOST_ID);
        const onPointerDown = (e: Event) => {
            const path = e.composedPath();
            if (host && path.includes(host)) return;
            if (path.includes(anchor)) return;
            close();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [anchor]);

    if (!state) return null;

    return (
        <div
            ref={panelRef}
            role="alert"
            style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
            className="fixed z-[2147483647] flex w-max max-w-[min(22rem,90vw)] items-start gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 shadow-lg"
        >
            <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-error" />
            <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-error">
                    {t(state.failure.scopeKey, state.failure.scopeLabel)}
                </div>
                {/* Provider bodies are routinely one unbroken JSON string or URL,
                    and can be long — wrap hard, then scroll rather than grow. */}
                <p className="mt-0.5 max-h-[40vh] overflow-y-auto text-[12px] leading-snug break-words text-ink-soft">
                    {state.failure.reason}
                </p>
            </div>
            <button
                type="button"
                aria-label={t("errDismiss", "Dismiss")}
                title={t("errDismiss", "Dismiss")}
                onClick={close}
                className="-mr-1 shrink-0 rounded p-1 text-ink-soft hover:bg-hover-2 hover:text-ink"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

let popoverRoot: Root | null = null;

function ensureMounted(): void {
    if (popoverRoot) return;
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
    // Claim the root BEFORE anything that can throw (see main/errorToast).
    popoverRoot = createRoot(mount);
    bindThemeToElement(mount);
    popoverRoot.render(<ErrorPopover />);
}

/**
 * Show `failure` next to `anchor`, or close it if that same anchor's panel is
 * already open (the buttons toggle).
 */
export function toggleIndicatorError(anchor: HTMLElement, failure: IndicatorFailure): void {
    if (current?.anchor === anchor) {
        close();
        return;
    }
    current = { anchor, failure };
    ensureMounted();
    emit();
}

/** Close whatever is open (page restored, indicators cleared). */
export function hideIndicatorError(): void {
    close();
}

/**
 * Close only if the open panel belongs to `root` — the marker it was anchored
 * to is being removed (retried, restored). Scoped rather than unconditional
 * because markers come down all the time: a paragraph elsewhere finishing
 * translating must not shut the reason the user is reading.
 *
 * `contains` still answers correctly once `root` is detached, so this may be
 * called either side of the removal.
 */
export function hideIndicatorErrorIn(root: Node): void {
    if (current && root.contains(current.anchor)) close();
}
