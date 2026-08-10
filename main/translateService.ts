// ---------------------------------------------------------------------------
// Translation providers — BACKGROUND ONLY.
//
// The provider classes themselves live here, not just their HTTP: content
// scripts get no cross-origin privileges in MV3 (Firefox applies the host
// page's CSP connect-src, Chrome applies page-origin CORS), and the DeepL key
// / Microsoft token must not be handed to a script injected into every page.
//
// Content asks for a translation by *meaning* — ACTION.TRANSLATE_TEXTS with a
// service id, the texts and a target language — and this module picks the
// provider, serves the cache, and performs the request. It replaced an older
// arrangement where content built the HTTP request and background relayed it
// as a dumb URL proxy.
//
// Content scripts must never import this module; they go through
// main/translateClient.ts.
// ---------------------------------------------------------------------------

import {
    ACTION,
    AI_PREFIX,
    APP_NAME_WITH_SUFFIX,
    CONFIG_KEY,
    STATUS_SUCCESS,
    TRANSLATE_SERVICE,
} from "@/main/constants";
import { TranslateResult } from "@/main/translateClient";
import { aiPageTranslate } from "@/main/aiService";
import {
    builtinAiSupported,
    builtinAiTranslateTexts,
    cancelDownload,
    clearDownloadCancel,
    detectBatchLanguage,
    detectorAvailability,
    ensureModel,
    translatorAvailability,
} from "@/main/builtinAi/builtinAiService";
import { toModelLang } from "@/main/builtinAi/placeholders";
import type { BuiltinAiCancelDownloadRequest, BuiltinAiPingResponse } from "@/main/builtinAi/types";
import { configRepo } from "@/main/storage/configStore";
import * as translationCache from "@/main/storage/translationCache";
import { isTraditionalChinese } from "@/utils/language";
import { utf8Length } from "@/utils/text";
import { ABORT_SCOPE, handleAbort, handleAbortable, handleAsync } from "@/main/messageBridge";

// ---------------------------------------------------------------------------
// Provider HTTP
// ---------------------------------------------------------------------------

interface ProviderFetchInit {
    method: string;
    headers: Record<string, string>;
    body: string;
}

interface ProviderResponse {
    status: number;
    statusText: string;
    /**
     * Raw response body. Retained (rather than only exposed through `json()`)
     * so the error paths can quote the provider's own words: a bare status line
     * almost never says *why*, while the body carries the real reason (bad key,
     * quota exhausted, unknown endpoint).
     */
    bodyText: string;
    json: () => Promise<any>;
}

/** Host of a URL, for error messages. Never throws on a malformed URL. */
function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** How much of a failing response body to quote. Enough to identify, short enough to toast. */
const PROVIDER_ERROR_BODY_CHARS = 300;

/**
 * Error for a non-200 provider response.
 *
 * Every provider builds its failure through here so the message that reaches
 * the user's page has the same three parts everywhere: which provider, what the
 * transport said, and what the provider's body said.
 */
function providerHttpError(provider: string, url: string, response: ProviderResponse): Error {
    const snippet = (response.bodyText || "").trim().slice(0, PROVIDER_ERROR_BODY_CHARS);
    const status = `HTTP ${response.status}${response.statusText ? " " + response.statusText : ""}`;
    return new Error(`${provider} ${status} (${hostOf(url)})${snippet ? ": " + snippet : ""}`);
}

/**
 * Plain fetch with the extension principal. Kept as a named helper so every
 * provider goes through one place (and so the response shape stays the small
 * `{status, statusText, json()}` the provider bodies were written against).
 */
async function providerFetch(
    url: string,
    init: ProviderFetchInit,
    signal?: AbortSignal | null,
): Promise<ProviderResponse> {
    let r: Response;
    try {
        r = await fetch(url, {
            method: init.method,
            headers: init.headers,
            body: init.body,
            signal: signal ?? undefined,
        });
    } catch (e: any) {
        // An aborted request is a normal control-flow signal, not a failure —
        // it must stay an AbortError so callers can tell the two apart.
        if (e?.name === "AbortError") throw e;
        // Otherwise this is `TypeError: Failed to fetch`, which names neither
        // the provider nor the host it could not reach. Since this string is
        // what ends up in the user's error bubble, say both.
        throw new Error(`network error requesting ${hostOf(url)}: ${e?.message || e}`);
    }
    const bodyText = await r.text();
    return {
        status: r.status,
        statusText: r.statusText,
        bodyText,
        json: async () => JSON.parse(bodyText),
    };
}

