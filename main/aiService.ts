// ---------------------------------------------------------------------------
// AI provider clients — BACKGROUND ONLY.
//
// Everything here talks to a provider over HTTP with the user's API key
// attached. Content scripts must never import this module: they go through
// main/aiClient.ts, which messages background instead. The shared provider
// model and wire types live in main/aiProvider.ts.
// ---------------------------------------------------------------------------

import { ACTION, AI_TASK, CONFIG_KEY, DEFAULT_VALUE, LANGUAGES_MAP, PORT_NAME } from "@/main/constants";
import { browser } from "wxt/browser";
import { normalizeProvider } from "@/main/aiProvider";
import type {
    AiProvider,
    AiStreamMessage,
    AiStreamRequest,
    ChatMessage,
    ChatOptions,
} from "@/main/aiProvider";
import { configRepo } from "@/main/storage/configStore";
import { ABORT_SCOPE, handleAbort, handleAbortable, handleAsync } from "@/main/messageBridge";

/**
 * Paragraph separator in page-translation prompts. The model is told to
 * preserve it verbatim, and the response is split on it — so the prompt text
 * and the splitter must never drift apart. Exported because it is the protocol
 * between {@link buildPrompt} and {@link aiPageTranslate}.
 */
export const SEPARATOR_TAG = "<sep/>";

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on the text of one AI request.
 *
 * A backstop against runaway PROGRAMMATIC input, not a user-facing limit: it
 * sits well above any plausible hand-written selection, but below the point
 * where a request costs real money and stalls for a minute. Features that feed
 * generated text to a provider (subtitle segmentation, page translation) must
 * chunk to their own, much tighter budget — the video subtitle segmenter once
 * shipped whole transcripts this way. Enforced here because `buildPrompt` is
 * the one place every AI path goes through; the throw is reported to the caller
 * as a stream error.
 */
export const AI_MAX_INPUT_CHARS = 20_000;

export function buildPrompt(req: AiStreamRequest): ChatMessage[] {
    const { task, payload } = req;
    const text = payload.text ?? "";
    if (text.length > AI_MAX_INPUT_CHARS) {
        throw new Error(
            `Text too long for one AI request (${text.length} chars, limit ${AI_MAX_INPUT_CHARS}). Split it into smaller pieces.`,
        );
    }
    switch (task) {
        case AI_TASK.TRANSLATE: {
            const lang = LANGUAGES_MAP.get(payload.targetLang || DEFAULT_VALUE.AI_TARGET_LANGUAGE)?.name;
            return [
                {
                    role: "system",
                    content: `You are a professional ${lang} native speaker translator. Translate any text the user inputs into ${lang}. The translation should be natural and fluent, conforming to ${lang} expression conventions. Output only the translation, with no explanation, no quotes, or formatting marks. If the original text is already in ${lang}, output it as-is.`,
                },
                { role: "user", content: text },
            ];
        }
        case AI_TASK.GRAMMAR:
            return [
                { role: "system", content: "You are a writing assistant. Fix grammar, spelling, and punctuation with the smallest possible edits. Preserve tone, meaning, and the original language. Output only the corrected text, with no explanation, no quotes, no markdown." },
                { role: "user", content: text },
            ];
        case AI_TASK.POLISH:
            return [
                { role: "system", content: "You are a writing assistant. Polish the user's text for clarity and fluency while keeping the original meaning and language. Output only the rewritten text, with no explanation, no quotes, no markdown." },
                { role: "user", content: text },
            ];
        case AI_TASK.FORMAL:
            return [
                { role: "system", content: "You are a writing assistant. Rewrite the user's text in a formal, professional tone. Keep the original language. Output only the rewritten text, with no explanation, no quotes, no markdown." },
                { role: "user", content: text },
            ];
        case AI_TASK.CASUAL:
            return [
                { role: "system", content: "You are a writing assistant. Rewrite the user's text in a casual, conversational tone. Keep the original language. Output only the rewritten text, with no explanation, no quotes, no markdown." },
                { role: "user", content: text },
            ];
        case AI_TASK.CUSTOM:
            return [
                { role: "system", content: payload.systemPrompt || "You are a writing assistant. Follow the user's instructions and reply with only the requested output." },
                { role: "user", content: text },
            ];
        case AI_TASK.PAGE_TRANSLATE: {
            // Keep `${lang}` (resolved target language name) in scope so the
            // prompt template can interpolate it once the user fills in the
            // content. The user content is a JSON-stringified array of
            // paragraph texts (each item may contain <bN> placeholder tags
            // that MUST be preserved exactly in the output array).
            const lang = LANGUAGES_MAP.get(payload.targetLang || DEFAULT_VALUE.AI_TARGET_LANGUAGE)?.name;
            return [
                { role: "system", content: `You are a professional ${lang} native speaker translator. Translate any text the user inputs into ${lang}. The translation should be natural and fluent, conforming to ${lang} expression conventions. Output only the translation, with no explanation, no quotes, or formatting marks. If the original text is already in ${lang}, output it as-is. If the text contains XML tags, consider where the tags should be placed in the translation while maintaining fluency. The ${SEPARATOR_TAG} XML tag is the sole paragraph separator. Preserve every ${SEPARATOR_TAG} tag in your translation exactly as-is. Each paragraph must map one-to-one to the source — do not merge, split, or reorder them.` },
                { role: "user", content: text },
            ];
        }
    }
}

