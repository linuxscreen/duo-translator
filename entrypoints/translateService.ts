import { getConfig, setConfig } from "@/utils/db";
import { ACTION, CONFIG_KEY, DB_ACTION, VIEW_STRATEGY } from "@/entrypoints/constants";
import { sendMessageToBackground } from "@/entrypoints/utils";

export class Token {
    token: string
    expireTime: number

    constructor(token: string, expireTime: number) {
        this.token = token;
        this.expireTime = expireTime;
    }
}

export default defineUnlistedScript(
    () => {
    }
)

export class translateParams {
    serviceName: string
    targetLang: string
    sourceLang?: string
    defaultStrategy?: string
    autoTrigger?: boolean
    isBody?: boolean

    constructor(serviceName: string, targetLang: string, sourceLang?: string, defaultStrategy?: string, autoTrigger?: boolean, isBody?: boolean) {
        this.serviceName = serviceName;
        if (sourceLang !== undefined && sourceLang !== null) {
            this.sourceLang = sourceLang;
        }
        if (defaultStrategy) {
            this.defaultStrategy = defaultStrategy;
        }
        if (autoTrigger !== undefined && autoTrigger !== null) {
            this.autoTrigger = autoTrigger;
        }
        if (isBody !== undefined && isBody !== null) {
            this.isBody = isBody;
        }
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
    }
}

interface TranslateText {
    (text: Array<string>, targetLang: string, sourceLang?: string, options?: any): Promise<TranslateResult[]>;
}

interface TranslateHtml {
    (html: Array<HTMLElement>, targetLang: string, sourceLang?: string): Promise<TranslateResult[]>;
}

interface TranslateBatchText {
    (text: Array<string>, targetLang: string, sourceLang?: string): Promise<TranslateResult[]>;
}

interface DetectLanguage {
    (text: Array<string>): Promise<string>;
}

type TagMap = {
    [key: string]: Tag;
};
type Tag = {
    match: string;
    tagName: string;
    index: number;
}

class TagReplacer {
    private tagCounter: number;
    private tagStack: Tag[];
    private tagMap: TagMap;

    constructor() {
        this.tagCounter = 11;
        this.tagStack = [];
        this.tagMap = {};
    }

    // Replace the original label with a custom label
    replaceTags(html: string): string {
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

        html = html.replace(tagRegex, (match, tagName) => {
            if (match.startsWith("</")) {
                // Closed label handling
                let lastTag = this.tagStack.pop();
                // How to close the label and open the label are not the same, pop all the time
                // fix the bug that the label is not closed
                while (lastTag && tagName != lastTag?.tagName) {
                    lastTag = this.tagStack.pop();
                }
                if (lastTag == undefined) {
                    return match
                }
                return `</b${lastTag.index}>`;
            } else {
                // open label handling
                const currentTag = { match, tagName, index: this.tagCounter };
                this.tagStack.push(currentTag);

                // Document the mapping of the custom label to the original label
                this.tagMap[`b${this.tagCounter}`] = currentTag;

                this.tagCounter++;
                return `<b${currentTag.index}>`;
            }
        });

        return html;
    }

    // Replace the custom label back with the original label
    restoreTags(customHtml: string): string {
        const customTagRegex = /<\/?b([0-9]+)>/g;

        customHtml = customHtml.replace(customTagRegex, (match, tagNumber) => {
            const originalTag: Tag = this.tagMap[`b${tagNumber}`];
            if (originalTag) {
                if (match.startsWith("</")) {
                    return `</${originalTag.tagName}>`;
                } else {
                    return originalTag.match;
                }
            }
            return match; // Returns the original tag when there is no match
        });

        return customHtml;
    }
}

// ----------------------------------------------------------------------------

class TranslationService {

    constructor(serviceName: string, baseUrl: string, requestMethod: string, authToken: Token, apiKey: string,
        translateText: TranslateText, translateHtml?: TranslateHtml, translateBatchText?: TranslateBatchText,
        detectLanguage?: DetectLanguage) {
        this.serviceName = serviceName;
        this.baseUrl = baseUrl;
        this.requestMethod = requestMethod;
        this.authToken = authToken;
        this.apiKey = apiKey;
        this.translateText = translateText.bind(this);
        if (translateHtml) {
            this.translateHtml = translateHtml.bind(this);
        }
        if (translateBatchText) {
            this.translateBatchText = translateBatchText.bind(this);
        }
        if (detectLanguage) {
            this.detectLanguage = detectLanguage.bind(this);
        }
        console.log("TranslationService created:", this)
    }

