import {browser} from "wxt/browser";
import {sendMessageToBackground} from "@/entrypoints/utils";
import {split} from "sentence-splitter"
import {
    ACTION,
    CONFIG_KEY,
    DB_ACTION,
    DOMAIN_STRATEGY,
    STORAGE_ACTION,
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

export default defineContentScript({
    // matches: ['<all_urls>'],
    matches: ['https://*/*', 'http://*/*'],
    cssInjectionMode: 'manual',
    async main(ctx) {
        async function getGlobalSwitch() {
            let globalSwitch = await getConfig(CONFIG_KEY.GLOBAL_SWITCH)
            return globalSwitch === null ? true : globalSwitch
        }

        let process = false
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
        // record the elements before translated, for show original
        let originalElementRecords: HTMLElement[] = []
        let translateElementRecords: HTMLElement[] = []
        // Get the domain name and port of the current page
        let currentUrl = window.location.href;
        const domain = getDomainFromUrl(currentUrl);
        const domainWithPort = getDomainWithPortFromUrl(currentUrl);
        if (domainWithPort == null) {
            return
        }
        // collect all the paragraph elements, by the way add duo-paragraph class
        let ruleStrategy = await listRuleFromDB()
        ruleStrategyProcess(ruleStrategy)
        markParagraphElement(document.body)
        let pageLanguage = detectLanguage()
        console.log('domain:', domain)
        // get the id of the current tab,which used unique defines the page
        let tabId = await sendMessageToBackground({action: TB_ACTION.TAB_ID_GET})
        let userLanguage = navigator.language
        let tabTranslateStatusKey = "tabTranslateStatus#" + tabId
        console.log("tabId: ", tabId)
        // when page first loaded, set translate status to false
        await sendMessageToBackground({
            action: STORAGE_ACTION.SESSION_SET,
            data: {key: tabTranslateStatusKey, value: false}
        })


        let isTranslating = false;
        let pendingTranslations: (() => void)[] = [];

        function queueTranslation(task: () => Promise<void>) {
            if (!isTranslating) {
                pendingTranslations.push(task);
            }
            if (!isTranslating) processQueue();
        }

        async function processQueue() {
            if (isTranslating) return;
            isTranslating = true;

            while (pendingTranslations.length > 0) {
                const currentTask = pendingTranslations.shift();
                if (currentTask) await currentTask();
            }

            isTranslating = false;
        }


        // observe the dom change, translate the new added elements
        let observer = new MutationObserver(async mutations => {
            mutations.forEach(mutation => {
                // console.log('mutation root:', mutation)
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        // if the node is not a HTMLElement, return
                        if (!(node instanceof HTMLElement)) {
                            return
                        }
                        let element = node as HTMLElement

                        // don't observe the element with duo-no-observer attribute
                        if (hasAttributeIncludingParents(element, "duo-no-observer")) {
                            return
                        }
                        console.log('mutation:', element.cloneNode(true).textContent)

                        markParagraphElement(element)
                        // get translate status of the current tab
                        getSessionStorage(tabTranslateStatusKey).then((status) => {
                            if (status) {
                                translateRoot(element)
                            }
                        });
                    });
                }
            });

            // queueTranslation(async () => {
            //     // Process each mutation only once per queue execution
            //     let notTranslated = Array.from(document.body.querySelectorAll('.duo-translated')) as HTMLElement[]
            //     notTranslated = notTranslated.filter(element => !element.querySelector('.duo-translation'));
            //     console.log('notTranslated:', count, notTranslated)
            //     await translateCollectedElements(notTranslated, {targetLang:"zh",serviceName:"microsoft",},beforeDuoTranslate,afterDuoTranslate)
            // });

            // search the element that have duo-translated class but not have duo-translation class children actually, we think it is not translated
            if (process) {
                return
            }
            process = true
            setTimeout(async () => {
                try {
                    if (!(await getGlobalSwitch())) {
                        return
                    }
                    let notTranslated = Array.from(document.body.querySelectorAll('.duo-translated')) as HTMLElement[]
                    notTranslated = notTranslated.filter(element => !element.querySelector('.duo-translation'));
                    let [viewStrategy, targetLanguage, translateService]: [string, string, string] = await Promise.all(
                        [
                            getConfig(CONFIG_KEY.VIEW_STRATEGY),
                            getConfig(CONFIG_KEY.TARGET_LANGUAGE),
                            getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
                        ]
                    )
                    viewStrategy = viewStrategy || VIEW_STRATEGY.DOUBLE
                    translateService = translateService || TRANS_SERVICE.MICROSOFT
                    targetLanguage = targetLanguage || navigator.language
                    console.log('notTranslated:', notTranslated)
                    let params = new translateParams(translateService, targetLanguage, undefined)
                    switch (viewStrategy) {
                        case VIEW_STRATEGY.DOUBLE:
                            await translateCollectedElements(notTranslated, params, beforeDuoTranslate, afterDuoTranslate)
                            break
                        case VIEW_STRATEGY.SINGLE:
                            await translateCollectedElements(notTranslated, params, undefined, afterTranslate)
                            break
                        case VIEW_STRATEGY.BUTTON:
                            break
                    }

                } finally {
                    process = false
                }
            }, 100)


        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            // attributes: true,
            // characterData: true,
            // characterDataOldValue: true,
            // attributeOldValue: true
        });

        const getCssSelectorString = (ele: HTMLElement): string => {
            // ignore the elements with class start with duo
            return getCssSelector(ele, {selectors: ["id", "class", "tag"], blacklist: ['.duo-*']})
        }


        const svgAddCursor = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 0C5.37259 0 0 5.37259 0 12C0 18.6274 5.37259 24 12 24C18.6274 24 24 18.6274 24 12C24 5.37259 18.6274 0 12 0Z" fill="white"/>
<path d="M12 0C5.37259 0 0 5.37259 0 12C0 18.6274 5.37259 24 12 24C18.6274 24 24 18.6274 24 12C24 5.37259 18.6274 0 12 0ZM17.7664 13.3668H13.377V17.7674C13.377 18.5248 12.7574 19.1445 12 19.1445C11.2426 19.1445 10.623 18.5248 10.623 17.7674V13.3668H6.23161C5.47423 13.3668 4.85456 12.7471 4.85456 11.9898C4.85456 11.2324 5.47423 10.6127 6.23161 10.6127H10.623V6.23266C10.623 5.47528 11.2426 4.85561 12 4.85561C12.7574 4.85561 13.377 5.47528 13.377 6.23266V10.6127H17.7664C18.5237 10.6127 19.1434 11.2324 19.1434 11.9898C19.1434 12.7471 18.5237 13.3668 17.7664 13.3668Z" fill="#48BE78"/>
</svg>`;

        const svgTrashCursor = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21 3.99998H17.9C17.4215 1.67358 15.3751 0.003 13 0H10.9999C8.62483 0.003 6.57836 1.67358 6.09995 3.99998H2.99997C2.44769 3.99998 1.99998 4.44769 1.99998 4.99997C1.99998 5.55225 2.44769 6 2.99997 6H3.99995V19C4.00328 21.76 6.23992 23.9967 8.99997 24H15C17.76 23.9967 19.9967 21.76 20 19V6H21C21.5523 6 22 5.5523 22 5.00002C22 4.44773 21.5523 3.99998 21 3.99998Z" fill="white"/>
<path d="M21 3.99998H17.9C17.4215 1.67358 15.3751 0.003 13 0H11C8.62484 0.003 6.57837 1.67358 6.09997 3.99998H2.99998C2.4477 3.99998 2 4.44769 2 4.99997C2 5.55225 2.4477 6 2.99998 6H3.99997V19C4.0033 21.76 6.23994 23.9967 8.99998 24H15C17.76 23.9967 19.9967 21.76 20 19V6H21C21.5523 6 22 5.5523 22 5.00002C22 4.44773 21.5523 3.99998 21 3.99998ZM11 17C11 17.5523 10.5523 18 10 18C9.44769 18 8.99998 17.5523 8.99998 17V11C8.99998 10.4477 9.44769 10 9.99997 10C10.5522 10 11 10.4477 11 11V17H11ZM15 17C15 17.5523 14.5523 18 14 18C13.4477 18 13 17.5523 13 17V11C13 10.4477 13.4477 10 14 10C14.5523 10 15 10.4477 15 11V17ZM8.171 3.99998C8.59634 2.80228 9.72903 2.00152 11 1.99997H13C14.271 2.00152 15.4037 2.80228 15.829 3.99998H8.171Z" fill="#FF554A"/>
</svg>`

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

        async function restoreOriginalPage() {
            console.log('restore original page')
            for (let i = 0; i < translateElementRecords.length; i++) {
                let ele = translateElementRecords[i]
                let originalEle = originalElementRecords[i]
                if (ele && originalEle) {
                    ele.innerHTML = originalEle?.innerHTML
                    ele.removeAttribute("duo-no-observer")
                    ele.classList.remove("duo-translated")
                }
            }
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

        // Accept messages from popups, process the task
        browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
            console.log('content script receive message:', message)
            let params: translateParams
            switch (message.action) {
                case TRANS_ACTION.TRANSLATE:
                case TRANS_ACTION.DOUBLE:
                case TRANS_ACTION.SINGLE:
                    await translateRoot(document.body)
                    break
                case TRANS_ACTION.ORIGIN:
                    console.log('show original')
                    // restore original page
                    // observer.disconnect()
                    await showOriginal()
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
                    let strategy = message.data
                    console.log("domain strategy change: ", strategy)
                    // get global switch status
                    let globalSwitch = await getGlobalSwitch()
                    if (globalSwitch) {
                        return await translateStrategyProcess(strategy)
                    } else {
                        return false
                    }
                case ACTION.TRANSLATE_CHANGE:
                    console.log('translate change:', message.data)
                    // restore original page
                    // observer.disconnect()
                    await restoreOriginalPage()
                    await translateRoot(document.body)
                    // document.body.innerHTML = domContent
                    return
                default:
                    break
            }
        });
        let domainStrategy = (await sendMessageToBackground({
            action: DB_ACTION.DOMAIN_GET,
            data: {domain: domainWithPort}
        }))?.strategy || DOMAIN_STRATEGY.AUTO
        console.log('domainStrategy:', domainStrategy)
        //get the global switch status
        let globalSwitch = await getGlobalSwitch()
        if (globalSwitch) {
            // return
            await translateStrategyProcess(domainStrategy)
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
                    paragraphList.push(paragraphElement.textContent)
                }
            }
            let randomParagraphs = paragraphList.sort(() => 0.5 - Math.random()).slice(0, 20)
            return translationServices.get(TRANS_SERVICE.MICROSOFT)?.detectLanguage?.(randomParagraphs)
        }

        async function translateStrategyProcess(domainStrategy: string) {
            // get the translation status of the current tab
            let translateStatus = await sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_GET,
                data: {key: tabTranslateStatusKey}
            })
            if (domainStrategy == DOMAIN_STRATEGY.ALWAYS) {
                if (translateStatus) {
                    return true
                }
                await translateRoot(document.body)
                return true
            } else if (domainStrategy == DOMAIN_STRATEGY.NEVER) {
                if (translateStatus) {
                    await restoreOriginalPage()
                }
                return false
            }
            console.log('translateStrategyProcess:', domainStrategy)
            // get default strategy
            let defaultStrategy = await getConfig(CONFIG_KEY.DEFAULT_STRATEGY) || DOMAIN_STRATEGY.AUTO
            // If the target language is empty, set to the system language
            let targetLanguage = await getConfig(CONFIG_KEY.TARGET_LANGUAGE) || navigator.language
            switch (defaultStrategy) {
                case DOMAIN_STRATEGY.AUTO:
                    // If the language of the current page is the same as the target language, it will not be translated
                    // there modify to detect page language by use translate api
                    let sourceLanguage = await pageLanguage
                    if (!sourceLanguage || sourceLanguage == "" || sourceLanguage == 'und') {
                        // if the language is not detected, get the language from the tab
                        sourceLanguage = await sendMessageToBackground({action: TB_ACTION.TAB_LANG_GET})
                    }
                    console.log('sourceLanguage:', sourceLanguage, 'targetLanguage:', targetLanguage)
                    if (sourceLanguage == targetLanguage) {
                        await setSessionStorage(tabTranslateStatusKey, false)
                        return false
                    } else {
                        await setSessionStorage(tabTranslateStatusKey, true)
                        await translateRoot(document.body)
                        // observer.observe(document.body, {childList: true, subtree: true});
                        return true
                    }
                case DOMAIN_STRATEGY.ALWAYS:
                    await translateRoot(document.body)
                    // observer.observe(document.body, {childList: true, subtree: true});
                    await setSessionStorage(tabTranslateStatusKey, true)
                    return true
                case DOMAIN_STRATEGY.ASK:
                    // todo A dialog box pops up asking if you want to translate
                    return false
                case DOMAIN_STRATEGY.NEVER:
                    return false
            }
            return false
        }

        async function showOriginal() {
            await restoreOriginalPage()
            await sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_SET,
                data: {key: tabTranslateStatusKey, value: false}
            })
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

        // translate the root DOM tree
        async function translateRoot(root: HTMLElement) {
            // if the root is body, it means the page is reloaded, or re translated
            if (root == document.body) {
                originalElementRecords = []
            }
            let [ruleStrategy, viewStrategy, targetLanguage, translateService, globalSwitch]
                : [string[], string, string, string, boolean] = await Promise.all(
                [
                    listRuleFromDB(),
                    getConfig(CONFIG_KEY.VIEW_STRATEGY),
                    getConfig(CONFIG_KEY.TARGET_LANGUAGE),
                    getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
                    getConfig(CONFIG_KEY.GLOBAL_SWITCH)
                ]
            )
            viewStrategy = viewStrategy || VIEW_STRATEGY.DOUBLE
            globalSwitch = globalSwitch === null ? true : globalSwitch
            translateService = translateService || TRANS_SERVICE.MICROSOFT
            targetLanguage = targetLanguage || navigator.language
            let params = new translateParams(translateService, targetLanguage, undefined)
            console.log('viewStrategy:', viewStrategy, 'tabLanguage:', targetLanguage, 'translateService:', translateService, 'globalSwitch:', globalSwitch)
            ruleStrategyProcess(ruleStrategy)
            if (globalSwitch) {
                switch (viewStrategy) {
                    case VIEW_STRATEGY.DOUBLE:
                        await translateDuoDOM(root, params)
                        break
                    case VIEW_STRATEGY.SINGLE:
                        translateDOM(root, params)
                        break
                    case VIEW_STRATEGY.BUTTON:
                        break
                }
            }

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
            // remove the elements with duo-no-translate,duo-translation,notranslate class
            elements = elements.filter((element) => {
                return !ifElementWithParentMatchCondition(element, isTranslateExcludedElement)
            })
            return elements
        }

        function isTranslateExcludedElement(element: HTMLElement): boolean {
            // todo support user defined class to exclude translation
            // limit the element with text content that is number // last condition
            return element.classList.contains('duo-no-translate') || element.classList.contains("duo-translation") || element.classList.contains('notranslate') ||
                element.hasAttribute("duo-no-observer") || (element.textContent!.match(/^[0-9\s]*$/) != null)
        }

        function ifElementWithParentMatchCondition(element: HTMLElement, condition: (element: HTMLElement) => boolean): boolean {
            if (condition(element)) {
                return true
            }
            if (element.parentElement) {
                return ifElementWithParentMatchCondition(element.parentElement as HTMLElement, condition)
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

        // search and add the duo-paragraph class to the paragraph element for marking
        function markParagraphElement(element: HTMLElement) {
            if (!(element instanceof HTMLElement)) {
                return;
            }
            let nodeName = element.nodeName.toLowerCase();
            // console.log('nodeName:', nodeName)
            // todo support user defined tag to exclude
            if (nodeName === 'script' || nodeName === 'style' || nodeName === 'comment' || ifElementWithParentMatchCondition(element, isParagraphExcludedElement)) {
                return;
            }
            if (element.style.display === 'none') {
                return;
            }
            // if the element is able to input, don't translate
            if (isEditable(element)) {
                return;
            }
            if (isParagraphElement(element)) {
                // Deletes all annotation nodes for the current element
                for (let i = 0; i < element.childNodes.length; i++) {
                    if (element.childNodes[i].nodeType === Node.COMMENT_NODE) {
                        element.removeChild(element.childNodes[i]);
                    }
                }
                // add duo-paragraph class
                element.classList.add('duo-paragraph')
                return;
            }
            // Recursively traverses all children of the current element
            for (let i = 0; i < element.childNodes.length; i++) {
                let currentNode = element.childNodes[i];
                if (currentNode.nodeType === 1) { // check if the node is an element node
                    markParagraphElement(currentNode as HTMLElement);
                } else if (currentNode.nodeType === 3) {
                    // set the text node to paragraph element
                    // create a custom element to wrap the text node
                    let paraElement = document.createElement('duo-span')
                    paraElement.classList.add('duo-paragraph')
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
                    element.replaceChild(paraElement, originalNode)
                }
            }

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
//
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
            console.log("splitHtml", whiteSpace)
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
         */
        function translateDOM(tree: HTMLElement, params: translateParams) {
            let needTranslateElement = collectElementsToTranslate(tree)
            translateCollectedElements(needTranslateElement, params, undefined, afterTranslate)
        }

        function afterTranslate(needTranslateElement: HTMLElement[], res: TranslatedElement[]) {
            for (let i = 0; i < needTranslateElement.length; i++) {
                console.log('res:', res[i])
                originalElementRecords.push(needTranslateElement[i].cloneNode(true) as HTMLElement)
                let cloneElement = needTranslateElement[i].cloneNode(true) as HTMLElement
                cloneElement.innerHTML = res[i].translatedText
                console.log('cloneElement:', cloneElement)
                needTranslateElement[i].innerHTML = cloneElement.firstElementChild?.innerHTML! || cloneElement.textContent || needTranslateElement[i].innerHTML
                // identify the element that has been translated, in some cases, the translated element possibly be recovered(but attribute remained)
                let translation = document.createElement('duo-translation')
                translation.classList.add("duo-translation")
                translation.style.display = 'none'
                needTranslateElement[i].appendChild(translation)
                translateElementRecords.push(needTranslateElement[i])
                // when translated, set duo-no-observer attribute
                needTranslateElement[i].setAttribute("duo-no-observer", "true")
                needTranslateElement[i].classList.add("duo-translated")
                console.log('needTranslateElement:', needTranslateElement[i].textContent)
                // needTranslateElement[i].classList.add("duo-translated")

            }
        }

        /**
         * Translate the DOM tree for bilingual
         * @param tree
         * @param params
         */
        async function translateDuoDOM(tree: HTMLElement, params: translateParams) {
            console.log('translateDuoDOM enter:', tree)
            if (!(tree instanceof HTMLElement)) {
                return;
            }
            let elements = collectElementsToTranslate(tree)
            if (!elements) {
                return
            }
            translateCollectedElements(elements, params, beforeDuoTranslate, afterDuoTranslate)
        }

        function beforeDuoTranslate(elements: HTMLElement[]): HTMLElement[] {
            console.log('beforeDuoTranslate:', elements)
            let originalHtmlElements: HTMLElement[] = []
            for (let element of elements) {
                console.log('translateDuoDOM element:', element.cloneNode(true))
                originalElementRecords.push(element.cloneNode(true) as HTMLElement)
                translateElementRecords.push(element)
                element.setAttribute("duo-no-observer", "true")
                // console.log('element:', element.innerHTML)
                // const sentences = split(element.innerHTML).filter((node) => node.type === 'Sentence');
                let tagStack: string[] = []
                console.log('element:', element.innerHTML)
                const sentences = splitHtml(element.innerHTML)
                console.log('sentences:', sentences)
                element.innerHTML = ""
                for (let i = 0; i < sentences.length; i++) {
                    let sentence = sentences[i]
                    let span = document.createElement('span');

                    // process the raw html to fix tag mismatch
                    let rawHtml = sentence
                    console.log('rawHtml1:', rawHtml)
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
                            console.log('tagName:', tagName);
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
                    console.log('sentences:', rawHtml)
                    span.setAttribute("duo-sequence", i.toString())
                    span.classList.add("duo-sentence")
                    // element.appendChild(span) // probably cause the page refresh all the time issue
                    element.innerHTML += span.outerHTML

                }
                // element.setAttribute("duo-no-observer", "true")
                originalHtmlElements.push(element)

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
            for (let i = 0; i < originalHtmlElements.length; i++) {
                let element = originalHtmlElements[i]
                let elementCloned = element.cloneNode(false) as HTMLElement
                elementCloned.innerHTML = res[i].translatedText
                if (elementCloned.textContent?.trim() !== "" && elementCloned.textContent !== originalHtmlElements[i].textContent) {
                    let duoElement = document.createElement('font')
                    duoElement.classList.add("duo-translation")
                    duoElement.setAttribute("duo-no-observer", "true")
                    duoElement.innerHTML = elementCloned.firstElementChild?.innerHTML!
                    // If the current text is longer than 40 characters, add a line break. Otherwise, add a space
                    if (element.textContent!.length > 40) {
                        element.appendChild(document.createElement('br'));
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
                        if (element.textContent?.includes("Examples")) {
                            console.log('elementWidth:', elementWidth, 'width:', allChildrenWidth)
                        }
                        if (Math.floor(allChildrenWidth) > Math.ceil(elementWidth)) {
                            divide.outerHTML = '<br>'
                        }

                        // need determine the length of current element whether wrap the text line
                        // let tempElement = element.cloneNode(true) as HTMLElement
                        // let tempElement = cloneElementWithStyles(element)
                        // tempElement.appendChild(document.createTextNode(' '));
                        // tempElement.appendChild(duoElement.cloneNode(true))
                        // tempElement.style.display = 'inline'
                        // tempElement.style.visibility = 'hidden'
                        // tempElement.style.position = 'absolute';
                        // tempElement.style.width = ''
                        // // tempElement.style.overflow = 'visible'
                        // tempElement.style.whiteSpace = ''
                        // tempElement.style.textOverflow = ''
                        // document.body.appendChild(tempElement);
                        // const textWidth = tempElement.offsetWidth;
                        // const textHeight = tempElement.offsetHeight;
                        // element.appendChild(duoElement)
                        // if (tempElement.textContent?.includes("Bootstrap Project")) {
                        //     console.log('tempElement:', tempElement)
                        //     console.log('duoElement:', duoElement)
                        //     console.log('textWidth:', textWidth)
                        //
                        //     console.log('copyElement:', element)
                        //     console.log('copyElement.offsetWidth:', element.offsetWidth)
                        //     console.log('copyElement.offsetHeight:', element.offsetHeight)
                        //     console.log('textHeight:', textHeight)
                        // }

                        // if (textWidth > element.offsetWidth) {
                        //     divide.outerHTML = '<br>'
                        // }
                        // document.body.removeChild(tempElement);

                    }
                    element.classList.add("duo-original")
                    element.classList.add("duo-translated")
                    // cancel the element high limit
                    element.style.setProperty("max-height", "none", "important")
                    element.style.setProperty("-webkit-line-clamp", "none", "important")
                    // recursively find the parent element with max-height and -webkit-line-clamp
                    let operateElement :HTMLElement|null = element
                    while (operateElement) {
                        if (operateElement.style.maxHeight !== "") {
                            // record the element original max-height
                            operateElement.setAttribute("duo-max-height", operateElement.style.maxHeight)
                            operateElement.classList.add("duo-height-break")
                            operateElement.style.setProperty("max-height", "none", "important")
                        }
                        if (operateElement.style.webkitLineClamp !== ""){
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
        }

        async function translateCollectedElements(elements: HTMLElement[], params: translateParams, beforeTranslate?: (elements: HTMLElement[]) => HTMLElement[],
                                                  afterTranslate?: (elements: HTMLElement[], res: TranslatedElement[]) => void) {
            let originalHtmlElements: HTMLElement[] = elements
            if (beforeTranslate) {
                console.log('beforeTranslate11:', elements)
                originalHtmlElements = beforeTranslate(elements)
            }
            console.log('originalHtmlElements:', originalHtmlElements)
            // return
            await translationServices.get(params.serviceName)?.translateHtml?.(originalHtmlElements, params.targetLang, params.sourceLang).then((res :TranslatedElement[]) => {
                console.log('res:', res,'elements length', elements.length,'res length',res.length)
                if (afterTranslate && res) {
                    // don't translate the element with same source and target language
                    // traversal remove element that has the same source and target language in reverse order
                    for (let i = res.length-1; i >= 0; i--) {
                        if (res[i].sourceLang == params.targetLang) {
                            // delete the res[i] and originalHtmlElements[i]
                            res.splice(i, 1)
                            originalHtmlElements.splice(i, 1)
                        }
                    }
                    afterTranslate(originalHtmlElements, res)
                }

            })
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
