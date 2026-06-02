import getCssSelector from "css-selector-generator";
import { franc } from "franc";
import { split } from "sentence-splitter";
import { TB_ACTION, TRANSLATE_STATUS_KEY, CONFIG_KEY, DB_ACTION, TRANS_SERVICE, DOMAIN_STRATEGY, svgAddCursor, svgTrashCursor, TRANS_ACTION, ACTION, STORAGE_ACTION, iso6393To1Map, excludedTagSet, VIEW_STRATEGY, DEFAULT_STRATEGY, ELEMENT_STATUS, APP_NAME, APP_NAME_WITH_SUFFIX, EXCLUDE_CHILD_ELEMENT_TAGS, DEFAULT_VALUE } from "./constants";
import { restore, translationServices, translateParams, getTranslateResult, translate, TranslateResult, resetTranslationCacheEnabled } from "./translateService";
import { sendMessageToBackground } from "../utils/message";
import { browser } from "wxt/browser"
import { shuffle } from "@/utils/arrays";
import { mountFloatBall, type FloatBallController } from "./floatBall";
import { mountAiWritingDot } from "./aiWriting/floatingDot";
import { openWorkbench, ensureWorkbenchMounted } from "./aiWriting/workbench";
import { addRuleToDB, deleteRuleFromDB, getConfig, listRuleFromDB } from "@/utils/db";
import { isTraditionalChinese } from "@/utils/language";
import { startTranslate } from "./aiWriting/translateRunner";
import { applyTextToTarget } from "./aiWriting/applyText";
import { getElementText } from "@/utils/dom";
import { getDomainWithPortFromUrl } from "@/utils/url";