// ---------------------------------------------------------------------------
// Streaming clients — background-only (CORS, API-key isolation)
// ---------------------------------------------------------------------------

function applyTemplate(url: string, vars: { model: string; key: string }): string {
    return url
        .replace(/\{model\}/g, encodeURIComponent(vars.model))
        .replace(/\{key\}/g, encodeURIComponent(vars.key));
}

/**
 * Dispatch a chat-completion stream to the right protocol adapter based on
 * `provider.type`. Yields plain text deltas in document order.
 */
export async function* chatStream(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): AsyncGenerator<string, void, void> {
    switch (provider.type) {
        case "gemini":
            yield* geminiChatStream(provider, messages, opts);
            return;
        case "claude":
            yield* claudeChatStream(provider, messages, opts);
            return;
        // OpenAI-compatible: openai, deepseek, ollama, openrouter, custom
        default:
            yield* openAiChatStream(provider, messages, opts);
            return;
    }
}

// SSE frame parser shared by OpenAI/Gemini. Yields the `data:` payload of
// each complete frame (frames separated by blank lines).
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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

// ---- OpenAI-compatible (also DeepSeek / Ollama / OpenRouter / Custom) ----

export async function* openAiChatStream(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): AsyncGenerator<string, void, void> {
    const url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: provider.model,
            messages,
            stream: true,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
            ...(opts.params !== undefined ? opts.params : {})
        }),
        signal: opts.signal,
    });

    if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`AI request failed: HTTP ${resp.status} ${resp.statusText} ${errText}`);
    }

    for await (const data of sseFrames(resp.body)) {
        if (data === "[DONE]") return;
        try {
            const json = JSON.parse(data);
            const delta: string | undefined = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) yield delta;
        } catch {
            /* ignore keep-alive comments / malformed lines */
        }
    }
}

// ---- Gemini (native generateContent + alt=sse) ----

export async function* geminiChatStream(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): AsyncGenerator<string, void, void> {
    // Gemini separates the system instruction from the conversational turns.
    // Map: system → systemInstruction; user/assistant → contents (role
    // 'model' for assistant). Adjacent same-role messages are merged into
    // one Content with multiple parts.
    const systemParts: { text: string }[] = [];
    type Content = { role: "user" | "model"; parts: { text: string }[] };
    const contents: Content[] = [];
    for (const m of messages) {
        if (m.role === "system") {
            systemParts.push({ text: m.content });
            continue;
        }
        const role = m.role === "assistant" ? "model" : "user";
        const last = contents[contents.length - 1];
        if (last && last.role === role) {
            last.parts.push({ text: m.content });
        } else {
            contents.push({ role, parts: [{ text: m.content }] });
        }
    }

    // Templated URL substitution + force SSE streaming via `alt=sse`.
    let url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    // `generateContent` doesn't stream — swap to `streamGenerateContent`
    // when the template still points at the unary endpoint.
    url = url.replace(/:generateContent\b/, ":streamGenerateContent");
    url += (url.includes("?") ? "&" : "?") + "alt=sse";

    const body: any = {
        contents,
        ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
        generationConfig: {
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
        },
    };

    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
    });

    if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Gemini request failed: HTTP ${resp.status} ${resp.statusText} ${errText}`);
    }

    for await (const data of sseFrames(resp.body)) {
        try {
            const json = JSON.parse(data);
            const parts = json?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                for (const p of parts) {
                    if (typeof p?.text === "string" && p.text.length > 0) yield p.text;
                }
            }
        } catch {
            /* ignore */
        }
    }
}

// ---- Claude (native /v1/messages SSE) ----

export async function* claudeChatStream(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): AsyncGenerator<string, void, void> {
    // Claude requires `max_tokens` and uses a top-level `system` field.
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));

    const url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": provider.apiKey,
            "anthropic-version": "2023-06-01",
            // Required to call the Anthropic API directly from a browser-like
            // context (service workers count as such for CORS purposes).
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: provider.model,
            max_tokens: opts.maxTokens ?? 4096,
            ...(system ? { system } : {}),
            messages: convo,
            stream: true,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: opts.signal,
    });

    if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Claude request failed: HTTP ${resp.status} ${resp.statusText} ${errText}`);
    }

    for await (const data of sseFrames(resp.body)) {
        try {
            const json = JSON.parse(data);
            if (json?.type === "content_block_delta") {
                const text: string | undefined = json?.delta?.text;
                if (typeof text === "string" && text.length > 0) yield text;
            } else if (json?.type === "message_stop") {
                return;
            }
        } catch {
            /* ignore */
        }
    }
}

