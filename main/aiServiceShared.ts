/** Maximum source text per AI request, including independently translated paragraphs. */
export const AI_MAX_INPUT_CHARS = 20_000;

export function assertAiInputLength(text: string): void {
    if (text.length > AI_MAX_INPUT_CHARS) {
        throw new Error(
            `Text too long for one AI request (${text.length} chars, limit ${AI_MAX_INPUT_CHARS}). Split it into smaller pieces.`,
        );
    }
}

export function applyTemplate(url: string, vars: { model: string; key: string }): string {
    return url
        .replace(/\{model\}/g, encodeURIComponent(vars.model))
        .replace(/\{key\}/g, encodeURIComponent(vars.key));
}

// Yields the `data:` payload of each complete frame, separated by blank lines.
export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf("\n\n")) !== -1) {
                const frame = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                // Concatenate multi-line `data:` payloads per SSE spec.
                let data = "";
                for (const rawLine of frame.split("\n")) {
                    const line = rawLine.trim();
                    if (!line || !line.startsWith("data:")) continue;
                    data += (data ? "\n" : "") + line.slice(5).trim();
                }
                if (data) yield data;
            }
        }
    } finally {
        // Consumers may stop early — AI_PROVIDER_TEST breaks out after ~32
        // chars, and any aborted stream closes the generator mid-iteration.
        // Without cancelling, the upstream response body stays open.
        // Fire-and-forget: cancel() on an already-closed reader can reject, and
        // this must never block the generator's teardown.
        void reader.cancel().catch(() => { });
    }
}

const NON_STREAM_MAX_CONCURRENCY = 5;
let nonStreamActive = 0;
const nonStreamWaiters: (() => void)[] = [];

function acquireNonStreamSlot(): Promise<void> {
    if (nonStreamActive < NON_STREAM_MAX_CONCURRENCY) {
        nonStreamActive++;
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => nonStreamWaiters.push(resolve));
}

function releaseNonStreamSlot(): void {
    const next = nonStreamWaiters.shift();
    if (next) {
        // Hand the slot straight to the next waiter — active count stays put.
        next();
    } else {
        nonStreamActive--;
    }
}

/** Shares the upstream concurrency limit across all non-streaming AI providers. */
export async function withNonStreamSlot<T>(request: () => Promise<T>): Promise<T> {
    await acquireNonStreamSlot();
    try {
        return await request();
    } finally {
        releaseNonStreamSlot();
    }
}
