// ---------------------------------------------------------------------------
// Request-error reporting — CONTENT SIDE.
//
// Every user-facing request in this extension (page translation, per-paragraph
// translation, selection translation, TTS, AI writing) is issued from the
// background service worker, because MV3 content scripts have no cross-origin
// privileges. That is the right architecture and it created one blind spot: a
// failure was logged to the *background* console — a separate console behind
// chrome://extensions that nobody opens — and the page was left with nothing.
// A dead endpoint, an expired API key and a quota wall all looked the same from
// the user's seat: nothing happened, silently.
//
// This module is the one funnel that closes that gap. Everything that fails a
// request calls `reportRequestError`, which does exactly two things:
//
//   1. prints the complete error to the PAGE console — message, the operation
//      that failed, and the background stack that `failResponse` shipped over
//      with it (main/messageBridge.ts);
//   2. raises a bubble at the top of the page via main/errorToast.
//
// Sub-frames do (1) locally and relay (2) to the top frame, so a failure in an
// iframe is still visible where the user is looking.
// ---------------------------------------------------------------------------

import { ACTION, APP_NAME_WITH_SUFFIX } from "@/main/constants";
import { BackgroundRequestError, sendMessageToBackground } from "@/utils/message";
import type { ErrorToastPayload } from "@/main/errorToast";

/**
 * Load the bubble surface on demand.
 *
 * Deliberately a dynamic import. This module is reached from translateClient.ts,
 * which is imported by nearly everything content-side; a static import would
 * put React, the i18n bundle and the Tailwind stylesheet into that graph, so
 * every page would pay to load a UI it will most likely never show. It also
 * makes the type-only import above the sole compile-time edge, which keeps the
 * unit suite from having to stand up a whole browser-i18n environment just to
 * test a translation call.
 */
function toast(payload: ErrorToastPayload): void {
    // NOT `void toast(...)` at the call sites any more: this used to be an
    // `async` function, so anything it threw became a REJECTION, which the
    // synchronous try/catch in reportRequestError below cannot catch and `void`
    // then discarded — an "Uncaught (in promise)" from the error reporter
    // itself. (Seen for real: on a page whose extension had been disabled,
    // showErrorToast → ensureMounted → bindThemeToElement → storage.watch threw
    // "Extension context invalidated.") Keeping the catch inside makes the
    // "reporting never becomes the failure" promise true for callers.
    import("@/main/errorToast")
        .then(({ showErrorToast }) => showErrorToast(payload))
        .catch((e) => {
            console.log(APP_NAME_WITH_SUFFIX, "error bubble failed to render:", e);
        });
}

/**
 * Draw a bubble for an error reported by another frame (relayed through
 * background). The console line was already written by the frame that failed,
 * so this is the display half only.
 */
export function showRelayedError(payload: ErrorToastPayload): void {
    if (!payload?.reason) return;
    toast(payload);
}

/**
 * Which feature failed. The value is the i18n key of the label shown in the
 * bubble; `ERROR_SCOPE_FALLBACK` below carries the English text used when the
 * key is missing.
 */
export const ERROR_SCOPE = {
    PAGE_TRANSLATE: "errScopePageTranslate",
    PARAGRAPH_TRANSLATE: "errScopeParagraphTranslate",
    SELECTION_TRANSLATE: "errScopeSelectionTranslate",
    TTS: "errScopeTts",
    AI_WRITING: "errScopeAiWriting",
    SUBTITLE: "errScopeSubtitle",
    DICTIONARY: "errScopeDictionary",
} as const;

export type ErrorScope = (typeof ERROR_SCOPE)[keyof typeof ERROR_SCOPE];

const ERROR_SCOPE_FALLBACK: Record<string, string> = {
    [ERROR_SCOPE.PAGE_TRANSLATE]: "Page translation",
    [ERROR_SCOPE.PARAGRAPH_TRANSLATE]: "Paragraph translation",
    [ERROR_SCOPE.SELECTION_TRANSLATE]: "Selection translation",
    [ERROR_SCOPE.TTS]: "Text to speech",
    [ERROR_SCOPE.AI_WRITING]: "AI writing",
    [ERROR_SCOPE.SUBTITLE]: "Video subtitles",
    [ERROR_SCOPE.DICTIONARY]: "Dictionary",
};

