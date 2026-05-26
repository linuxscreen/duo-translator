import { ACTION, APP_NAME_WITH_SUFFIX, EXCLUDE_CHILD_ELEMENT_TAGS, PORT_NAME, TRANS_SERVICE, VIEW_STRATEGY } from "@/main/constants";
import { sendMessageToBackground } from "../utils/message";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { browser } from "wxt/browser";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export class Token {
    constructor(public token: string, public expireTime: number) { }

    isValid(): boolean {
        return !!this.token && this.expireTime > Date.now();
    }
}

export class TranslateResult {
    translatedMappedHtmlText: string; // translated innerHtml of the mapped tag element, for example <b0>translated text</b0>
    sourceLang: string;
    score: number;
    rawText: string = "";
    rawTextLength: number = 0; // original text length, sum of all text nodes length
    translatedCopyElement?: HTMLElement; // a translated copy of the original element use for double view strategy
    originalSliceElement?: HTMLElement[];
    rawMappedHtmlText?: string; // original innerHtml of the mapped tag element, for example <b0>original text</b0>
    translatedHtmlText?: string; // translated innerHtml of the original tag element, for example <p class="x" id="y">translated text</p>
    targetLang?: string;
    textNodes?: Text[];

    constructor(rawTranslatedText: string, sourceLang: string, score: number) {
        this.translatedMappedHtmlText = rawTranslatedText;
        this.sourceLang = sourceLang;
        this.score = score;
    }
}

export class TranslateParams {
    constructor(
        public serviceName: string,
        public targetLang: string,
        public sourceLang?: string,
        public defaultStrategy?: string,
        public autoTrigger?: boolean,
        public isBody?: boolean,
    ) { }
}
// Backward-compatible alias for existing call sites that use lowercase name.
export { TranslateParams as translateParams };

export default defineUnlistedScript(() => { });

// ---------------------------------------------------------------------------
// Tag handling helpers (placeholder tags so translators preserve markup)
// ---------------------------------------------------------------------------

type Tag = { match: string; tagName: string; index: number };

/**
 * Replaces native HTML tags with synthetic <bN> placeholders so translation
 * APIs (which often mangle real HTML) preserve the structure. A fresh
 * instance must be used per request — state is request-scoped.
 */
class TagReplacer {
    private tagCounter = 11;
    private tagStack: Tag[] = [];
    private tagMap: Record<string, Tag> = {};

    replaceTags(html: string): string {
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
        return html.replace(tagRegex, (match, tagName) => {
            if (match.startsWith("</")) {
                let lastTag = this.tagStack.pop();
                while (lastTag && tagName !== lastTag.tagName) {
                    lastTag = this.tagStack.pop();
                }
                if (!lastTag) return match;
                return `</b${lastTag.index}>`;
            }
            const currentTag: Tag = { match, tagName, index: this.tagCounter };
            this.tagStack.push(currentTag);
            this.tagMap[`b${this.tagCounter}`] = currentTag;
            this.tagCounter++;
            return `<b${currentTag.index}>`;
        });
    }

    restoreTags(customHtml: string): string {
        const customTagRegex = /<\/?b([0-9]+)>/g;
        return customHtml.replace(customTagRegex, (match, tagNumber) => {
            const originalTag = this.tagMap[`b${tagNumber}`];
            if (!originalTag) return match;
            return match.startsWith("</") ? `</${originalTag.tagName}>` : originalTag.match;
        });
    }
}

export function convertAToBTags(html: string): string {
    if (html === "") return "";
    let result = html.replace(/<a\s+i=(\d+)>/g, "<b$1>").replace(/<\/a>/g, "</b>");

    const openTags: string[] = [];
    let finalResult = "";
    for (let i = 0; i < result.length; i++) {
        if (result.substring(i, i + 2) === "<b") {
            const numEnd = result.indexOf(">", i);
            const tagNum = result.substring(i + 2, numEnd);
            openTags.push(tagNum);
            finalResult += `<b${tagNum}>`;
            i = numEnd;
        } else if (result.substring(i, i + 4) === "</b>") {
            const lastTag = openTags.pop() || "";
            finalResult += `</b${lastTag}>`;
            i += 3;
        } else {
            finalResult += result[i];
        }
    }

    return finalResult;
}

