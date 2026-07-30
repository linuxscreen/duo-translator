// ---------------------------------------------------------------------------
// Content-side AI entry points.
//
// The two ways a content script asks background to run an AI task: a port for
// streaming (`startAiChatStream`) and a one-shot message for everything else
// (`aiComplete`). No provider HTTP and no API keys live here — those are in
// main/aiService.ts, which content must never import.
// ---------------------------------------------------------------------------

import { ACTION, AI_REQUEST_TIMEOUT, PORT_NAME } from "@/main/constants";
import { browser } from "wxt/browser";
import { abortableRequest } from "@/utils/abortableRequest";
import type { AiStreamRequest, AiStreamMessage } from "@/main/aiProvider";

// ---------------------------------------------------------------------------
// Open a port and consume deltas as an async iterable
// ---------------------------------------------------------------------------

export function startAiChatStream(req: AiStreamRequest): {
    stream: AsyncIterable<string>;
    abort: () => void;
} {
    const port = browser.runtime.connect({ name: PORT_NAME.AI_CHAT_STREAM });
    port.postMessage(req);

    let resolveNext: ((v: IteratorResult<string>) => void) | null = null;
    let rejectNext: ((err: any) => void) | null = null;
    const queue: string[] = [];
    let ended = false;
    let error: Error | null = null;

    const onMessage = (raw: any) => {
        const msg = raw as AiStreamMessage;
        if (msg.type === "delta") {
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                rejectNext = null;
                r({ value: msg.text, done: false });
            } else {
                queue.push(msg.text);
            }
        } else if (msg.type === "done") {
            ended = true;
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                rejectNext = null;
                r({ value: undefined as any, done: true });
            }
        } else if (msg.type === "error") {
            error = new Error(msg.message);
            if (rejectNext) {
                const r = rejectNext;
                resolveNext = null;
                rejectNext = null;
                r(error);
            }
        }
    };
    // Terminate the iteration as "done", resolving any pending `next()` so a
    // parked `for await` loop unblocks and runs to completion. Safe to call
    // multiple times.
    const finish = () => {
        ended = true;
        if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            rejectNext = null;
            r({ value: undefined as any, done: true });
        }
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(finish);

    const stream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
            return {
                next(): Promise<IteratorResult<string>> {
                    if (error) return Promise.reject(error);
                    if (queue.length > 0) {
                        return Promise.resolve({ value: queue.shift()!, done: false });
                    }
                    if (ended) return Promise.resolve({ value: undefined as any, done: true });
                    return new Promise<IteratorResult<string>>((resolve, reject) => {
                        resolveNext = resolve;
                        rejectNext = reject;
                    });
                },
                return(): Promise<IteratorResult<string>> {
                    try { port.disconnect(); } catch { }
                    ended = true;
                    return Promise.resolve({ value: undefined as any, done: true });
                },
            };
        },
    };

    return {
        stream,
        // Calling `port.disconnect()` does NOT fire our own `onDisconnect`
        // listener (only the other end is notified), so we must `finish()`
        // ourselves — otherwise a `for await` loop parked on `next()` hangs
        // forever and the caller's `running` flag never clears.
        abort: () => { finish(); try { port.disconnect(); } catch { } },
    };
}

// ---------------------------------------------------------------------------
// Content-side helper: one-shot completion (no streaming)
// ---------------------------------------------------------------------------

/**
 * Run one AI task and resolve with the complete answer.
 *
 * The counterpart to {@link startAiChatStream}, for callers that can do nothing
 * with a partial answer — subtitle segmentation has to align the model's whole
 * output against the source text before it means anything, so streaming it just
 * pays for a port and one message per delta. Background sends the upstream
 * request with `stream:false` and, where the provider supports it, thinking
 * turned off.
 *
 * Cancellation goes out of band (`sendMessage` has no native abort): the
 * request is tagged with a requestId and an abort fires AI_COMPLETE_ABORT with
 * that id, so background really cancels the upstream fetch.
 *
 * Throws on provider/config failure — callers are expected to have a fallback.
 */
export async function aiComplete(req: AiStreamRequest, signal?: AbortSignal): Promise<string> {
    const res = await abortableRequest<{ text?: string }>({
        action: ACTION.AI_COMPLETE,
        abortAction: ACTION.AI_COMPLETE_ABORT,
        data: { providerId: req.providerId, task: req.task, payload: req.payload },
        signal,
        timeout: AI_REQUEST_TIMEOUT,
    });

    // A failed request resolves `undefined` rather than throwing, so this is
    // the error path too.
    if (!res || typeof res.text !== "string") throw new Error("AI request failed");
    return res.text;
}
