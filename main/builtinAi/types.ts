// ---------------------------------------------------------------------------
// Built-in AI — ambient globals + the few types that cross to content.
//
// Pure declarations, safe to import from any context.
//
// The `Translator` / `LanguageDetector` globals are the browser's on-device
// translation model (Chrome 138+, Edge 148+). They are not in TypeScript's DOM
// lib yet, so they are declared here rather than pulled from a @types package —
// one small surface, and it documents exactly the subset we rely on.
// ---------------------------------------------------------------------------

/** Result of `Translator.availability()` / `LanguageDetector.availability()`. */
export type BuiltinAiAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export interface BuiltinAiMonitor {
    addEventListener(
        type: "downloadprogress",
        listener: (event: { loaded: number; total: number }) => void,
    ): void;
}

export interface BuiltinAiCreateOptions {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: BuiltinAiMonitor) => void;
    signal?: AbortSignal;
}

export interface TranslatorSession {
    translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
    destroy(): void;
}

export interface LanguageDetectorSession {
    detect(text: string, options?: { signal?: AbortSignal }): Promise<{ detectedLanguage: string; confidence: number }[]>;
    destroy(): void;
}

declare global {
    const Translator: {
        availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<BuiltinAiAvailability>;
        create(options: BuiltinAiCreateOptions): Promise<TranslatorSession>;
    };

    const LanguageDetector: {
        availability(): Promise<BuiltinAiAvailability>;
        create(options?: { monitor?: (m: BuiltinAiMonitor) => void; signal?: AbortSignal }): Promise<LanguageDetectorSession>;
    };
}

/** Outcome of one translated batch. Background-internal. */
export interface BuiltinAiTranslateResult {
    /** 1:1 with the input texts. */
    texts: string[];
    /** The source language actually used, as the model reported/received it. */
    sourceLang: string;
    /**
     * True when at least one text lost its `<bN>` placeholders and had to be
     * re-translated as plain text. Logged only — the degraded text is already
     * in `texts` and the caller has nothing to decide.
     */
    plainTextFallback: boolean;
    /** True when source and target matched, so nothing was translated. */
    sameLanguage?: boolean;
}

/**
 * `error.name` used when a translation could not run *yet* because the model
 * for this language pair is still downloading.
 *
 * Not a failure the user has to act on — the download is already running, and
 * background started it without asking. It is a distinct name so content can
 * tell it apart from a real error: it shows a progress bar instead of an error
 * bubble, and re-runs the translation when the download completes.
 *
 * Background bails out with this rather than awaiting the download because the
 * content-side request has a timeout, and a first-time model download on a slow
 * link can outlast any sensible one.
 */
export const BUILTIN_AI_MODEL_DOWNLOADING = "BuiltinAiModelDownloading";

/** Rides along with a {@link BUILTIN_AI_MODEL_DOWNLOADING} error, as `error.detail`. */
export interface BuiltinAiModelDownloadingDetail {
    /** BCP-47 tags as the model wants them (already through `toModelLang`). */
    sourceLang: string;
    targetLang: string;
}

/** Broadcast from background to every frame while a model downloads. */
export interface BuiltinAiDownloadProgress {
    /**
     * Which model. The language detector is a single shared model with no
     * language pair, so the bar labels it differently instead of rendering an
     * empty "→".
     */
    kind: "translator" | "detector";
    sourceLang: string;
    targetLang: string;
    /** 0-100. */
    percent: number;
    /** True on the final message, whether it succeeded or failed. */
    done: boolean;
    /** Set only when the download failed. */
    error?: string;
    /**
     * The final message is a user cancellation rather than a failure.
     *
     * Distinct from `error` on purpose: a cancelled download must not paint the
     * red "could not download" treatment or leave anything on screen — the user
     * just told us to stop, so acknowledging it loudly would be nagging.
     */
    cancelled?: boolean;
}

/** Payload of {@link ACTION.BUILTIN_AI_CANCEL_DOWNLOAD}. */
export interface BuiltinAiCancelDownloadRequest {
    kind: "translator" | "detector";
    /** Ignored when `kind` is `detector` — that model has no language pair. */
    sourceLang?: string;
    targetLang?: string;
}

/** Capability self-check, rendered in Options › Services › Built-in AI. */
export interface BuiltinAiPingResponse {
    /** Whether background sees the built-in AI globals at all. */
    supported: boolean;
    detector: BuiltinAiAvailability | null;
    /** Availability of the pair the dialog asked about, when it named one. */
    translator?: BuiltinAiAvailability | null;
}