function transferLanguageCode(language: string): string {
    if (language === "zh-Hans") return "zh-CN";
    if (language === "zh-Hant") return "zh-TW";
    return language;
}

// ---------------------------------------------------------------------------
// TranslateService — abstract base shared by every provider
// ---------------------------------------------------------------------------

export interface TranslateRequestOptions {
    retryCount?: number;
}

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

    /** Translate a list of HTML elements while preserving inline tags. */
    abstract translateHtml(
        html: HTMLElement[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
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
// Google
// ---------------------------------------------------------------------------

export class GoogleTranslateService extends TranslateService {
    readonly name = TRANS_SERVICE.GOOGLE;
    // TODO: support a configurable mirror URL and automatic failover.
    private readonly endpoint = "https://translate-pa.googleapis.com/v1/translateHtml";
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
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        const payload = texts.map((text) =>
            text.replaceAll("<b", "<a i=").replaceAll(/<\/b\d+>/g, "</a>")
        );

        const response = await fetch(this.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json+protobuf",
                "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify([[payload, "auto", targetLang], "te_lib"]),
            signal: signal,
        });

        if (response.status !== 200) {
            console.error(APP_NAME_WITH_SUFFIX, "Google Translate API error:", response.statusText);
            return [];
        }

        const data = await response.json();
        if (!data || data.length < 2) return [];

        const result: TranslateResult[] = [];
        for (let i = 0; i < data[0].length; i++) {
            const translated = convertAToBTags(data[0][i]);
            result.push(new TranslateResult(translated, data[1][i], 1));
        }
        return result;
    }

    async translateHtml(
        html: HTMLElement[],
        targetLang: string,
        signal?: AbortSignal,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
        const tagMapList: Map<string, string>[] = [];
        const texts: string[] = [];

        for (let i = 0; i < html.length; i++) {
            tagMapList.push(new Map<string, string>());
            let count = 0;
            const originalHtml = html[i].outerHTML.replace(tagRegex, (match, tagName) => {
                const key = `<${tagName} i=${count}>`;
                count++;
                tagMapList[i].set(key, match);
                return key;
            });
            texts.push(originalHtml);
        }

        const translated = await this.translateText(texts, targetLang, signal, sourceLang);
        for (let i = 0; i < translated.length; i++) {
            tagMapList[i].forEach((value, key) => {
                translated[i].translatedHtmlText = translated[i]?.translatedHtmlText?.replace(key, value);
            });
        }
        return translated;
    }
}

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

const MS_TRANSLATE_URL =
    "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true&";
const MS_DETECT_URL =
    "https://api-edge.cognitive.microsofttranslator.com/detect?api-version=3.0";
const MS_MAX_RETRY = 5;
const MS_BATCH_CHAR_LIMIT = 4500;
const MS_BATCH_ITEM_LIMIT = 900;
const utf8Encoder = new TextEncoder();

export class MicrosoftTranslateService extends TranslateService {
    readonly name = TRANS_SERVICE.MICROSOFT;
    private authToken: Token = new Token("", 0);

    private async fetchToken(): Promise<Token> {
        // Uncaught (in promise) TypeError: this.authToken.isValid is not a function
        // What sendMessage returns across processes is a pure object that has been structured and cloned. 
        // The prototype has been lost and needs to be repackaged into a Token instance.
        const raw = await sendMessageToBackground({
            action: ACTION.ACCESS_TOKEN_GET,
            data: { service: this.name },
        });
        if (!raw || typeof raw.token !== "string") return new Token("", 0);
        return new Token(raw.token, raw.expireTime ?? 0);
    }

    private async ensureToken(): Promise<void> {
        if (this.authToken.isValid()) return;
        this.authToken = await this.fetchToken();
    }

