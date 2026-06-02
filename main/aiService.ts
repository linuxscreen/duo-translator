import { AI_TASK, DEFAULT_VALUE, LANGUAGES_MAP, PORT_NAME } from "@/main/constants";
import { browser } from "wxt/browser";

// ---------------------------------------------------------------------------
// Provider model & catalog
// ---------------------------------------------------------------------------

export type AiProviderType =
    | "openai"
    | "deepseek"
    | "gemini"
    | "ollama"
    | "openrouter"
    | "claude"
    | "custom";

export interface AiProvider {
    id: string;
    /** Provider kind — drives default URL and which request adapter is used. */
    type: AiProviderType;
    /** Display name (defaults to the catalog label, user-editable). */
    name: string;
    /** Full endpoint URL. May include `{model}` / `{key}` template placeholders. */
    url: string;
    /** Empty allowed for Ollama / Custom; required for hosted providers. */
    apiKey: string;
    model: string;
    /** When false the provider is preserved but hidden from selection dropdowns. */
    enabled?: boolean;
    /** Legacy field — older configs used `baseUrl` (without `/chat/completions`).
     *  Kept here so we can migrate on read; new writes use `url`. */
    baseUrl?: string;
}

export interface ProviderCatalogEntry {
    type: AiProviderType;
    label: string;
    defaultUrl: string;
    /** When false, apiKey can be empty (Ollama local, Custom proxy). */
    requiresApiKey: boolean;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
    { type: "openai", label: "OpenAI", defaultUrl: "https://api.openai.com/v1/chat/completions", requiresApiKey: true },
    { type: "deepseek", label: "DeepSeek", defaultUrl: "https://api.deepseek.com/chat/completions", requiresApiKey: true },
    { type: "gemini", label: "Gemini", defaultUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}", requiresApiKey: true },
    { type: "ollama", label: "Ollama", defaultUrl: "http://localhost:11434/v1/chat/completions", requiresApiKey: false },
    { type: "openrouter", label: "OpenRouter", defaultUrl: "https://openrouter.ai/api/v1/chat/completions", requiresApiKey: true },
    { type: "claude", label: "Claude", defaultUrl: "https://api.anthropic.com/v1/messages", requiresApiKey: true },
    { type: "custom", label: "Custom", defaultUrl: "", requiresApiKey: false },
];

export function getCatalogEntry(type: AiProviderType): ProviderCatalogEntry {
    return PROVIDER_CATALOG.find((c) => c.type === type) ?? PROVIDER_CATALOG[0];
}

/**
 * Migrate older-shape provider records (no `type`, `baseUrl` instead of `url`)
 * into the current shape. Safe to call on already-migrated records.
 */
export function normalizeProvider(p: any): AiProvider {
    const type: AiProviderType = (p?.type as AiProviderType) || "openai";
    let url: string = typeof p?.url === "string" ? p.url : "";
    if (!url && typeof p?.baseUrl === "string" && p.baseUrl) {
        url = p.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    }
    if (!url) url = getCatalogEntry(type).defaultUrl;
    return {
        id: String(p?.id ?? ""),
        type,
        name: String(p?.name ?? getCatalogEntry(type).label),
        url,
        apiKey: String(p?.apiKey ?? ""),
        model: String(p?.model ?? ""),
        enabled: p?.enabled === undefined ? true : !!p.enabled,
    };
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface ChatOptions {
    params?: any;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
}

export interface AiStreamRequest {
    task: AI_TASK;
    providerId?: string;
    payload: {
        text: string;
        targetLang?: string;
        systemPrompt?: string;
        lang?: string;
    };
}

export type AiStreamMessage =
    | { type: "delta"; text: string }
    | { type: "done" }
    | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

export function buildPrompt(req: AiStreamRequest): ChatMessage[] {
    const { task, payload } = req;
    const text = payload.text ?? "";
    switch (task) {
        case AI_TASK.TRANSLATE: {
            const lang = LANGUAGES_MAP.get(payload.targetLang || DEFAULT_VALUE.AI_TARGET_LANG)?.name;
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
            const lang = LANGUAGES_MAP.get(payload.targetLang || DEFAULT_VALUE.AI_TARGET_LANG)?.name;
            return [
                { role: "system", content: `You are a professional ${lang} native speaker translator. Translate any text the user inputs into ${lang}. The translation should be natural and fluent, conforming to ${lang} expression conventions. Output only the translation, with no explanation, no quotes, or formatting marks. If the original text is already in ${lang}, output it as-is. If the text contains XML tags, consider where the tags should be placed in the translation while maintaining fluency. The <sep/> XML tag is the sole paragraph separator. Preserve every <sep/> tag in your translation exactly as-is. Each paragraph must map one-to-one to the source — do not merge, split, or reorder them.` },
                { role: "user", content: text },
            ];
        }
    }
}

/**
 * Non-streaming counterpart to `chatStream` — accumulates all deltas into a
 * single string. Used by the page-translation pipeline where we want the full
 * JSON array response before parsing.
 */
export async function chatComplete(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: ChatOptions = {},
): Promise<string> {
    let collected = "";
    for await (const delta of chatStream(provider, messages, opts)) {
        collected += delta;
    }
    return collected;
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
// Content-side helper: open a port and consume deltas as an async iterable
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
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
        ended = true;
        if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            rejectNext = null;
            r({ value: undefined as any, done: true });
        }
    });

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
                    try { port.disconnect(); } catch {}
                    ended = true;
                    return Promise.resolve({ value: undefined as any, done: true });
                },
            };
        },
    };

    return {
        stream,
        abort: () => { try { port.disconnect(); } catch {} },
    };
}

// ---------------------------------------------------------------------------
// Task wrappers (content-side convenience)
// ---------------------------------------------------------------------------

export function aiTranslate(text: string, targetLang: string) {
    return startAiChatStream({
        task: AI_TASK.TRANSLATE,
        payload: { text, targetLang },
    });
}

export function aiEnhance(
    text: string,
    mode: AI_TASK.GRAMMAR | AI_TASK.POLISH | AI_TASK.FORMAL | AI_TASK.CASUAL,
    lang?: string,
) {
    return startAiChatStream({
        task: mode,
        payload: { text, lang },
    });
}

export function aiCustom(systemPrompt: string, userText: string) {
    return startAiChatStream({
        task: AI_TASK.CUSTOM,
        payload: { text: userText, systemPrompt },
    });
}