    detectLanguage: DetectLanguage | undefined;
    serviceName: string
    baseUrl: string
    requestMethod: string
    authToken: Token
    apiKey: string
    //translate origin text function
    translateText: TranslateText
    // translate html function
    translateHtml: TranslateHtml | undefined
    // batch translate text function
    translateBatchText: TranslateBatchText | undefined

}

export const googleTranslationService: TranslationService = new TranslationService(
    "google",
    "https://duo-translator.zeroflx.com/googleapis/v1/translateHtml",
    "POST",
    new Token("", 0),
    "",
    async function (this: TranslationService, texts: Array<string>, targetLang: string, sourceLang?: string) : Promise<TranslateResult[]> {
        if (texts.length == 0) {
            return Promise.resolve([])
        }
        texts = texts.map((text) => {
            text = text.replaceAll("<b", "<a i=")
            text = text.replaceAll("</b\d+>", "</a>")
            return text
        })

        // todo two url for google translate(official and mirror), switch rapidly and available
        // todo or support user defined custom mirror url
        const response = await fetch(this.baseUrl, {
            method: this.requestMethod,
            headers: {
                'Content-Type': 'application/json+protobuf',
            },
            body: JSON.stringify(
                [
                    [
                        texts,
                        "auto",
                        targetLang

                    ],
                    "te_lib"
                ]
            )
        });
        if (response.status !== 200) {
            console.error("Google Translate API error:", response.statusText);
            return Promise.resolve([]);
        }
        let data = await response.json()
        let result: TranslateResult[] = []
        if (!data || data.length < 2) {
            return Promise.resolve([])
        }
        // console.log('google translate data:', data)
        for (let i = 0; i < data?.[0].length; i++) {
            let translateText = data[0][i]
            translateText = convertAToBTags(translateText)
            result.push(new TranslateResult(translateText, data[1][i], 1))
        }
        // cache the result 5s

        // console.log('google translate result:', result)
        return result
    },
    async function (this: TranslationService, html: Array<HTMLElement>, targetLang: string, sourceLang?: string) {

        // hook google translate api
        // let result1: TranslatedElement[] = []
        // for (let i = 0; i < html.length; i++) {
        //     result1.push(new TranslatedElement("<p>test</p>", "en", targetLang, "1"))
        // }
        // // mock time delay
        // await new Promise(resolve => setTimeout(resolve, 300))
        // return Promise.resolve(result1)

        let tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
        let tagMapList: Map<string, string>[] = []
        let texts: string[] = []
        let translatedHtmlList: string[] = []
        for (let i = 0; i < html.length; i++) {
            tagMapList.push(new Map<string, string>())
            let originalElement = html[i]
            let originalHtml = originalElement.outerHTML
            let count = 0
            originalHtml = originalHtml.replace(tagRegex, (match, tagName) => {
                let key = `<${tagName} i=${count}>`
                count++
                // restore the original tag
                tagMapList[i].set(key, match)
                return key
            })
            texts.push(originalHtml)
            // console.log('originalHtml:', originalHtml)
        }
        let translatedTexts = await this.translateText(texts, targetLang, sourceLang)
        for (let i = 0; i < translatedTexts.length; i++) {
            let translatedHtml = translatedTexts[i]
            tagMapList[i].forEach((value, key) => {
                translatedHtml.translatedText = translatedHtml?.translatedText?.replace(key, value)
            })
            // translatedHtmlList.push(translatedHtml)
        }
        return Promise.resolve(translatedTexts)
    }
);
const maxRetry = 5
let gettingToken = false

export class TranslateResult {
    rawTranslatedText: string // like <b0>translated text</b0>
    sourceLang: string
    score: number
    originalSliceElement?: HTMLElement[]
    rawText?: string // like <b0>original text</b0>
    translatedText?: string // like <p>translated text</p>
    targetLang?: string
    textNodes?: Text[]

    constructor(rawTranslatedText: string, sourceLang: string, score: number, originalElement?: HTMLElement[], translatedText?: string, targetLang?: string, textNodes?: Text[]) {
        this.rawTranslatedText = rawTranslatedText;
        this.sourceLang = sourceLang;
        this.score = score;
        if (originalElement) {
            this.originalSliceElement = originalElement;
        }
        if (translatedText) {
            this.translatedText = translatedText;
        }
        if (targetLang) {
            this.targetLang = targetLang;
        }
        if (textNodes) {
            this.textNodes = textNodes;
        }
    }
}