    private async refreshTokenForce(): Promise<void> {
        this.authToken = await this.fetchToken();
    }

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
        options: TranslateRequestOptions = { retryCount: 0 },
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];

        await this.ensureToken();
        const url = MS_TRANSLATE_URL + "to=" + targetLang;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + this.authToken.token,
            },
            body: JSON.stringify(texts.map((t) => ({ text: t }))),
            signal: signal,
        });

        if (response.status === 401) {
            const retryCount = (options.retryCount ?? 0) + 1;
            if (retryCount > MS_MAX_RETRY) return [];
            await this.refreshTokenForce();
            return this.translateText(texts, targetLang, signal, sourceLang, { retryCount });
        }

        if (response.status !== 200) {
            console.error(APP_NAME_WITH_SUFFIX, "Microsoft Translate API error:", response.statusText);
            return [];
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

    async translateHtml(
        html: HTMLElement[],
        targetLang: string,
        signal?: AbortSignal,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        if (html.length === 0) return [];

        const cloned = html.map((ele) => ele.cloneNode(true) as HTMLElement);
        const tagReplacer = new TagReplacer();
        const texts: string[] = [];

        for (const ele of cloned) {
            // Collapse whitespace between tags so the translator doesn't try to
            // translate stray indentation.
            let originHtml = ele.outerHTML.replace(/>([^<]+)</gs, (_, p1) => `>${p1}<`);
            texts.push(tagReplacer.replaceTags(originHtml));
        }

        const translated = await this.translateBatchText(texts, targetLang, signal, sourceLang);
        for (const item of translated) {
            if (!item.translatedHtmlText) continue;
            const restored = tagReplacer.restoreTags(item.translatedHtmlText);
            const container = document.createElement("div");
            container.innerHTML = restored;
            item.translatedHtmlText = container.innerHTML;
        }
        return translated;
    }

    async detectLanguage(texts: string[]): Promise<string> {
        await this.ensureToken();
        const response = await fetch(MS_DETECT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + this.authToken.token,
            },
            body: JSON.stringify(texts.map((t) => ({ text: t }))),
        });
        if (response.status !== 200) return "";

        const data: { language: string; score: number }[] = await response.json();
        // Weight each detection by the byte length of its source text so that
        // a single short paragraph in another language can't outvote the body.
        const tally = new Map<string, number>();
        data.forEach((d, i) => {
            const weight = d.score * utf8Encoder.encode(texts[i]).length;
            tally.set(d.language, (tally.get(d.language) || 0) + weight);
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
    readonly name = TRANS_SERVICE.DEEPL;
    private readonly apiKey: string;
    private readonly endpoint: string;

    constructor(apiKey: string = import.meta.env.VITE_DEEPL_API_KEY ?? "") {
        super();
        this.apiKey = apiKey;
        // DeepL routes free-tier keys (suffix ":fx") to api-free; paid keys to api.
        this.endpoint = apiKey.endsWith(":fx")
            ? "https://api-free.deepl.com/v2/translate"
            : "https://api.deepl.com/v2/translate";
    }

    private async request(body: Record<string, unknown>): Promise<any | null> {
        if (!this.apiKey) {
            console.error(APP_NAME_WITH_SUFFIX, "DeepL API key is not configured (VITE_DEEPL_API_KEY).");
            return null;
        }
        const response = await fetch(this.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `DeepL-Auth-Key ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (response.status !== 200) {
            console.error(APP_NAME_WITH_SUFFIX, "DeepL Translate API error:", response.status, response.statusText);
            return null;
        }
        return response.json();
    }

    private toResults(payload: any): TranslateResult[] {
        const translations: { text: string; detected_source_language: string }[] =
            payload?.translations ?? [];
        return translations.map(
            (t) =>
                new TranslateResult(t.text, transferLanguageCode(t.detected_source_language), 1),
        );
    }

    async translateText(
        texts: string[],
        targetLang: string,
        _signal?: AbortSignal | null,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];
        const payload = await this.request({
            text: texts,
            target_lang: targetLang.toUpperCase(),
            ...(sourceLang ? { source_lang: sourceLang.toUpperCase() } : {}),
        });
        return payload ? this.toResults(payload) : [];
    }

    async translateHtml(
        html: HTMLElement[],
        targetLang: string,
        _signal?: AbortSignal | null,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        if (html.length === 0) return [];
        // DeepL handles HTML natively when tag_handling=html, so no manual
        // tag rewriting is needed.
        const payload = await this.request({
            text: html.map((ele) => ele.outerHTML),
            target_lang: targetLang.toUpperCase(),
            tag_handling: "html",
            ...(sourceLang ? { source_lang: sourceLang.toUpperCase() } : {}),
        });
        if (!payload) return [];
        const results = this.toResults(payload);
        // For HTML mode the translator returns the HTML directly — surface it
        // as translatedText so the bilingual renderer can use it verbatim.
        for (const r of results) r.translatedHtmlText = r.translatedMappedHtmlText;
        return results;
    }
}

// ---------------------------------------------------------------------------
// AI (OpenAI-compatible / Gemini / Claude via background bridge)
// ---------------------------------------------------------------------------

export const AI_SERVICE_PREFIX = "ai:" as const;

/**
 * Routes page-translation requests to a configured AI provider. The actual
 * HTTP call lives in background ([main/background.ts] AI_TRANSLATE) — both
 * for CORS reasons and to keep the API key out of the page's JS context.
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
        this.name = AI_SERVICE_PREFIX + providerId;
    }

    async translateText(
        texts: string[],
        targetLang: string,
        signal?: AbortSignal | null,
        _sourceLang?: string,
    ): Promise<TranslateResult[]> {
        if (texts.length === 0) return [];
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        // Port-based so the content side can cancel an in-flight AI call by
        // disconnecting — background turns onDisconnect into controller.abort().
        const port = browser.runtime.connect({ name: PORT_NAME.AI_TRANSLATE });
        let onAbort: (() => void) | null = null;

        try {
            const translations = await new Promise<string[] | null>((resolve) => {
                let settled = false;
                const finish = (v: string[] | null) => {
                    if (settled) return;
                    settled = true;
                    resolve(v);
                };
                // Chrome only fires onDisconnect on the OTHER end of the port,
                // so disconnecting locally on abort won't wake this promise —
                // resolve it from the abort handler directly.
                onAbort = () => {
                    try { port.disconnect(); } catch { /* already gone */ }
                    finish(null);
                };
                signal?.addEventListener("abort", onAbort);
                port.onMessage.addListener((raw: any) => {
                    const msg = raw as
                        | { type: "result"; translations: string[] }
                        | { type: "error"; message: string };
                    if (msg?.type === "result" && Array.isArray(msg.translations)) {
                        finish(msg.translations);
                    } else if (msg?.type === "error") {
                        console.error(APP_NAME_WITH_SUFFIX, "AI translate failed:", msg.message);
                        finish(null);
                    }
                });
                // Fires when background disconnects (e.g. after sending result
                // or on its own error). Local self-disconnect does not fire it.
                port.onDisconnect.addListener(() => finish(null));
                try {
                    port.postMessage({ providerId: this.providerId, texts, targetLang });
                } catch {
                    finish(null);
                }
            });

            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (!translations) return [];
            return translations.map((t) => new TranslateResult(String(t ?? ""), "", 1));
        } finally {
            if (onAbort) signal?.removeEventListener("abort", onAbort);
            try { port.disconnect(); } catch { /* already disconnected */ }
        }
    }

    async translateHtml(
        html: HTMLElement[],
        targetLang: string,
        signal?: AbortSignal | null,
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        if (html.length === 0) return [];
        const cloned = html.map((ele) => ele.cloneNode(true) as HTMLElement);
        const tagReplacer = new TagReplacer();
        const texts: string[] = [];
        for (const ele of cloned) {
            const originHtml = ele.outerHTML.replace(/>([^<]+)</gs, (_, p1) => `>${p1}<`);
            texts.push(tagReplacer.replaceTags(originHtml));
        }
        const translated = await this.translateText(texts, targetLang, signal, sourceLang);
        for (const item of translated) {
            if (!item.translatedHtmlText) continue;
            const restored = tagReplacer.restoreTags(item.translatedHtmlText);
            const container = document.createElement("div");
            container.innerHTML = restored;
            item.translatedHtmlText = container.innerHTML;
        }
        return translated;
    }
}

// ---------------------------------------------------------------------------
// Service registry
// ---------------------------------------------------------------------------

export const googleTranslationService: TranslateService = new GoogleTranslateService();
export const microsoftTranslationService: TranslateService = new MicrosoftTranslateService();
export const deeplTranslationService: TranslateService = new DeepLTranslateService();

// TODO: support user-defined custom keys / endpoints (Yandex, Youdao, …).
export const translationServices = new Map<string, TranslateService>([
    [googleTranslationService.name, googleTranslationService],
    [microsoftTranslationService.name, microsoftTranslationService],
    [deeplTranslationService.name, deeplTranslationService],
]);

/**
 * Resolve a service identifier to a TranslateService instance.
 * Identifiers may be either a built-in name (`microsoft|google|deepl`) or
 * an AI provider id prefixed with `ai:` (e.g. `ai:p_xyz123`).
 */
export function resolveTranslateService(service: string): TranslateService | undefined {
    if (service.startsWith(AI_SERVICE_PREFIX)) {
        return new AiTranslateService(service.slice(AI_SERVICE_PREFIX.length));
    }
    return translationServices.get(service);
}

// ---------------------------------------------------------------------------
// DOM-level helpers used by content scripts
// ---------------------------------------------------------------------------
class PreProcessResult {
    elements: HTMLElement[]; // original elements that need mapping tag, which come from element and its children
    mappedHtmlText: string;
    textNodes: Text[]; // text nodes that need to be deleted, which come from the child text nodes of element
    text: string;
    totalTextNodesLength: number;

    constructor(elements: HTMLElement[], mappedHtmlText: string, textNodes: Text[], text: string, totalTextNodesLength: number) {
        this.elements = elements;
        this.mappedHtmlText = mappedHtmlText;
        this.textNodes = textNodes;
        this.text = text;
        this.totalTextNodesLength = totalTextNodesLength;
    }
}

function getElementPreProcessResult(element: HTMLElement, viewStrategy: VIEW_STRATEGY): PreProcessResult {
    let i = 0;
    let totalTextNodesLength = 0;
    let text = "";
    const elements: HTMLElement[] = [];
    const processParent = document.createElement("div");
    const textNodes: Text[] = [];

    // flag all children of the element that textNode is not empty
    let notEmptyNodes: Node[] = [];
    let stack = [...element.childNodes];
    while (stack.length > 0) {
        let pop = stack.pop();
        if (!pop) continue;
        // /\p{Cf}/gu: Contains all zero-width characters
        if (pop.nodeType === Node.TEXT_NODE && pop.textContent?.replace(/\p{Cf}/gu, '') !== '') {
            notEmptyNodes.push(pop);
        }
        if (pop.nodeType === Node.ELEMENT_NODE) {
            let p = pop as HTMLElement;
            if (EXCLUDE_CHILD_ELEMENT_TAGS.has(p.tagName)) continue;
            stack.push(...pop.childNodes);
        }
    }
    let textNotEmptyElementSet = new Set<HTMLElement>();
    notEmptyNodes.forEach(node => {
        while (node.parentNode !== element && node.parentNode?.nodeType === Node.ELEMENT_NODE) {
            textNotEmptyElementSet.add(node.parentNode as HTMLElement);
            node = node.parentNode;
        }
    });

    elements.push(element);
    const removeChildren: HTMLElement[] = []
    const process = (node: Node | null, parent: HTMLElement) => {
        if (!node) return;
        if (node.nodeType === 1) {
            const ele = node as HTMLElement;
            // ignore empty element
            if (!textNotEmptyElementSet.has(ele)) {
                if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
                    removeChildren.push(ele)
                }
                return;
            }
            const rootProcessedElement = document.createElement("b" + i);
            parent.appendChild(rootProcessedElement);
            elements.push(ele);
            i++;
            for (const child of node.childNodes) process(child, rootProcessedElement);
        }
        if (node.nodeType === 3) {
            const textNode = node as Text;
            if (textNode.textContent === "") return;
            totalTextNodesLength += textNode.textContent.length;
            text += textNode.textContent;
            textNodes.push(textNode);
            parent.appendChild(textNode.cloneNode(true));
        }
    };

    for (const child of element.childNodes) process(child, processParent);
    if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
        removeChildren.forEach(ele => element.removeChild(ele))
    }
    return { elements, mappedHtmlText: processParent.innerHTML, textNodes: textNodes, totalTextNodesLength, text };
}

function updateTranslateElementContent(rawTranslatedHtml: string, originalElements: HTMLElement[]) {
    if (originalElements.length === 0 || rawTranslatedHtml === "") return;

    const translatedElement = document.createElement("div");
    translatedElement.innerHTML = rawTranslatedHtml;

    function getOriginalElement(tagName: string) {
        if (tagName === "DIV") {
            return originalElements[0];
        } else {
            const num = parseInt(tagName.replace("B", ""));
            if (isNaN(num) || num + 1 >= originalElements.length) return null;
            return originalElements[num + 1];
        }
    }

    function translate(node: Node | null) {
        if (!node) return;
        if (node.nodeType === 3) {
            const textParent = node.parentElement;
            if (!textParent) return;
            const original = getOriginalElement(textParent.tagName)
            if (!original) return;
            original.appendChild(node.cloneNode(true));
            return;
        }
        if (node.nodeType === 1) {
            const ele = node as HTMLElement;
            for (const child of node.childNodes) translate(child);
            const eleParent = ele.parentElement;
            if (eleParent) {
                const originalParent = getOriginalElement(eleParent.tagName)
                if (!originalParent) return;
                const original = getOriginalElement(ele.tagName)
                if (!original) return;
                originalParent.appendChild(original);
            }
        }
    }
    translatedElement.childNodes.forEach(translate);
}

export async function getTranslateResult(
    service: string,
    elements: HTMLElement[],
    targetLang: string,
    viewStrategy: VIEW_STRATEGY,
    signal?: AbortSignal
): Promise<TranslateResult[]> {
    if (!elements || elements.length === 0) return [];

    const texts: string[] = [];
    const preProcessResults: PreProcessResult[] = [];

    const needRemoveElementIdx: number[] = []
    const translatedCopyElements: HTMLElement[] = [];
    for (let i = 0; i < elements.length; i++) {
        let element = elements[i]
        if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
            let rawElement = document.createElement("span")
            rawElement.innerHTML = element.innerHTML
            element = rawElement
        }
        const result = getElementPreProcessResult(element, viewStrategy);
        if (result.mappedHtmlText.trim() === "") {
            needRemoveElementIdx.push(i)
            continue
        }
        if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
            translatedCopyElements.push(element)
        }

        texts.push(result.mappedHtmlText);
        preProcessResults.push(result);
    }

    for (let i = needRemoveElementIdx.length - 1; i >= 0; i--) {
        elements.splice(needRemoveElementIdx[i], 1)
    }

    const results = await resolveTranslateService(service)?.translateText(texts, targetLang, signal);
    if (!results) return [];


    for (let i = results.length - 1; i >= 0; i--) {
        const result = results[i];
        if (texts[i] === result.translatedMappedHtmlText) {
            elements.splice(i, 1);
            results.splice(i, 1);
        }
        let preProcessResult = preProcessResults[i]
        result.originalSliceElement = preProcessResult.elements
        result.rawMappedHtmlText = texts[i];
        result.rawTextLength = preProcessResult.totalTextNodesLength;
        result.rawText = preProcessResult.text
        if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
            // We render against a copy in DOUBLE mode, so the original text
            // nodes can be discarded outright.
            preProcessResult.textNodes?.forEach((textNode) => textNode?.remove());
            result.translatedCopyElement = translatedCopyElements[i];
            result.textNodes = preProcessResult.textNodes
        } else {
            // SINGLE may leave the element untranslated; keep the originals.
            result.textNodes = preProcessResult.textNodes
        }
    }
    return results;
}

// replace the element content with the translated text
export async function translate(results: TranslateResult[]): Promise<void> {
    for (const result of results) {
        updateTranslateElementContent(result.translatedMappedHtmlText, result.originalSliceElement || []);
    }
}

// replace the element content with the original text
export async function restore(results: TranslateResult[]): Promise<void> {
    for (const result of results) {
        if (!result.rawMappedHtmlText) continue;
        updateTranslateElementContent(result.rawMappedHtmlText, result.originalSliceElement || []);
    }
}
