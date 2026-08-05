// ---------------------------------------------------------------------------
// Shared scaffolding for background message handlers — BACKGROUND ONLY.
//
// Every network-ish handler in background used to open-code the same shape:
// an async IIFE, a try/catch that logs and replies STATUS_FAIL, a per-request
// AbortController parked in a module-level Map, and a `finally` that removes
// it. That was seven near-identical copies of the try/catch and three
// byte-identical abort handlers backed by three identical Maps.
//
// The wire protocol is deliberately unchanged: each feature keeps its own
// ACTION entry (they carry the design rationale — see main/constants.ts), and
// the request/response envelopes are exactly what they were. Only the
// scaffolding is shared.
//
// The content-side twin of this file is utils/abortableRequest.ts.
// ---------------------------------------------------------------------------

import { APP_NAME_WITH_SUFFIX, STATUS_FAIL, STATUS_SUCCESS } from "@/main/constants";

type SendResponse = (response: any) => void;

/**
 * In-flight AbortControllers, keyed by scope then by the content-supplied
 * requestId. One nested table replaces the three parallel Maps that used to
 * live in background.ts (aiTranslateAborters / translateProxyAborters /
 * aiCompleteAborters). Entries are removed when the request settles.
 *
 * Scopes are separate namespaces on purpose: requestIds are generated
 * independently per feature, so a collision across features is possible in
 * principle and would otherwise let one feature's abort cancel another's.
 */
const aborters = new Map<string, Map<string, AbortController>>();

function scopeTable(scope: string): Map<string, AbortController> {
    let table = aborters.get(scope);
    if (!table) {
        table = new Map();
        aborters.set(scope, table);
    }
    return table;
}

/**
 * Shape every failure reply uses. Keep in sync with `failureMessage` in
 * utils/message.ts.
 *
 * `name` and `stack` ride along because this is a cross-context throw: the
 * error was raised in the service worker, whose console the user never opens.
 * Without them the content script can only ever print its own stack, which
 * says "a message failed" and nothing about where. `label` is included as
 * `scope` so the page-side report can name the operation, not just the reason.
 */
function failResponse(sendResponse: SendResponse, label: string, e: any): void {
    console.error(APP_NAME_WITH_SUFFIX, `${label} failed:`, e);
    sendResponse({
        status: STATUS_FAIL,
        data: {
            message: e?.message || String(e),
            name: e?.name,
            stack: e?.stack,
            scope: label,
        },
    });
}

/**
 * Run an async handler and reply with its result.
 *
 * Returns `true` so the caller can `return handleAsync(...)` directly from the
 * onMessage listener — MV3 requires that to keep the response channel open.
 *
 * @param label human-readable name used in the failure log line
 * @param fn resolves to the value placed in `data` on success
 */
export function handleAsync(
    label: string,
    sendResponse: SendResponse,
    fn: () => Promise<any>,
): true {
    void (async () => {
        try {
            sendResponse({ status: STATUS_SUCCESS, data: await fn() });
        } catch (e: any) {
            failResponse(sendResponse, label, e);
        }
    })();
    return true;
}

/**
 * Like {@link handleAsync}, but cancellable.
 *
 * `sendMessage` has no native cancellation, so abort is relayed out of band:
 * the content side tags the request with a requestId and later fires the
 * feature's *_ABORT action with the same id. We park an AbortController under
 * that id for the duration of the request, so the abort really cancels the
 * upstream fetch rather than merely ignoring its result.
 *
 * @param scope abort namespace, must match the {@link handleAbort} call for the
 *              paired *_ABORT action
 */
export function handleAbortable(
    scope: string,
    label: string,
    message: any,
    sendResponse: SendResponse,
    fn: (data: any, signal: AbortSignal) => Promise<any>,
): true {
    void (async () => {
        const data = message?.data || {};
        const requestId: string | undefined = data.requestId;
        const controller = new AbortController();
        const table = scopeTable(scope);
        if (requestId) table.set(requestId, controller);
        try {
            sendResponse({ status: STATUS_SUCCESS, data: await fn(data, controller.signal) });
        } catch (e: any) {
            failResponse(sendResponse, label, e);
        } finally {
            if (requestId) table.delete(requestId);
        }
    })();
    return true;
}

/**
 * Cancel the in-flight {@link handleAbortable} request for this scope+requestId.
 * Synchronous — replies immediately and does not keep the channel open.
 */
export function handleAbort(scope: string, message: any, sendResponse: SendResponse): void {
    const requestId: string | undefined = message?.data?.requestId;
    const controller = requestId ? aborters.get(scope)?.get(requestId) : undefined;
    if (controller) {
        controller.abort();
        aborters.get(scope)!.delete(requestId!);
    }
    sendResponse({ status: STATUS_SUCCESS });
}

/** Abort scopes. Values are arbitrary but must be unique per feature. */
export const ABORT_SCOPE = {
    TRANSLATE: "translate",
    AI_TRANSLATE: "aiTranslate",
    AI_COMPLETE: "aiComplete",
} as const;