function transferLanguageCode(language: string) {
    if (language == "zh-Hans") {
        return "zh-CN"
    }
    if (language == "zh-Hant") {
        return "zh-TW"
    }
    return language
}

let detectLanguageUrl = "https://api-edge.cognitive.microsofttranslator.com/detect?api-version=3.0"

async function refreshToken(service: TranslationService) {
    if (!service.authToken || service.authToken.token == "" || service.authToken.expireTime < Date.now()) {
        service.authToken = await sendMessageToBackground({
            action: ACTION.ACCESS_TOKEN_GET,
            data: { serviceName: service.serviceName }
        })
    }
}

export const microsoftTranslationService = new TranslationService(
    "microsoft",
    "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true&",
    "POST",
    new Token("", 0),
    "",
    // Translate text functions
    async function (this: TranslationService, text: Array<string>, targetLang: string, sourceLang?: string, options?: any) :Promise<TranslateResult[]> {
        // send request to background

        let url: string
        url = this.baseUrl + "to=" + targetLang;
        //token initialization
        // if (!this.authToken || this.authToken.token == "" || this.authToken.expireTime < Date.now()) {
        //     this.authToken = await sendMessageToBackground({action :ACTION.GET_ACCESS_TOKEN, data: {serviceName: this.serviceName}})
        // }
        await refreshToken(this)
        const response = await fetch(url, {
            method: this.requestMethod,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.authToken.token
            },
            body: JSON.stringify(
                text.map(t => ({ text: t }))
            )
        });
        // if the response status is 401, the token is invalid and the token is re-obtained
        if (response.status === 401) {
            options.retryCount++
            console.log('retryCount:', options.retryCount)
            if (options.retryCount > maxRetry) {
                return Promise.resolve([])
            }
            this.authToken = await sendMessageToBackground({
                action: ACTION.ACCESS_TOKEN_GET,
                data: { serviceName: this.serviceName }
            })
            return this.translateText(text, targetLang, sourceLang, options)

        }
        if (response.status !== 200) {
            console.error("Microsoft Translate API error:", response.statusText);
            return Promise.resolve([]);
        }
        let data = await response.json()
        return data?.map((d: {
            translations: { text: string }[],
            detectedLanguage: { language: string, score: number }
        }) => new TranslateResult(d.translations[0].text, transferLanguageCode(d.detectedLanguage.language), d.detectedLanguage.score));
    },
    async function (this: TranslationService, html: Array<HTMLElement>, targetLang: string, sourceLang?: string) {
        if (html.length == 0) {
            return Promise.resolve([])
        }
        // console.log('html:', html)
        html = html.map((ele) => {
            return ele.cloneNode(true) as HTMLElement
        })
        let texts: string[] = []
        let tagReplacer = new TagReplacer()

        for (let i = 0; i < html.length; i++) {
            let originalHtml = html[i]
            let originHtml = originalHtml.outerHTML
            // console.log('originHtml:', originHtml)
            // remove space and line break, only process the text between > and <
            originHtml = originHtml.replace(/>([^<]+)</sg, (match, p1) => {
                // Trim removes the left and right whitespace characters (including spaces and carriage returns) and retains a space in between
                // const cleanedText = p1.replace(/\s+/sg, ' ').trim();
                return `>${p1}<`;
            });
            let translatedHtml = tagReplacer.replaceTags(originHtml)
            texts.push(translatedHtml)
        }
        // console.log('texts:', texts)
        // @ts-ignore
        let translatedTexts = await this.translateBatchText(texts, targetLang, sourceLang)
        // let translatedHtmlList: string[] = []
        for (let i = 0; i < translatedTexts.length; i++) {
            let translatedElement = translatedTexts[i]
            if (translatedElement.translatedText) {
                let translatedHtml = tagReplacer.restoreTags(translatedElement.translatedText)
                let container = document.createElement("div")
                container.innerHTML = translatedHtml
                translatedElement.translatedText = container.innerHTML
            }
            // translatedHtmlList.push(container.innerHTML)
        }
        return Promise.resolve(translatedTexts)
    },
    async function (this: TranslationService, text: Array<string>, targetLang: string, sourceLang?: string) {
        if (text.length == 0) {
            return Promise.resolve([])
        }
        // limit the max characters of text to 4500 and the max elements of text to 900
        let texts: Array<Array<string>> = []
        let i = 0
        let limit = 0
        texts.push([])
        for (let t of text) {
            if (t.length > 4500) {
                t = t.substring(0, 4500)
            }
            limit += t.length
            i++
            if (limit > 4500 || i > 900) {
                texts.push([])
                limit = 0
                i = 0
                texts[texts.length - 1].push(t)
            } else {
                texts[texts.length - 1].push(t)
            }
        }

        const translationPromises = texts.map((text, index) => {
            // the returned results are guaranteed to contain the original index for subsequent sorting
            return this.translateText(text, targetLang, sourceLang, { retryCount: 0 }).then((translatedTexts: TranslateResult[]) => ({
                index,
                translatedTexts
            }));
        });

        // all translations are requested concurrently
        const translationResults = await Promise.all(translationPromises);

        // sort the results in the order of the original array
        const sortedResults = translationResults.sort((a, b) => a.index - b.index);

        // restore the sorted results
        let sortedList = sortedResults.map(result => result.translatedTexts)
        let result: TranslateResult[] = []
        for (let s of sortedList) {
            for (let ss of s) {
                result.push(ss)
            }
        }
        return Promise.resolve(result)
    },
    async function (this: TranslationService, text: Array<string>) {
        await refreshToken(this)
        const response = await fetch(detectLanguageUrl, {
            method: this.requestMethod,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.authToken.token
            },
            body: JSON.stringify(
                text.map(t => ({ text: t }))
            )
        });
        if (response.status !== 200) {
            return Promise.resolve("")
        }
        let data = await response.json()
        let detectLanguages = data.map((d: {
            language: string,
            score: number
        }) => {
            if (d.score > 0.5) {
                return d.language
            }
        });
        // find the most frequent language
        let languageMap = new Map<string, number>()
        for (let l of detectLanguages) {
            if (languageMap.has(l)) {
                languageMap.set(l, (languageMap.get(l) || 0) + 1)
            } else {
                languageMap.set(l, 1)
            }
        }
        let max = 0
        let maxLanguage = ""
        languageMap.forEach((value, key) => {
            if (value > max) {
                max = value
                maxLanguage = key
            }
        })
        maxLanguage = transferLanguageCode(maxLanguage)
        console.log('detectLanguage:', maxLanguage)
        return maxLanguage
    }
);

