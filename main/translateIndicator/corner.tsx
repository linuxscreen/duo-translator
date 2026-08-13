// The bottom-right variant of the translating indicator — one surface for the
// whole tab, instead of one marker per paragraph.
//
// Top frame only, and lazily imported (it pulls in React, the i18n dictionaries
// and the Tailwind sheet — same reasoning as main/errorToast). Sub-frames report
// their state to the top frame instead of drawing their own, because this is
// anchored to the viewport and an iframe's viewport is a box somewhere in the
// middle of the page.
//
// State comes entirely from the controller in ./index.ts, already folded across
// frames; this file only renders it and calls back.
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertCircle, RotateCw, X } from "lucide-react";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import type { CornerIndicatorState } from "./types";

const HOST_ID = "duo-translate-indicator-host";

const EMPTY: CornerIndicatorState = { pending: 0, failed: 0, failure: null };

// ---------------------------------------------------------------------------
// Store (outside React, so the controller can push before the mount lands)
// ---------------------------------------------------------------------------

let state: CornerIndicatorState = EMPTY;
const listeners = new Set<(v: CornerIndicatorState) => void>();

interface CornerCallbacks {
    /** Receives the button, which the reason panel anchors itself to. */
    onDetails: (anchor: HTMLElement) => void;
    onRetry: () => void;
    onDismiss: () => void;
}
let callbacks: CornerCallbacks | null = null;

function emit(): void {
    const snapshot = state;
    listeners.forEach((fn) => fn(snapshot));
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function CornerIndicator(): JSX.Element | null {
    useLang();
    const [current, setCurrent] = useState<CornerIndicatorState>(state);

    useEffect(() => {
        listeners.add(setCurrent);
        return () => { listeners.delete(setCurrent); };
    }, []);

    const failed = current.failed > 0;
    if (!failed && current.pending <= 0) return null;

    return (
        <div className="pointer-events-none fixed right-4 bottom-4 z-[2147483646] flex justify-end">
            <div
                role={failed ? "alert" : "status"}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-line-strong bg-surface py-1.5 pr-2 pl-3 shadow-lg"
            >
                {failed ? (
                    <>
                        <AlertCircle className="h-4 w-4 shrink-0 text-error" />
                        <span className="text-[12px] text-ink-soft">
                            {/* The count is the useful part: one pill stands in
                                for every failed batch in the tab. */}
                            {t("translateIndicatorFailedCount", "Translation failed")}
                            {current.failed > 1 ? ` ×${current.failed}` : ""}
                        </span>
                        <button
                            type="button"
                            aria-label={t("translateIndicatorDetails", "Translation failed — show details")}
                            title={t("translateIndicatorDetails", "Translation failed — show details")}
                            onClick={(e) => callbacks?.onDetails(e.currentTarget)}
                            className="shrink-0 rounded-full p-1 text-ink-soft hover:bg-hover-2 hover:text-ink"
                        >
                            <AlertCircle className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            aria-label={t("translateIndicatorRetryAll", "Retry all failed paragraphs")}
                            title={t("translateIndicatorRetryAll", "Retry all failed paragraphs")}
                            onClick={() => callbacks?.onRetry()}
                            className="shrink-0 rounded-full p-1 text-ink-soft hover:bg-hover-2 hover:text-ink"
                        >
                            <RotateCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            aria-label={t("errDismiss", "Dismiss")}
                            title={t("errDismiss", "Dismiss")}
                            onClick={() => callbacks?.onDismiss()}
                            className="shrink-0 rounded-full p-1 text-ink-soft hover:bg-hover-2 hover:text-ink"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </>
                ) : (
                    <>
                        {/* Tailwind's `animate-spin`, written out: the ring is a
                            border trick and needs the transparent top edge. */}
                        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-ink-soft border-t-transparent" />
                        <span className="pr-1 text-[12px] text-ink-soft">
                            {t("translatingStatus", "Translating…")}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

let cornerRoot: Root | null = null;

function ensureMounted(): void {
    if (cornerRoot) return;
    let host = document.getElementById(HOST_ID) as HTMLElement | null;
    if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-ai-ui", "");
        // <html> rather than <body>: an SPA that swaps the body would take the
        // host with it mid-translation.
        document.documentElement.appendChild(host);
    }
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    // Claim the root BEFORE anything that can throw, so a failure cannot leave a
    // half-built mount to be retried into a second React root (see the note in
    // main/errorToast).
    cornerRoot = createRoot(mount);
    bindThemeToElement(mount);
    cornerRoot.render(<CornerIndicator />);
}

/**
 * Render the tab's folded indicator state. Mounting is lazy on the first
 * non-idle state, so a page that never translates never pays for this surface.
 */
export function renderCornerIndicator(next: CornerIndicatorState, cbs: CornerCallbacks): void {
    state = next;
    callbacks = cbs;
    if (next.pending > 0 || next.failed > 0) ensureMounted();
    emit();
}
