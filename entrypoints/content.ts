import {browser} from "wxt/browser";
import {isTraditionalChinese, sendMessageToBackground} from "@/entrypoints/utils";
import {split} from "sentence-splitter"
import {
    ACTION,
    CONFIG_KEY,
    DB_ACTION,
    DOMAIN_STRATEGY, EXCLUDE_TAGS, excludedTagSet,
    iso6393To1, iso6393To1Map,
    STORAGE_ACTION, svgAddCursor, svgTrashCursor,
    TB_ACTION,
    TRANS_ACTION,
    TRANS_SERVICE,
    VIEW_STRATEGY
} from "@/entrypoints/constants";
import translateService, {
    TranslatedElement,
    translateParams,
    translationServices
} from "@/entrypoints/translateService";
import {getCssSelector} from 'css-selector-generator';
import {getConfig} from "@/utils/db";
import {franc} from "franc-min";
import Heap from "heap";


// import {Mutex} from "async-mutex";

class LanguageScore {
    public language: string;
    public score: number;

    constructor(language: string, score: number) {
        this.language = language;
        this.score = score;
    }
}

// const mutex = new Mutex();

class ParagraphElementTool {
    private totalScore: number
    private allParagraphElements: Map<HTMLElement, LanguageScore>
    private languageScoreMap: Map<string, LanguageScore>;
    private paragraphElementHeap: Heap<LanguageScore>;
    private encoder: TextEncoder;

    constructor() {
        this.totalScore = 0
        this.languageScoreMap = new Map();
        this.paragraphElementHeap = new Heap((a: LanguageScore, b: LanguageScore) => b.score - a.score);
        this.allParagraphElements = new Map()
        this.encoder = new TextEncoder()
    }

    hasParagraphElement(element: HTMLElement) {
        return this.allParagraphElements.has(element)
    }

    update(element: HTMLElement, lang?: string) {
        let exist = this.allParagraphElements.get(element)
        if (!lang) {
            lang = this.detectParagraphLanguage(element);
        }
        if (exist) {

            if (exist.language != lang) {
                this.updateLanguageScore(exist.language, -exist.score)
                this.updateLanguageScore(lang, exist.score)
                this.allParagraphElements.set(element, new LanguageScore(lang, exist.score))
            }
        } else {
            let len = this.getElementTextLength(element)
            this.allParagraphElements.set(element, new LanguageScore(lang, len))
            this.updateLanguageScore(lang, len)
        }
    }

    remove(element: HTMLElement) {
        let exist = this.allParagraphElements.get(element)
        if (exist) {
            this.updateLanguageScore(exist.language, -exist.score)
            this.allParagraphElements.delete(element)
        }
    }

    detectParagraphLanguage(element: HTMLElement) {
        let text = element.textContent
        if (!text) {
            return "und"
        }
        let lang = franc(text, {minLength: 5})
        if (lang == "cmn") {
            if (isTraditionalChinese(text)) {
                lang = 'zh-TW'
            } else {
                lang = 'zh-CN'
            }
        } else {
            lang = iso6393To1Map.get(lang) || "und"
        }
        // element.setAttribute("duo-lang", lang)
        return lang;
    }

    updateLanguageScore(language: string, changedScore: number) {
        if (language == "de") {
            console.log('updateLanguageScore:', language, changedScore)
        }
        // const release = await mutex.acquire();
        // try {
        let l = this.languageScoreMap.get(language)
        if (l) {
            this.totalScore += changedScore
            l.score += changedScore
            // this.paragraphElementHeap.updateItem(l)
            this.paragraphElementHeap.heapify()
        } else {
            let l = new LanguageScore(language, changedScore)
            this.totalScore += l.score
            this.languageScoreMap.set(language, l)
            this.paragraphElementHeap.push(l)
        }
        // } finally {
        //     release()
        // }
        console.log('heap:', this.paragraphElementHeap.toArray(), this.getMaxLanguage(), this.getMaxProportion())

    }

    getMaxLanguage() {
        if (this.getMaxProportion() >= 0.6) {
            return this.paragraphElementHeap.peek()?.language || "und"
        } else {
            return "und"
        }
    }

    getMaxProportion() {
        // const release = await mutex.acquire();
        // try {
        //     let total = 0
        //     let t = this.heap.peek()?.score || 0
        //     for (let i = this.heap.toArray().length - 1; i >= 0; i--) {
        //         total += this.heap.toArray()[i].score
        //     }
        //     return {a: t / total, b: this.heap.toArray()}
        // } finally {
        //     release()
        // }
        let peek = this.paragraphElementHeap.peek()
        // console.log('peek:', this.paragraphElementHeap.toArray(), peek)
        if (peek && this.totalScore > 0) {
            return (peek.score || 0) / this.totalScore
        } else {
            return 0
        }
    }

    getByteLength(str: string | undefined | null) {
        if (!str) {
            return 0
        }
        return this.encoder.encode(str.trim()).length
    }

    getElementTextLength(element: HTMLElement): number {
        let text = "";

        function traverse(node: Node) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent || ""; // 获取文本节点内容
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (excludedTagSet.has(node.nodeName.toLowerCase())) {
                    return;
                }
                // 递归处理子元素
                for (let child of node.childNodes) {
                    traverse(child);
                }
            }
        }

        traverse(element);
        return this.getByteLength(text); // 计算字节长度
    }

}

