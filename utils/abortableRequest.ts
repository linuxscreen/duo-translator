import { sendMessageToBackground, sendMessageToBackgroundOrThrow } from "./message";

/**
 * Cancellable request to background — the content-side twin of
 * `handleAbortable` in main/messageBridge.ts.
 *
 * NOTE ON PLACEMENT: this deliberately lives in its own module rather than in
 * utils/message.ts. `sendMessageToBackground` is the mock seam the unit suite
 * is built on (see main/__tests__/translateClient.test.ts — provider HTTP is
 * mocked there, not at `fetch`). A helper defined *inside* message.ts would
 * call its own local `sendMessageToBackground` binding, which `vi.mock` cannot
 * intercept, so every provider test would escape to the real transport. From a
 * separate module the import is a normal module edge and the mock applies.
 * Don't fold this back into message.ts.
 */
export async function abortableRequest<T = any>(opts: {
    action: string;
    /** Action fired with the same requestId when `signal` aborts. */
    abortAction: string;
    data?: Record<string, unknown>;
    signal?: AbortSignal | null;
    timeout?: number;
}): Promise<T | undefined> {
    const { action, abortAction, data, signal, timeout } = opts
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    // `sendMessage` has no native cancellation, so abort is relayed out of
    // band: the request carries a generated id, and aborting fires
    // `abortAction` with that id. Background parks an AbortController under it
    // and really cancels the upstream fetch — the result isn't just discarded.
    const requestId =
        (globalThis.crypto?.randomUUID?.() as string | undefined) ??
        `${Date.now()}_${Math.random().toString(36).slice(2)}`

    let onAbort: (() => void) | null = null
    if (signal) {
        onAbort = () => {
            void sendMessageToBackground({ action: abortAction, data: { requestId } })
        }
        signal.addEventListener("abort", onAbort)
    }

    try {
        // Throwing variant on purpose: the background's real failure reason
        // (an HTTP body, a provider message) would otherwise be flattened to
        // `undefined` and every caller would report a generic error. Callers
        // that must degrade rather than reject catch at their own boundary —
        // see AiTranslateService.translateText / DeepLTranslateService.request.
        const resp = await sendMessageToBackgroundOrThrow(
            { action, data: { requestId, ...data } },
            timeout,
        )
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
        return resp as T | undefined
    } finally {
        if (onAbort) signal?.removeEventListener("abort", onAbort)
    }
}