// ---------------------------------------------------------------------------
// Non-streaming clients — background-only. Used by the page-translation
// pipeline, which wants a single full response and must NOT set stream:true on
// the upstream request (some providers/proxies reject or mis-handle SSE for
// batch JSON translation). Mirrors the chatStream adapters per provider type.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global concurrency limiter for non-streaming requests. Every call to
// chatCompleteNonStream goes through this semaphore, so no matter how many
// callers fire at once (multiple page-translate batches, other features...),
// at most NON_STREAM_MAX_CONCURRENCY upstream requests are in flight. This is
// the single chokepoint where the rate limit actually takes effect.
// ---------------------------------------------------------------------------
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

/**
 * Dispatch a non-streaming chat completion to the right protocol adapter based
 * on `provider.type`. Returns the full response text. Calls are globally rate
 * limited to NON_STREAM_MAX_CONCURRENCY concurrent upstream requests.
 */
export async function chatCompleteNonStream(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): Promise<string> {
    await acquireNonStreamSlot();
    try {
        switch (provider.type) {
            case "gemini":
                return await geminiChatComplete(provider, messages, opts);
            case "claude":
                return await claudeChatComplete(provider, messages, opts);
            // OpenAI-compatible: openai, deepseek, ollama, openrouter, custom
            default:
                return await openAiChatComplete(provider, messages, opts);
        }
    } finally {
        releaseNonStreamSlot();
    }
}

export async function openAiChatComplete(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): Promise<string> {
    const url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: provider.model,
            messages,
            stream: false,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.params !== undefined ? opts.params : {}),
            ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        }),
        signal: opts.signal,
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`AI request failed: HTTP ${resp.status} ${resp.statusText} ${errText}`);
    }
    const json = await resp.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
}

