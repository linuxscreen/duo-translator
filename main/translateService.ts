import { ACTION, TRANS_SERVICE, VIEW_STRATEGY } from "@/main/constants";
import { sendMessageToBackground } from "../utils/message";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

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
    rawTranslatedText: string;
    sourceLang: string;
    score: number;
    originalSliceElement?: HTMLElement[];
    rawText?: string;
    translatedText?: string;
    targetLang?: string;
    textNodes?: Text[];

    constructor(rawTranslatedText: string, sourceLang: string, score: number) {
        this.rawTranslatedText = rawTranslatedText;
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
        sourceLang?: string,
        options?: TranslateRequestOptions,
    ): Promise<TranslateResult[]>;

    /** Translate a list of HTML elements while preserving inline tags. */
    abstract translateHtml(
        html: HTMLElement[],
        targetLang: string,
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
        sourceLang?: string,
    ): Promise<TranslateResult[]> {
        return this.translateText(texts, targetLang, sourceLang);
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
        });

        if (response.status !== 200) {
            console.error("Google Translate API error:", response.statusText);
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

        const translated = await this.translateText(texts, targetLang, sourceLang);
        for (let i = 0; i < translated.length; i++) {
            tagMapList[i].forEach((value, key) => {
                translated[i].translatedText = translated[i]?.translatedText?.replace(key, value);
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
        });

        if (response.status === 401) {
            const retryCount = (options.retryCount ?? 0) + 1;
            if (retryCount > MS_MAX_RETRY) return [];
            await this.refreshTokenForce();
            return this.translateText(texts, targetLang, sourceLang, { retryCount });
        }

        if (response.status !== 200) {
            console.error("Microsoft Translate API error:", response.statusText);
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
                this.translateText(chunk, targetLang, sourceLang, { retryCount: 0 }).then(
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

        const translated = await this.translateBatchText(texts, targetLang, sourceLang);
        for (const item of translated) {
            if (!item.translatedText) continue;
            const restored = tagReplacer.restoreTags(item.translatedText);
            const container = document.createElement("div");
            container.innerHTML = restored;
            item.translatedText = container.innerHTML;
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
            console.warn("DeepL API key is not configured (VITE_DEEPL_API_KEY).");
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
            console.error("DeepL Translate API error:", response.status, response.statusText);
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
        for (const r of results) r.translatedText = r.rawTranslatedText;
        return results;
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

// ---------------------------------------------------------------------------
// DOM-level helpers used by content scripts
// ---------------------------------------------------------------------------

function getElementPreProcessResult(element: HTMLElement, viewStrategy: VIEW_STRATEGY): {
    elements: HTMLElement[];
    text: string;
    deleteTextNodes: Text[];
} {
    let i = 0;
    const elements: HTMLElement[] = [];
    const processParent = document.createElement("div");
    const deleteTextNodes: Text[] = [];

    const SKIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', "IMAGE"]);

    // flag all children of the element that textNode is not empty
    let notEmptyNodes: Node[] = [];
    let stack = [...element.childNodes];
    while (stack.length > 0) {
        let pop = stack.pop();
        if (!pop) continue;
        // /\p{Cf}/gu: Contains all zero-width characters
        if (pop.nodeType === Node.TEXT_NODE && pop.textContent?.replace(/\p{Cf}/gu, '').trim() !== '') {
            notEmptyNodes.push(pop);
        }
        if (pop.nodeType === Node.ELEMENT_NODE) {
            let p = pop as HTMLElement;
            if (SKIP_TAGS.has(p.tagName)) continue;
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
    const removeChildren : HTMLElement[] = []
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
            deleteTextNodes.push(textNode);
            parent.appendChild(textNode.cloneNode(true));
        }
    };

    for (const child of element.childNodes) process(child, processParent);
    if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
        removeChildren.forEach(ele => element.removeChild(ele))
    }
    return { elements, text: processParent.innerHTML, deleteTextNodes };
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
): Promise<TranslateResult[]> {
    if (!elements || elements.length === 0) return [];

    const texts: string[] = [];
    const sliceElements: HTMLElement[][] = [];
    const deleteTextNodesList: Text[][] = [];
    for (const element of elements) {
        const result = getElementPreProcessResult(element, viewStrategy);
        texts.push(result.text);
        sliceElements.push(result.elements);
        deleteTextNodesList.push(result.deleteTextNodes);
    }

    const results = await translationServices.get(service)?.translateText(texts, targetLang);
    if (!results) return [];

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        result.originalSliceElement = sliceElements[i];
        result.rawText = texts[i];
        if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
            // We render against a copy in DOUBLE mode, so the original text
            // nodes can be discarded outright.
            deleteTextNodesList[i]?.forEach((textNode) => textNode?.remove());
        } else {
            // SINGLE may leave the element untranslated; keep the originals.
            result.textNodes = deleteTextNodesList[i];
        }
    }
    return results;
}

export async function translate(results: TranslateResult[]): Promise<void> {
    for (const result of results) {
        updateTranslateElementContent(result.rawTranslatedText, result.originalSliceElement || []);
    }
}

export async function restore(results: TranslateResult[]): Promise<void> {
    for (const result of results) {
        if (!result.rawText) continue;
        updateTranslateElementContent(result.rawText, result.originalSliceElement || []);
    }
}