export class Token {
    constructor(public token: string, public expireTime: number) { }

    isValid(): boolean {
        return !!this.token && this.expireTime > Date.now();
    }

    static fromData(data: any): Token | null {
        if (!data || typeof data.token !== "string" || typeof data.expireTime !== "number") return null
        return new Token(data.token, data.expireTime);
    }
}

const MS_TOKEN_URL = "https://edge.microsoft.com/translate/auth";
const MS_TOKEN_TTL = 10 * 60 * 1000;

let cachedToken: Token | null = null;
let inflight: Promise<Token> | null = null;
let inflightForced = false;

if (import.meta.env.DEV) {
    // Debug hook kept from the previous implementation; reads the live cache.
    (globalThis as any).__debugMicrosoftToken = () => cachedToken;
}

/**
 * Fetch (or reuse) the Microsoft translate auth token.
 *
 * One latch covers both the normal and the forced path. Previously these were
 * two mechanisms — an async-mutex for the cached read and a separate promise
 * latch for the refresh — each repeating the same "store in cache, persist to
 * config, return" triple.
 *
 * @param force skip the cache entirely. Used by the 401-retry path: it must NOT
 *   join a non-forced in-flight request, or it could be handed back the very
 *   stale token that caused the 401 and spin until MS_MAX_RETRY.
 * @throws when the token cannot be fetched. Callers at the message boundary map
 *   this to a STATUS_FAIL reply carrying an empty Token.
 */
export function getMicrosoftToken(force = false): Promise<Token> {
    if (!force && cachedToken?.isValid()) return Promise.resolve(cachedToken);
    // Coalesce concurrent callers (a 401 storm across parallel batches shares
    // one refetch), but never let a forced refresh join a non-forced request.
    if (inflight && (inflightForced || !force)) return inflight;

    inflightForced = force;
    inflight = (async () => {
        if (!force) {
            const stored = Token.fromData(await configRepo.get(CONFIG_KEY.MICROSOFT_TOKEN));
            if (stored?.isValid()) {
                cachedToken = stored;
                return stored;
            }
        }
        const raw = await fetch(MS_TOKEN_URL).then((r) => r.text());
        const fresh = new Token(raw, Date.now() + MS_TOKEN_TTL);
        cachedToken = fresh;
        await configRepo.set(CONFIG_KEY.MICROSOFT_TOKEN, fresh);
        return fresh;
    })().finally(() => {
        inflight = null;
        inflightForced = false;
    });

    return inflight;
}


//#region translate service classes
// ---------------------------------------------------------------------------
// TranslateService — abstract base shared by every provider
// ---------------------------------------------------------------------------

export interface TranslateRequestOptions {
    retryCount?: number;
}

// A NOTE ON FAILURE, since this reverses an earlier design:
//
// Providers used to swallow their own failures — log to the background console
// and return `[]` — so that "page translation degrades rather than rejects".
// The degrading worked; the *reporting* did not. The background console is a
// separate console the user never opens, so a dead endpoint, an expired key or
// a quota wall all looked identical from the page: nothing translated, nothing
// said, nowhere to look. A `strict` flag existed to opt back into throwing, and
// exactly one caller (the Options connectivity test) ever set it.
//
// So providers now always throw, and resilience is enforced where it actually
// belongs: `translateUnits` in main/content.ts already wraps every batch in a
// try/catch, so one failed batch still leaves the rest of the page readable —
// but now the reason travels back over the message reply, into the page console
// and into the error bubble. `strict` is gone; there is one behaviour.

/**
 * Runtime translation provider. Each provider (Google, Microsoft, DeepL …)
 * subclasses this and implements the methods relevant to its API.
 */
export abstract class TranslateService {
    abstract readonly name: string;