export async function geminiChatComplete(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): Promise<string> {
    const systemParts: { text: string }[] = [];
    type Content = { role: "user" | "model"; parts: { text: string }[] };
    const contents: Content[] = [];
    for (const m of messages) {
        if (m.role === "system") {
            systemParts.push({ text: m.content });
            continue;
        }
        const role = m.role === "assistant" ? "model" : "user";
        const last = contents[contents.length - 1];
        if (last && last.role === role) {
            last.parts.push({ text: m.content });
        } else {
            contents.push({ role, parts: [{ text: m.content }] });
        }
    }

    // Unary generateContent endpoint — unlike the stream path we do NOT swap to
    // streamGenerateContent or append alt=sse.
    const url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    const body: any = {
        contents,
        ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
        generationConfig: {
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
        },
    };

    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Gemini request failed: HTTP ${resp.status} ${resp.statusText} ${errText}`);
    }
    const json = await resp.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    let out = "";
    if (Array.isArray(parts)) {
        for (const p of parts) {
            if (typeof p?.text === "string") out += p.text;
        }
    }
    return out;
}

export async function claudeChatComplete(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): Promise<string> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));

    const url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": provider.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: provider.model,
            max_tokens: opts.maxTokens ?? 4096,
            ...(system ? { system } : {}),
            messages: convo,
            stream: false,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: opts.signal,
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Claude request failed: HTTP ${resp.status} ${resp.statusText} ${errText}`);
    }
    const json = await resp.json();
    const blocks = json?.content;
    let out = "";
    if (Array.isArray(blocks)) {
        for (const b of blocks) {
            if (typeof b?.text === "string") out += b.text;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export const NO_PROVIDER_ERROR =
    "No enabled AI provider configured. Add or enable one in extension Options → Services.";

/**
 * Resolve which provider a request should use: the explicitly requested one,
 * else the stored active one, else the first enabled one. Disabled providers
 * are never selected.
 *
 * Reads storage directly. Round-tripping through sendMessageToBackground here
 * would deadlock — we ARE the background.
 */
export async function resolveAiProvider(providerId?: string): Promise<AiProvider | undefined> {
    const rawList: any[] = ((await configRepo.get(CONFIG_KEY.AI_PROVIDERS)) as any[] | null) || [];
    const list: AiProvider[] = rawList.map(normalizeProvider);
    if (list.length === 0) return undefined;
    const id = providerId || (await configRepo.get(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID));
    return list.find((p) => p.id === id && p.enabled !== false)
        || list.find((p) => p.enabled !== false);
}

/** {@link resolveAiProvider}, throwing the standard message when none is usable. */
export async function resolveAiProviderOrThrow(providerId?: string): Promise<AiProvider> {
    const provider = await resolveAiProvider(providerId);
    if (!provider) throw new Error(NO_PROVIDER_ERROR);
    return provider;
}

/**
 * Provider-specific body extras for our non-interactive tasks (page
 * translation, subtitle segmentation). These want the answer, not the model's
 * reasoning: thinking costs tokens and seconds, and buys nothing on
 * mechanical rewrite work. DeepSeek's reasoning models take this switch in the
 * request body; providers without one are left alone.
 */
export function providerTaskParams(provider: AiProvider): any {
    if (provider.type === "deepseek") return { thinking: { type: "disabled" } };
    return undefined;
}

// ---------------------------------------------------------------------------
// Page translation
// ---------------------------------------------------------------------------

// Batch texts up to this many characters per upstream request. The concurrency
// cap is enforced globally inside chatCompleteNonStream (a shared semaphore), so
// firing every batch at once here is fine — the limiter throttles the actual
// requests across all callers, not just this one invocation.
const AI_PAGE_TRANSLATE_BATCH_CHARS = 500;

/**
 * Run a page-translation request against the configured AI provider and return
 * the translations array. Backs the ACTION.AI_TRANSLATE_TEXT handler.
 * Throws on misconfiguration or a non-array model response.
 */
export async function aiPageTranslate(
    providerId: string | undefined,
    texts: string[],
    targetLang: string,
    signal?: AbortSignal,
): Promise<string[]> {
    const provider = await resolveAiProviderOrThrow(providerId);

    let temperature = 0; // todo support use defined temperature
    const params = providerTaskParams(provider); // todo support use defined params

    const all = texts ?? [];
    if (all.length === 0) return [];

    // Split into batches of <= AI_PAGE_TRANSLATE_BATCH_CHARS characters. Each
    // batch is a contiguous slice so results can be written back into their
    // original positions regardless of completion order. Concurrency is capped
    // downstream by chatCompleteNonStream's global semaphore.
    const batches: { start: number; texts: string[] }[] = [];
    let cur: string[] = [];
    let curStart = 0;
    let curChars = 0;
    for (let i = 0; i < all.length; i++) {
        const len = all[i].length;
        // Close the current batch if appending this text would exceed the
        // char budget — unless the batch is empty (a single oversized text
        // still has to go out on its own).
        if (cur.length > 0 && curChars + len > AI_PAGE_TRANSLATE_BATCH_CHARS) {
            batches.push({ start: curStart, texts: cur });
            cur = [];
            curStart = i;
            curChars = 0;
        }
        cur.push(all[i]);
        curChars += len;
    }
    if (cur.length > 0) batches.push({ start: curStart, texts: cur });

    const results: string[] = new Array(all.length);

    // Translate one batch and write its results back at the right offset.
    const runBatch = async (batch: { start: number; texts: string[] }) => {
        const messages = buildPrompt({
            task: AI_TASK.PAGE_TRANSLATE,
            providerId: provider.id,
            payload: { text: batch.texts.join(SEPARATOR_TAG), targetLang },
        });
        // Non-streaming: the upstream request is sent with stream:false (see
        // chatCompleteNonStream) — page translation wants the full result in
        // one response, not an SSE stream.
        const full = await chatCompleteNonStream(provider, messages, { temperature, signal, params });
        const outs = full.split(SEPARATOR_TAG).filter((s) => s.length > 0);

        for (let i = 0; i < batch.texts.length; i++) {
            // Guard against a short response — fall back to the source text so
            // indices never drift out of alignment with the input array.
            // todo fallback to machine translation
            results[batch.start + i] = i < outs.length ? outs[i] : batch.texts[i];
        }
    };

    // Fire every batch; the global semaphore in chatCompleteNonStream caps how
    // many actually hit the network at once.
    await Promise.all(batches.map(runBatch));

    return results;
}

// ---------------------------------------------------------------------------
// Message + port bridge
// ---------------------------------------------------------------------------

type MessageHandler = (message: any, sendResponse: (r: any) => void) => boolean | void;

/** AI actions handled in background, keyed by ACTION. Consumed by background.ts. */
export const aiMessageHandlers: Record<string, MessageHandler> = {
    [ACTION.AI_PROVIDER_TEST]: (message, sendResponse) => {
        // Options sends the whole provider record — possibly an unsaved draft,
        // possibly disabled — so it is used as-is rather than resolved by id.
        const provider = normalizeProvider(message.data);
        return handleAsync('AI provider test', sendResponse, async () => {
            const gen = chatStream(
                provider,
                [
                    { role: "system", content: "Reply with exactly: ok" },
                    { role: "user", content: "ping" },
                ],
                { maxTokens: 16 },
            );
            let collected = "";
            for await (const delta of gen) {
                collected += delta;
                if (collected.length > 32) break;
            }
            return { reply: collected.trim() };
        });
    },

    [ACTION.AI_COMPLETE]: (message, sendResponse) => handleAbortable(
        ABORT_SCOPE.AI_COMPLETE, 'AI complete', message, sendResponse,
        async (data, signal) => {
            const { providerId, task, payload } = data as {
                providerId?: string;
                task: AI_TASK;
                payload: { text: string; targetLang?: string; systemPrompt?: string; lang?: string };
            };
            const provider = await resolveAiProviderOrThrow(providerId);
            const messages = buildPrompt({ task, providerId: provider.id, payload });
            const text = await chatCompleteNonStream(provider, messages, {
                temperature: 0,
                signal,
                params: providerTaskParams(provider),
            });
            return { text };
        },
    ),

    [ACTION.AI_COMPLETE_ABORT]: (message, sendResponse) =>
        handleAbort(ABORT_SCOPE.AI_COMPLETE, message, sendResponse),
};

/**
 * Register the AI Writing streaming bridge (content port <-> provider SSE).
 *
 * MUST be called synchronously during background startup, for the same reason
 * as registerAutoSyncListeners() — see the MV3 note in main/background.ts. A
 * listener registered after an `await` misses the very connection that woke the
 * worker, and Firefox's non-persistent event page never wakes for it at all.
 */
export function registerAiBridge(): void {
    browser.runtime.onConnect.addListener((port) => {
        if (port.name !== PORT_NAME.AI_CHAT_STREAM) return;
        const controller = new AbortController();
        let disposed = false;
        const send = (msg: AiStreamMessage) => {
            if (disposed) return;
            try { port.postMessage(msg); } catch { /* port may have closed */ }
        };
        port.onDisconnect.addListener(() => {
            disposed = true;
            controller.abort();
        });
        port.onMessage.addListener(async (raw) => {
            const req = raw as AiStreamRequest;
            try {
                const provider = await resolveAiProvider(req.providerId);
                if (!provider) {
                    send({ type: "error", message: NO_PROVIDER_ERROR });
                    return;
                }
                const messages = buildPrompt(req);
                const gen = chatStream(provider, messages, { signal: controller.signal });
                for await (const delta of gen) {
                    if (disposed) return;
                    send({ type: "delta", text: delta });
                }
                send({ type: "done" });
            } catch (e: any) {
                if (controller.signal.aborted) return;
                send({ type: "error", message: e?.message || String(e) });
            }
        });
    });
}
