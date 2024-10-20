import {getConfig, setConfig} from "@/utils/db";
import {CONFIG_KEY} from "@/entrypoints/constants";

export default defineUnlistedScript(
    () => {
    }
)

export class translateParams {
    serviceName: string
    sourceLang?: string
    targetLang: string

    constructor(serviceName: string, targetLang: string, sourceLang?: string,) {
        this.serviceName = serviceName;
        if (sourceLang !== undefined && sourceLang !== null) {
            this.sourceLang = sourceLang;
        }
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
    }
}

interface TranslateText {
    (text: Array<string>, targetLang: string, sourceLang?: string): Promise<Array<string>>;
}

interface TranslateHtml {
    (html: Array<HTMLElement>, targetLang: string, sourceLang?: string): Promise<Array<string>>;
}

interface TranslateBatchText {
    (text: Array<string>, targetLang: string, sourceLang?: string): Promise<Array<string>>;
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
                const currentTag = {match, tagName, index: this.tagCounter};
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

    constructor(serviceName: string, baseUrl: string, requestMethod: string, authToken: string, apiKey: string, translateText: TranslateText, translateHtml?: TranslateHtml, translateBatchText?: TranslateBatchText) {
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
    }

    serviceName: string
    baseUrl: string
    requestMethod: string
    authToken: string
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
    "",
    "",
    async function (this: TranslationService, text: Array<string>, targetLang: string, sourceLang?: string) {
        if (text.length == 0) {
            return Promise.resolve([])
        }
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
                        text,
                        "auto",
                        targetLang

                    ],
                    "te_lib"
                ]
            )
        });
        let data = await response.json()
        // console.log('google translate data:', data)
        return data[0]
    },
    async function (this: TranslationService, html: Array<HTMLElement>, targetLang: string, sourceLang?: string) {
        let tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
        let tagMapList :Map<string, string>[] = []
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
                translatedHtml = translatedHtml.replace(key, value)
            })
            translatedHtmlList.push(translatedHtml)
        }
        return Promise.resolve(translatedHtmlList)
    }
);
let retryCount = 0
let maxRetryCount = 3
export const microsoftTranslationService = new TranslationService(
    "microsoft",
    "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true&",
    "POST",
    "",
    "",
    // Translate text functions
    async function (this: TranslationService, text: Array<string>, targetLang: string, sourceLang?: string) {
        let url: string
        if (sourceLang == undefined) {
            url = this.baseUrl + "to=" + targetLang;
        } else {
            url = this.baseUrl + "from=" + sourceLang + "&to=" + targetLang;
        }
        let tokenUrl = "https://edge.microsoft.com/translate/auth"
        //token initialization
        if (!this.authToken) {
            console.log("get first token")
            // get token, firstly by db and then by fetch
            let token = await getConfig(CONFIG_KEY.MICROSOFT_TOKEN)
            if (!token || token == "") {
                token = await fetch(tokenUrl).then(response => response.text());
                console.log('fetch token:', token)
                await setConfig(CONFIG_KEY.MICROSOFT_TOKEN, token)
            }
            this.authToken = token
        }
        const response = await fetch(url, {
            method: this.requestMethod,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.authToken
            },
            body: JSON.stringify(
                text.map(t => ({text: t}))
            )
        });
        // if the response status is 401, the token is invalid and the token is re-obtained
        if (response.status === 401) {
            maxRetryCount--
            if (maxRetryCount < 0) {
                maxRetryCount = 3
                return Promise.resolve([])
            }
            if (retryCount < 1) {
                // first time try to get token from db
                this.authToken = await getConfig(CONFIG_KEY.MICROSOFT_TOKEN)
                retryCount++
                return this.translateText(text, targetLang, sourceLang)
            }else {
                // second time try to get token from fetch
                let token = await fetch(tokenUrl).then(response => response.text());
                await setConfig(CONFIG_KEY.MICROSOFT_TOKEN, token)
                this.authToken = token
                retryCount = 0
                return this.translateText(text, targetLang, sourceLang)
            }

        }
        let data = await response.json()
        return data.map((d: {
            translations: { text: string }[]
        }) => d.translations[0].text);
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
            // remove space and line break, only process the text between > and <
            originHtml = originHtml.replace(/>([^<]+)</sg, (match, p1) => {
                // Trim removes the left and right whitespace characters (including spaces and carriage returns) and retains a space in between
                const cleanedText = p1.replace(/\s+/sg, ' ').trim();
                return `>${cleanedText}<`;
            });
            let translatedHtml = tagReplacer.replaceTags(originHtml)
            texts.push(translatedHtml)
        }
        // console.log('texts:', texts)
        // @ts-ignore
        let translatedTexts = await this.translateBatchText(texts, targetLang, sourceLang)
        let translatedHtmlList: string[] = []
        for (let i = 0; i < translatedTexts.length; i++) {
            let translatedHtml = tagReplacer.restoreTags(translatedTexts[i])
            let container = document.createElement("div")
            container.innerHTML = translatedHtml
            translatedHtmlList.push(container.innerHTML)
        }
        return Promise.resolve(translatedHtmlList)
    },
    async function (this: TranslationService, text: Array<string>, targetLang: string, sourceLang?: string) {
        if (text.length == 0) {
            return Promise.resolve([])
        }
        // limit the max characters of text to 4500 and the max elements of text to 900
        let texts :Array<Array<string>> = []
        let i = 0
        let limit = 0
        texts.push([])
        for (let t of text) {
            if (t.length > 4500) {
                t = t.substring(0, 4500)
            }
            limit += t.length
            i ++
            if (limit > 4500 || i > 900) {
                texts.push([])
                limit = 0
                i = 0
                texts[texts.length - 1].push(t)
            }else {
                texts[texts.length - 1].push(t)
            }
        }

        const translationPromises = texts.map((text, index) => {
            // the returned results are guaranteed to contain the original index for subsequent sorting
            return this.translateText(text,targetLang,sourceLang).then(translatedText => ({
                index,
                translatedText
            }));
        });

        // all translations are requested concurrently
        const translationResults = await Promise.all(translationPromises);

        // sort the results in the order of the original array
        const sortedResults = translationResults.sort((a, b) => a.index - b.index);

        // restore the sorted results
        let sortedList = sortedResults.map(result => result.translatedText)
        let result :string[] = []
        for (let s of sortedList) {
            for (let ss of s) {
                result.push(ss)
            }
        }
        return Promise.resolve(result)
    }
);

export const translationServices = new Map<string, TranslationService>([
    // todo add more translation service, such as DeepL, Yandex, Youdao etc.
    // todo support user defined custom key and url
    [googleTranslationService.serviceName, googleTranslationService],
    [microsoftTranslationService.serviceName, microsoftTranslationService]
])