    /** Translate a list of plain-text snippets. */
    abstract translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
        options?: TranslateRequestOptions,
    ): Promise<TranslateResult[]>;

    /**
     * Translate a possibly large batch of texts. Default behaviour just
     * delegates to {@link translateText}. Override when chunking/retrying is
     * required (Microsoft does this to respect API limits).
     */
    translateBatchText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        return this.translateText(texts, targetLang, signal, sourceLang);
    }

    /** Detect the dominant language. Default: not supported. */
    detectLanguage(_texts: string[]): Promise<string> {
        return Promise.resolve("");
    }
}

// ---------------------------------------------------------------------------
// Background-proxied fetch shared by the built-in providers (Google/Microsoft)
// ---------------------------------------------------------------------------
// Content-script fetches get no cross-origin privileges in MV3: Firefox
// applies the host page's CSP connect-src (e.g. chatgpt.com blocks these
// hosts outright) and Chrome applies page-origin CORS (works today only
// because these endpoints answer permissive preflights). Background fetches
// with the extension principal are subject to neither, so all provider HTTP
// goes through ACTION.TRANSLATE_PROXY_FETCH — same reasoning as the existing
// DeepL and the TTS fetches.

const GOOGLE_TRANSLATE_URL = "https://translate-pa.googleapis.com/v1/translateHtml";
const MS_TRANSLATE_URL = "https://edge.microsoft.com/translate/translatetext?isEnterpriseClient=false&"
const MS_DETECT_URL = `${MS_TRANSLATE_URL}to=en`
const DEEPL_FREE_URL = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_URL = "https://api.deepl.com/v2/translate";

/**
 * Pick the DeepL endpoint implied by the key. Free-tier keys carry a `:fx`
 * suffix and are only valid against api-free; a paid key only against api.
 * Single implementation — the connectivity test and the translate path must not
 * drift apart on this.
 */
export function deeplEndpointFor(key: string): string {
    return key.endsWith(":fx") ? DEEPL_FREE_URL : DEEPL_PRO_URL;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export class GoogleTranslateService extends TranslateService {
    readonly name = TRANSLATE_SERVICE.GOOGLE;
    // TODO: support a configurable mirror URL and automatic failover.
    private readonly endpoint = GOOGLE_TRANSLATE_URL;
    private readonly apiKey: string;

    constructor(apiKey: string = import.meta.env.VITE_GOOGLE_API_KEY) {
        super();
        this.apiKey = apiKey;
    }

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal,
        _sourceLang?: string,
        _options?: TranslateRequestOptions,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        const response = await providerFetch(this.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json+protobuf",
                "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify([[texts, "auto", targetLang], "te_lib"]),
        }, signal);

        if (response.status !== 200) {
            throw providerHttpError("Google Translate", this.endpoint, response);
        }

        const data = await response.json();
        if (!data || data.length < 2) {
            throw new Error("Google Translate returned an unrecognized response shape");
        }

        const result: TranslateResult[] = [];
        for (let i = 0; i < data[0].length; i++) {
            result.push(new TranslateResult(data[0][i], data[1][i], 1));
        }
        return result;
    }

}

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

const MS_MAX_RETRY = 5;
const MS_BATCH_CHAR_LIMIT = 4500;
const MS_BATCH_ITEM_LIMIT = 900;

export class MicrosoftTranslateService extends TranslateService {
    readonly name = TRANSLATE_SERVICE.MICROSOFT;
    private authToken: Token = new Token("", 0);

    /**
     * @deprecated
     */
    private async ensureToken(): Promise<void> {
        if (this.authToken.isValid()) return;
        this.authToken = await getMicrosoftToken(false);
    }