function getPreProcessResult(element: HTMLElement): { elements: HTMLElement[], text: string, deleteTextNodes: Text[] } {
    let i = 0
    let elements: HTMLElement[] = []
    let processParent: HTMLElement = document.createElement("div")
    let deleteTextNodes: Text[] = []
    let process = (node: Node, parent: HTMLElement) => {
        if (!node) {
            return
        }
        if (node.nodeType === 1) {
            // console.log(node.nodeName);
            let ele = node as HTMLElement
            let rootProcessedElement = document.createElement('b' + i)
            parent.appendChild(rootProcessedElement)
            elements.push(ele)
            i++
            let children = node.childNodes
            for (let child of children) {
                // console.log("child:" + child.nodeName);
                process(child, rootProcessedElement)
            }

        }
        if (node.nodeType === 3) {
            let textNode = node as Text
            if (textNode.textContent == "") {
                return
            }
            deleteTextNodes.push(textNode)
            parent.appendChild(textNode.cloneNode(true))
        }

    }

    process(element, processParent)
    return { elements: elements, text: processParent.innerHTML, deleteTextNodes: deleteTextNodes }
}

function updateTranslateElementContent(rawTranslatedHtml: string, originalElements: HTMLElement[]) {
    if (originalElements.length == 0 || rawTranslatedHtml == "") {
        return
    }
    let translatedElement = document.createElement('div')
    translatedElement.innerHTML = rawTranslatedHtml
    function translate(node: Node | null) {
        if (!node) {
            return
        }
        if (node.nodeType === 3) {
            let parent = node.parentElement
            if (!parent) {
                return
            }
            let num: number = parseInt(parent.tagName.replace("B", ""))
            if (isNaN(num) || num >= originalElements.length) {
                return
            }
            parent = originalElements[num]
            parent.appendChild(node.cloneNode(true))
            return
        }
        if (node.nodeType === 1) {
            let ele = node as HTMLElement
            let num: number = parseInt(ele.tagName.replace("B", ""))
            if (isNaN(num) || num >= originalElements.length) {
                return
            }
            let need = originalElements[num]
            if (need && need.textContent != "") {
                let clone = need.cloneNode(false) as HTMLElement
                clone.textContent = node.textContent || ""
                need.parentElement?.appendChild(clone)
                return
            }
            let children = node.childNodes
            for (let child of children) {
                translate(child)
            }
            let parent = ele.parentElement
            if (parent) {
                let num: number = parseInt(parent.tagName.replace("B", ""))
                if (isNaN(num) || num >= originalElements.length) {
                    return
                }
                parent = originalElements[num]
                if (parent) {
                    parent.appendChild(need)
                }
            }

        }
    }

    translate(translatedElement.firstElementChild)
    // console.log(originalElements[0].outerHTML);
}



