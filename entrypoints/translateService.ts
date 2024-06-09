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

class TranslationService {

    constructor(serviceName: string, baseUrl: string, requestMethod: string, authToken: Promise<string> | null, apiKey: string, translateText: TranslateText) {
        this.serviceName = serviceName;
        this.baseUrl = baseUrl;
        this.requestMethod = requestMethod;
        this.authToken = authToken;
        this.apiKey = apiKey;
        this.translateText = translateText.bind(this);
    }

    serviceName: string
    baseUrl: string
    requestMethod: string
    authToken: Promise<string> | null
    apiKey: string
    //request的配置
    translateText: TranslateText


}


export const googleTranslationService = new TranslationService(
    "google",
    "https://translation.googleapis.com/language/translate/v2?key=",
    "POST",
    null,
    "AIzaSyC_zDStMeRgutILdJuL_4xyQpEwawBrKw4",
    // 翻译文本函数
    async function (text: Array<string>, targetLang: string, sourceLang?: string) {
        // text都填充为已经翻译-- 用于模拟翻译
        text.fill("已经翻译", 0, text.length)
        return text
        //拼接url
        let url = this.baseUrl + this.apiKey;
        const response = await fetch(url, {
            method: this.requestMethod,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                q: text,
                sourceLang: sourceLang,
                target: targetLang
            })
        });
        let data = await response.json()
        // 取data中的translatedText,生成一个数组
        return data.data.translations.map(translation => translation.translatedText);

    }
);

export const microsoftTranslationService = new TranslationService(
    "microsoft",
    "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true&",
    "POST",
    null,
    "",
    // 翻译文本函数
    async function (text: Array<string>, targetLang: string, sourceLang?: string) {
        // text都填充为已经翻译-- 用于模拟翻译
        text.fill("已经翻译", 0, text.length)
        return text
        //拼接urlfrom=en&to=zh-CHS&
        let url: string
        if (sourceLang == undefined) {
            url = this.baseUrl + "to=" + targetLang;
        } else {
            url = this.baseUrl + "from=" + sourceLang + "&to=" + targetLang;
        }
        let tokenUrl = "https://edge.microsoft.com/translate/auth"
        //首先获取token
        if (!this.authToken) {
            console.log("get first token")
            this.authToken = fetch(tokenUrl).then(response => response.text());
        }
        const response = await fetch(url, {
            method: this.requestMethod,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + await this.authToken
            },
            body: JSON.stringify(
                text.map(t => ({text: t}))
            )
        });
        // 判断response的状态,如果为401,说明token失效,重新获取token
        if (response.status === 401) {
            this.authToken = fetch(tokenUrl).then(response => response.text());
            console.log("renew token")
            return this.translateText(text, targetLang, sourceLang)
        }
        let data = await response.json()
        // // 取data中的translatedText,生成一个数组
        return data.map((d: {
            translations: { text: string }[]
        }) => d.translations.map(translation => translation.text));
    }
);

export const translationServices = new Map<string, TranslationService>([
    [googleTranslationService.serviceName, googleTranslationService],
    [microsoftTranslationService.serviceName, microsoftTranslationService]
])