    /**
     * @deprecated
     */
    private async refreshTokenForce(): Promise<void> {
        const token = await getMicrosoftToken(true);
        // Keep the old token on failure so the retry loop can still run.
        if (token.token) this.authToken = token;
    }

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
        options: TranslateRequestOptions = { retryCount: 0 },
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        const url = MS_TRANSLATE_URL + "to=" + targetLang;
        const response = await providerFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(texts),
        }, signal);

        if (response.status !== 200) {
            throw providerHttpError("Microsoft Translate", url, response);
        }

        const data: Array<{
            translations: { text: string }[];
            detectedLanguage: { language: string; score: number };
        }> = await response.json();

        return data.map(
            (d) =>
                new TranslateResult(
                    d.translations[0].text,
                    transferLanguageCode(d.detectedLanguage.language),
                    d.detectedLanguage.score,
                ),
        );
    }

    /**
     * Microsoft caps each request at ~5000 chars / 1000 elements. Split the
     * batch into sub-requests, dispatch concurrently, then re-assemble in
     * original order.
     */
    async translateBatchText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        const chunks: string[][] = [[]];
        let charCount = 0;
        let itemCount = 0;
        for (let raw of texts) {
            if (raw.length > MS_BATCH_CHAR_LIMIT) raw = raw.substring(0, MS_BATCH_CHAR_LIMIT);
            charCount += raw.length;
            itemCount++;
            if (charCount > MS_BATCH_CHAR_LIMIT || itemCount > MS_BATCH_ITEM_LIMIT) {
                chunks.push([]);
                charCount = 0;
                itemCount = 0;
            }
            chunks[chunks.length - 1].push(raw);
        }

        const responses = await Promise.all(
            chunks.map((chunk, index) =>
                this.translateText(chunk, targetLang, signal, sourceLang, { retryCount: 0 }).then(
                    (translatedTexts) => ({ index, translatedTexts }),
                ),
            ),
        );
        responses.sort((a, b) => a.index - b.index);

        const result: TranslateResult[] = [];
        for (const r of responses) result.push(...r.translatedTexts);
        return result;
    }

    async detectLanguage(texts: string[]): Promise<string> {
        const response = await providerFetch(MS_DETECT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(texts),
        });
        // Throws like every other provider call. Detection is the one path with
        // a real local fallback (franc), so its *caller* — detectTextsLanguage
        // in translateClient.ts — logs the reason and degrades to "" rather than
        // raising a bubble the user can do nothing about.
        if (response.status !== 200) throw providerHttpError("Microsoft Detect", MS_DETECT_URL, response);

        const data: { detectedLanguage : { language : string, score : number} }[] = await response.json();
        // Weight each detection by the byte length of its source text so that
        // a single short paragraph in another language can't outvote the body.
        const tally = new Map<string, number>();
        data.forEach((d, i) => {
            const weight = d.detectedLanguage.score * utf8Length(texts[i]);
            tally.set(d.detectedLanguage.language, (tally.get(d.detectedLanguage.language) || 0) + weight);
        });

        let maxScore = 0;
        let maxLanguage = "";
        tally.forEach((value, key) => {
            if (value > maxScore) {
                maxScore = value;
                maxLanguage = key;
            }
        });
        return transferLanguageCode(maxLanguage);
    }
}

// ---------------------------------------------------------------------------
// DeepL (extension example — uses the official API)
// ---------------------------------------------------------------------------

export class DeepLTranslateService extends TranslateService {
    readonly name = TRANSLATE_SERVICE.DEEPL;

    /**
     * @param apiKeyOverride bypasses the stored key. Used by the Options
     *   "test connection" dialog to validate a key the user has typed but not
     *   saved yet.
     */
    constructor(private readonly apiKeyOverride?: string) {
        super();
    }

    private targetLangConverter(lang: string): string {
        if (lang === "zh-CN") return "ZH-HANS"
        if (lang === "zh-TW") return "ZH-HANT"
        return lang.toUpperCase()
    }

    /**
     * DeepL returns no CORS headers, so the request cannot be issued from a
     * content script — it goes through the same background proxy as Google and
     * Microsoft. The full request (including the Authorization header) is built
     * here; the proxy's allow-list is what guarantees the key can only ever be
     * sent to DeepL's own endpoints.
     */
    private async request(
        body: Record<string, unknown>,
        signal?: AbortSignal | null,
    ): Promise<any> {
        const key = this.apiKeyOverride || ((await configRepo.get(CONFIG_KEY.DEEPL_API_KEY)) as string) || "";
        // A missing key is the single most likely DeepL failure and the one the
        // user can actually fix — it must reach them, not the background console.
        if (!key) throw new Error("DeepL API key is not configured");
        const url = deeplEndpointFor(key);
        const response = await providerFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `DeepL-Auth-Key ${key}`,
            },
            body: JSON.stringify(body),
        }, signal);
        if (response.status !== 200) throw providerHttpError("DeepL", url, response);
        return await response.json();
    }

    private toResults(payload: any): TranslateResult[] {
        const translations: { text: string; detected_source_language: string }[] =
            payload?.translations ?? [];
        return translations.map(
            (t) =>
                new TranslateResult(t.text, transferLanguageCode(t.detected_source_language, t.text), 1),
        );
    }

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
        _options?: TranslateRequestOptions,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];
        const payload = await this.request({
            text: texts,
            target_lang: this.targetLangConverter(targetLang),
            ...(sourceLang ? { source_lang: sourceLang.toUpperCase() } : {}),
        }, signal);
        if (!payload) throw new Error("DeepL returned an empty response");
        return this.toResults(payload);
    }

}