export const translationServices = new Map<string, TranslationService>([
    // todo add more translation service, such as DeepL, Yandex, Youdao etc.
    // todo support user defined custom key and url
    [googleTranslationService.serviceName, googleTranslationService],
    [microsoftTranslationService.serviceName, microsoftTranslationService]
])

export function convertAToBTags(html: string): string {
    if (html == "") {
        return ""
    }
    let result = html.replace(/<a\s+i=(\d+)>/g, '<b$1>');

    result = result.replace(/<\/a>/g, '</b>');

    let openTags: string[] = [];
    let finalResult = '';

    for (let i = 0; i < result.length; i++) {
        if (result.substring(i, i + 2) === '<b') {
            const numEnd = result.indexOf('>', i);
            const tagNum = result.substring(i + 2, numEnd);
            openTags.push(tagNum);
            finalResult += `<b${tagNum}>`;
            i = numEnd;
        } else if (result.substring(i, i + 4) === '</b>') {
            const lastTag = openTags.pop() || '';
            finalResult += `</b${lastTag}>`;
            i += 3;
        } else {
            finalResult += result[i];
        }
    }

    // Handle moving content before <b0> tag
    let index = finalResult.indexOf("<b0>");
    if (index > 0) {
        let contentBefore = finalResult.substring(0, index);
        finalResult = finalResult.substring(index + 4);
        finalResult = `<b0>${contentBefore}${finalResult}`;
    }

    // Handle moving content after </b0> tag
    index = finalResult.indexOf("</b0>");
    if (index !== -1) {
        let contentAfter = finalResult.substring(index + 5);
        if (contentAfter) {
            finalResult = finalResult.substring(0, index) + contentAfter + "</b0>";
        }
    }

    // Fix nested b0 tags
    // finalResult = finalResult.replace(/<b0>([^<]*)<b0>/g, '<b0>$1');
    // finalResult = finalResult.replace(/><\/b0>/g, '>');

    return finalResult;
}

export async function getTranslateResult(service: string, elements: HTMLElement[], targetLang: string, viewStrategy: VIEW_STRATEGY): Promise<TranslateResult[]> {
    if (!elements || elements.length === 0) {
        return Promise.resolve([]);
    }
    let texts: string[] = []
    let sliceElements: HTMLElement[][] = []
    let deleteTextNodesList: Text[][] = []
    for (let i = 0; i < elements.length; i++) {
        let element = elements[i]
        let result = getPreProcessResult(element)
        let text = result.text
        texts.push(text)
        sliceElements.push(result.elements)
        deleteTextNodesList.push(result.deleteTextNodes)
    }

    let results = await translationServices.get(service)?.translateText(texts, targetLang)
    if (!results) {
        return []
    }
    for (let i = 0; i < results.length; i++) {
        let result = results[i]
        result.originalSliceElement = sliceElements[i]
        result.rawText = texts[i]
        if (viewStrategy == VIEW_STRATEGY.DOUBLE) {
            // we are merely handling the copy of element in the view strategy of DOUBLE, text nodes can be removed directly
            deleteTextNodesList[i]?.forEach(textNode => {
                textNode?.remove()
            })
        } else {
            // we need to keep text nodes because the element may not be translated in SINGLE strategy
            result.textNodes = deleteTextNodesList[i]
        }
    }
    return results
}

export async function translate(results: TranslateResult[]): Promise<void> {
    for (let i = 0; i < results.length; i++) {
        let result = results[i]
        updateTranslateElementContent(result.rawTranslatedText, result.originalSliceElement || [])
    }
}

export async function restore(results: TranslateResult[]): Promise<void> {
    for (let i = 0; i < results.length; i++) {
        let result = results[i]
        if (!result.rawText) {
            continue
        }
        updateTranslateElementContent(result.rawText, result.originalSliceElement || [])
    }
}