export async function content() {
    console.log('content script loaded');
    let translateElements: Set<HTMLElement> = new Set()

    // Constructable Stylesheet for translation + bilingual highlighting CSS.
    // - Lives in document.adoptedStyleSheets, not the DOM, so it doesn't
    //   trigger our own MutationObserver and can't be removed by hostile pages.
    // - replaceSync() swaps the whole rule set in one call (no innerText
    //   re-parsing on every keystroke from the options color picker).
    let translationStyleSheet: CSSStyleSheet | null = null

    let batchElements: HTMLElement[] = [];
    let batchTimer: NodeJS.Timeout | null = null
    const pendingTranslateParagraphElementsTask: Set<Promise<void>> = new Set()
    let translateTask: Promise<void> | null = null
    let restoreOriginalTask: Promise<void> | null = null
    let controller: AbortController | null = null
    const MARK_BUDGET_MS = 20;
    const MARK_MAX_DEPTH = 50;
    // get the id of the current tab,which used unique defines the page
    const encoder = new TextEncoder();

    // convert the SVG to Base64
    const svgAddBase64 = btoa(svgAddCursor);
    const svgTrashBase64 = btoa(svgTrashCursor);

    // create a data URL for the cursor
    const cursorAddUrl = `url('data:image/svg+xml;base64,${svgAddBase64}'), auto`;
    const cursorTrashUrl = `url('data:image/svg+xml;base64,${svgTrashBase64}'), auto`;

    let pageLanguage = "und"
    let tabId = await sendMessageToBackground({ action: TB_ACTION.ID_GET })
    if (!tabId) {
        return
    }
    let tabTranslateStatusKey = TRANSLATE_STATUS_KEY + tabId
    // Get the domain name and port of the current page
    let currentUrl = window.location.href;
    const domainWithPort = getDomainWithPortFromUrl(currentUrl);
    if (domainWithPort === "") {
        return
    }
    const getCssSelectorString = (ele: HTMLElement): string => {
        // ignore the elements with class start with duo
        return getCssSelector(ele, { selectors: ["id", "class", "tag"], blacklist: ['.duo-*'] })
    }
    let floatBall: FloatBallController | null = null

    // return
    // set translate status to false when the page is loaded
    let translateStatus = false
    persistTranslateStatus(false)
    let manualTrigger = false
    const ignoreMutationElements = new WeakSet();
    const paragraphElementMap = new Map<HTMLElement, ELEMENT_STATUS>();
    let duoTranslatedElementSet = new Set<HTMLElement>()
    let translatedElementMap = new Map<HTMLElement, TranslateResult>()
    // get all config from storage
    let [ruleStrategy, viewStrategy, targetLanguage, translateService, globalSwitch, defaultStrategy,
        rawDomainStrategy, floatBallSwitch, bilingualHighlightingMinSentences, translationLineBreakMinChars]
        : [string[], VIEW_STRATEGY, string, string, boolean, string, any, boolean, number, number] = await Promise.all(
            [
                listRuleFromDB(domainWithPort),
                getConfig(CONFIG_KEY.VIEW_STRATEGY),
                getConfig(CONFIG_KEY.TARGET_LANGUAGE),
                getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.GLOBAL_SWITCH),
                getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
                sendMessageToBackground({ action: DB_ACTION.DOMAIN_GET, data: { domain: domainWithPort } }),
                getConfig(CONFIG_KEY.FLOAT_BALL_SWITCH),
                getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES),
                getConfig(CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS)
            ]
        )
    viewStrategy = viewStrategy || DEFAULT_VALUE.VIEW_STRATEGY
    globalSwitch = globalSwitch === undefined ? true : globalSwitch
    floatBallSwitch = floatBallSwitch === undefined ? true : floatBallSwitch
    translateService = translateService || DEFAULT_VALUE.TRANSLATE_SERVICE
    targetLanguage = targetLanguage || navigator.language.split('-')[0]
    defaultStrategy = defaultStrategy || DEFAULT_VALUE.DOMAIN_STRATEGY
    let domainStrategy = (rawDomainStrategy?.strategy || DOMAIN_STRATEGY.AUTO) as string
    bilingualHighlightingMinSentences = bilingualHighlightingMinSentences || DEFAULT_VALUE.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
    // console.debug("get config:", "ruleStrategy: ", ruleStrategy, "viewStrategy: ", viewStrategy,
    //     "targetLanguage: ", targetLanguage, "translateService: ", translateService, "globalSwitch: ",
    //     globalSwitch, "defaultStrategy: ", defaultStrategy, "domainStrategy: ", domainStrategy)

    // Accept messages from popups, process the task
    // =============================  message listener start  ===================================
    browser.runtime.onMessage.addListener(async (message, sender, sendResponse: (t: any) => void) => {
        console.log('content script receive message:', message)
        switch (message.action) {
            case TRANS_ACTION.TRANSLATE:
                console.log('start translate page')
                await translateAction()
                break
            case TRANS_ACTION.SHOW_ORIGINAL:
                console.log('start restore original page')
                await restoreOriginalAction()
                break
            case TRANS_ACTION.DOUBLE:
            case TRANS_ACTION.SINGLE:
                break
            case TRANS_ACTION.TOGGLE:
                toggleTranslateStatus()
                break
            case ACTION.AI_OPEN_WORKBENCH: {
                ensureWorkbenchMounted()
                const active = document.activeElement as HTMLElement | null
                let seedText = ""
                if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                    seedText = active.value
                } else if (active?.isContentEditable) {
                    seedText = (active.innerText || active.textContent || "").trim()
                } else {
                    const sel = window.getSelection()?.toString() || ""
                    seedText = sel
                }
                openWorkbench({ text: seedText, targetEl: active ?? null })
                break
            }
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
                console.log('strategy change:', message)
                if (message && message.data && typeof message.data === "string") {
                    domainStrategy = message.data || DOMAIN_STRATEGY.AUTO
                    manualTrigger = true
                    switch (domainStrategy) {
                        case DOMAIN_STRATEGY.AUTO:
                            switch (defaultStrategy) {
                                case DEFAULT_STRATEGY.AUTO:
                                    manualTrigger = false
                                    let needTranslate = targetLanguage != pageLanguage
                                    if (translateStatus && !needTranslate) {
                                        await restoreOriginalAction()
                                        return false
                                    } else if (!translateStatus && needTranslate) {
                                        await translateAction()
                                        return true
                                    }
                                case DEFAULT_STRATEGY.NEVER:
                                    if (translateStatus) {
                                        await restoreOriginalAction()
                                    }
                                    return false
                                case DEFAULT_STRATEGY.ALWAYS:
                                    if (!translateStatus) {
                                        await translateAction()
                                    }
                                    return true
                            }
                            break
                        case DOMAIN_STRATEGY.NEVER:
                            if (translateStatus) {
                                await restoreOriginalAction()
                            }
                            return false
                        case DOMAIN_STRATEGY.ALWAYS:
                            if (!translateStatus) {
                                await translateAction()
                            }
                            return true
                    }
                }
                break
            case ACTION.TRANSLATE_SERVICE_CHANGE:
                console.log('translate service change:', message.data)
                let service = message.data as string
                if (service && service != "") {
                    translateService = service
                }
                if (message.active) {
                    if (translateStatus) {
                        await restoreOriginalAction()
                        await translateAction()
                    }
                }
                break
            case ACTION.DEFAULT_STRATEGY_CHANGE:
                if (typeof message.data === "string") {
                    defaultStrategy = message.data
                }
                if (!globalSwitch) {
                    return
                }
                if (domainStrategy == DOMAIN_STRATEGY.ALWAYS || domainStrategy == DOMAIN_STRATEGY.NEVER) {
                    return
                }
                manualTrigger = true // other condition always true
                switch (defaultStrategy) {
                    case DEFAULT_STRATEGY.AUTO:
                        if (domainStrategy == DOMAIN_STRATEGY.AUTO) {
                            manualTrigger = false
                        }
                        if (translateStatus && targetLanguage === pageLanguage) {
                            await restoreOriginalAction()
                        }
                        if (!translateStatus && targetLanguage !== pageLanguage) {
                            await translateAction()
                        }
                        console.log('default strategy:', translateStatus)
                        return translateStatus;
                    case DEFAULT_STRATEGY.NEVER:
                        if (translateStatus) {
                            await restoreOriginalAction()
                        }
                        return false
                    case DEFAULT_STRATEGY.ALWAYS:
                        if (!translateStatus) {
                            await translateAction()
                        }
                        return true // deprecated, return translate status to notify the home page
                    default:
                        break

                }
                break
            case ACTION.GLOBAL_SWITCH_CHANGE:
                console.log('global switch change:', message.data)
                if (typeof message.data === "boolean" && globalSwitch != message.data) {
                    console.log('global switch:', message.data)
                    manualTrigger = false
                    globalSwitch = message.data
                    if (!message.active) {
                        return
                    }
                    if (!globalSwitch) {
                        await unload()
                        return false
                    } else {
                        await init()
                    }
                }
                // return undefined
                // process the global switch change
                break
            case ACTION.VIEW_STRATEGY_CHANGE:
                if (message.data && message.data != "" && viewStrategy != message.data) {
                    viewStrategy = message.data
                } else {
                    return
                }
                if (!message.active) {
                    return
                }
                // process the view strategy change
                if (translateStatus) {
                    await restoreOriginalAction()
                    // await translateAction()
                }
                break
            case ACTION.TRANSLATION_CACHE_SWITCH_CHANGE:
                // Drop the memoized cache-enabled flag so the next translate
                // batch re-reads the toggle.
                resetTranslationCacheEnabled(typeof message.data === "boolean" ? message.data : undefined)
                break
            case ACTION.TARGET_LANG_CHANGE:
                let newLang = message?.data
                if (typeof newLang === "string" && newLang != "" && targetLanguage != newLang) {
                    targetLanguage = newLang
                } else {
                    return
                }
                if (message.active) {
                    await restoreOriginalAction()
                    await translateAction()
                }
                // process the target language change
                break
            case TB_ACTION.FLOAT_BALL_SWITCH:
                if (typeof message.data === "boolean") {
                    console.log('float ball switch:', message.data, "floatBallSwitch:", floatBallSwitch)
                    let newFloatBallSwitch: boolean = message.data
                    floatBallSwitch = newFloatBallSwitch
                    if (newFloatBallSwitch) {
                        await initFloatBall()
                    } else {
                        await removeFloatBall()
                    }

                }
            case TRANS_ACTION.TRANSLATE_TEXT_BOX:
                translateTextBox();
            case TRANS_ACTION.TRANSLATE_PARA:
                if (!lastRightClickElement) return
                translateParagraphElements([lastRightClickElement]);
                break
            case TRANS_ACTION.SHOW_ORIGINAL_PARA:
                if (!lastRightClickElement) return
                restoreOriginalParagraphElement(lastRightClickElement);
                break
            default:
                break
        }
    });
    // =============================  message listener end  ===================================

    let lastRightClickElement: HTMLElement | null = null
    let lastEditableElement: HTMLElement | null = null

    document.addEventListener("contextmenu", (e) => {
        const target = e.target as HTMLElement | null;
        if (target && IsEditableElement(target)) {
            // console.log("isContentEditable", target);
            lastEditableElement = target
        }
    })

    function IsEditableElement(element: HTMLElement): boolean {
        if (element.isContentEditable) {
            return true
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return true
        }
        return false
    }

    // add 'Translate/Restore this paragraph' menu when mouse is over paragraph element and right clicked
    document.addEventListener("mousedown", (e) => {
        if (e.button !== 2) { // ignore non right click
            return
        }
        const target = e.target as HTMLElement | null;
        const para = target?.closest(".duo-paragraph") as HTMLElement | null;

        // if (para) {
        //     translateParagraphElements([para]);
        // }
        console.log("paragraph clicked:", para);
        // return
        if (para) {
            let translated = true
            if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
                translated = duoTranslatedElementSet.has(para);
            } else if (viewStrategy === VIEW_STRATEGY.SINGLE) {
                translated = translateElements.has(para);
            }
            lastRightClickElement = para
            sendMessageToBackground({ action: ACTION.SHOW_TRANSLATE_RESTORE_PARA_MENU, data: { translated: translated } });
        } else {
            lastRightClickElement = null
            sendMessageToBackground({ action: ACTION.HIDE_TRANSLATE_RESTORE_PARA_MENU });
        }
    });

    const intersectionObserver = new IntersectionObserver(items => {
        // console.log("intersectionObserver items: ", items.length)
        if (!translateStatus) {
            return
        }
        for (const item of items) {
            const el = item.target as HTMLElement;
            if (!item.isIntersecting) {
                continue
            }
            // translated and translating elements should be ignored
            if (paragraphElementMap.get(el) != ELEMENT_STATUS.ORIGINAL) {
                continue
            }
            batchElements.push(el)
            paragraphElementMap.set(el, ELEMENT_STATUS.PENDING)
            // console.log("IntersectionObserver in item", el.textContent)
        }
        if (batchTimer == null) {
            batchTimer = setTimeout(() => {
                const task = translateParagraphElements(batchElements)
                pendingTranslateParagraphElementsTask.add(task)
                task.finally(() => {
                    pendingTranslateParagraphElementsTask.delete(task)
                })
                console.log("batchElements translated", batchElements.length)
                batchElements = [];
                batchTimer = null
            }, 50);
        }
    }, {
        rootMargin: '300px 0px',
    });

    // ===== Mutation queue + cooperative scheduling =====
    //
    // The MutationObserver callback only does cheap work (filter + dedupe into
    // a Set). All paragraph-marking happens in processPendingMutations(),
    // which yields to the browser every MARK_BUDGET_MS so the page never sees
    // a long task — even when shadcn-style sites flood us with mutations.
    const PROCESS_DEBOUNCE_MS = 50;
    let pendingMarkRoots = new Set<HTMLElement>();
    let pendingProcessTimer: number | null = null;
    let processingActive = false;

    async function translateTextBox() {
        if (!lastEditableElement) return
        const originalText = getElementText(lastEditableElement);
        const runStream = startTranslate(originalText, 'en', { kind: "trans", service: "google" });
        let translatedText = "";
        for await (const chunk of runStream.stream) {
            translatedText += chunk;
        }
        console.log("translateTextBox: ", translatedText);
        applyTextToTarget(lastEditableElement, translatedText);

    }

    function scheduleMutationProcess() {
        if (pendingProcessTimer != null || processingActive) return;
        pendingProcessTimer = window.setTimeout(processPendingMutations, PROCESS_DEBOUNCE_MS);
    }

    async function processPendingMutations() {
        pendingProcessTimer = null;
        if (processingActive) return;
        processingActive = true;
        try {
            // console.log("processPendingMutations ", pendingMarkRoots.size);
            // Drain in waves: roots added during our async work get picked up
            // on the next iteration of the outer loop.
            while (pendingMarkRoots.size > 0) {
                const roots = Array.from(pendingMarkRoots);
                pendingMarkRoots.clear();
                for (const root of roots) {
                    // isConnected check at every yield boundary so we drop nodes the page
                    // already removed during our wait.
                    if (!root.isConnected) continue;
                    if (isIgnoreMutationElement(root)) continue;
                    // console.log("processPendingMutations root");
                    const collected = await markParagraphElement(root);
                    if (!translateStatus) {
                        continue
                    }
                    for (const ele of collected) {
                        paragraphElementMap.set(ele, ELEMENT_STATUS.ORIGINAL);
                        intersectionObserver.observe(ele);
                    }
                }
            }
        } finally {
            processingActive = false;
        }
    }

    function cleanupRemovedSubtree(removedNode: Node) {
        if (removedNode.nodeType !== 1) return;
        const removed = removedNode as HTMLElement;
        if (removed.classList.contains('duo-paragraph')) {
            duoTranslatedElementSet.delete(removed);
            translatedElementMap.delete(removed);
            paragraphElementMap.delete(removed);
            return;
        }
        // Walk our own tracking map instead of querySelectorAll on the removed
        // subtree — the map is much smaller than a re-scan of the whole subtree.
        if (paragraphElementMap.size === 0) return;
        for (const tracked of Array.from(paragraphElementMap.keys())) {
            if (removed.contains(tracked)) {
                duoTranslatedElementSet.delete(tracked);
                translatedElementMap.delete(tracked);
                paragraphElementMap.delete(tracked);
            }
        }
    }

    let observer = new MutationObserver(async mutations => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;
            if (mutation.target.nodeType !== 1) continue;
            const target = mutation.target as HTMLElement;
            // Cheap structural skip — bail before queueing.
            if (isIgnoreMutationElement(target)) continue;
            // console.log('start mutation');
            // Removal cleanup must happen now while removed nodes are still
            // identifiable; it touches only Map entries, no DOM scan.
            mutation.removedNodes.forEach(cleanupRemovedSubtree);
            pendingMarkRoots.add(target);
        }
        if (pendingMarkRoots.size > 0) scheduleMutationProcess();
    });

    if (globalSwitch) {
        await init()
    }

    let childrenCursorCache: Set<HTMLElement> = new Set()
    let selectionModeActive = false;

    function isIgnoreMutationElement(element: HTMLElement) {
        // closest() is a native O(depth) walk — faster than the JS loop and
        // catches the common UI-framework patterns in one shot.
        // if (element.closest && element.closest(IGNORE_CONTAINER_SELECTOR)) return true;
        let current: HTMLElement | null = element
        while (current && current.nodeName !== "BODY") {
            if (ignoreMutationElements.has(current)) {
                return true
            }
            current = current.parentElement
        }
        return false
    }

    // Yield to the browser between work chunks. Prefer requestIdleCallback so
    // we don't fight a busy main thread; fall back to setTimeout(0) elsewhere.
    function yieldToBrowser(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (typeof (window as any).requestIdleCallback === 'function') {
                (window as any).requestIdleCallback(() => resolve(), { timeout: 50 });
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    /**
     * Execute init function when page is loaded
     */
    async function init() {
        ruleStrategyProcess(ruleStrategy)
        initCSS()
        await initFloatBall()
        await initTranslate()
        // AI Writing is independent of page-translation lifecycle: even when
        // page translation is off / restricted, the writing assistant should
        // still be available on user input fields.
        mountAiWritingDot({ domain: domainWithPort }).catch((err) =>
            console.warn(APP_NAME_WITH_SUFFIX, "mountAiWritingDot failed", err),
        )
    }

    /**
     * Execute unload function when turning off global switch
     */
    async function unload() {
        removeCSS()
        observer.disconnect()
        removeFloatBall()
        restoreOriginalPage(true, true)
    }

    async function initTranslate() {
        startObserveDom()
        let htmlElements = await markParagraphElement(document.body);
        pageLanguage = await detectLanguage(htmlElements);
        if (isNeedsTranslate()) {
            await persistTranslateStatus(true)
            htmlElements.forEach((element) => {
                paragraphElementMap.set(element, ELEMENT_STATUS.ORIGINAL)
                intersectionObserver.observe(element)
            })
        }
    }

    async function initCSS() {
        // Rule mode style stays as a <style> element — it never changes after
        // init so the cost of adoptedStyleSheets bookkeeping isn't worth it.
        let ruleModeStyle = document.createElement('style') as HTMLStyleElement
        ruleModeStyle.id = "rule-mode-style"
        ruleModeStyle.innerText += ".duo-selected {outline: 2px solid yellow !important;}"
        document.head.appendChild(ruleModeStyle)
        await processStyleChangeAction()
    }

    async function removeCSS() {
        document.getElementById('rule-mode-style')?.remove()
        if (translationStyleSheet) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
                (s) => s !== translationStyleSheet,
            )
            translationStyleSheet = null
        }
        // Legacy cleanup — earlier versions used a <style id="duo-translation-style">.
        document.getElementById('duo-translation-style')?.remove()
    }

    function startObserveDom() {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,// text content change
            // attributes: true,
            // characterDataOldValue: true,
            // attributeOldValue: true
        });
    }

    // return // for debug

    // ======================== float ball ========================

    function setFloatBallSwitchStatus(status: boolean) {
        floatBall?.setActive(status)
    }

    async function removeFloatBall() {
        floatBall?.destroy()
        floatBall = null
    }

    async function initFloatBall() {
        if (!globalSwitch) return
        if (!floatBallSwitch) return
        // Per-site disable: "Disable on this site" from the float ball's close
        // menu persists domain.floatBallDisabled — honour it on (re)mount.
        if (rawDomainStrategy?.floatBallDisabled) return
        if (floatBall) return
        floatBall = await mountFloatBall({
            domain: domainWithPort,
            initiallyActive: translateStatus,
            onTranslate: () => { translateAction() },
            onRestore: () => { restoreOriginalAction() },
            onClose: () => {
                floatBallSwitch = false
                // Defer teardown: onClose fires from inside the ball's own React
                // click handler; unmounting the root synchronously from there is
                // unsafe, so let the current event finish first.
                setTimeout(() => removeFloatBall(), 0)
            },
        })
    }

    // ======================== float ball end ========================

    // deprecated
    async function translateWholePage() {
        if (manualTrigger) {
            // if manually trigger, we can determine the translate status
            await persistTranslateStatus(true)
        }
        await translateAllElements()
    }

    // deprecated
    async function translateAllElements() {
        let elements = document.querySelectorAll(".duo-needs-translate")
        let elementsArray = Array.from(elements) as HTMLElement[]
        await translateParagraphElements(elementsArray)
    }

    /**
     * save translate status, update float ball status and notify popup and background
     * @param status
     */
    async function persistTranslateStatus(status: boolean) {
        if (translateStatus === status) {
            return
        }
        console.log("persist translate status", status);
        await setSessionStorage(tabTranslateStatusKey, status).then(() => {
            translateStatus = status
            setFloatBallSwitchStatus(status)
        })
        // notify the popup and background to set translate status
        browser.runtime.sendMessage({
            action: TRANS_ACTION.TRANSLATE_STATUS_CHANGE,
            data: {
                tabId: tabId,
                status: status
            }
        });
    }

    async function translateAction() {
        if (translateTask) {
            return
        }
        const action = async () => {
            if (restoreOriginalTask) {
                await restoreOriginalTask
            }
            if (translateStatus) {
                return
            }
            controller = new AbortController()
            manualTrigger = true
            await persistTranslateStatus(true)
            document.querySelectorAll(".duo-needs-translate").forEach((element) => {
                let ele = element as HTMLElement
                paragraphElementMap.set(ele, ELEMENT_STATUS.ORIGINAL)
                console.log("translateAction observe element");
                intersectionObserver.observe(ele)
            })
        }
        translateTask = action()
        translateTask.finally(() => {
            translateTask = null
        })

    }

    async function restoreOriginalAction() {
        if (restoreOriginalTask) {
            return
        }
        const action = async () => {
            if (translateTask) {
                await translateTask
            }
            if (!translateStatus) {
                return
            }

            manualTrigger = true
            await persistTranslateStatus(false)
            paragraphElementMap.clear()
            intersectionObserver.disconnect()

            if (batchTimer) {
                clearTimeout(batchTimer)
            }
            if (controller) {
                controller.abort()
                await Promise.allSettled(pendingTranslateParagraphElementsTask)
            }
            controller = new AbortController()
            // test add delay
            // await new Promise(resolve => {
            //     setTimeout(resolve, 2000);
            // })
            // restore original page
            await restoreOriginalPage(false)
        }
        restoreOriginalTask = action()
        restoreOriginalTask.finally(() => {
            restoreOriginalTask = null
        })
    }

    async function restoreOriginalParagraphElement(element: HTMLElement) {
        if (viewStrategy == VIEW_STRATEGY.DOUBLE) {
            ignoreMutationElements.add(element)
            try {
                let translation = element.querySelector(".duo-translation")
                translation?.remove();
                let divide = element.querySelector(".duo-divide")
                divide?.remove();
                let spans = element.querySelectorAll("duo-span")
                for (let span of spans) {
                    let textNode = span.firstChild as Text
                    if (textNode && textNode.textContent != "") {
                        span.parentElement?.insertBefore(textNode, span)
                    }
                }
                for (let span of spans) {
                    span.remove()
                }
            } catch (e) {
                console.error(APP_NAME_WITH_SUFFIX, "restore original paragraph error:", e)
            }

            Promise.resolve().then(() => {
                ignoreMutationElements.delete(element)
                duoTranslatedElementSet.delete(element)
            })
        } else if (viewStrategy == VIEW_STRATEGY.SINGLE) {
            let result = translatedElementMap.get(element)
            if (!result) return
            await restore([result])
            Promise.resolve().then(() => {
                ignoreMutationElements.delete(element)
                translatedElementMap.delete(element)
            })
        }
    }

    /**
     * restore the original page
     * @param setStatus set the translation status to false and persist to storage
     */
    async function restoreOriginalPage(setStatus: boolean = true, pure: boolean = false) {
        if (setStatus) {
            await persistTranslateStatus(false)
        }

        if (viewStrategy == VIEW_STRATEGY.DOUBLE) {
            for (let element of duoTranslatedElementSet) {
                if (!element) {
                    continue
                }
                ignoreMutationElements.add(element)
                try {
                    // if (element.textContent.startsWith("The Open Source Security Foundation")) {
                    //     // debugger
                    // }
                    let translation = element.querySelector(".duo-translation")
                    translation?.remove();
                    let divide = element.querySelector(".duo-divide")
                    divide?.remove();
                    let spans = element.querySelectorAll("duo-span")
                    for (let span of spans) {
                        let textNode = span.firstChild as Text
                        // console.log("textNode:", textNode, span)
                        if (textNode && textNode.textContent != "") {
                            span.parentElement?.insertBefore(textNode, span)
                        }
                    }
                    for (let span of spans) {
                        span.remove()
                    }
                    // element.removeEventListener("mouseenter", handler)
                    // element.removeAttribute("duo-no-observer")
                } catch (e) {
                    console.error(APP_NAME_WITH_SUFFIX, "restore original page error:", e)
                }
            }
            // add delete ignoreMutationElements task to the macro-task queue, will process after observe task when next event loop starts
            // setTimeout(() => {
            //     for (let element of duoTranslatedElementMap) {
            //         ignoreMutationElements.delete(element?.[0])
            //     }
            // }, 0);

            // add delete ignoreMutationElements task to the micro-task queue after observe task
            Promise.resolve().then(() => {
                for (let element of duoTranslatedElementSet) {
                    ignoreMutationElements.delete(element)
                }
                duoTranslatedElementSet.clear()
            })
        } else if (viewStrategy == VIEW_STRATEGY.SINGLE) {
            let results: TranslateResult[] = []
            translatedElementMap.forEach((result, element) => {
                ignoreMutationElements.add(element)
                // remote all text recursively node of element
                removeTextNodes(element)
                results.push(result)
            })
            await restore(results)
            Promise.resolve().then(() => {
                translatedElementMap.forEach((result, element) => {
                    ignoreMutationElements.delete(element)
                })
                translatedElementMap.clear()
            })
        }
        if (pure) {
            document.body.querySelectorAll(".duo-paragraph").forEach(element => {
                removeDuoClassAndAttribute(element as HTMLElement)
            })
            let spans = document.body.querySelectorAll("duo-span")
            for (let span of spans) {
                let textNode = span.firstChild as Text
                if (textNode && textNode.textContent != "") {
                    span.parentElement?.insertBefore(textNode, span)
                }
            }
            for (let span of spans) {
                span.remove()
            }
        }
        // console.log('restore original page', duoTranslatedElementMap)

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

    function removeDuoClassAndAttribute(element: HTMLElement) {
        let attributes = element.getAttributeNames()
        for (let attribute of attributes) {
            if (attribute.startsWith("duo-")) {
                element.removeAttribute(attribute)
            }
        }
        let classList: string[] = []
        element.classList.forEach(className => {
            if (className.startsWith("duo-")) {
                classList.push(className)
            }
        })
        for (let className of classList) {
            element.classList.remove(className)
        }
    }

    function removeTextNodes(element: HTMLElement) {
        function getTextNodes(element: HTMLElement) {
            let textNodes: Text[] = []
            let children = element.childNodes
            for (let child of children) {
                if (child instanceof Text) {
                    textNodes.push(child)
                } else if (child instanceof HTMLElement) {
                    textNodes.push(...getTextNodes(child))
                }
            }
            return textNodes
        }
        let textNodes = getTextNodes(element)
        for (let textNode of textNodes) {
            textNode.remove()
        }
    }

    async function setSessionStorage(key: string, value: any) {
        await sendMessageToBackground({
            action: STORAGE_ACTION.SESSION_SET,
            data: { key: key, value: value }
        })
    }

    async function getSessionStorage(key: string) {
        return sendMessageToBackground({
            action: STORAGE_ACTION.SESSION_GET,
            data: { key: key }
        })
    }

    function getElementTextLength(element: HTMLElement): number {
        let text = getElementTextContent(element)
        return encoder.encode(text).length; // Calculate byte length
    }

    function getElementTextContent(element: HTMLElement): string {
        let text = "";

        function traverse(node: Node) {
            if (!node) {
                return
            }
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent?.trim() || ""; // Get text node content
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (excludedTagSet.has(node.nodeName.toLowerCase())) {
                    return;
                }
                // Recursively process child elements
                for (let child of node.childNodes) {
                    traverse(child);
                }
            }
        }

        traverse(element);
        return text
    }


    function getTextLanguage(text: string) {
        let lang = franc(text, { minLength: 10 })
        if (lang == "cmn") {
            if (isTraditionalChinese(text)) {
                lang = 'zh-TW'
            } else {
                lang = 'zh-CN'
            }
        } else {
            lang = iso6393To1Map.get(lang) || "und"
        }
        return lang
    }

    async function detectLanguage(elements: HTMLElement[]) {
        // use franc to detect the language locally
        let text = ""
        // randomly select elements, max 2000 characters
        elements = shuffle(elements)
        let utf8Length = 0
        for (let index = 0; index < elements.length; index++) {
            const element = elements[index];
            let content = getElementTextContent(element) + "\n"
            text += content
            utf8Length += encoder.encode(content).length
            if (utf8Length > 2000) {
                break
            }
        }

        text.trimEnd()
        let lang = 'und'
        if (utf8Length > 500) {
            lang = getTextLanguage(text)
            console.log("detect language by franc: %s", lang, utf8Length)
        }

        if (lang != "und") {
            return lang
        } else {
            // fallback to use microsoft translate to detect the language
            try {
                lang = await translationServices.get(TRANS_SERVICE.MICROSOFT)?.detectLanguage?.([text]) || "und"
                console.log("detect language by microsoft translate: %s", lang)
                return lang
            }
            catch {
                return "und"
            }
        }
    }


    function toggleTranslateStatus() {
        // translateStatus = !translateStatus
        manualTrigger = true
        if (translateStatus) {
            restoreOriginalAction()
        } else {
            translateAction()
        }
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

    // Builds the full stylesheet text for translation styling + bilingual
    // highlighting from current config. Always returns a complete CSS string
    // so the caller can swap the stylesheet atomically via replaceSync.
    function buildTranslationCss(opts: {
        bgColor: string
        fontColor: string
        borderStyle: string
        borderColor: string
        highlightBg: string
        highlightFontColor: string
        highlightStyle: string
        highlightBorderColor: string
        highlightSwitch: boolean
    }): string {
        const blocks: string[] = []

        // Translation style — applied to the appended translation copy.
        const translationDecls: string[] = []
        if (opts.bgColor) translationDecls.push(`background-color: ${opts.bgColor};`)
        if (opts.fontColor) translationDecls.push(`color: ${opts.fontColor};`)
        const translationRule = getCSSRuleString(opts.borderStyle, opts.borderColor)
        if (translationRule) translationDecls.push(translationRule)
        if (translationDecls.length > 0) {
            blocks.push(`.duo-translation { ${translationDecls.join(' ')} }`)
        }

        // Bilingual highlighting — unified across original + translation spans.
        if (opts.highlightSwitch) {
            const highlightDecls: string[] = []
            if (opts.highlightBg) highlightDecls.push(`background-color: ${opts.highlightBg};`)
            if (opts.highlightFontColor) highlightDecls.push(`color: ${opts.highlightFontColor};`)
            const highlightRule = getCSSRuleString(opts.highlightStyle, opts.highlightBorderColor)
            if (highlightRule) highlightDecls.push(highlightRule)
            if (highlightDecls.length > 0) {
                blocks.push(
                    `.duo-highlight-original, .duo-highlight-translation { ${highlightDecls.join(' ')} }`,
                )
            }
        }
        return blocks.join('\n')
    }

    async function processStyleChangeAction() {
        let [
            bgColor, fontColor, borderStyle, borderColor,
            highlightBg, highlightFontColor, highlightStyle, highlightBorderColor,
            highlightSwitch,
        ] = await Promise.all([
            getConfig(CONFIG_KEY.BG_COLOR),
            getConfig(CONFIG_KEY.FONT_COLOR),
            getConfig(CONFIG_KEY.STYLE),
            getConfig(CONFIG_KEY.BORDER_COLOR),
            getConfig(CONFIG_KEY.HIGHLIGHT_BG_COLOR),
            getConfig(CONFIG_KEY.HIGHLIGHT_FONT_COLOR),
            getConfig(CONFIG_KEY.HIGHLIGHT_STYLE),
            getConfig(CONFIG_KEY.HIGHLIGHT_BORDER_COLOR),
            getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        ])
        const css = buildTranslationCss({
            bgColor: bgColor || '',
            fontColor: fontColor || '',
            borderStyle: borderStyle || 'noneStyleSelect',
            borderColor: borderColor || '',
            highlightBg: highlightBg || '',
            highlightFontColor: highlightFontColor || '',
            highlightStyle: highlightStyle || 'noneStyleSelect',
            highlightBorderColor: highlightBorderColor || '',
            highlightSwitch: highlightSwitch == null ? true : !!highlightSwitch,
        })

        if (!translationStyleSheet) {
            translationStyleSheet = new CSSStyleSheet()
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, translationStyleSheet]
        }
        // replaceSync replaces all rules atomically; far cheaper than re-parsing
        // an innerText concatenation on every drag tick from the color picker.
        translationStyleSheet.replaceSync(css)
    }

    function isNotTranslateElement(element: HTMLElement): boolean {
        // todo support user defined class to exclude translation
        return element.classList.contains('duo-no-translate')
    }

    /**
     * judge whether to mark the element
     * @param element
     */
    function isNotMarkElement(element: HTMLElement): boolean {
        // todo support user defined class to exclude translation
        // todo support user defined tag to exclude
        return element.classList.contains("duo-translation") || isExcludedNodeType(element)
    }

    /**
     * check the element editable status, if true no need to process translation
     * @param element
     * @returns boolean
     */
    function isEditable(element: HTMLElement): boolean {
        // Check if the element is content editable
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

    /**
     * search and add the duo-paragraph class to the paragraph element for marking
     * @param element
     * @returns the elements that need to translate
     */
    // Async + iterative to avoid blocking the main thread on large subtrees.
    // The walk yields to the browser every MARK_BUDGET_MS so a body-sized
    // input still mark-completes without freezing the page. Behaviour matches
    // the previous recursive version (depth limit, text-node→duo-span wrapping,
    // mutation suppression around our own DOM writes).

    async function markParagraphElement(element: HTMLElement): Promise<HTMLElement[]> {
        let notTranslate = false;
        const rawElement = element;
        const collectElements: HTMLElement[] = [];

        // Walk up — looking for an enclosing duo-paragraph (early return) or
        // an isNotTranslateElement ancestor (sets the flag for descent).
        const parentElements: HTMLElement[] = [];
        while (element.parentElement && element.parentElement != document.body) {
            parentElements.push(element.parentElement);
            element = element.parentElement;
        }
        for (let i = parentElements.length - 1; i >= 0; i--) {
            const p = parentElements[i];
            if (isNotMarkElement(p)) return collectElements;
            if (!notTranslate && isNotTranslateElement(p)) notTranslate = true;
            if (p.classList.contains("duo-paragraph")) {
                if (!notTranslate) collectElements.push(p);
                return collectElements;
            }
        }

        // Iterative DFS via a stack. Children are pushed in reverse order so
        // pop-order matches the original left-to-right recursion.
        type Frame = { el: HTMLElement; notTranslate: boolean; depth: number };
        const stack: Frame[] = [{ el: rawElement, notTranslate, depth: 0 }];
        let chunkStart = performance.now();

        while (stack.length > 0) {
            if (performance.now() - chunkStart >= MARK_BUDGET_MS) {
                await yieldToBrowser();
                chunkStart = performance.now();
            }
            const frame = stack.pop()!;
            const el = frame.el;
            let nt = frame.notTranslate;
            const depth = frame.depth;

            if (depth > MARK_MAX_DEPTH) continue;
            // Page may have removed the node while we were yielding.
            if (!el.isConnected) continue;
            if (isNotMarkElement(el)) continue;
            if (!nt && isNotTranslateElement(el)) nt = true;
            if (el.classList.contains("duo-paragraph")) {
                if (!nt) collectElements.push(el);
                continue;
            }
            if (isEditable(el)) continue;

            if (isParagraphElement(el)) {
                el.classList.add('duo-paragraph');
                if (!nt) {
                    if (!el.querySelector('.duo-translation')) collectElements.push(el);
                    el.classList.add("duo-needs-translate");
                }
                continue;
            }

            // Walk children in document order, doing inline text-node→duo-span
            // wrapping. Capture element children to a list first; some may be
            // merged into a paraElement by text-wrap below — we filter them
            // out via the parentElement check before pushing to the stack.
            const recurseChildren: HTMLElement[] = [];
            let i = 0;
            while (i < el.childNodes.length) {
                const c = el.childNodes[i];
                if (c.nodeType === Node.ELEMENT_NODE) {
                    recurseChildren.push(c as HTMLElement);
                }
                i++;
            }
            // Push in reverse so pop order = forward visit. Skip children that
            // got merged into a paraElement (their parent is no longer `el`).
            for (let j = recurseChildren.length - 1; j >= 0; j--) {
                if (recurseChildren[j].parentElement === el) {
                    stack.push({ el: recurseChildren[j], notTranslate: nt, depth: depth + 1 });
                }
            }
        }
        return collectElements;
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
            console.error(APP_NAME_WITH_SUFFIX, 'Invalid URL:', error);
            return null;
        }
    }

    function isParagraphElement(element: HTMLElement): boolean {
        // An element is considered a paragraph when its children contains a text node whose textContent is not empty
        for (let i = 0; i < element.childNodes.length; i++) {
            // /\p{Cf}/gu: Contains all zero-width characters
            if (element.childNodes[i].nodeType === Node.TEXT_NODE && element.childNodes[i].textContent!.replace(/\p{Cf}/gu, '').trim() !== "") {
                return true
            }
        }
        return false
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
     * deprecated
     * Remove all comment nodes recursively
     */
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

    /**
     * determine whether translate the page according to the strategy
     * @returns boolean
     */
    function whetherTranslate(): boolean {
        if (!globalSwitch) {
            return false
        }
        if (manualTrigger) {
            console.log('manualTriggerTranslate:', manualTrigger, translateStatus)
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
                return targetLanguage != pageLanguage
            case DOMAIN_STRATEGY.NEVER:
                return false
            case DOMAIN_STRATEGY.ALWAYS:
                return true
        }
        return false
    }

    /**
     * remove all non-text child elements
     * @param element
     */
    function removeAllNonTextChildElements(element: HTMLElement) {
        for (let child of element.children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.textContent?.trim() === "") {
                    element.removeChild(child)
                } else {
                    removeAllNonTextChildElements(child as HTMLElement)
                }
            }
        }
    }

    function highlightHandler(span: HTMLElement, originalElement: HTMLElement, translatedElement: HTMLElement) {
        span.onmouseover = function () {
            let sequence = parseInt(span.getAttribute("duo-sequence")!)
            let sequenceElements = originalElement.querySelectorAll('duo-span[duo-sequence="' + sequence + '"]');
            if (sequenceElements) {
                for (let sequenceElement of sequenceElements) {
                    if (!translatedElement.contains(sequenceElement)) {
                        sequenceElement.classList.add("duo-highlight-original")
                    }
                }
            }
            let translationElements = translatedElement.querySelectorAll('duo-span[duo-sequence="' + sequence + '"]')
            translationElements.forEach(element => {
                element.classList.add("duo-highlight-translation")
            })
        }

        span.onmouseleave = function () {
            let sequence = parseInt(span.getAttribute("duo-sequence")!)
            let sequenceElements = originalElement.querySelectorAll('duo-span[duo-sequence="' + sequence + '"]');
            if (sequenceElements) {
                for (let sequenceElement of sequenceElements) {
                    sequenceElement.classList.remove("duo-highlight-original")
                }
            }
            let translationElements = translatedElement.querySelectorAll('duo-span[duo-sequence="' + sequence + '"]')
            translationElements.forEach(element => {
                element.classList.remove("duo-highlight-translation")
            })
        }
    }

    function wrapTextNode2Span(textNodes: Text[], sentences: string[]): HTMLElement[] {
        let j = 0
        let spans: HTMLElement[] = []
        for (let i = 0; i < sentences.length; i++) {
            let sentence = sentences[i];
            while (j < textNodes.length) {
                let text = textNodes[j].textContent
                if (!text) {
                    continue
                }
                if (sentence.length >= text.length) {
                    if (sentence.startsWith(text)) {
                        let span = document.createElement("duo-span")
                        span.setAttribute("duo-sequence", i.toString())
                        textNodes[j]?.parentElement?.insertBefore(span, textNodes[j])
                        span.appendChild(textNodes[j])
                        spans.push(span)
                        sentence = sentence.slice(text.length)
                        j++
                        ignoreMutationElements.add(span)
                    } else {
                        break
                    }
                } else {
                    if (text.startsWith(sentence)) {
                        textNodes[j].textContent = text.slice(sentence.length)
                        let span = document.createElement("duo-span")
                        span.setAttribute("duo-sequence", i.toString())
                        span.textContent = sentence
                        textNodes[j].parentElement?.insertBefore(span, textNodes[j])
                        spans.push(span)
                        ignoreMutationElements.add(span)
                    }
                    break
                }
            }
        }
        return spans
    }

    /**
     * Translate the paragraph elements
     * @param elements
     * @param context hasDuplicated is false, indicate that the element has not been duplicated. targetTranslateService set custom translate service
     */
    async function translateParagraphElements(elements: HTMLElement[], context?: any) {
        let viewStrategyCopy = viewStrategy
        if (elements.length == 0) {
            return
        }
        let ignoreElements: HTMLElement[] = []
        try {
            console.log('translateParagraphElements: ', elements.length)
            // @debuglog
            // elements.forEach((element) => {
            //     console.log('translateParagraphElements element:', element.textContent)
            // })
            if (context && typeof context.hasDuplicated === 'boolean' && !context.hasDuplicated) {
                // remove duplicate elements
                elements = Array.from(new Set(elements))
            }
            for (let i = elements.length - 1; i >= 0; i--) {
                const element = elements[i];
                if (ignoreMutationElements.has(element)
                    || element.querySelector(".duo-translation")) {
                    elements.splice(i, 1);
                    continue;
                }
                ignoreElements.push(element);
                ignoreMutationElements.add(element);
            }
            // @debuglog
            // console.log('translateParagraphElements:', elements)
            let service = translateService
            if (context && typeof context.targetTranslateService === "string" && context.targetTranslateService) {
                service = context.targetTranslateService
                console.log('context.targetTranslateService:', context.targetTranslateService)
            }
            if (service == "") {
                service = TRANS_SERVICE.MICROSOFT
            }

            let translateResults = await getTranslateResult(service, elements, targetLanguage, viewStrategyCopy, controller?.signal)
            if (!translateResults || translateResults.length != elements.length) {
                return
            }

            // remove the element that language is same as targetLanguage
            for (let i = translateResults.length - 1; i >= 0; i--) {
                let result = translateResults[i]
                if (result.sourceLang == targetLanguage && result.score >= 0.7) {
                    translateResults.splice(i, 1)
                    elements.splice(i, 1)
                } else if (viewStrategyCopy == VIEW_STRATEGY.SINGLE) {
                    result.textNodes?.forEach(element => {
                        element.remove()
                    });
                    translatedElementMap.set(elements[i], result)
                }
            }

            // the elements will be replaced(translated) in single view strategy
            // the copy of elements will be replaced(translated) in double view strategy
            await translate(translateResults)

            // append translated copy element to original element in double view strategy
            if (viewStrategyCopy == VIEW_STRATEGY.DOUBLE) {
                for (let i = 0; i < translateResults.length; i++) {
                    let translatedResult = translateResults[i]
                    let translatedElement = translatedResult.translatedCopyElement
                    if (!translatedElement) {
                        continue
                    }
                    let element = elements[i]
                    if (!element || element.querySelector(".duo-translation")) {
                        continue
                    }
                    let originalTextResult = getTextNodesAndText(element)
                    translatedElement.classList.add("duo-translation")
                    // find the last child that textContent is not empty
                    let lastChild = getLastContainingTextChild(element)
                    let divide : HTMLElement
                    if (originalTextResult.text.length >= translationLineBreakMinChars) {
                        divide = document.createElement('br')
                        divide.classList.add("duo-divide")
                    } else {
                        divide = document.createElement('span')
                        divide.classList.add("duo-divide")
                        divide.innerHTML = '&nbsp;&nbsp;'
                    }
                    if (lastChild?.nextSibling) {
                        element.insertBefore(translatedElement, lastChild.nextSibling)
                        element.insertBefore(divide, lastChild.nextSibling)
                    } else {
                        element.appendChild(divide)
                        element.appendChild(translatedElement)
                    }
                    let handler = function () {
                        if (originalTextResult.text == "" || originalTextResult.textNodes.length == 0) {
                            return
                        }
                        let translatedTextResult = getTextNodesAndText(translatedElement)
                        if (translatedTextResult.text == "" || translatedTextResult.textNodes.length == 0) {
                            return
                        }
                        const originalSentences = splitSentence(originalTextResult.text)
                        if (originalSentences.length === 0 || originalSentences.length < bilingualHighlightingMinSentences) {
                            return
                        }
                        const translatedSentences = splitSentence(translatedTextResult.text)
                        if (translatedSentences.length != originalSentences.length) {
                            return
                        }
                        let spans = wrapTextNode2Span(originalTextResult.textNodes, originalSentences)

                        spans.push(...wrapTextNode2Span(translatedTextResult.textNodes, translatedSentences))
                        for (let span of spans) {
                            highlightHandler(span, element, translatedElement)
                        }
                    }
                    handler()
                    duoTranslatedElementSet.add(element)
                }
            }

            elements.forEach((element) => {
                paragraphElementMap.set(element, ELEMENT_STATUS.TRANSLATED)
                intersectionObserver.unobserve(element)
            })
        } catch (e) {
            // @ts-ignore
            if (e.name === 'AbortError') { // user cancel translate
                return
            }
            console.error(APP_NAME_WITH_SUFFIX, "translate paragraph error:", e)
        }
        finally {
            Promise.resolve().then(() => {
                for (let element of ignoreElements) {
                    ignoreMutationElements.delete(element)
                }
            })
        }
    }

    function getLastContainingTextChild(element : Node) {
        let lastChild = element.lastChild
        while (lastChild && !isContainsValidTextElement(lastChild)) {
            lastChild = lastChild.previousSibling
        }
        return lastChild
    }

    function isContainsValidTextElement(element: Node) {
        if (element.nodeType === Node.TEXT_NODE) {
            return true
        }
        let stack = [element]
        while (stack.length > 0) {
            let pop = stack.pop()
            if (!pop) continue
            if (pop.nodeType === Node.TEXT_NODE && pop.textContent?.replace(/\p{Cf}/gu, '') != "") {
                return true
            }
            if (pop.nodeType === Node.ELEMENT_NODE) {
                let ele = pop as HTMLElement
                if (EXCLUDE_CHILD_ELEMENT_TAGS.has(ele.tagName)) {
                    continue
                }
                stack.push(...pop.childNodes)
            }
        }
    }

    /**
     * Check if translate webpage
     * @returns {boolean}
     */
    function isNeedsTranslate(): boolean {
        if (domainStrategy == DOMAIN_STRATEGY.NEVER) {
            return false
        }
        if (domainStrategy == DOMAIN_STRATEGY.ALWAYS) {
            return true
        }
        if (defaultStrategy == DEFAULT_STRATEGY.NEVER) {
            return false
        }
        if (defaultStrategy == DEFAULT_STRATEGY.ALWAYS) {
            return true
        }
        return targetLanguage != pageLanguage
    }

    function getTextNodesAndText(element: Node) {
        let text = ""
        let textNodes: Text[] = []
        const process = function (element: Node) {
            if (element.nodeType === Node.TEXT_NODE && element.textContent?.replace(/\p{Cf}/gu, '') != "") {
                textNodes.push(element as Text)
                text += element.textContent
            }
            if (element.nodeType === Node.ELEMENT_NODE) {
                let ele = element as HTMLElement
                if (EXCLUDE_CHILD_ELEMENT_TAGS.has(ele.tagName)) {
                    return
                }
                let children = element.childNodes
                for (let child of children) {
                    process(child)
                }
            }
        }
        process(element)

        return { textNodes, text }
    }

    function splitSentence(text: string | null) {
        if (!text) {
            return []
        }
        let results = split(text)
        let sentences: string[] = []
        let sentence = ""
        results.forEach(result => {
            sentence += result.raw
            if (result.type == "Sentence") {
                sentences.push(sentence)
                sentence = ""
            }
        })
        return sentences
    }

    // =============== Rule mode ===============
    function getCSSRuleString(style: string, color?: string) {
        let cssRule = ""
        const isBorder = style === 'solidBorder' || style === 'dottedBorder' || style === 'dashedBorder'
        const isUnderline = !!style && style.endsWith("Line")
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
        if (color) {
            if (isBorder) {
                cssRule += `border-color: ${color};`
            } else if (isUnderline) {
                cssRule += `text-decoration-color: ${color};`
            }
        }
        if (isUnderline) {
            cssRule += `text-underline-offset: 4px;`
        }
        return cssRule
    }

    async function toggleSelectionMode() {
        // get all the rules of the current domain from the db, find the element and add class duo-selected
        let rules = await listRuleFromDB(domainWithPort)
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

    function ruleModeAddStyle(element: HTMLElement) {
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

    function ruleModeDeleteStyle(element: HTMLElement) {
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
                ruleModeDeleteStyle(currentElement)
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

    function removeNoTranslateClass(element: Element) {
        element.classList.remove("duo-no-translate");
        element.querySelectorAll(".duo-paragraph").forEach((child) => {
            child.classList.add("duo-needs-translate")
        })
    }

    /**
     * click left mouse button on the <element> in the rule mode
     * @param ele selected element
     * @returns void
     */
    function selectElementClicked(ele: HTMLElement) {
        if (ele.classList.contains("duo-selected")) {
            ele.classList.remove("duo-selected")
            ruleModeAddStyle(ele)
            // save to db
            let selector = getCssSelectorString(ele)
            deleteRuleFromDB(domainWithPort, selector)
            // remove class duo-no-translate
            removeNoTranslateClass(ele)
        } else {
            // if ele's parent element has duo-selected, remove it
            let parent = ele.parentElement
            while (parent) {
                if (parent.classList.contains("duo-selected")) {
                    parent.classList.remove("duo-selected")
                    ruleModeAddStyle(parent)
                    deleteRuleFromDB(domainWithPort, getCssSelectorString(parent))
                    removeNoTranslateClass(parent)
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
                deleteRuleFromDB(domainWithPort, selector)
                removeNoTranslateClass(child)
            })
            addRuleToDB(domainWithPort, getCssSelectorString(ele))
            ele.classList.add("duo-no-translate")
            ele.querySelectorAll(".duo-needs-translate").forEach((element) => {
                element.classList.remove("duo-needs-translate")
            })
            ruleModeDeleteStyle(ele)
        }
    }

    function setElementAddRuleStyle(element: HTMLElement): HTMLElement | undefined {
        console.log('setElementAddRuleStyle:', element)
        if (element.classList.contains("duo-paragraph")) {
            ruleModeAddStyle(element)
            return element
        } else {
            let query = element.querySelectorAll(".duo-paragraph")
            if (query.length > 0) {
                ruleModeAddStyle(element)
                return element
            } else {
                // find the parent element of the current element that has the duo-paragraph class
                let parent = element.parentElement
                while (parent) {
                    if (parent.classList.contains("duo-paragraph")) {
                        ruleModeAddStyle(parent)
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

}