// ---------------------------------------------------------------------------
// Built-in AI (on-device model, Chrome 138+ / Edge 148+)
// ---------------------------------------------------------------------------

/**
 * The browser's own translation model. The only provider here that issues no
 * network request at all — everything runs on-device, offline, for free.
 *
 * Runs in background exactly like the others: the `Translator` /
 * `LanguageDetector` globals ARE exposed in an MV3 extension service worker.
 * (Chrome's "not available in Web Workers" note is about `new Worker()`; an
 * extension worker is not that. Measured — see main/builtinAi/builtinAiService.ts.)
 *
 * The one asynchronous wrinkle is the first-use model download. Background
 * starts it automatically — no user gesture is required from a service worker —
 * and bails out of this batch with BUILTIN_AI_MODEL_DOWNLOADING so the request
 * cannot time out waiting. The page shows progress and re-translates when the
 * broadcast says the model is ready.
 */
export class BuiltinAiTranslateService extends TranslateService {
    readonly name = TRANSLATE_SERVICE.BUILTIN;

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
        _options?: TranslateRequestOptions,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        const result = await builtinAiTranslateTexts(texts, targetLang, sourceLang);
        if (!Array.isArray(result?.texts) || result.texts.length !== texts.length) {
            throw new Error("Built-in AI returned a mismatched translation batch");
        }
        if (result.plainTextFallback) {
            // Not an error — the text is translated, just without its inline
            // markup. Logged so the cause is discoverable if a page looks flat.
            console.log(
                APP_NAME_WITH_SUFFIX,
                "built-in AI: model dropped inline placeholders, fell back to plain text for part of this batch",
            );
        }
        const source = transferLanguageCode(result.sourceLang || "");
        return result.texts.map((t: string) => new TranslateResult(String(t ?? ""), source, 1));
    }

    async detectLanguage(texts: string[]): Promise<string> {
        return transferLanguageCode(await detectBatchLanguage(texts) || "");
    }
}

/**
 * Routes page-translation requests to a configured AI provider. The actual
 * HTTP call lives in background (ACTION.AI_TRANSLATE_TEXT) — both for CORS
 * reasons and to keep the API key out of the page's JS context.
 *
 * Tag preservation reuses the same `<bN>` placeholder convention as
 * MicrosoftTranslateService: the caller's `texts` already contain `<bN>`
 * markers; we JSON-stringify the array, the model returns a JSON array of
 * the same length, and we wrap each item in a TranslateResult.
 */
export class AiTranslateService extends TranslateService {
    readonly name: string;
    private readonly providerId: string;

    constructor(providerId: string) {
        super();
        this.providerId = providerId;
        this.name = AI_PREFIX + providerId;
    }

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        _sourceLang?: string,
        _options?: TranslateRequestOptions,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        // Page translation doesn't need streaming — background batches the
        // texts, calls chatCompleteNonStream (stream:false) and returns the
        // full array. Failures propagate: an AI provider's message ("invalid
        // api key", "insufficient balance", a model name typo) is the most
        // actionable error in the whole pipeline, so it is exactly the one the
        // user must see.
        const translations = await aiPageTranslate(this.providerId, texts, targetLang, signal ?? undefined);
        if (!translations) throw new Error("AI provider returned an empty translation response");
        return translations.map((t) => new TranslateResult(String(t ?? ""), "", 1));
    }

}
//#endregion

// ---------------------------------------------------------------------------
// Service registry
// ---------------------------------------------------------------------------

export const googleTranslationService: TranslateService = new GoogleTranslateService();
export const microsoftTranslationService: TranslateService = new MicrosoftTranslateService();
export const deeplTranslationService: TranslateService = new DeepLTranslateService();
export const builtinAiTranslationService: TranslateService = new BuiltinAiTranslateService();

