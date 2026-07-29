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