export default defineContentScript({
    // matches: ['<all_urls>'],
    matches: ['https://*/*', 'http://*/*'],
    cssInjectionMode: 'manual',
    async main(ctx) {
        // get the id of the current tab,which used unique defines the page
        let tabId = await sendMessageToBackground({action: TB_ACTION.ID_GET})
        if (!tabId) {
            return
        }
        // Get the domain name and port of the current page
        let currentUrl = window.location.href;
        const domain = getDomainFromUrl(currentUrl);
        const domainWithPort = getDomainWithPortFromUrl(currentUrl);
        if (domainWithPort == null) {
            return
        }
        let paragraphElementTool = new ParagraphElementTool()
        let translateStatus = false
        let manualTranslateTrigger = false
        const ignoreMutationElements = new WeakSet();
        let translatedOriginalMap = new Map<HTMLElement, HTMLElement>()
        // get all config from storage
        let [ruleStrategy, viewStrategy, targetLanguage, translateService, globalSwitch, defaultStrategy, rawDomainStrategy]
            : [string[], string, string, string, boolean, string, any] = await Promise.all(
            [
                listRuleFromDB(),
                getConfig(CONFIG_KEY.VIEW_STRATEGY),
                getConfig(CONFIG_KEY.TARGET_LANGUAGE),
                getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.GLOBAL_SWITCH),
                getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
                sendMessageToBackground({action: DB_ACTION.DOMAIN_GET, data: {domain: domainWithPort}})
            ]
        )
        viewStrategy = viewStrategy || VIEW_STRATEGY.DOUBLE
        globalSwitch = globalSwitch === null ? true : globalSwitch
        translateService = translateService || TRANS_SERVICE.MICROSOFT
        targetLanguage = targetLanguage || navigator.language
        defaultStrategy = defaultStrategy || DOMAIN_STRATEGY.AUTO
        let domainStrategy = (rawDomainStrategy?.strategy || DOMAIN_STRATEGY.AUTO) as string
        let allParagraphElementSet = new Map<HTMLElement, LanguageScore>()
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
        // record the elements before translated, for show original
        let originalElementRecords: HTMLElement[] = []
        let translateElementRecords: HTMLElement[] = []
        // collect all the paragraph elements, by the way add duo-paragraph class
        ruleStrategyProcess(ruleStrategy)
        // console.log(document.body.innerHTML)
        // }
        // let pageLanguage = detectLanguageByFranc()
        // console.log('domain:', domain, 'pageLanguage:', pageLanguage)
        let tabTranslateStatusKey = "tabTranslateStatus#" + tabId
        console.log("tabId: ", tabId)
        switch (domainStrategy) {
            case DOMAIN_STRATEGY.NEVER:
                await setPersistTranslateStatus(false)
                break
            case DOMAIN_STRATEGY.ALWAYS:
                await setPersistTranslateStatus(true)
                break
            case DOMAIN_STRATEGY.AUTO:
                if (defaultStrategy == DOMAIN_STRATEGY.NEVER) {
                    await setPersistTranslateStatus(false)
                } else if (defaultStrategy == DOMAIN_STRATEGY.ALWAYS) {
                    await setPersistTranslateStatus(true)
                }
                break
        }
        let htmlElements = markParagraphElement(document.body, undefined, [], false, 0, 100);
        await translateParagraphElements(htmlElements)
        let timer: number | null = null
        let translateElements: Set<HTMLElement> = new Set()
        // observe the dom change, translate the new added elements
        let observer = new MutationObserver(async mutations => {
            mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        if (mutation.target.nodeType != 1) {
                            return;
                        }
                        // 监听子节点的添加或删除
                        // 检查删除的节点
                        mutation.removedNodes.forEach((removedNode) => {
                            //
                            if (removedNode.nodeType == 1) {
                                let element = removedNode as HTMLElement;
                                // console.log('remove element:', element)
                                if (element.classList.contains("duo-paragraph")) {
                                    paragraphElementTool.remove(element);
                                    translatedOriginalMap.delete(element);
                                } else {
                                    element.querySelectorAll(".duo-paragraph").forEach((ele) => {
                                        if (ele.nodeType == 1) {
                                            let element = ele as HTMLElement;
                                            paragraphElementTool.remove(element) // 这一行必须要有
                                            translatedOriginalMap.delete(element)
                                        }
                                    });
                                }
                            }

                        });
                        let parent = mutation.target as HTMLElement;
                        if (ignoreMutationElements.has(parent)) {
                            console.log('ignore mutation:', parent);
                            return;
                        }
                        // console.log('parent mutation:', parent, mutation.type)
                        let collect = markParagraphElement(parent, undefined, [], true);
                        // let collect = []
                        if (collect.length > 0) {
                            translateElements.add(parent);
                        } else {
                            mutation.addedNodes.forEach((addedNode) => {
                                if (addedNode.nodeType == 1 && addedNode instanceof HTMLElement) {
                                    let element = addedNode as HTMLElement;
                                    if (ignoreMutationElements.has(element)) {
                                        return;
                                    }
                                    markParagraphElement(element, undefined, [], false, 0, 100).forEach((ele) => {
                                        translateElements.add(ele);
                                    });
                                }
                            });
                        }
                        if (translateElements.size >= 50) {
                            if (timer !== null) {
                                clearTimeout(timer);
                                timer = null;
                            }
                            translateParagraphElements(Array.from(translateElements), {hasDuplicated: true});
                            translateElements = new Set();
                        } else if (timer === null) {
                            // 如果还没有定时器，则启动一个定时器，最多等待 timeoutLimit 毫秒
                            timer = window.setTimeout(() => {
                                if (timer !== null) {
                                    clearTimeout(timer);
                                    timer = null;
                                }
                                translateParagraphElements(Array.from(translateElements), {hasDuplicated: true});
                                translateElements = new Set();
                            }, 50);
                        }
                        setTranslateStatusByTranslatedElement()


                    } else if (mutation.type === 'characterData') {
                        // 监听文本内容的变化
                        console.log('Text content changed:', mutation.target);
                        // if (mutation.target.nodeType == 1) {
                        //     let element = mutation.target as HTMLElement
                        //     markParagraphElement(element)
                        // }
                    }


                    // let element = mutation.target as HTMLElement
                    // if (!(element instanceof HTMLElement)) {
                    //     return
                    // }
                    // // if (element.textContent == "Prerequisites") {
                    // //     console.log('Prerequisites mutation:', element, mutation.type)
                    // // }
                    // markParagraphElement(element)
                    // // console.log('mutation:', mutation, 'translateStatus:', translateStatus)
                    // // todo
                    // if (translateStatus) {
                    //     translateRoot(element)
                    // }
                    // return;
                    // if (ele.textContent=="Prerequisites") {
                    //     console.log('Prerequisites mutation:', ele,mutation.type)
                    // }
                    // }
                    // console.log('mutation root:', mutation)
                }
            );
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            // characterData: true,// text content change
            // attributes: true,
            // characterDataOldValue: true,
            // attributeOldValue: true
        });

        // set translate status true when the page has a translated element, otherwise set false
        async function setTranslateStatusByTranslatedElement() {
            if (translatedOriginalMap.size == 0) {
                if (translateStatus) {
                    try {
                        await setSessionStorage(tabTranslateStatusKey, false)
                        translateStatus = false
                    } finally {
                    }
                }
            } else {
                if (!translateStatus) {
                    try {
                        await setSessionStorage(tabTranslateStatusKey, true)
                        translateStatus = true
                    } finally {
                    }
                }
            }
        }


        // setTimeout(() => {
        //     observer.disconnect()
        // },8)

        const getCssSelectorString = (ele: HTMLElement): string => {
            // ignore the elements with class start with duo
            return getCssSelector(ele, {selectors: ["id", "class", "tag"], blacklist: ['.duo-*']})
        }

        // Convert the SVG to Base64
        const svgAddBase64 = btoa(svgAddCursor);
        const svgTrashBase64 = btoa(svgTrashCursor);

        // Create a data URL for the cursor
        const cursorAddUrl = `url('data:image/svg+xml;base64,${svgAddBase64}'), auto`;
        const cursorTrashUrl = `url('data:image/svg+xml;base64,${svgTrashBase64}'), auto`;

        // set rule mode css style
        let ruleModeStyle = document.createElement('style') as HTMLStyleElement
        ruleModeStyle.id = "rule-mode-style"
        ruleModeStyle.innerText += ".duo-selected {outline: 2px solid yellow !important;}"
        document.head.appendChild(ruleModeStyle)
        await processStyleChangeAction()

        async function translateWholePage(manualTrigger: boolean) {
            if (manualTrigger) {
                manualTranslateTrigger = true
                await setPersistTranslateStatus(true)
            }
            let elements = document.querySelectorAll(".duo-needs-translate")
            let elementsArray = Array.from(elements) as HTMLElement[]
            await translateParagraphElements(elementsArray)
        }

        async function setPersistTranslateStatus(status: boolean) {
            await setSessionStorage(tabTranslateStatusKey, status).then(() => {
                translateStatus = status
            })
        }

        document.addEventListener('contextmenu', (event) => {
            sendMessageToBackground({action: TB_ACTION.CONTEXT_MENU_SHOW, data: tabId})
        });
        // Accept messages from popups, process the task
        browser.runtime.onMessage.addListener(async (message, sender, sendResponse: (t: any) => void) => {
            console.log('content script receive message:', message)
            let params: translateParams
            switch (message.action) {
                case TRANS_ACTION.TRANSLATE:
                    // await translateRoot(document.body)
                    console.log('translate page')
                    await translateWholePage(true)
                    break
                case TRANS_ACTION.ORIGIN:
                    console.log('show original')
                    manualTranslateTrigger = true
                    await setPersistTranslateStatus(false)
                    // restore original page
                    await showOriginalPage()
                    break
                case TRANS_ACTION.DOUBLE:
                case TRANS_ACTION.SINGLE:
                    break
                case TRANS_ACTION.TOGGLE:
                    toggleTranslateStatus()
                    break
                case ACTION.TOGGLE_SELECTION_MODE:
                    await toggleSelectionMode()
                    break
                case ACTION.LEAVE_SELECTION_MODE:
                    deactivateSelectionMode()
                    break
                case ACTION.STYLE_CHANGE:
                    // process style change action
                    console.log("process style change action")
                    await processStyleChangeAction()
                    break
                case ACTION.DOMAIN_STRATEGY_CHANGE:
                    console.log('aaaa:', message)
                    if (message && message.data && typeof message.data === "string") {
                        domainStrategy = message.data || DOMAIN_STRATEGY.AUTO
                        switch (domainStrategy) {
                            case DOMAIN_STRATEGY.AUTO:
                                switch (defaultStrategy) {
                                    case DOMAIN_STRATEGY.AUTO:
                                        manualTranslateTrigger = false
                                        if (!translateStatus) {
                                            await translateWholePage(false)
                                            return translateStatus
                                        } else {
                                            let pageLang = paragraphElementTool.getMaxLanguage()
                                            if (pageLang == "und") {
                                                await restoreOriginalPage(false)
                                                await translateWholePage(false)
                                                return translateStatus
                                            } else {
                                                if (targetLanguage == paragraphElementTool.getMaxLanguage()) {
                                                    await restoreOriginalPage(true)
                                                    return translateStatus
                                                }
                                                return true
                                            }
                                        }
                                    case DOMAIN_STRATEGY.NEVER:
                                        if (translateStatus) {
                                            await restoreOriginalPage(true)
                                        }
                                        return false
                                    case DOMAIN_STRATEGY.ALWAYS:
                                        if (!translateStatus) {
                                            await setPersistTranslateStatus(true)
                                            await translateWholePage(false)
                                        }
                                        return true
                                }
                                break
                            case DOMAIN_STRATEGY.NEVER:
                                console.log('bbb:', translateStatus)
                                if (translateStatus) {
                                    await restoreOriginalPage(true)
                                }
                                return false
                            case DOMAIN_STRATEGY.ALWAYS:
                                if (!translateStatus) {
                                    await setPersistTranslateStatus(true)
                                    await translateWholePage(false)
                                }
                                return true
                        }


                    }
                    break
                case ACTION.TRANSLATE_CHANGE:
                    console.log('translate change:', message.data)
                    let service = message.data.service as string
                    if (service && service != "") {
                        translateService = service
                    }
                    if (message.active) {
                        await restoreOriginalPage()
                        await translateRoot(document.body)
                    }

                    // restore original page
                    // observer.disconnect()
                    // await restoreOriginalPage()
                    // await translateRoot(document.body)
                    // document.body.innerHTML = domContent
                    break
                case ACTION.DEFAULT_STRATEGY_CHANGE:
                    if (typeof message.data === "string") {
                        defaultStrategy = message.data
                    }
                    switch (defaultStrategy) {
                        case DOMAIN_STRATEGY.AUTO:
                            manualTranslateTrigger = false
                            if (!translateStatus) {
                                await translateWholePage(false)
                            }
                            console.log('default strategy:', translateStatus)
                            return translateStatus;
                        case DOMAIN_STRATEGY.NEVER:
                            if (translateStatus) {
                                await restoreOriginalPage(true)
                            }
                            return false
                        case DOMAIN_STRATEGY.ALWAYS:
                            if (!translateStatus) {
                                await setPersistTranslateStatus(true)
                                await translateWholePage(false)
                            }
                            return true
                        default:
                            break

                    }
                    break
                case ACTION.GLOBAL_SWITCH_CHANGE:
                    console.log('global switch change:', message.data)
                    if (typeof message.data === "boolean") {
                        console.log('global switch:', message.data)
                        globalSwitch = message.data
                        if (!message.active) {
                            return
                        }
                        if (!globalSwitch) {
                            await restoreOriginalPage()
                            return false
                        } else {
                            return translatePage()
                        }
                    }
                    // return undefined
                    // process the global switch change
                    break
                case ACTION.VIEW_STRATEGY_CHANGE:
                    if (message.data && message.data != "") {
                        viewStrategy = message.data
                    }
                    if (!message.active || !globalSwitch) {
                        return
                    }
                    // process the view strategy change
                    await restoreOriginalPage(false)
                    return translatePage()
                    // if (viewStrategy == VIEW_STRATEGY.DOUBLE) {
                    //    if (translateStatus) {
                    //         await restoreOriginalPage(false)
                    //         await translatePage()
                    //    }
                    //
                    // }else if (viewStrategy == VIEW_STRATEGY.SINGLE) {
                    //     if (translateStatus) {
                    //         await restoreOriginalPage(false)
                    //         await translatePage()
                    //     }
                    // }
                    break
                case ACTION.TARGET_LANG_CHANGE:
                    if (message.data && message.data != "") {
                        targetLanguage = message.data
                    }
                    // process the target language change
                    break
                default:
                    break
            }
        });

        function logIfCondition(prefix: string | null, msg: string | null, condition: boolean) {
            // get caller function name
            if (condition) {
                // let callerName = logIfCondition.caller.name
                console.log('callerName:,', "callerName", 'prefix:', prefix || "", 'msg:', msg || "")
            }
        }

        async function getGlobalSwitch() {
            let globalSwitch = await getConfig(CONFIG_KEY.GLOBAL_SWITCH)
            return globalSwitch === null ? true : globalSwitch
        }

        /**
         * restore the original page
         * @param setStatus set the translation status to false and persist to storage
         */
        async function restoreOriginalPage(setStatus: boolean = true) {
            if (setStatus) {
                try {
                    await setSessionStorage(tabTranslateStatusKey, false)
                    translateStatus = false
                } finally {
                }
            }
            console.log('restore original page', originalElementRecords, translateElementRecords)
            // for (let i = 0; i < translateElementRecords.length; i++) {
            //     let ele = translateElementRecords[i]
            //     let originalEle = originalElementRecords[i]
            //     if (ele && originalEle) {
            //         ele.innerHTML = originalEle?.innerHTML
            //         ele.removeAttribute("duo-no-observer")
            //         ele.classList.remove("duo-translated")
            //     }
            // }
            for (let element of translatedOriginalMap) {
                let [translatedElement, originalElement] = element
                ignoreMutationElements.add(translatedElement)
                translatedElement.innerHTML = originalElement.innerHTML
                translatedElement.removeAttribute("duo-no-observer")
                translatedElement.classList.remove("duo-translated")
                translatedOriginalMap.delete(translatedElement)
            }
            Promise.resolve().then(() => {
                for (let element of translatedOriginalMap) {
                    ignoreMutationElements.delete(element?.[0])
                }
            })
            // to prevent record residual
            originalElementRecords = []
            translateElementRecords = []
            // height and line limit restore
            let heightBreakElements = document.querySelectorAll(".duo-height-break")
            for (let heightBreakElement of heightBreakElements) {
                let element = heightBreakElement as HTMLElement
                element.style.maxHeight = element.getAttribute("duo-max-height") || ""
                element.removeAttribute("duo-max-height")
                element.classList.remove("duo-height-break")
            }
            let lineBreakElements = document.querySelectorAll(".duo-line-break")
            for (let lineBreakElement of lineBreakElements) {
                let element = lineBreakElement as HTMLElement
                element.style.setProperty("-webkit-line-clamp", element.getAttribute("duo-webkit-line-clamp") || "")
                element.removeAttribute("duo-webkit-line-clamp")
                element.classList.remove("duo-line-break")
            }
        }

        async function setSessionStorage(key: string, value: any) {
            await sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_SET,
                data: {key: key, value: value}
            })
        }

        async function getSessionStorage(key: string) {
            return sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_GET,
                data: {key: key}
            })
        }

        async function detectLanguage() {
            // select 20 paragraph element randomly to detect the language
            let paragraphElements = document.querySelectorAll('.duo-paragraph')
            let paragraphList: string[] = []
            for (let paragraphElement of paragraphElements) {
                if (paragraphElement && paragraphElement.textContent && paragraphElement.textContent.trim() !== "") {
                    let text = paragraphElement.textContent
                    // judge if valid paragraph, such as pure number or pure symbol
                    if (text.match(/^[0-9\s]*$/)) {
                        continue
                    }
                    paragraphList.push(paragraphElement.textContent.trim())
                }
            }
            let randomParagraphs = paragraphList.sort(() => 0.5 - Math.random()).slice(0, 20)
            return translationServices.get(TRANS_SERVICE.MICROSOFT)?.detectLanguage?.(randomParagraphs)
        }

        function detectLanguageByFranc() {
            let paragraphElements = document.querySelectorAll('.duo-paragraph')
            let paragraphList: string[] = []
            for (let paragraphElement of paragraphElements) {
                if (paragraphElement && paragraphElement.textContent && paragraphElement.textContent.trim() !== "") {
                    let text = paragraphElement.textContent
                    // judge if valid paragraph, such as pure number or pure symbol
                    if (text.match(/^[0-9\s]*$/)) {
                        continue
                    }
                    // remove \n \t \r
                    paragraphList.push(paragraphElement.textContent.trim().replace(/\s+/g, ' '))
                }
            }
            // get the longest 10 paragraphs
            let randomParagraphs = paragraphList.sort((a, b) => b.length - a.length).slice(0, 10)
            // use franc to detect the language
            let detectLanguage: string[] = []
            for (let randomParagraph of randomParagraphs) {
                let lang = franc(randomParagraph)
                // judge if maxLang is simplified  Chinese or traditional Chinese
                if (lang == "und") {
                    continue
                }
                if (lang == 'cmn') {
                    if (isTraditionalChinese(randomParagraph)) {
                        lang = 'zh-TW'
                    } else {
                        lang = 'zh-CN'
                    }
                } else {
                    lang = iso6393To1Map.get(lang) || ""
                    if (lang == "") {
                        continue
                    }
                }

                detectLanguage.push(lang)
            }

            // get the most common language
            let counts: { [key: string]: number } = {};
            if (detectLanguage.length < 5) {
                return ""
            }
            detectLanguage.forEach(function (i) {
                counts[i] = (counts[i] || 0) + 1;
            });
            let maxCount = 0;
            let maxLang = '';
            for (let key in counts) {
                if (counts[key] > maxCount) {
                    maxCount = counts[key];
                    maxLang = key;
                }
            }
            console.log('detectLanguage:', detectLanguage, 'randomParagraphs:', randomParagraphs, 'maxLang:', maxLang, 'proportion:', maxCount / detectLanguage.length)
            if (maxCount / detectLanguage.length >= 0.7) {
                return maxLang
            } else {
                return ""
            }
        }

        // translate body then set the translation status to true
        // not return the actual translate status
        async function translateBody(setStatus: boolean = true) {
            await translateRoot(document.body)
            if (setStatus) {
                await setSessionStorage(tabTranslateStatusKey, true)
                translateStatus = true
            }
            return true
        }

        function detectPageLanguage() {
            // let allElements = document.querySelectorAll(".duo-paragraph");
            // for (let element of allElements) {
            //
            // }
            // let langCountMap = new Map<string, number>()
            // let totalTextLen = 0
            // let count = 0
            // for (let htmlElement of allParagraphElementSet) {
            //     if (document.contains(htmlElement)) {
            //         count++
            //     } else {
            //         console.log('element not in document:', htmlElement)
            //     }
            //     let textLen = htmlElement.textContent?.length || 0
            //     totalTextLen += textLen
            //     let lang = htmlElement.getAttribute("duo-lang")
            //     if (lang) {
            //         if (langCountMap.has(lang)) {
            //             langCountMap.set(lang, (langCountMap.get(lang) || 0) + textLen)
            //         } else {
            //             langCountMap.set(lang, textLen)
            //         }
            //     }
            // }
            // let maxCount = 0
            // let maxLang = ""
            // langCountMap.forEach((value, key) => {
            //     if (value > maxCount) {
            //         maxCount = value
            //         maxLang = key
            //     }
            // })
            // console.log('detectPageLanguage:', langCountMap, 'maxLang:', maxLang, 'maxCount:', maxCount, 'totalTextLen:', totalTextLen, 'proportion:', maxCount / totalTextLen, 'allParagraphElementSet size:', allParagraphElementSet.size, 'count:', count)
            // // if (maxCount/totalTextLen >= 0.7) {
            // //     return maxLang
            // // }
            // return maxLang
        }

        // function detectPageLanguageScore() {
        //     let scoreMap = new Map<string, number>()
        //     let totalScore = 0
        //     for (let htmlElement of allParagraphElementSet) {
        //         let lang = htmlElement[0].getAttribute("duo-lang")
        //         let len = getByteLength(htmlElement[0].textContent)
        //         totalScore += len
        //         if (lang) {
        //             if (scoreMap.has(lang)) {
        //                 scoreMap.set(lang, (scoreMap.get(lang) || 0) + len)
        //             } else {
        //                 scoreMap.set(lang, len)
        //             }
        //         }
        //     }
        //     let maxScore = 0
        //     let maxLang = ""
        //     scoreMap.forEach((value, key) => {
        //         if (value > maxScore) {
        //             maxScore = value
        //             maxLang = key
        //         }
        //     })
        //     return {lang: maxLang, score: maxScore / totalScore}
        // }

        async function translatePage() {
            console.log("translatePage:", allParagraphElementSet)
            if (domainStrategy == DOMAIN_STRATEGY.ALWAYS) {
                await translateBody()
                return true
            }
            if (domainStrategy == DOMAIN_STRATEGY.NEVER) {
                return false
            }
            switch (defaultStrategy) {
                case DOMAIN_STRATEGY.AUTO:
                    // let detect = detectPageLanguage()
                    // let maxLang = paragraphElementTool.getMaxLanguage()
                    // let langScore = detectPageLanguageScore()
                    console.log('translatePage detect:', paragraphElementTool.getMaxLanguage(), paragraphElementTool.getMaxProportion())
                    // pageLanguage = detectLanguageByFranc()
                    let pageLanguage = paragraphElementTool.getMaxLanguage()
                    if (!pageLanguage || pageLanguage == "" || pageLanguage == 'und') {
                        // call translateRoot directly, because the language is not detected, set pageLanguage and judge whether translate when translate api return
                        let translateFlag = false
                        // temp set translate service to microsoft, finally restore to the original service
                        // let translateServiceBack = translateService
                        // translateService = TRANS_SERVICE.MICROSOFT
                        translateRoot(document.body, true, {targetTranslateService: TRANS_SERVICE.MICROSOFT}).then((status) => {
                            if (status) {
                                setSessionStorage(tabTranslateStatusKey, true)
                                translateStatus = true
                                translateFlag = true
                            } else {
                                setSessionStorage(tabTranslateStatusKey, false)
                                translateStatus = false
                                translateFlag = false
                            }
                        }).catch((e) => {
                            setSessionStorage(tabTranslateStatusKey, false)
                            translateStatus = false
                            translateFlag = false
                        }).finally(() => {
                            // translateService = translateServiceBack
                        })
                        return translateFlag
                    }
                    if (pageLanguage != targetLanguage) {
                        await translateBody()
                        return true
                    }
                    break
                case DOMAIN_STRATEGY.ALWAYS:
                    await translateBody()
                    return true
                case DOMAIN_STRATEGY.NEVER:
                    return false
                default:
                    break
            }
            return false
        }

        async function translateStrategyProcess() {
            console.log('translateStrategyProcess:', domainStrategy)
            if (domainStrategy == DOMAIN_STRATEGY.ALWAYS) {
                if (translateStatus) {
                    return true
                }
                return translateBody()
            } else if (domainStrategy == DOMAIN_STRATEGY.NEVER) {
                if (translateStatus) {
                    await restoreOriginalPage()
                }
                return false
            }
            switch (defaultStrategy) {
                case DOMAIN_STRATEGY.AUTO:
                    // If the language of the current page is the same as the target language, it will not be translated
                    // there modify to detect page language by use translate api
                    let sourceLanguage = ""
                    if (!sourceLanguage || sourceLanguage == "" || sourceLanguage == 'und') {
                        // if the language is not detected, get the language from the tab
                        // sourceLanguage = await sendMessageToBackground({action: TB_ACTION.TAB_LANG_GET})
                        // sourceLanguage = await detectLanguage() || await sendMessageToBackground({action: TB_ACTION.TAB_LANG_GET})

                        // call translateRoot directly, because the language is not detected, set pageLanguage and judge whether translate when translate api return
                        return translateRoot(document.body)
                    }
                    console.log('sourceLanguage:', sourceLanguage, 'targetLanguage:', targetLanguage, 'translateStatus', translateStatus)
                    if (sourceLanguage == targetLanguage) {
                        if (translateStatus) {
                            await restoreOriginalPage()
                        }
                        return false
                    } else {
                        // await setSessionStorage(tabTranslateStatusKey, true)
                        return translateRoot(document.body)
                    }
                case DOMAIN_STRATEGY.ALWAYS:
                    if (!translateStatus) {
                        await translateBody()
                    }
                    return true
                case DOMAIN_STRATEGY.ASK:
                    // todo A dialog box pops up asking if you want to translate
                    return false
                case DOMAIN_STRATEGY.NEVER:
                    await restoreOriginalPage()
                    return false
            }
            return false
        }

        async function showOriginalPage() {
            try {
                await restoreOriginalPage()
            } catch (e) {
                console.error("showOriginal failed: ", e)
            }
        }

        function toggleTranslateStatus() {
            getSessionStorage(tabTranslateStatusKey).then((status) => {
                if (status) {
                    // observer.disconnect()
                    console.log('translate status:', status)
                    setSessionStorage(tabTranslateStatusKey, false)
                    // restore the original page
                    restoreOriginalPage()
                } else {
                    setSessionStorage(tabTranslateStatusKey, true)
                    translateRoot(document.body)
                }
            });
        }

        function ruleStrategyProcess(ruleStrategy: string[]) {
            // Iterate through all the rules and mark the elements that don't translate
            if (!ruleStrategy) {
                return
            }
            ruleStrategy.forEach((content: string) => {
                let element = document.querySelector(content);
                if (element == null) {
                    return
                }
                // add class，mark as duo-no-translate
                element.classList.add('duo-no-translate');
            })

        }

        async function translateMultipleRoot(roots: HTMLElement[], autoTrigger?: boolean, context?: any) {
            // console.log('translateRoot:', root)
            if (defaultStrategy == DOMAIN_STRATEGY.AUTO) {
                let pageLanguage = paragraphElementTool.getMaxLanguage()
                if (pageLanguage == targetLanguage) {
                    return false
                }
            }

            let params = new translateParams(translateService, targetLanguage, undefined, defaultStrategy, autoTrigger)
            // if the root is body, it means the page is reloaded, or re translated
            // if (root == document.body) {
            //     console.log('translate body:', root)
            //     params.isBody = true
            //     originalElementRecords = []
            // }
            console.log('viewStrategy:', viewStrategy, 'tabLanguage:', targetLanguage, 'translateService:', translateService, 'globalSwitch:', globalSwitch)
            // ruleStrategyProcess(ruleStrategy)
            if (globalSwitch) {
                switch (viewStrategy) {
                    case VIEW_STRATEGY.DOUBLE:
                        return translateDuoMultipleDOM(roots, params, context)
                    case VIEW_STRATEGY.SINGLE:
                    // return translateDOM(root, params, context)
                    default:
                        break
                }
            }
            return false

        }

        // translate the root DOM tree
        // if translate success, return true, otherwise return false
        async function translateRoot(root: HTMLElement, autoTrigger?: boolean, context?: any) {
            // console.log('translateRoot:', root)
            if (defaultStrategy == DOMAIN_STRATEGY.AUTO) {
                let pageLanguage = paragraphElementTool.getMaxLanguage()
                if (pageLanguage == targetLanguage) {
                    return false
                }
            }

            let params = new translateParams(translateService, targetLanguage, undefined, defaultStrategy, autoTrigger)
            // if the root is body, it means the page is reloaded, or re translated
            if (root == document.body) {
                console.log('translate body:', root)
                params.isBody = true
                originalElementRecords = []
            }
            console.log('viewStrategy:', viewStrategy, 'tabLanguage:', targetLanguage, 'translateService:', translateService, 'globalSwitch:', globalSwitch)
            // ruleStrategyProcess(ruleStrategy)
            if (globalSwitch) {
                switch (viewStrategy) {
                    case VIEW_STRATEGY.DOUBLE:
                        return translateDuoDOM(root, params, context)
                    case VIEW_STRATEGY.SINGLE:
                        return translateDOM(root, params, context)
                    default:
                        break
                }
            }
            return false

        }


        async function processStyleChangeAction() {
            let [bgColor, fontColor, borderStyle, originalBgColor, translationBgColor, highlightSwitch] = await Promise.all([
                getConfig(CONFIG_KEY.BG_COLOR),
                getConfig(CONFIG_KEY.FONT_COLOR),
                getConfig(CONFIG_KEY.STYLE),
                getConfig(CONFIG_KEY.ORIGINAL_BG_COLOR),
                getConfig(CONFIG_KEY.TRANSLATION_BG_COLOR),
                getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH)
            ]);
            bgColor = bgColor || ""
            fontColor = fontColor || ""
            borderStyle = borderStyle || "noneStyleSelect"
            originalBgColor = originalBgColor || '#FFECCB'
            translationBgColor = translationBgColor || '#ADD8E6'
            if (highlightSwitch == null) {
                highlightSwitch = true
            }
            console.log('style:', bgColor, fontColor, borderStyle, originalBgColor, translationBgColor, highlightSwitch)
            let styleSheet: HTMLStyleElement = document.getElementById("duo-translation-style") as HTMLStyleElement;
            if (!styleSheet) {
                styleSheet = document.createElement("style");
                styleSheet.type = "text/css";
                // Insert the <style> tag into <head>
                document.head.appendChild(styleSheet);
                styleSheet.id = "duo-translation-style"
            }
            let rule = getCSSRuleString(borderStyle)
            styleSheet.innerText = ""
            // insert css style
            if (bgColor && bgColor !== "") {
                styleSheet.innerText += `.duo-translation { background-color: ${bgColor};}`;
            }
            if (fontColor && fontColor !== "") {
                styleSheet.innerText += `.duo-translation { color: ${fontColor};}`;
            }
            if (rule && rule != "") {
                styleSheet.innerText += `.duo-translation { ${rule} }`;
            }
            if (highlightSwitch) {
                styleSheet.innerText += `.duo-highlight-translation { background-color: ${translationBgColor}; }`;
                styleSheet.innerText += `.duo-highlight-original { background-color: ${originalBgColor}; }`;
            }
            console.log('styleSheet:', styleSheet)
        }

        function convertToPx(value: string, element: HTMLElement) {
            // 使用正则表达式来分离数值和单位
            const match = value.match(/^([+-]?\d*\.?\d+)([a-z%]*)$/);

            if (match) {
                const number = parseFloat(match[1]);
                const unit = match[2];

                // 如果单位是 'px'，直接返回值
                if (unit === 'px') {
                    return number;
                }

                // 如果单位是 'em' 或 'rem'
                if (unit === 'em' || unit === 'rem') {
                    const fontSize = parseFloat(window.getComputedStyle(element).fontSize);
                    return number * fontSize; // em 或 rem 转换为 px
                }

                // 如果单位是 '%'
                if (unit === '%') {
                    const parentElement = element.parentElement || document.body;
                    const parentWidth = parentElement.offsetWidth;
                    return (number / 100) * parentWidth; // % 转换为 px
                }

                // 如果单位是 'vh' 或 'vw' 等视口单位
                if (unit === 'vh' || unit === 'vw') {
                    const viewportSize = unit === 'vh' ? window.innerHeight : window.innerWidth;
                    return (number / 100) * viewportSize; // vh 或 vw 转换为 px
                }

                // 如果其他单位，直接返回原数值（可以根据需求扩展）
                return number;
            }

            return 0; // 如果无法匹配到任何值
        }


        function isElementInViewport(element: HTMLElement) {
            // const rect = element.getBoundingClientRect();
            // let t = rect.top >= 0 &&
            //     rect.left >= 0
            //     &&
            //     rect.bottom <= (document.documentElement.clientHeight) &&
            //     rect.right <= (document.documentElement.clientWidth);
            // if (!t) {
            //     console.log('element in viewport:', element, rect, document.documentElement.clientHeight, document.documentElement.clientWidth)
            // }
            let textIndex = window.getComputedStyle(element).textIndent
            // console.log('textIndex:', textIndex, 'element:', element)
            if (textIndex && textIndex != "" && !textIndex.startsWith("0") && textIndex != "auto") {
                let elementCopy = element.cloneNode(true) as HTMLElement
                elementCopy.style.textIndent = "0"
                let actWidth = elementCopy.getBoundingClientRect().width
                let width = Math.abs(convertToPx(textIndex, element))
                if (actWidth <= width) {
                    return false
                }
            }
            return true
        }

        /**
         * Recursively traverse the DOM tree to collect nodes that meet the conditions
         * @param element
         * @param condition
         * @param elements
         */
        function collectElements(element: HTMLElement, condition: (element: HTMLElement) => boolean, elements: HTMLElement[] = []): HTMLElement[] {
            elements = elements || []; // initialize element array
            if (!(element instanceof HTMLElement)) {
                return elements;
            }
            let nodeName = element.nodeName.toLowerCase();
            // don't translate the element with class duo-no-translate and notranslate
            // todo support user defined class to exclude translation
            if (element.classList?.contains('duo-no-translate') || element.classList?.contains("duo-translation") || element.classList?.contains('notranslate')) {
                return elements;
            }
            // todo support user defined tag to exclude translation
            if (nodeName === 'script' || nodeName === 'style' || nodeName === '#comment' || nodeName === 'code') {
                return elements;
            }
            // display style is none, don't translate, fix baidu.com
            if (element.style.display === 'none') {
                return elements;
            }
            // check if the current element meets the condition
            if (condition(element)) {
                // Deletes all annotation nodes for the current element
                for (let i = 0; i < element.childNodes.length; i++) {
                    if (element.childNodes[i].nodeType === Node.COMMENT_NODE) {
                        element.removeChild(element.childNodes[i]);
                    }
                }
                elements.push(element);
                return elements;
            }
            // Recursively traverses all children of the current element
            for (let i = 0; i < element.childNodes.length; i++) {
                const currentNode = element.childNodes[i];
                if (currentNode.nodeType === 1) { // check if the node is an element node
                    collectElements(currentNode as HTMLElement, condition, elements);
                }
            }
            return elements;
        }

        function collectElementsToTranslate(element: HTMLElement): HTMLElement[] {
            let elements: HTMLElement[] = []
            if (element.classList.contains("duo-paragraph")) {
                elements.push(element)
            } else {
                elements = Array.from(element.querySelectorAll('.duo-paragraph')) as HTMLElement[]
            }
            // return elements
            // remove the elements with duo-no-translate,duo-translation,notranslate class
            elements = elements.filter((element) => {
                return !ifElementWithParentMatchCondition(element, isTranslateExcludedElement, 0, 10) && !element.querySelector('.duo-translation')
            })
            return elements
        }

        function isTranslateExcludedElement(element: HTMLElement): boolean {
            // todo support user defined class to exclude translation
            // limit the element with text content that is number // last condition
            // return element.classList.contains('duo-no-translate') || element.classList.contains("duo-translation") || element.classList.contains('notranslate')
            //     || element.hasAttribute("duo-no-observer")
            return element.classList.contains('duo-no-translate') || element.classList.contains('notranslate')
        }

        /**
         * judge the element whether to mark
         * @param element
         */
        function isNotMarkElement(element: HTMLElement): boolean {
            // todo support user defined class to exclude translation
            // limit the element with text content that is number // last condition
            // todo support user defined tag to exclude
            return element.classList.contains("duo-translation") || element.hasAttribute("duo-no-observer") || isExcludedNodeType(element)
        }

        function ifElementWithParentMatchCondition(element: HTMLElement, condition: (element: HTMLElement) => boolean, deep?: number, maxDeep?: number): boolean {
            if (deep !== undefined && maxDeep !== undefined && deep > maxDeep) {
                return false
            }
            if (condition(element)) {
                return true
            }
            if (element.parentElement) {
                if (deep === undefined || maxDeep === undefined) {
                    return ifElementWithParentMatchCondition(element.parentElement as HTMLElement, condition)
                } else {
                    return ifElementWithParentMatchCondition(element.parentElement as HTMLElement, condition, deep + 1, maxDeep)
                }

            }
            return false
        }

        function isParagraphExcludedElement(element: HTMLElement): boolean {
            return element.nodeName.toLowerCase() === 'code' || element.classList.contains("duo-paragraph")
        }

        function isEditable(element: HTMLElement): boolean {
            // Check if the element is contenteditable
            if (element.isContentEditable) {
                return true;
            }

            // Check if it's an input, textarea, or select element and not disabled or readonly
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                return !element.disabled && !element.readOnly;
            }

            if (element instanceof HTMLSelectElement) {
                return !element.disabled;
            }

            // If none of the above, it's not editable
            return false;
        }

        function isExcludedNodeType(node: Node): boolean {
            let nodeName = node.nodeName.toLowerCase();
            return excludedTagSet.has(nodeName);
        }

        // search and add the duo-paragraph class to the paragraph element for marking
        function markParagraphElement(element: HTMLElement, notTranslate?: boolean, collectElements?: HTMLElement[],
                                      notRecursion?: boolean, deep?: number, maxDeep?: number): HTMLElement[] {
            // element.cloneNode(true) ***** may be trigger observer event cause oom *******
            if (deep != undefined && maxDeep != undefined && deep > maxDeep) {
                return collectElements || []
            }
            if (!element) {
                return [];
            }
            if (!(element instanceof HTMLElement)) {
                return [];
            }
            if (ifElementWithParentMatchCondition(element, isNotMarkElement)) {
                return [];
            }
            // if (element.textContent == "Prerequisites") {
            // console.log("Prerequisites element:", element.nodeType, element instanceof HTMLElement)
            // }
            if (notTranslate === undefined) {
                notTranslate = ifElementWithParentMatchCondition(element, isTranslateExcludedElement)
            } else if (!notTranslate) {
                notTranslate = isTranslateExcludedElement(element)
            }

            // if (element.classList.contains("duo-paragraph") && !element.querySelectorAll('.duo-translation')) {
            //     console.log('duo-paragraph element:', element.cloneNode(true))
            //     // delete the element's children that has class duo-translation if the element has class duo-paragraph
            //     let children = element.querySelector('.duo-translation')
            //     if (collectElements) {
            //         collectElements.push(element)
            //         return collectElements
            //     }
            //     return []
            // }

            if (element.style.display === 'none') {
                return [];
            }
            // if the element is able to input, don't translate
            if (isEditable(element)) {
                return [];
            }
            if (isParagraphElement(element)) {
                // judge whether visible
                if (!isElementInViewport(element)) {
                    return []
                }
                // Deletes all annotation nodes for the current element
                for (let i = 0; i < element.childNodes.length; i++) {
                    if (element.childNodes[i].nodeType === Node.COMMENT_NODE) {
                        element.removeChild(element.childNodes[i]);
                    }
                }

                element.classList.add('duo-paragraph')
                if (!notTranslate) {
                    if (collectElements && !element.querySelector('.duo-translation')) {
                        console.log('push collect element:', element)
                        collectElements.push(element)
                    }
                    element.classList.add("duo-needs-translate")
                }
                paragraphElementTool.update(element)

                return collectElements || [];
            }
            if (notRecursion) {
                return collectElements || [];
            }
            // Recursively traverses all children of the current element
            for (let i = 0; i < element.childNodes.length; i++) {
                let currentNode = element.childNodes[i];
                if (currentNode.nodeType === 1) { // check if the node is an element node
                    if (deep === undefined || maxDeep === undefined) {
                        markParagraphElement(currentNode as HTMLElement, notTranslate, collectElements)
                    } else {
                        markParagraphElement(currentNode as HTMLElement, notTranslate, collectElements, false, deep + 1, maxDeep)
                    }
                } else if (currentNode.nodeType === 3 && currentNode.textContent!.trim() !== "") {
                    // set the text node to paragraph element
                    // create a custom element to wrap the text node
                    let paraElement = document.createElement('duo-span')
                    paraElement.classList.add('duo-paragraph')
                    paraElement.setAttribute('duo-no-observer', 'true')
                    if (!notTranslate) {
                        if (collectElements && !paraElement.querySelector('.duo-translation')) {
                            collectElements.push(paraElement)
                        }
                        paraElement.classList.add("duo-needs-translate")
                    }
                    paragraphElementTool.update(paraElement)
                    // let lang = detectParagraphLanguage(paraElement);
                    // let len = getElementTextLength(paraElement)
                    // allParagraphElementSet.set(paraElement, new LanguageScore(lang, len))
                    // paragraphElementTool.updateLanguageScore(lang, len)
                    // paraElement.setAttribute("duo-len", len.toString())
                    // paragraphElementTool.updateLanguageScore(paraElement.getAttribute("duo-lang") || "und", len)
                    // paraElement.classList.add('duo-serial-' + paragraphSerialNumber)
                    // paragraphSerialNumber++
                    // paraElement.textContent = currentNode.textContent
                    paraElement.appendChild(currentNode.cloneNode(true))
                    // if currentNode nextSibling is not block element, merge the text node
                    let originalNode = currentNode
                    currentNode = currentNode.nextSibling!
                    while (currentNode) {
                        if ((currentNode.nodeType == 3 || !isBlockElement(currentNode as HTMLElement))) {
                            let next = currentNode.nextSibling!
                            paraElement.appendChild(currentNode)
                            console.log('currentNode:', currentNode)
                            currentNode = next
                        } else {
                            break
                        }
                    }
                    ignoreMutationElements.add(element)
                    element.replaceChild(paraElement, originalNode)
                    Promise.resolve().then(() => {
                        ignoreMutationElements.delete(element)
                    })
                }
            }
            return collectElements || [];
        }

        // function getByteLength(str: string | undefined | null) {
        //     if (!str) {
        //         return 0
        //     }
        //     return encoder.encode(str.trim()).length
        // }
        //
        // function getElementTextLength(element: HTMLElement): number {
        //     let text = "";
        //
        //     function traverse(node: Node) {
        //         if (node.nodeType === Node.TEXT_NODE) {
        //             text += node.textContent || ""; // 获取文本节点内容
        //         } else if (node.nodeType === Node.ELEMENT_NODE) {
        //             if (isExcludedNodeType(node)) {
        //                 return;
        //             }
        //             // 递归处理子元素
        //             for (let child of node.childNodes) {
        //                 traverse(child);
        //             }
        //         }
        //     }
        //
        //     traverse(element);
        //     return getByteLength(text); // 计算字节长度
        // }

        function detectParagraphLanguage(element: HTMLElement) {
            let text = element.textContent
            if (!text) {
                return "und"
            }
            let lang = franc(text, {minLength: 5})
            if (lang == "cmn") {
                if (isTraditionalChinese(text)) {
                    lang = 'zh-TW'
                } else {
                    lang = 'zh-CN'
                }
            } else {
                lang = iso6393To1Map.get(lang) || "und"
            }
            // element.setAttribute("duo-lang", lang)
            return lang;
        }

        /**
         * extract the domain name from the url
         * @param url
         */
        function getDomainFromUrl(url: string) {
            try {
                const parsedUrl = new URL(url);
                return parsedUrl.hostname;
            } catch (error) {
                console.error('Invalid URL:', error);
                return null;
            }
        }

        /**
         * get domain with port from url
         * @param url
         */
        function getDomainWithPortFromUrl(url: string) {
            try {
                const parsedUrl = new URL(url);
                if (parsedUrl.port != '80' && parsedUrl.port != '443') {
                    return parsedUrl.hostname + ':' + parsedUrl.port; // For non-standard ports, you need to add a port number
                }
                return parsedUrl.hostname; // only get the domain name
            } catch (error) {
                console.error('Invalid URL:', error);
                return null;
            }
        }

        function isBlockElement(element: HTMLElement): boolean {
            // if the element is not HTMLElement, return false
            if (!(element instanceof HTMLElement)) {
                return false;
            }
            // Check if the element is a block element
            const display = window.getComputedStyle(element).display;
            return display === 'block' || display === 'flex' || display === 'grid' || display === 'table' || display === 'flow-root';
        }

        function isParagraphElement(element: HTMLElement): boolean {
            let flag = false
            // An element is considered a paragraph if its child node has a text node and the text content is not empty
            // also the element is not block element with not empty text content
            if (element.childNodes.length > 0) {
                for (let i = 0; i < element.childNodes.length; i++) {
                    // judge if the child node is block element
                    if (element.childNodes[i].nodeType == Node.ELEMENT_NODE) {
                        let ele = element.childNodes[i] as HTMLElement
                        if (isBlockElement(ele) && ele.textContent!.trim() !== "") {
                            return false
                        }
                    }
                    if (element.childNodes[i].nodeType === Node.TEXT_NODE && element.childNodes[i].textContent!.trim() !== "") {
                        // console.log('isParagraphElement:', element)
                        // need to confirm the brother element is not block element and that textContent is not empty
                        flag = true
                    }
                }
                return flag
            }
            return false
        }

        function hasAttributeIncludingParents(element: HTMLElement, attribute: string): boolean {
            // The current element has this attribute
            if (element?.hasAttribute(attribute)) {
                return true;
            }

            // recursively checks the parent element upwards
            if (element.parentElement) {
                return hasAttributeIncludingParents(element.parentElement, attribute);
            }

            // If the root element has not been found, it returns false
            return false;
        }

        function splitHtml(originHtml: string): string[] {
            let sentences = split(originHtml)

            let whiteSpace: string[] = []
            let sentenceWithWhiteSpace = []
            for (let sentence of sentences) {
                if (sentence.type == "WhiteSpace") {
                    whiteSpace.push(sentence.raw)
                } else if (sentence.type == "Sentence") {
                    sentenceWithWhiteSpace.push((whiteSpace[whiteSpace.length - 1] == undefined ? "" : whiteSpace.pop()) + sentence.raw)
                }
            }
            for (let i = 0; i < sentenceWithWhiteSpace.length; i++) {
                if (sentenceWithWhiteSpace[i].trim().startsWith("</")) {
                    if (i > 0) {
                        sentenceWithWhiteSpace[i - 1] += sentenceWithWhiteSpace[i]
                        sentenceWithWhiteSpace.splice(i, 1)
                    }
                }
            }
            sentenceWithWhiteSpace[sentenceWithWhiteSpace.length - 1] += whiteSpace[whiteSpace.length - 1] == undefined ? "" : whiteSpace.pop()
            // console.log("splitHtml", whiteSpace)
            return sentenceWithWhiteSpace
        }

        function startsWithIgnoringWhitespace(input: string, searchString: string): boolean {
            // Trim the input string to ignore leading spaces and line breaks
            const trimmedInput = input.trimStart();
            return trimmedInput.startsWith(searchString);
        }

        /**
         * Translate the DOM tree for monolingual
         * @param tree
         * @param params
         * @param context
         */
        function translateDOM(tree: HTMLElement, params: translateParams, context?: any) {
            console.log('translateDOM enter:', tree)
            let needTranslateElement = collectElementsToTranslate(tree)
            return translateCollectedElements(needTranslateElement, params, undefined, afterTranslate, 0, 3)
        }

        function afterTranslate(needTranslateElement: HTMLElement[], res: TranslatedElement[]): HTMLElement[] {
            for (let i = 0; i < needTranslateElement.length; i++) {
                // console.log('res:', res[i])
                originalElementRecords.push(needTranslateElement[i].cloneNode(true) as HTMLElement)
                let cloneElement = needTranslateElement[i].cloneNode(true) as HTMLElement
                cloneElement.innerHTML = res[i].translatedText
                // console.log('cloneElement:', cloneElement)
                needTranslateElement[i].innerHTML = cloneElement.firstElementChild?.innerHTML! || cloneElement.textContent || needTranslateElement[i].innerHTML
                // identify the element that has been translated, in some cases, the translated element possibly be recovered(but attribute remained)
                let translation = document.createElement('duo-translation')
                translation.classList.add("duo-translation")
                translation.style.display = 'none'
                needTranslateElement[i].appendChild(translation)
                translateElementRecords.push(needTranslateElement[i])
                // when translated, set duo-no-observer attribute
                // needTranslateElement[i].setAttribute("duo-no-observer", "true")
                needTranslateElement[i].classList.add("duo-translated")
                // console.log('needTranslateElement:', needTranslateElement[i].textContent)
                // needTranslateElement[i].classList.add("duo-translated")

            }
            return []
        }

        /**
         * Translate the DOM tree for bilingual
         * @param tree
         * @param params
         * @param context
         * @returns {Promise<boolean>} true if the translation is successful, false otherwise
         */
        async function translateDuoDOM(tree: HTMLElement, params: translateParams, context?: any): Promise<boolean> {
            if (tree.textContent == "Prerequisites") {
                console.log('translateDuoDOM enter:', tree)
            }
            console.log('translateDuoDOM enter:', tree)
            if (!(tree instanceof HTMLElement)) {
                return false;
            }
            // let elements = collectElementsToTranslate(tree)
            let elements: HTMLElement[] = []
            if (tree.classList.contains("duo-needs-translate")) {
                elements.push(tree)
            } else {
                elements = Array.from(tree.querySelectorAll('.duo-needs-translate')) as HTMLElement[]
            }
            if (!elements || elements.length == 0) {
                return true;
            }
            return translateCollectedElements(elements, params, beforeDuoTranslate, afterDuoTranslate, 0, 3, context)
        }

        async function translateDuoMultipleDOM(trees: HTMLElement[], params: translateParams, context?: any): Promise<boolean> {
            // if (tree.textContent == "Prerequisites") {
            //     console.log('translateDuoDOM enter:', tree)
            // }
            // console.log('translateDuoDOM enter:', tree)
            // if (!(tree instanceof HTMLElement)) {
            //     return false;
            // }
            // let elements = collectElementsToTranslate(tree)
            let elements: HTMLElement[] = []
            for (let tree of trees) {
                if (tree.classList.contains("duo-needs-translate")) {
                    elements.push(tree)
                } else {
                    elements = elements.concat(Array.from(tree.querySelectorAll('.duo-needs-translate')) as HTMLElement[])
                }
            }
            if (!elements || elements.length == 0) {
                return true;
            }
            return translateCollectedElements(elements, params, beforeDuoTranslate, afterDuoTranslate, 0, 3, context)
        }

        // remove all comment nodes recursively
        function removeCommentNodesRecursively(element: HTMLElement) {
            for (let i = 0; i < element.childNodes.length; i++) {
                if (element.childNodes[i].nodeType === Node.COMMENT_NODE) {
                    console.log("remove comment node:", element.childNodes[i])
                    element.removeChild(element.childNodes[i]);
                } else if (element.childNodes[i].nodeType === Node.ELEMENT_NODE) {
                    removeCommentNodesRecursively(element.childNodes[i] as HTMLElement)
                }
            }
        }

        function beforeDuoTranslate(elements: HTMLElement[]): HTMLElement[] {
            // console.log('beforeDuoTranslate:', elements)
            let originalHtmlElements: HTMLElement[] = []
            for (let element of elements) {
                // if (element.tagName==="TEXTAREA"){
                //     originalHtmlElements.push(element)
                //     continue
                // }
                // remove all comment nodes recursively
                removeCommentNodesRecursively(element)
                // console.log('translateDuoDOM element:', element.cloneNode(true))
                originalElementRecords.push(element.cloneNode(true) as HTMLElement)
                translateElementRecords.push(element)
                // console.log('element:', element.innerHTML)
                // const sentences = split(element.innerHTML).filter((node) => node.type === 'Sentence');
                let tagStack: string[] = []
                if (element.textContent?.includes("From Scratch")) {
                    console.log('xxelement:', element.innerHTML)

                }
                // console.log('element:', element.innerHTML)
                const sentences = splitHtml(element.innerHTML)
                // console.log('sentences:', sentences)
                element.innerHTML = ""
                for (let i = 0; i < sentences.length; i++) {
                    let sentence = sentences[i]
                    let span = document.createElement('span');

                    // process the raw html to fix tag mismatch
                    let rawHtml = sentence
                    // console.log('rawHtml1:', rawHtml)
                    while (startsWithIgnoringWhitespace(rawHtml, "</")) {
                        // remove invalid closing tags at the beginning
                        tagStack.pop()
                        rawHtml = rawHtml.replace(/<\/[a-zA-Z][a-zA-Z0-9]*\s*>/, '')
                    }
                    while (tagStack.length > 0) {
                        rawHtml = `<${tagStack.pop()}>` + rawHtml
                    }
                    let match
                    while ((match = tagRegex.exec(rawHtml)) !== null) {
                        const tagName = match[1];
                        if (match[0].startsWith("</")) {
                            // Handle closed labels
                            if (tagName === tagStack[tagStack.length - 1]) {
                                tagStack.pop();
                            }
                        } else {
                            // Handle open labels
                            // console.log('tagName:', tagName);
                            tagStack.push(tagName);
                        }

                    }
                    // lastTagStack = Array.from(tagStack)
                    // while (tagStack.length > 0) {
                    //     // patch the missing closing tags
                    //     rawHtml += `</${tagStack.pop()}>`
                    // }
                    for (let j = tagStack.length - 1; j >= 0; j--) {
                        rawHtml += `</${tagStack[j]}>`
                    }
                    span.setAttribute("duo-no-observer", "true")
                    span.innerHTML = rawHtml;
                    // console.log('sentences:', rawHtml)
                    span.setAttribute("duo-sequence", i.toString())
                    span.classList.add("duo-sentence")
                    // element.appendChild(span) // probably cause the page refresh all the time issue
                    element.innerHTML += span.outerHTML
                    // element.removeAttribute("duo-no-observer")

                }
                originalHtmlElements.push(element)
                if (element.cloneNode(true).textContent?.includes("services today are all based on Spring Boot")) {
                    console.log('before element:', element.innerHTML, document.contains(element))
                }

            }
            return originalHtmlElements
        }

        function cloneElementWithStyles(element: HTMLElement): HTMLElement {
            // 克隆元素（不包括样式）
            const clonedElement = element.cloneNode(true) as HTMLElement;

            // 获取元素的所有计算样式
            const computedStyle = window.getComputedStyle(element);

            // 将所有计算样式应用到克隆元素
            for (let i = 0; i < computedStyle.length; i++) {
                const prop = computedStyle[i];
                clonedElement.style[prop as any] = computedStyle.getPropertyValue(prop);
            }

            return clonedElement;
        }

        function afterDuoTranslate(originalHtmlElements: HTMLElement[], res: TranslatedElement[]) {
            let translatedElements: HTMLElement[] = []
            // console.log('afterDuoTranslate:', originalHtmlElements.length, res.length)
            try {
                for (let i = 0; i < originalHtmlElements.length; i++) {
                    // if (!originalHtmlElements[i].textContent?.includes("services today are all based on Spring Boot")) {
                    //     // console.log('originalHtmlElements:', originalHtmlElements[i].innerHTML)
                    //     continue
                    // }
                    let element = originalHtmlElements[i]
                    // if (element.tagName==="TEXTAREA"){
                    //     try {
                    //         let textElement = element as HTMLTextAreaElement
                    //         let elementCloned = element.cloneNode(true) as HTMLTextAreaElement
                    //         ignoreMutationElements.add(elementCloned)
                    //         // // insert the translated element after the original element
                    //         let translatedElement = document.createElement('div')
                    //         translatedElement.innerHTML = res[i].translatedText
                    //         let text = translatedElement?.children?.[0] as HTMLTextAreaElement
                    //         elementCloned.value = textElement.value + "\n" + text.value
                    //         element.parentElement?.insertBefore(elementCloned, element.nextSibling)
                    //         element.remove()
                    //         Promise.resolve().then(() => {
                    //             ignoreMutationElements.delete(elementCloned)
                    //         })
                    //     }catch (e) {
                    //         console.error('afterDuoTranslate error:', e)
                    //     }
                    //     continue
                    // }
                    console.log('element after:', element)
                    let elementCloned = element.cloneNode(false) as HTMLElement
                    elementCloned.innerHTML = res[i].translatedText
                    console.log('elementCloned:', elementCloned.innerHTML)
                    if (elementCloned.textContent?.trim() !== "" && elementCloned.textContent !== originalHtmlElements[i].textContent) {
                        let duoElement = document.createElement('font')
                        duoElement.classList.add("duo-translation")
                        duoElement.setAttribute("duo-no-observer", "true")
                        duoElement.innerHTML = elementCloned.firstElementChild?.innerHTML!
                        // If the current text is longer than 40 characters, add a line break. Otherwise, add a space
                        if (element.textContent!.length > 40) {
                            element.appendChild(document.createElement('br'));
                            console.log('duoElement element:', duoElement)
                            element.appendChild(duoElement);
                        } else {
                            let divide = document.createElement('span')
                            divide.textContent = ' '
                            element.appendChild(divide);
                            element.appendChild(duoElement);
                            let elementWidth = element.getBoundingClientRect().width
                            let children = element.children
                            let allChildrenWidth = 0
                            for (let c of children) {
                                allChildrenWidth += c.getBoundingClientRect().width
                            }
                            // if (element.textContent?.includes("Examples")) {
                            //     console.log('elementWidth:', elementWidth, 'width:', allChildrenWidth)
                            // }
                            if (Math.floor(allChildrenWidth) > Math.ceil(elementWidth)) {
                                divide.outerHTML = '<br>'
                            }
                        }
                        element.classList.add("duo-original")
                        element.classList.add("duo-translated")
                        translatedElements.push(element)
                        // console.log('element after:', element.innerHTML, element, document.contains(element))
                        // cancel the element high limit
                        element.style.setProperty("max-height", "none", "important")
                        element.style.setProperty("-webkit-line-clamp", "none", "important")
                        // recursively find the parent element with max-height and -webkit-line-clamp
                        let operateElement: HTMLElement | null = element
                        while (operateElement) {
                            if (operateElement.style.maxHeight !== "") {
                                // record the element original max-height
                                operateElement.setAttribute("duo-max-height", operateElement.style.maxHeight)
                                operateElement.classList.add("duo-height-break")
                                operateElement.style.setProperty("max-height", "none", "important")
                            }
                            if (operateElement.style.webkitLineClamp !== "") {
                                // record the element original -webkit-line-clamp
                                operateElement.classList.add("duo-line-break")
                                operateElement.setAttribute("duo-webkit-line-clamp", operateElement.style.webkitLineClamp)
                                operateElement.style.setProperty("-webkit-line-clamp", "none", "important")
                            }
                            operateElement = operateElement.parentElement
                        }
                        let spans = element.querySelectorAll(".duo-sentence")
                        if (spans) {
                            for (let span of spans) {
                                let spanElement = span as HTMLElement
                                // original vs. highlight settings
                                spanElement.onmouseover = function () {
                                    let sequence = parseInt(span.getAttribute("duo-sequence")!)
                                    span.classList.add("duo-highlight-original")
                                    // get all elements with the same sequence number
                                    let sequenceElements = span.parentElement?.querySelectorAll('.duo-translation > span[duo-sequence="' + sequence + '"]');
                                    // console.log('sequenceElements:', sequenceElements)
                                    if (sequenceElements) {
                                        for (let sequenceElement of sequenceElements) {
                                            sequenceElement.classList.add("duo-highlight-translation")
                                        }
                                    }
                                }
                                spanElement.onmouseleave = function () {
                                    span.classList.remove("duo-highlight-original")
                                    let sequence = parseInt(span.getAttribute("duo-sequence")!)
                                    let sequenceElements = span.parentElement?.querySelectorAll('.duo-translation > span[duo-sequence="' + sequence + '"]');
                                    if (sequenceElements) {
                                        for (let sequenceElement of sequenceElements) {
                                            sequenceElement.classList.remove("duo-highlight-translation")
                                        }
                                    }
                                }
                            }
                        }
                        // console.log('element cloneNode:', element.cloneNode(true))

                        // Translation highlighting settings
                        duoElement?.querySelectorAll(".duo-sentence")?.forEach((child) => {
                            let span = child as HTMLElement
                            span.onmouseover = function () {
                                span.classList.add("duo-highlight-translation")
                                let querySelectorAll = element.querySelectorAll(".duo-sentence");
                                let originalSpan = querySelectorAll![parseInt(span.getAttribute("duo-sequence")!)] as HTMLElement;
                                originalSpan.classList.add("duo-highlight-original")
                            }
                            span.onmouseleave = function () {
                                span.classList.remove("duo-highlight-translation")
                                let querySelectorAll = element.querySelectorAll(".duo-sentence");
                                let originalSpan = querySelectorAll![parseInt(span.getAttribute("duo-sequence")!)] as HTMLElement;
                                originalSpan.classList.remove("duo-highlight-original")
                            }
                        })
                    }
                }
            } catch (e) {
                console.error('afterDuoTranslate error:', e)
            }
            return translatedElements
        }

        function whetherTranslate() {
            if (!globalSwitch) {
                return false
            }
            if (manualTranslateTrigger) {
                console.log('manualTranslateTrigger:', manualTranslateTrigger, translateStatus)
                return translateStatus;
            }
            if (domainStrategy == DOMAIN_STRATEGY.NEVER) {
                return false
            }
            if (domainStrategy == DOMAIN_STRATEGY.ALWAYS) {
                return true
            }
            switch (defaultStrategy) {
                case DOMAIN_STRATEGY.AUTO:
                    console.log('translateParagraph language before:', paragraphElementTool.getMaxLanguage(), 'getMaxProportion:', paragraphElementTool.getMaxProportion())
                    return targetLanguage != paragraphElementTool.getMaxLanguage();
                case DOMAIN_STRATEGY.NEVER:
                    return false
                case DOMAIN_STRATEGY.ALWAYS:
                    return true

            }
            return true
        }

        /**
         * Translate the paragraph elements
         * @param elements
         * @param context hasDuplicated is true, indicate that the element has been duplicated
         */
        async function translateParagraphElements(elements: HTMLElement[], context?: any) {
            console.log('translateParagraphElements:', elements.length)
            let translatedOriginalMapTemp = new Map<HTMLElement, HTMLElement>()
            for (let i = 0; i < elements.length; i++) {
                console.log('translateParagraphElements element:', elements[i].cloneNode(true))
            }
            if (!whetherTranslate()) {
                return
            }
            if (context && typeof context.hasDuplicated === 'boolean' && !context.hasDuplicated) {
                // remove duplicate elements
                elements = Array.from(new Set(elements))
            }
            // remove had translated elements
            elements = elements.filter((element) => {
                return !translatedOriginalMap.has(element);
            })
            for (let element of elements) {
                translatedOriginalMapTemp.set(element, element.cloneNode(true) as HTMLElement)
                ignoreMutationElements.add(element)
            }
            let ignoreTranslateElements: HTMLElement[] = []
            console.log('translateParagraphElements:', elements)
            let service = translateService
            if (context && typeof context.targetTranslateService === "string" && context.targetTranslateService) {
                service = context.targetTranslateService
                console.log('context.targetTranslateService:', context.targetTranslateService)
            }
            if (viewStrategy == VIEW_STRATEGY.DOUBLE) {
                elements = beforeDuoTranslate(elements)
            }
            if (service == "") {
                service = TRANS_SERVICE.MICROSOFT
            }
            let translatedElements: HTMLElement[] = []
            await translationServices.get(service)?.translateHtml?.(elements, targetLanguage, "").then((res: TranslatedElement[]) => {
                if (!res) {
                    return;
                }
                for (let i = res.length - 1; i >= 0; i--) {
                    let r = res[i]
                    paragraphElementTool.update(elements[i], r.sourceLang)
                    if (res[i].sourceLang == targetLanguage) {
                        res.splice(i, 1)
                        ignoreTranslateElements.push(elements[i])
                        elements.splice(i, 1)
                    }
                }
                if (elements.length == 0) {
                    return;
                }
                if (defaultStrategy == DOMAIN_STRATEGY.AUTO && !manualTranslateTrigger && domainStrategy == DOMAIN_STRATEGY.AUTO) {
                    console.log('translateParagraph language after:', paragraphElementTool.getMaxLanguage(), paragraphElementTool.getMaxProportion())
                    if (paragraphElementTool.getMaxLanguage() == targetLanguage) {
                        return
                    }
                }

                if (viewStrategy == VIEW_STRATEGY.DOUBLE) {
                    translatedElements = afterDuoTranslate(elements, res)
                } else if (viewStrategy == VIEW_STRATEGY.SINGLE) {
                    translatedElements = afterTranslate(elements, res)
                }
            })
            for (let translatedElement of translatedElements) {
                translatedOriginalMap.set(translatedElement, translatedOriginalMapTemp.get(translatedElement)!)
            }
            Promise.resolve().then(() => {
                for (let element of elements) {
                    ignoreMutationElements.delete(element)
                }
                for (let ignoreTranslateElement of ignoreTranslateElements) {
                    ignoreMutationElements.delete(ignoreTranslateElement)
                }
            })
            if (defaultStrategy == DOMAIN_STRATEGY.AUTO && !manualTranslateTrigger && domainStrategy == DOMAIN_STRATEGY.AUTO) {
                await setTranslateStatusByTranslatedElement()
            }
        }

        /**
         * Translate the collected elements
         * @param elements
         * @param params
         * @param beforeTranslate
         * @param afterTranslate
         * @param dep
         * @param maxDep
         * @param context
         * @returns {Promise<boolean>} true if the translation is successful, false otherwise
         */
        async function translateCollectedElements(elements: HTMLElement[], params: translateParams, beforeTranslate?: (elements: HTMLElement[]) => HTMLElement[],
                                                  afterTranslate?: (elements: HTMLElement[], res: TranslatedElement[]) => HTMLElement[], dep: number = 0, maxDep?: number, context?: any): Promise<boolean> {
            try {
                if (maxDep && dep >= maxDep) {
                    console.error("translateCollectedElements dep exceed maxDep:", maxDep)
                    return false
                }
                let originalHtmlElements: HTMLElement[] = elements
                if (!originalHtmlElements || originalHtmlElements.length == 0) {
                    return true
                }
                for (let element of elements) {
                    element.setAttribute("duo-no-observer", "true")
                }
                if (beforeTranslate) {
                    // console.log('beforeTranslate11:', elements)
                    originalHtmlElements = beforeTranslate(elements)
                }
                // console.log('originalHtmlElements:', originalHtmlElements)
                // return
                let translateFlag = true
                console.log('context:', context)
                if (context && typeof context.targetTranslateService === "string" && context.targetTranslateService) {
                    params.serviceName = context.targetTranslateService
                    console.log('context.targetTranslateService:', context.targetTranslateService)
                }
                await translationServices.get(params.serviceName)?.translateHtml?.(originalHtmlElements, params.targetLang, params.sourceLang).then((res: TranslatedElement[]) => {
                    // console.log('res:', res, 'elements length', elements.length, 'res length', res.length)
                    if (afterTranslate && res) {
                        // if isBody is true, indicate that not observed element
                        if (params.isBody) {
                            // detect language
                            // find the most common language
                            let languageMap = new Map<string, number>()
                            for (let r of res) {
                                if (r.score < 0.9) {
                                    continue
                                }
                                if (languageMap.has(r.sourceLang)) {
                                    languageMap.set(r.sourceLang, languageMap.get(r.sourceLang)! + 1)
                                } else {
                                    languageMap.set(r.sourceLang, 1)
                                }
                            }
                            let max = 0
                            let sourceLang = ""
                            for (let [key, value] of languageMap) {
                                if (value > max) {
                                    max = value
                                    sourceLang = key
                                }
                            }
                            let pageLanguage = sourceLang
                            console.log('after translate pageLanguage:', pageLanguage)
                            if (sourceLang == params.targetLang && params.defaultStrategy == DOMAIN_STRATEGY.AUTO && params.autoTrigger) {
                                translateFlag = false
                                return
                            }
                        }
                        // don't translate the element with same source and target language
                        // traversal remove element that has the same source and target language in reverse order
                        for (let i = res.length - 1; i >= 0; i--) {
                            if (res[i].sourceLang == params.targetLang) {
                                // delete the res[i] and originalHtmlElements[i]
                                res.splice(i, 1)
                                originalHtmlElements.splice(i, 1)
                            }
                        }
                        if (originalHtmlElements.length == 0) {
                            return;
                        }
                        console.log('originalHtmlElements:', originalHtmlElements)
                        let notTranslatedElements = afterTranslate(originalHtmlElements, res)
                        for (let originalHtmlElement of originalHtmlElements) {
                            originalHtmlElement.removeAttribute("duo-no-observer")
                        }
                        // console.log('notTranslatedElements:', notTranslatedElements)
                        // if (params.isBody) {
                        //     // go here means the page is translated
                        //     setSessionStorage(tabTranslateStatusKey, true)
                        //     tabTranslateStatus = true
                        // }
                    }
                })
                return translateFlag
            } catch (e) {
                console.error('translateCollectedElements error:', e)
                return false
            }
        }

        function getCSSRuleString(style: string) {
            let cssRule = ""
            switch (style) {
                case 'noneStyleSelect':
                    cssRule = 'border: none;'
                    break;
                case 'solidBorder':
                    cssRule = 'border: 2px solid;'
                    break
                case 'dottedBorder':
                    cssRule = 'border: 2px dotted;'
                    break
                case 'dashedBorder':
                    cssRule = 'border: 2px dashed;'
                    break;
                case "wavyLine":
                    cssRule = 'text-decoration: wavy underline;'
                    break;
                case "doubleLine":
                    cssRule = 'text-decoration: underline double;'
                    break;
                case "underLine":
                    cssRule = 'text-decoration: underline;'
                    break;
                case "dottedLine":
                    cssRule = 'text-decoration: underline dotted;'
                    break;
                case "dashedLine":
                    cssRule = 'text-decoration: underline dashed;'
                    break;
            }
            if (style?.endsWith("Line")) {
                cssRule += `text-underline-offset: 4px;`
            } else {
                // cssRule += `padding: 4px;`
            }
            return cssRule

        }

        async function toggleSelectionMode() {
            // get all the rules of the current domain from the db, find the element and add class duo-selected
            let rules = await listRuleFromDB()
            console.log('rules:', rules)
            if (rules) {
                for (let rule of rules) {
                    let element = document.querySelector(rule);
                    if (element) {
                        element.classList.add('duo-selected')
                    }
                }
            }
            addEventListeners();
        }

        const mouseRightHandler = function (event: MouseEvent) {
            if (event.button === 2) {
                deactivateSelectionMode()
            }
        }
        const contextMenuHandler = function (event: MouseEvent) {
            event.preventDefault()
        }

        function addEventListeners() {
            document.addEventListener('mouseover', highlightElement);
            document.addEventListener('mousedown', mouseRightHandler);
        }

        function addRuleToDB(rule: string) {
            sendMessageToBackground({action: DB_ACTION.RULES_ADD, data: {domain: domainWithPort, data: rule}})
        }

        function listRuleFromDB() {
            return sendMessageToBackground({action: DB_ACTION.RULES_LIST, data: {domain: domainWithPort}})
        }

        function deleteRuleFromDB(rule: string) {
            sendMessageToBackground({action: DB_ACTION.RULES_DEL, data: {domain: domainWithPort, data: rule}})
        }

        function modeRuleAddStyle(element: HTMLElement) {
            // element.style.cursor = cursorAddUrl;
            element.style.setProperty('cursor', cursorAddUrl, 'important');
            childrenCursorCache.add(element)
            const children = element.querySelectorAll('*'); // Selects all children of the parent element
            children.forEach(child => {
                let ele = child as HTMLElement
                // ele.style.setProperty('cursor', cursorAddUrl, 'important');
                ele.style.setProperty('cursor', cursorAddUrl, 'important');
                childrenCursorCache.add(ele)
            });
            element.style.setProperty('outline', '2px solid green', 'important');
            // element.style.outline = "2px solid green !important";
        }

        function modeRuleDeleteStyle(element: HTMLElement) {
            // element.style.cursor = cursorTrashUrl;
            // element.style.setProperty('cursor', cursorTrashUrl, 'important');
            element.style.setProperty('cursor', cursorTrashUrl, 'important');
            childrenCursorCache.add(element)
            const children = element.querySelectorAll('*'); // Selects all children of the parent element
            children.forEach(child => {
                let ele = child as HTMLElement
                ele.style.setProperty('cursor', cursorTrashUrl, 'important');
                childrenCursorCache.add(ele)
            });
            element.style.setProperty('outline', '2px solid red', 'important');
            // element.style.outline = "2px solid red !important";
        }

        // @ts-ignore
        function highlightElement(event) {
            console.log('highlightElement', event.target)
            let currentElement = event.target;
            if (currentElement === document.body || currentElement === document.documentElement) {
                return
            }
            // The parent element of the current element is a duo-selected element and is not processed
            while (currentElement && currentElement !== document.body && currentElement !== document.documentElement) {
                if (currentElement.className.includes("duo-selected")) {
                    // Set the deletion style
                    modeRuleDeleteStyle(currentElement)
                    const handler = function (event: Event) {
                        console.log('inner')
                        event.preventDefault();
                        event.stopPropagation();
                        selectElementClicked(currentElement)
                    }
                    currentElement.onmouseout = function (event: Event) {
                        event.preventDefault();
                        // event.stopPropagation();
                        currentElement.style.outline = ""
                        currentElement.removeEventListener('click', handler);
                    }
                    currentElement.addEventListener('click', handler);
                    // set the style of all child elements for the current element
                    let children = currentElement.querySelectorAll("*")
                    children.forEach((ele: HTMLElement) => {
                        // ele.style.cursor = cursorTrashUrl;
                        ele.style.setProperty('cursor', cursorTrashUrl, 'important');
                        childrenCursorCache.add(ele)
                    })
                    return
                }
                currentElement = currentElement.parentElement
            }
            // The smallest unit element is a paragraph, and the current element must be a child or parent of the duo-paragraph element
            let element
                = event.target as HTMLElement
            let elementAddRuleStyle = setElementAddRuleStyle(element);
            if (elementAddRuleStyle) {
                const clickHandler = function (event: Event) {
                    event.preventDefault();
                    event.stopPropagation();
                    selectElementClicked(elementAddRuleStyle)
                }
                elementAddRuleStyle.addEventListener('click', clickHandler);
                elementAddRuleStyle.onmouseout = function (event: Event) {
                    event.preventDefault();
                    // event.stopPropagation();
                    elementAddRuleStyle.style.outline = ""
                    elementAddRuleStyle?.removeEventListener('click', clickHandler);
                }
            }

        }


        function selectElementClicked(ele: HTMLElement) {
            if (ele.classList.contains("duo-selected")) {
                ele.classList.remove("duo-selected")
                modeRuleAddStyle(ele)
                // save to db
                let selector = getCssSelectorString(ele)
                deleteRuleFromDB(selector)
                // remove class duo-no-translate
                ele.classList.remove("duo-no-translate")
            } else {
                // if ele's parent element has duo-selected, remove it
                let parent = ele.parentElement
                while (parent) {
                    if (parent.classList.contains("duo-selected")) {
                        parent.classList.remove("duo-selected")
                        modeRuleAddStyle(parent)
                        deleteRuleFromDB(getCssSelectorString(parent))
                        parent.classList.remove("duo-no-translate")
                        return
                    }
                    parent = parent.parentElement as HTMLElement
                }
                if (ele.classList.length == 0) {
                    ele.setAttribute("class", "duo-selected")
                } else {
                    ele.classList.add("duo-selected")
                }
                // remove children element that has duo-selected
                let children = ele.querySelectorAll(".duo-selected")
                children.forEach(child => {
                    child.classList.remove("duo-selected")
                    // save to db
                    let selector = getCssSelectorString(child as HTMLElement)
                    deleteRuleFromDB(selector)
                    child.classList.remove("duo-no-translate")
                })
                addRuleToDB(getCssSelectorString(ele))
                ele.classList.add("duo-no-translate")
                modeRuleDeleteStyle(ele)
            }
        }

        function setElementAddRuleStyle(element: HTMLElement): HTMLElement | undefined {
            console.log('setElementAddRuleStyle:', element)
            if (element.classList.contains("duo-paragraph")) {
                modeRuleAddStyle(element)
                return element
            } else {
                let query = element.querySelectorAll(".duo-paragraph")
                if (query.length > 0) {
                    modeRuleAddStyle(element)
                    return element
                } else {
                    // find the parent element of the current element that has the duo-paragraph class
                    let parent = element.parentElement
                    while (parent) {
                        if (parent.classList.contains("duo-paragraph")) {
                            modeRuleAddStyle(parent)
                            // set the style of all child elements of the current element
                            let children = parent.querySelectorAll("*")
                            for (let child of children) {
                                let ele = child as HTMLElement
                                // ele.style.cursor = cursorAddUrl;
                                ele.style.setProperty('cursor', cursorAddUrl, 'important');
                                childrenCursorCache.add(ele)
                            }
                            return parent
                        }
                        parent = parent.parentElement as HTMLElement
                    }
                    return undefined
                }
            }
        }

        let childrenCursorCache: Set<HTMLElement> = new Set()
        let selectionModeActive = false;

        function deactivateSelectionMode() {
            document.addEventListener('contextmenu', contextMenuHandler);
            console.log('deactivateSelectionMode')
            selectionModeActive = false;
            // remove all element that have duo-selected
            document.querySelectorAll('.duo-selected').forEach((element) => {
                element.classList.remove('duo-selected');
            })
            childrenCursorCache.forEach((ele) => {
                ele.style.cursor = 'auto';
            })
            document.removeEventListener('mouseover', highlightElement);
            document.removeEventListener('mousedown', mouseRightHandler);
            setTimeout(() => {
                document.removeEventListener('contextmenu', contextMenuHandler);
            }, 200)

        }

        function generateSelector(element: HTMLElement) {
            let path = [], current = element;
            while (current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
                const tagName = current.tagName.toLowerCase();
                const id = current.id ? `#${current.id}` : '';
                let className = current.className ? `.${current.className.trim().replace(/\s+/g, '.')}` : '';
                path.unshift(`${tagName}${id}${className}`);
                if (current.parentNode != null) {
                    current = current.parentNode as HTMLElement;
                }
            }
            return path.join(" > ");
        }

        /**
         * Split the array into multiple arrays of the specified size
         * @param elements
         * @param size
         */
        function splitElements<T>(elements: T[], size: number): T[][] {
            const result: T[][] = [];
            for (let i = 0; i < elements.length; i += size) {
                result.push(elements.slice(i, i + size));
            }
            return result;
        }
    }
})
;