// TODO: support user-defined custom keys / endpoints (Yandex, Youdao, …).
export const translationServices = new Map<string, TranslateService>([
    [googleTranslationService.name, googleTranslationService],
    [microsoftTranslationService.name, microsoftTranslationService],
    [builtinAiTranslationService.name, builtinAiTranslationService],
    [deeplTranslationService.name, deeplTranslationService],
]);

/**
 * Resolve a service identifier to a TranslateService instance.
 * Identifiers may be either a built-in name (`microsoft|google|deepl`) or
 * an AI provider id prefixed with `ai:` (e.g. `ai:p_xyz123`).
 */
export function resolveTranslateService(service: string): TranslateService | undefined {
    if (service.startsWith(AI_PREFIX)) {
        return new AiTranslateService(service.slice(AI_PREFIX.length));
    }
    return translationServices.get(service);
}

export function transferLanguageCode(language: string, text?: string): string {
    if (language === "zh-Hans") return "zh-CN";
    if (language === "zh-Hant") return "zh-TW";
    if (language === "ZH") {
        if (!text) return "zh-CN";
        return isTraditionalChinese(text) ? "zh-TW" : "zh-CN";
    }
    return language;
}
//#region translate cache
// ---------------------------------------------------------------------------
// Translation result cache
//
// The IndexedDB store (LRU, 100MB cap) is main/storage/translationCache.ts.
// Both it and the providers now run in background, so lookups are plain
// function calls — this used to cost two extra IPC round-trips per batch
// (cache-get + cache-put) on top of the translation itself.
// ---------------------------------------------------------------------------

interface CachedTranslation {
    t: string; // translatedMappedHtmlText
    s: string; // sourceLang
    c: number; // score
}

/**
 * Read the switch on every batch rather than memoizing it. A batch is already
 * doing IndexedDB + network work, so one chrome.storage.local read is noise,
 * and it removes the invalidation path the content script used to drive.
 */
async function isTranslationCacheEnabled(): Promise<boolean> {
    const v = await configRepo.get(CONFIG_KEY.TRANSLATION_CACHE_SWITCH);
    return v === undefined || v === null ? true : !!v;
}

async function cacheGetMany(
    service: string,
    targetLang: string,
    texts: string[],
): Promise<(CachedTranslation | null)[]> {
    if (texts.length === 0) return [];
    try {
        const res = await translationCache.getMany(service, targetLang, texts);
        if (!Array.isArray(res) || res.length !== texts.length) {
            return new Array(texts.length).fill(null);
        }
        return res as (CachedTranslation | null)[];
    } catch (e: any) {
        // A cache failure must never fail the translation.
        console.error(APP_NAME_WITH_SUFFIX, "translation cache read failed:", e?.message || e);
        return new Array(texts.length).fill(null);
    }
}

function cachePutMany(
    service: string,
    targetLang: string,
    entries: { text: string; value: CachedTranslation }[],
): void {
    if (entries.length === 0) return;
    void Promise.resolve(translationCache.putMany(service, targetLang, entries)).catch((e: any) => {
        console.error(APP_NAME_WITH_SUFFIX, "translation cache write failed:", e?.message || e);
    });
}

/**
 * Translate `texts`, serving hits from the persistent cache and only sending
 * the misses to the provider. The returned array is always aligned 1:1 with
 * `texts` (order preserved); freshly fetched results are written back to the
 * cache.
 *
 * Returns undefined for an *unknown service id* only — that is a configuration
 * bug, not a request failure, and callers bail out on it silently as they
 * always have. A provider that was reached and failed **throws**; the reason
 * travels back to the page (see the failure note above the provider classes).
 */
