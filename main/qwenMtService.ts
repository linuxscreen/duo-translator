import type { AiProvider, ChatMessage, ChatOptions } from "@/main/aiProvider";
import { AI_TASK, DEFAULT_VALUE, LANGUAGES_MAP } from "@/main/constants";
import { applyTemplate, assertAiInputLength, sseFrames } from "@/main/aiServiceShared";

export function isQwenMt(provider: AiProvider): boolean {
    return provider.type === "bailian" && /^qwen-mt-(plus|turbo|flash|lite)(?:$|-)/i.test(provider.model);
}

function buildRequestBody(provider: AiProvider, messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    if (opts.task !== AI_TASK.TRANSLATE && opts.task !== AI_TASK.PAGE_TRANSLATE) {
        throw new Error("Qwen-MT only supports translation. Choose a general-purpose AI model for writing and custom tasks.");
    }
    const userMessages = messages.filter((message) => message.role === "user");
    if (userMessages.length !== 1 || messages.some((message) => message.role === "assistant")) {
        throw new Error("Qwen-MT requires exactly one text to translate.");
    }
    assertAiInputLength(userMessages[0].content);
    const targetLang = opts.targetLang || DEFAULT_VALUE.AI_TARGET_LANGUAGE;
    const target = targetLang === "zh-CN" ? "Chinese" : LANGUAGES_MAP.get(targetLang)?.name;
    if (!target) throw new Error(`Unknown translation target language: ${targetLang}`);

    // Qwen-MT takes translation settings separately; prompts would become source text.
    return {
        ...(opts.params ?? {}),
        model: provider.model,
        messages: userMessages,
        stream,
        translation_options: { source_lang: "auto", target_lang: target },
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    };
}

async function request(provider: AiProvider, messages: ChatMessage[], opts: ChatOptions, stream: boolean): Promise<Response> {
    const url = applyTemplate(provider.url, { model: provider.model, key: provider.apiKey });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRequestBody(provider, messages, opts, stream)),
        signal: opts.signal,
    });
    if (!response.ok || (stream && !response.body)) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`AI request failed: HTTP ${response.status} ${response.statusText} ${errorText}`);
    }
    return response;
}

export async function qwenMtChatComplete(provider: AiProvider, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const response = await request(provider, messages, opts, false);
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
}

export async function* qwenMtChatStream(provider: AiProvider, messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string, void, void> {
    const response = await request(provider, messages, opts, true);
    // Plus/Turbo stream the full translation so far; callers expect only new text.
    const cumulative = /^qwen-mt-(plus|turbo)(?:$|-)/i.test(provider.model);
    let previous = "";
    for await (const data of sseFrames(response.body!)) {
        if (data === "[DONE]") return;
        let json;
        try {
            json = JSON.parse(data);
        } catch {
            continue;
        }
        const content = json?.choices?.[0]?.delta?.content;
        if (typeof content !== "string" || content.length === 0) continue;
        const delta = cumulative ? content.slice(previous.length) : content;
        previous = content;
        if (delta) yield delta;
    }
}
