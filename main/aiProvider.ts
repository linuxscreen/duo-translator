import { AI_TASK } from "@/main/constants";

// ---------------------------------------------------------------------------
// AI provider model + the wire types shared across every context.
//
// Imported by background, content, AND the popup/options React pages, so this
// module must stay free of both the provider HTTP clients (background-only)
// and the port/message helpers (content-only) — see main/aiService.ts and
// main/aiClient.ts respectively.
// ---------------------------------------------------------------------------

export type AiProviderType =
    | "openai"
    | "deepseek"
    | "gemini"
    | "ollama"
    | "openrouter"
    | "claude"
    | "custom";

export class AiProvider {
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

    constructor(id: string, type: AiProviderType, name: string, url: string, apiKey: string, model: string, enabled?: boolean) {
        this.id = id;
        this.type = type;
        this.name = name;
        this.url = url;
        this.apiKey = apiKey;
        this.model = model;
        this.enabled = enabled
    }

    getTitle(): string {
        return `${this.name} · ${this.model}`
    }
}

export interface ProviderCatalogEntry {
    type: AiProviderType;
    label: string;
    defaultUrl: string;
    /** When false, apiKey can be empty (Ollama local, Custom proxy). */
    requiresApiKey: boolean;
    /**
     * Known model ids offered in the provider form's dropdown. The FIRST entry
     * is the default for a freshly picked provider type, so keep the most
     * commonly used model at the top rather than the newest or the largest.
     *
     * The list is a convenience, never a whitelist: the form always offers a
     * free-text escape hatch, because provider catalogs move faster than this
     * file (and `custom` / self-hosted endpoints have no catalog at all).
     */
    models: string[];
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
    {
        type: "openai",
        label: "OpenAI",
        defaultUrl: "https://api.openai.com/v1/chat/completions",
        requiresApiKey: true,
        models: [
            "gpt-5.6-terra",
            "gpt-5.6-sol",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.4-nano",
            "gpt-5.2",
            "gpt-5",
            "gpt-5-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
        ],
    },
    {
        type: "deepseek",
        label: "DeepSeek",
        defaultUrl: "https://api.deepseek.com/chat/completions",
        requiresApiKey: true,
        // The legacy `deepseek-chat` / `deepseek-reasoner` ids were retired on
        // 2026-07-24 — do not re-add them.
        models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    },
    {
        type: "gemini",
        label: "Gemini",
        defaultUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        requiresApiKey: true,
        models: [
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-3.1-pro-preview",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.5-pro",
        ],
    },
    {
        type: "ollama",
        label: "Ollama",
        defaultUrl: "http://localhost:11434/v1/chat/completions",
        requiresApiKey: false,
        models: [
            "llama3.1",
            "qwen3.5",
            "qwen3",
            "gemma4",
            "gemma3",
            "llama3.2",
            "deepseek-r1",
            "mistral",
            "phi4",
            "gpt-oss",
        ],
    },
    {
        type: "openrouter",
        label: "OpenRouter",
        defaultUrl: "https://openrouter.ai/api/v1/chat/completions",
        requiresApiKey: true,
        models: [
            "openai/gpt-5.6-terra",
            "openai/gpt-5.6-sol",
            "openai/gpt-5.6-luna",
            "anthropic/claude-sonnet-5",
            "anthropic/claude-opus-5",
            "google/gemini-3.7-flash",
            "deepseek/deepseek-v4-flash",
            "deepseek/deepseek-v4-pro",
            "x-ai/grok-4.6",
            "qwen/qwen3.8-max",
            "z-ai/glm-5.2",
            "moonshotai/kimi-k3",
            "meta-llama/llama-4-maverick",
            "mistralai/mistral-large-2512",
        ],
    },
    {
        type: "claude",
        label: "Claude",
        defaultUrl: "https://api.anthropic.com/v1/messages",
        requiresApiKey: true,
        models: [
            "claude-sonnet-5",
            "claude-opus-5",
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "claude-haiku-4-5",
            "claude-fable-5",
        ],
    },
    { type: "custom", label: "Custom", defaultUrl: "", requiresApiKey: false, models: [] },
];

export function getCatalogEntry(type: AiProviderType): ProviderCatalogEntry {
    return PROVIDER_CATALOG.find((c) => c.type === type) ?? PROVIDER_CATALOG[0];
}

/** First catalog model for `type`, or "" when the type has no known models. */
export function getDefaultModel(type: AiProviderType): string {
    return getCatalogEntry(type).models[0] ?? "";
}

export function normalizeProvider(p: any): AiProvider {
    const type: AiProviderType = p?.type as AiProviderType;
    let url: string = typeof p?.url === "string" ? p.url : "";
    if (!url) url = getCatalogEntry(type).defaultUrl;

    let provider = new AiProvider(
        String(p?.id ?? ""),
        type,
        String(p?.name ?? getCatalogEntry(type).label),
        url,
        String(p?.apiKey ?? ""),
        String(p?.model ?? ""),
    );
    provider.enabled = p?.enabled === undefined ? true : !!p.enabled;
    return provider
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