export async function translateTextsWithCache(
    service: string,
    texts: string[],
    targetLang: string,
    signal?: AbortSignal,
): Promise<TranslateResult[] | undefined> {
    if (texts.length === 0) return [];

    if (!(await isTranslationCacheEnabled())) {
        return resolveTranslateService(service)?.translateText(texts, targetLang, signal);
    }

    const cached = await cacheGetMany(service, targetLang, texts);
    const missIndices: number[] = [];
    const missTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
        if (!cached[i]) {
            missIndices.push(i);
            missTexts.push(texts[i]);
        }
    }

    let fetched: TranslateResult[] = [];
    if (missTexts.length > 0) {
        const r = await resolveTranslateService(service)?.translateText(missTexts, targetLang, signal);
        if (!r) return undefined; // unknown service → bail like before
        // Provider must answer 1:1 with the inputs. If it doesn't, the
        // positional remap below would misalign — fall back to a full
        // (uncached) translation rather than return a corrupt array.
        if (r.length !== missTexts.length) {
            return resolveTranslateService(service)?.translateText(texts, targetLang, signal);
        }
        fetched = r;
    }

    const results: TranslateResult[] = new Array(texts.length);
    for (let i = 0; i < texts.length; i++) {
        const hit = cached[i];
        if (hit) results[i] = new TranslateResult(hit.t, hit.s, hit.c);
    }
    const toCache: { text: string; value: CachedTranslation }[] = [];
    for (let f = 0; f < missIndices.length; f++) {
        const idx = missIndices[f];
        const r = fetched[f];
        results[idx] = r;
        toCache.push({
            text: texts[idx],
            value: { t: r.translatedMappedHtmlText, s: r.sourceLang, c: r.score },
        });
    }

    cachePutMany(service, targetLang, toCache);
    return results;
}
//#endregion


// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

/**
 * Provider-backed language detection.
 *
 * Microsoft's detect endpoint is the default, but when Built-in AI is the
 * active translator the on-device LanguageDetector answers instead: it is
 * already downloaded on any machine that has the translator, and it removes the
 * one remaining network round-trip from an otherwise fully offline path.
 *
 * Falls back to Microsoft when the on-device detector fails or is inconclusive
 * — this is the tie-breaker for local franc detection, so an empty answer costs
 * the user nothing, but a working answer is strictly better than none.
 */
async function detectDominantLanguage(texts: string[]): Promise<string> {
    const active = await configRepo.get(CONFIG_KEY.TRANSLATE_SERVICE);
    if (active === TRANSLATE_SERVICE.BUILTIN) {
        try {
            const lang = await builtinAiTranslationService.detectLanguage(texts);
            if (lang) return lang;
        } catch (e: any) {
            console.log(APP_NAME_WITH_SUFFIX, 'built-in AI detect failed, falling back to Microsoft:', e?.message || e);
        }
    }
    return await microsoftTranslationService.detectLanguage(texts);
}

type MessageHandler = (message: any, sendResponse: (r: any) => void) => boolean | void;