export interface ReportOptions {
    /** Extra fields printed to the console only — never shown in the bubble. */
    detail?: Record<string, unknown>;
    /**
     * Log the full error but raise no bubble. The console line stays complete;
     * only the on-screen notice is suppressed. Two cases qualify:
     *
     *  - the failure has a working fallback and costs the user nothing
     *    (language detection falls back to the local franc detector), so a
     *    bubble would be noise they cannot act on;
     *  - the surface that made the request ALREADY shows the reason in its own
     *    UI (the AI writing dot, workbench and selection popup all render it
     *    inline next to the input). A second copy at the top of the page is one
     *    error the user has to dismiss twice — and dismissing the bubble is
     *    permanent, so the leftover inline copy reads like it did not work.
     *
     * The rule of thumb: the bubble is for failures with no other visible
     * channel. Never use `silent` to quiet a failure the user cannot otherwise
     * see — that is the exact bug this whole module exists to fix.
     */
    silent?: boolean;
}

/**
 * True for errors that are normal control flow rather than failures: the user
 * cancelled, or the surface was torn down mid-request. Reporting these would
 * put a bubble on screen every time someone toggles translation off mid-run.
 */
export function isAbortError(e: any): boolean {
    if (!e) return false;
    if (e.name === "AbortError" || e.originalName === "AbortError") return true;
    const msg = String(e.message || e);
    return /(^|\b)(aborted|abort error)\b/i.test(msg);
}

/** One-line reason for the bubble. Never "[object Object]", never empty. */
function reasonOf(e: any): string {
    if (typeof e === "string" && e.trim()) return e.trim();
    const msg = e?.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    try {
        const s = String(e);
        if (s && s !== "[object Object]") return s;
    } catch { /* toString threw — fall through */ }
    return "Unknown error";
}

const isTopFrame = (): boolean => {
    try {
        return window.top === window.self;
    } catch {
        // Cross-origin `window.top` access throws — that only happens in a
        // sub-frame, which is the answer we wanted anyway.
        return false;
    }
};

/**
 * Report a failed request.
 *
 * Safe to call from any frame and from any surface; it never throws and never
 * rejects, so it can be used inside a `catch` without a second guard.
 */
export function reportRequestError(scope: ErrorScope, error: any, options?: ReportOptions): void {
    try {
        if (isAbortError(error)) return;

        const scopeLabel = ERROR_SCOPE_FALLBACK[scope] || scope;
        const reason = reasonOf(error);

        const bg = error instanceof BackgroundRequestError ? error : null;
        console.log(
            `${APP_NAME_WITH_SUFFIX}${scopeLabel} failed: ${reason}`,
            {
                scope: scopeLabel,
                reason,
                // Where the request was going, when we know it.
                action: bg?.action,
                backgroundScope: bg?.scope,
                errorName: bg?.originalName ?? error?.name,
                // The stack from the service worker, where the throw actually
                // happened. The local stack below only records the messaging
                // call and is near-useless on its own.
                backgroundStack: bg?.backgroundStack,
                contentStack: error?.stack,
                frame: isTopFrame() ? "top" : window.location.href,
                ...(options?.detail ?? {}),
            },
        );

        if (options?.silent) return;

        // (2) The bubble.
        const payload: ErrorToastPayload = { scopeKey: scope, scopeLabel, reason };
        if (isTopFrame()) {
            toast(payload);
        } else {
            // A sub-frame has no business drawing a page-level bubble (it would
            // be clipped to the iframe's box, and cross-origin frames often have
            // no room at all). Background re-sends this to frame 0.
            void sendMessageToBackground({ action: ACTION.REPORT_ERROR, data: payload });
        }
    } catch (e) {
        // Reporting must never become the failure. Nothing else to do here — if
        // even this line throws we have no channel left.
        console.log(APP_NAME_WITH_SUFFIX, "error reporting itself failed:", e);
    }
}