/** Translate actions handled in background, keyed by ACTION. Consumed by background.ts. */
export const translateMessageHandlers: Record<string, MessageHandler> = {
    [ACTION.TRANSLATE_TEXTS]: (message, sendResponse) => handleAbortable(
        ABORT_SCOPE.TRANSLATE, 'Translate texts', message, sendResponse,
        async (data, signal) => {
            const { service, texts, targetLang } = data as {
                service: string; texts: string[]; targetLang: string;
            };
            const results = await translateTextsWithCache(service, texts, targetLang, signal);
            // `null` means "unknown service id" — content degrades silently on
            // it. A provider that failed throws instead, and handleAbortable
            // turns that into a STATUS_FAIL reply carrying the real reason.
            return results ?? null;
        },
    ),

    [ACTION.TRANSLATE_TEXTS_ABORT]: (message, sendResponse) =>
        handleAbort(ABORT_SCOPE.TRANSLATE, message, sendResponse),

    [ACTION.DETECT_LANGUAGE]: (message, sendResponse) =>
        handleAsync('Detect language', sendResponse, async () => {
            const texts: string[] = message.data?.texts ?? [];
            return { lang: await detectDominantLanguage(texts) };
        }),

    [ACTION.TRANSLATE_SERVICE_TEST]: (message, sendResponse) =>
        handleAsync('Translate service test', sendResponse, () => testTranslateService(message.data)),

    // Options-only: what does BACKGROUND see? The dialog can check `Translator`
    // in its own window, but that says nothing about the worker that actually
    // translates — and the two genuinely differ (a page needs a user gesture to
    // download a model, a service worker does not), so this asks the side whose
    // answer matters.
    [ACTION.BUILTIN_AI_SELF_CHECK]: (message, sendResponse) =>
        handleAsync('Built-in AI self-check', sendResponse, async (): Promise<BuiltinAiPingResponse> => {
            const supported = builtinAiSupported();
            if (!supported) return { supported, detector: null, translator: null };
            const { sourceLang, targetLang } = (message.data || {}) as { sourceLang?: string; targetLang?: string };
            return {
                supported,
                detector: await detectorAvailability(),
                translator: sourceLang && targetLang
                    ? await translatorAvailability(toModelLang(sourceLang), toModelLang(targetLang))
                    : null,
            };
        }),

    // Options-only: pre-download a pair the user picked, rather than waiting for
    // the first page that needs it. Resolves when the model is on disk; progress
    // arrives separately via BUILTIN_AI_DOWNLOAD_PROGRESS.
    [ACTION.BUILTIN_AI_ENSURE_MODEL]: (message, sendResponse) =>
        handleAsync('Built-in AI model download', sendResponse, async () => {
            const { sourceLang, targetLang } = (message.data || {}) as { sourceLang: string; targetLang: string };
            if (!sourceLang || !targetLang) throw new Error('Missing language pair');
            await ensureModel(toModelLang(sourceLang), toModelLang(targetLang));
            return { ok: true };
        }),

    // Any surface → background. Synchronous: aborting is local bookkeeping, and
    // the caller does not wait on it — the outcome arrives as a broadcast, the
    // same channel every other download state uses.
    [ACTION.BUILTIN_AI_CANCEL_DOWNLOAD]: (message, sendResponse) => {
        const { kind, sourceLang, targetLang } = (message.data || {}) as BuiltinAiCancelDownloadRequest;
        cancelDownload({
            kind: kind === 'detector' ? 'detector' : 'translator',
            // Normalized because the two callers speak different dialects: the
            // page echoes back a progress broadcast (already model form), while
            // the Options dialog may name its own pair in config form (zh-CN).
            // `toModelLang` is idempotent, so one call covers both — and getting
            // this wrong would miss the abort key and silently not cancel.
            sourceLang: sourceLang ? toModelLang(sourceLang) : sourceLang,
            targetLang: targetLang ? toModelLang(targetLang) : targetLang,
        });
        sendResponse({ status: STATUS_SUCCESS });
    },

    // The user asking for a translation by hand is an explicit "yes I do want
    // this", so it lifts a cancel. Without it, cancelling once would make the
    // built-in translator look broken for the rest of the worker's life, with
    // the only way back buried in Options.
    [ACTION.BUILTIN_AI_RESUME_DOWNLOAD]: (_message, sendResponse) => {
        clearDownloadCancel();
        sendResponse({ status: STATUS_SUCCESS });
    },
};

// ---------------------------------------------------------------------------
// Connectivity test (Options → Services)
// ---------------------------------------------------------------------------

/**
 * Validate a service by running the REAL translation path against a sample.
 *
 * Needs no special mode any more: providers always throw on failure, so the
 * reason arrives here on its own and `handleAsync` relays it to the dialog.
 */
async function testTranslateService(
    data: { service?: string; targetLang?: string; apiKey?: string } | undefined,
): Promise<{ reply: string }> {
    const svc = data?.service;
    const targetLang = data?.targetLang || 'zh-CN';
    if (!svc) throw new Error('Unknown service: undefined');

    // A draft DeepL key typed into the Options dialog but not yet saved needs a
    // one-off instance; everything else uses the shared singletons.
    const service = (svc === TRANSLATE_SERVICE.DEEPL && data?.apiKey)
        ? new DeepLTranslateService(data.apiKey)
        : resolveTranslateService(svc);
    if (!service) throw new Error(`Unknown service: ${svc}`);

    // Pressing Test is the user asking for this service to work, so it lifts a
    // cancel — otherwise cancelling from the Options row would leave the very
    // button next to it permanently answering "you cancelled this".
    if (svc === TRANSLATE_SERVICE.BUILTIN) clearDownloadCancel();

    const results = await service.translateText(['Hello, world.'], targetLang);
    const reply = results[0]?.translatedMappedHtmlText;
    if (!reply) throw new Error('empty translation response');
    return { reply };
}
