import { splitSentence, wrapTextNode2Span } from "@/main/dom/sentence";
import { TAB_ACTION, TRANSLATE_STATUS_KEY, CONFIG_KEY, DB_ACTION, TRANSLATE_SERVICE, DOMAIN_STRATEGY, TRANSLATE_ACTION, ACTION, STORAGE_ACTION, VIEW_STRATEGY, DEFAULT_STRATEGY, ELEMENT_STATUS, APP_NAME, APP_NAME_WITH_SUFFIX, DEFAULT_VALUE, STATUS_SUCCESS, CONFIG_VALUE_TO_KEY, LANGUAGES_MAP, IS_FIREFOX, browserTargetLanguage } from "./constants";
import { restore, translateParams, getTranslateResult, translate, TranslateResult, resetTranslationCacheEnabled, translationServices, TranslateService } from "./translateClient";
import { sendMessageToBackground } from "../utils/message";
import { browser } from "wxt/browser"
import { mountFloatBall, type FloatBallController } from "./floatBall";
import { mountAiWritingDot } from "./aiWriting/floatingDot";
import { isAiWritingTarget } from "./aiWriting/inputDetector";
import { openWorkbench, ensureWorkbenchMounted, destroyWorkbench } from "./aiWriting/workbench";
import { openSelectionTranslate } from "./aiWriting/selectionPopup";
import { getConfig, listRuleFromDB } from "@/utils/db";
import { createRuleMode, type RuleModeController } from "./ruleMode";
import { confirmRuleModeHint } from "./ruleHintDialog";
import { detectLanguage, getElementTextContent } from "@/main/lang";
import { parseTranslateServiceKey, startTranslate, TranslateServiceChoice } from "./aiWriting/translateRunner";
import { applyTextToTarget } from "./aiWriting/applyText";
import { getElementText } from "@/utils/dom";
import { readConfig } from "@/utils/reactiveConfig";
import { getDomainWithPortFromUrl } from "@/utils/url";
import { getAiTranslateService, getTranslateService } from "@/utils/service";
import { buildTranslationCss } from "@/main/css";
import { isEditable, isNotMarkElement, isNotTranslateElement, isParagraphElement } from "@/main/dom/predicates";
import { getTextNodesAndText, getTextNodesAndTextOfNodes, isContainsValidTextElement, removeDuoClassAndAttribute, removeTextNodes } from "@/main/dom/textNodes";
import {
    allParagraphs,
    cleanupParagraphMarks,
    clearParagraphMarks,
    closestNeedsTranslate,
    closestParagraph,
    isMixedParagraph,
    isParagraph,
    markNoTranslate,
    markParagraph,
    needsTranslateParagraphs,
    resetNoTranslateMarks,
} from "@/main/dom/paragraphMarks";
import { isBlockBoundary, segmentParagraph, type TranslationUnit } from "@/main/dom/segments";
import { BLOCK_SELECTOR } from "@/main/constants";
import { initVideoSubtitle, type VideoSubtitleController } from "@/main/videoSubtitle";

declare global {
    var __debugTranslationServices:
        | typeof translationServices
        | undefined
}

if (import.meta.env.DEV) {
    globalThis.__debugTranslationServices ??= translationServices
}

export async function content() {
    //#region main
    console.log('content script loaded');

    // The script runs in all frames. The translation pipeline runs in every
    // frame (so iframe content gets translated too), but a few concerns are
    // strictly tab-level and belong to the TOP frame only: the float ball,
    // writing the tab's translate-status to session storage, broadcasting that
    // status to the popup/badge, and orchestrating manual toggles down to
    // sub-frames. `isTopFrame` gates those. Comparing window references is safe
    // even across origins (no property access).
    const isTopFrame = window.top === window.self;

    // Constructable Stylesheet for translation + bilingual highlighting CSS.
    // - Lives in document.adoptedStyleSheets, not the DOM, so it doesn't
    //   trigger our own MutationObserver and can't be removed by hostile pages.
    // - replaceSync() swaps the whole rule set in one call (no innerText
    //   re-parsing on every keystroke from the options color picker).
    let translationStyleSheet: CSSStyleSheet | null = null
    // Firefox content scripts access the page document through an Xray wrapper,
    // where document.adoptedStyleSheets / constructable stylesheets are not
    // reliably usable (reading it yields undefined → "not iterable"). On Firefox
    // we use a plain <style> node instead; Chrome keeps the adoptedStyleSheets path.
    let translationStyleElement: HTMLStyleElement | null = null

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

    let pageLanguage: string | undefined = undefined
    let tabId = await sendMessageToBackground({ action: TAB_ACTION.ID_GET })
    if (!tabId) {
        return
    }
    let tabTranslateStatusKey = TRANSLATE_STATUS_KEY + tabId
    // Get the domain name and port of the current page. Sub-frames key off the
    // TOP document's domain so per-domain rules / strategy / disable stay
    // consistent with what the user configured for the page they actually see.
    let currentUrl = window.location.href;
    const domainWithPort = isTopFrame ? getDomainWithPortFromUrl(currentUrl) : getTopFrameDomain();
    if (domainWithPort === "") {
        return
    }
    const ruleMode: RuleModeController = createRuleMode(domainWithPort)
    let floatBall: FloatBallController | null = null
    // Video bilingual subtitles (YouTube only for now) — top-frame singleton.
    let videoSubtitle: VideoSubtitleController | null = null
    // AI Writing dot teardown. Top frame: the mount's unmount fn. Sub-frame: the
    // deferred-mount disposer (drops the focus listener + unmounts if up). Reset
    // on each init() so a global-switch off→on cycle re-mounts cleanly.
    let aiWritingDotDispose: (() => void) | null = null
    let aiWritingDotDisposed = false

    // return
    // set translate status to false when the page is loaded
    let translateStatus = false
    let manualTrigger = false // @deprecated
    const ignoreMutationElements = new WeakSet();
    const paragraphElementMap = new Map<HTMLElement, ELEMENT_STATUS>();
    // translated elements of DOUBLE view strategy
    let duoTranslatedElementMap = new Map<HTMLElement, { text: Text, content: string }[]>()
    // per-paragraph disposers for the delegated bilingual-highlight listeners;
    // WeakMap so paragraphs removed by the page don't pin the closures
    const highlightDisposers = new WeakMap<HTMLElement, () => void>()
    // translated elements of SINGLE view strategy
    // SINGLE: one TranslateResult per translated unit, grouped by container.
    let translatedElementMap = new Map<HTMLElement, TranslateResult[]>()
    // get all config from storage
    let [rules, viewStrategy, targetLanguageConfig, translateServiceConfig, globalSwitch, defaultStrategy,
        rawDomainStrategy, floatBallSwitch, bilingualHighlightingSwitch, bilingualHighlightingMinSentences, translationLineBreakMinChars, aiTranslateServiceKey,
        aiTargetLanguageConfig, contextMenuSwitch, translateStatusConfig]
        : [string[], VIEW_STRATEGY, string | undefined, string | undefined, boolean, string, any, boolean, boolean, number,
            number, string | undefined, string, boolean, boolean]
        = await Promise.all(
            [
                listRuleFromDB(domainWithPort),
                getConfig(CONFIG_KEY.VIEW_STRATEGY),
                getConfig(CONFIG_KEY.TARGET_LANGUAGE),
                getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.GLOBAL_SWITCH),
                getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
                sendMessageToBackground({ action: DB_ACTION.DOMAIN_GET, data: { domain: domainWithPort } }),
                getConfig(CONFIG_KEY.FLOAT_BALL_SWITCH),
                getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
                getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES),
                getConfig(CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS),
                getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.AI_TARGET_LANGUAGE),
                getConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH),
                getSessionStorage(tabTranslateStatusKey)
            ]
        )
    translateStatus = !!translateStatusConfig
    rules = rules || []
    shareConfig.rules = rules
    let translateService = (await getTranslateService(translateServiceConfig)).activeService
    let aiTranslateService = (await getAiTranslateService(aiTranslateServiceKey)).activeService
    let parsedAiTranslateService = parseTranslateServiceKey(aiTranslateService)
    shareConfig.aiTargetLanguage = aiTargetLanguageConfig
    shareConfig.aiTranslateServiceChoice = parsedAiTranslateService
    let targetLanguage = targetLanguageConfig || browserTargetLanguage()
    let domainStrategy = (rawDomainStrategy?.strategy || DOMAIN_STRATEGY.AUTO) as string
    let lastX = 0, lastY = 0
    let lastContextMenuElement: HTMLElement | null = null
    let lastEditableElement: HTMLElement | null = null

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

    //#region observer
    const observer = new MutationObserver(async mutations => {
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                // continue
                if (mutation.target.nodeType !== Node.TEXT_NODE) continue
                let target = mutation.target as Text
                if (ignoreMutationElements.has(target)) continue
                // return
                // if (target.length <= 5) continue // for debug
                console.log('characterData', mutation);
                let p = closestNeedsTranslate(target.parentElement)
                if (!p) continue
                if (isIgnoreMutationElement(p)) continue

                let text = target.textContent

                let translateStatus = duoTranslatedElementMap.has(p) || translatedElementMap.has(p)
                restoreOriginalParagraphElement(p).then(() => {
                    // probably get old original text
                    if (target.textContent != text) {
                        ignoreMutationElements.add(target)
                        target.textContent = text
                        Promise.resolve().then(() => {
                            ignoreMutationElements.delete(target)
                        })
                    }
                    if (translateStatus) {
                        translateParagraphElements([p])
                    }
                })
                continue
            }
            if (mutation.target.nodeType !== Node.ELEMENT_NODE) continue;
            const target = mutation.target as HTMLElement;

            // We observe <html> (not <body>) so a wholesale <body> swap stays
            // visible — some SPAs (Turbo/Astro-style soft navigation) replace
            // the entire <body> element on route change while keeping the JS
            // context alive. A body-scoped observer would be stranded on the
            // old, detached body and never see the new page. Mutations at the
            // <html>/<head> level are otherwise not page content: only re-root
            // marking when a fresh <body> is added, and never mark <head>.
            if (target === document.documentElement || target.nodeName === 'HEAD') {
                mutation.removedNodes.forEach(cleanupRemovedSubtree);
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'BODY') pendingMarkRoots.add(node as HTMLElement);
                });
                continue;
            }

            // Cheap structural skip — bail before queueing.
            if (isIgnoreMutationElement(target)) continue;
            // console.log('mutation target', target);
            // console.log('start mutation');
            // Removal cleanup must happen now while removed nodes are still
            // identifiable; it touches only Map entries, no DOM scan.
            mutation.removedNodes.forEach(cleanupRemovedSubtree);
            pendingMarkRoots.add(target);
        }
        if (pendingMarkRoots.size > 0) scheduleMutationProcess();
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
    //#endregion

    //#endregion

    // console.debug("get config:", "ruleStrategy: ", ruleStrategy, "viewStrategy: ", viewStrategy,
    //     "targetLanguage: ", targetLanguage, "translateService: ", translateService, "globalSwitch: ",
    //     globalSwitch, "defaultStrategy: ", defaultStrategy, "domainStrategy: ", domainStrategy)

    //#region message listener
    // Accept messages from popups, process the task
    browser.runtime.onMessage.addListener(async (message, sender, sendResponse: (t: any) => void) => {
        if (!message) return
        console.log('content script receive message:', message)
        switch (message.action) {
            case TRANSLATE_ACTION.TRANSLATE:
                console.log('start translate page')
                await translateAction()
                break
            case TRANSLATE_ACTION.SHOW_ORIGINAL:
                console.log('start restore original page')
                await restoreOriginalAction()
                break
            case TRANSLATE_ACTION.TOGGLE:
                // Toggle is decided by the top frame only; it then relays the
                // explicit translate/restore to sub-frames (toggleTranslateStatus).
                // Sub-frames must NOT toggle their own status or they'd drift
                // out of phase with the tab.
                if (!isTopFrame) break
                toggleTranslateStatus()
                break
            case ACTION.AI_OPEN_WORKBENCH: {
                // The workbench is a single tab-level surface. Keep it top-frame
                // only so a fanned-out message doesn't open one per frame.
                if (!isTopFrame) break
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
            case ACTION.ENTER_SELECTION_MODE:
                // Rule-selection mode (picking elements to exclude) is a
                // top-frame interaction; don't activate it inside iframes.
                if (!isTopFrame) break
                // Show the one-time entry hint first (unless suppressed); only
                // enter rule mode after the user confirms.
                await confirmRuleModeHint()
                await ruleMode.activeSelectInteraction()
                break
            case ACTION.LEAVE_SELECTION_MODE:
                if (!isTopFrame) break
                ruleMode.deactivateSelectInteraction()
                break
            case ACTION.STYLE_CHANGED:
                // process style change action
                console.log("process style change action")
                await updateStyle()
                break
            case ACTION.DOMAIN_STRATEGY_CHANGED:
                console.log('domain strategy changed:', message)
                if (message.data && typeof message.data === "string") {
                    let strategy = message.data as string
                    if (!Object.values(DOMAIN_STRATEGY).includes(strategy as DOMAIN_STRATEGY) || strategy === domainStrategy) {
                        return
                    }
                    updateDomainStrategy(strategy)
                }
                break
            case TRANSLATE_ACTION.TRANSLATE_INPUT_BOX:
                translateInputBox();
            case TRANSLATE_ACTION.TRANSLATE_PARA:
                if (!lastContextMenuElement) return
                translateParagraphElements([lastContextMenuElement]);
                break
            case TRANSLATE_ACTION.SHOW_ORIGINAL_PARA:
                if (!lastContextMenuElement) return
                restoreOriginalParagraphElement(lastContextMenuElement);
                break
            case TRANSLATE_ACTION.TRANSLATE_SELECTION:
                translateSelectionAction(message.data as string)
                break
            case ACTION.ACTIVE_TRANSLATE_SERVICE_CHANGED:
                let activeTranslateService = message.data.activeTranslateService
                if (activeTranslateService !== undefined) {
                    translateService = activeTranslateService
                }
                let activeAiTranslateServiceChoice = message.data.activeAiTranslateServiceChoice
                if (activeAiTranslateServiceChoice !== undefined) {
                    shareConfig.aiTranslateServiceChoice = activeAiTranslateServiceChoice
                }
            case ACTION.CONFIG_CHANGED:
                if (typeof message.data !== "object") return
                let activeFlag = !!message.active
                Object.entries(message.data).forEach(([key, value]) => {
                    onConfigChanged(key, value, activeFlag)
                })
                break
            case TRANSLATE_ACTION.TOGGLE_TRANSLATE_PARA:
                toggleTranslateParagraph()
                break
            case TRANSLATE_ACTION.TRANSLATE_SELECTION_INPUT_BOX:
                translateSelectionInputBox()
                break
            default:
                break
        }
    });
    //#endregion

    if (globalSwitch) {
        await init()
    }

    //#region event listeners
    document.addEventListener('mousemove', e => { lastX = e.clientX; lastY = e.clientY; }, { passive: true });

    // Double-tap shortcut: pressing the configured modifier (Ctrl/Alt) twice in
    // quick succession, with no other key in between, runs a quick action. The
    // toggles are read live on trigger so the latest settings apply.
    const DOUBLE_TAP_INTERVAL_MS = 400;
    let lastModifierTapTime = 0;
    document.addEventListener('keydown', async (e) => {
        // Ignore auto-repeat while the key is held.
        if (e.repeat) return;
        // Nothing before this point touches the event synchronously (no
        // preventDefault/stopPropagation), so awaiting here is safe.
        const modifier = await readConfig<string>(CONFIG_KEY.DOUBLE_TAP_MODIFIER);
        const expectedKey = modifier === 'alt' ? 'Alt' : 'Control';
        if (e.key !== expectedKey) {
            // Any non-modifier key (or the wrong modifier) breaks the tap sequence,
            // so real combos like Ctrl+C never trigger a double-tap.
            lastModifierTapTime = 0;
            return;
        }
        const now = Date.now();
        if (now - lastModifierTapTime <= DOUBLE_TAP_INTERVAL_MS) {
            lastModifierTapTime = 0;
            void handleDoubleTapModifier();
        } else {
            lastModifierTapTime = now;
        }
    }, true);

    // add 'Translate/Restore this paragraph' menu when mouse is over the text of
    // a paragraph element and right mouse clicked
    // Due to chrome limitations, currently context menu of 'Translate/Restore this paragraph' can only be implemented in this way.
    // chrome known issue: The context menu that is not triggered by the right mouse button may be abnormal.
    if (!IS_FIREFOX) {
        document.addEventListener("mousedown", (e) => {
            // return
            if (e.button !== 2 || !contextMenuSwitch) { // ignore non right click
                return
            }
            const target = e.target as HTMLElement | null;
            const para = closestParagraph(target)

            notifyParaContextMenuUpdate(e.clientX, e.clientY, para)
        }, true);
    }


    document.addEventListener("contextmenu", (e) => {
        if (!contextMenuSwitch) {
            return
        }
        const target = e.target as HTMLElement | null;
        if (target && IsEditableElement(target)) {
            // console.log("isContentEditable", target);
            lastEditableElement = target
        }
        if (IS_FIREFOX) {
            let ele = document.elementFromPoint(lastX, lastY) as Element | null
            const para = closestParagraph(ele)

            notifyParaContextMenuUpdate(lastX, lastY, para)
        }
    })
    //#endregion

    //#region functions
    function notifyParaContextMenuUpdate(lastX: number, lastY: number, element: HTMLElement | null) {
        if (element && isPointOverText(lastX, lastY, element)) {
            let translated
            if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
                translated = duoTranslatedElementMap.has(element);
            } else {
                translated = translatedElementMap.has(element);
            }
            browser.runtime.sendMessage({ action: ACTION.SHOW_TRANSLATE_RESTORE_PARA_MENU, data: { translated: translated } }).then((msg) => {
                if (msg.status === STATUS_SUCCESS) {
                    lastContextMenuElement = element
                }
            });

        } else {
            browser.runtime.sendMessage({ action: ACTION.HIDE_TRANSLATE_RESTORE_PARA_MENU }).then((msg) => {
                if (msg.status === STATUS_SUCCESS) {
                    lastContextMenuElement = null
                }
            });
        }
    }

    async function onConfigChanged(key: string, value: any, activeFlag: boolean) {
        switch (key) {
            case CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS:
                if (typeof value !== "number") return
                translationLineBreakMinChars = value
                break
            case CONFIG_KEY.TRANSLATE_SERVICE:
                console.log('translate service changed:', value)
                if (!value || typeof value !== "string") return
                let service = value
                translateService = service
                if (activeFlag) {
                    if (translateStatus) {
                        await restoreOriginalAction()
                        await translateAction()
                    }
                }
                break
            case CONFIG_KEY.DEFAULT_STRATEGY:
                if (!value || typeof value !== "string") return
                if (!Object.values(DEFAULT_STRATEGY).includes(value as DEFAULT_STRATEGY) || defaultStrategy === value) return
                await updateDefaultStrategy(value, activeFlag)
                break
            case CONFIG_KEY.GLOBAL_SWITCH:
                console.log('global switch changed:', value)
                if (typeof value === "boolean" && globalSwitch != value) {
                    manualTrigger = false
                    globalSwitch = value
                    if (!globalSwitch) {
                        await unload()
                        return false
                    } else {
                        await init()
                    }
                }
                break
            case CONFIG_KEY.VIEW_STRATEGY:
                if (!value || typeof value !== "string") return
                let newViewStrategy = value as VIEW_STRATEGY
                if (!Object.values(VIEW_STRATEGY).includes(newViewStrategy) || viewStrategy === newViewStrategy) return

                if (viewStrategy != value) {
                    viewStrategy = newViewStrategy
                } else {
                    return
                }
                if (!activeFlag) {
                    return
                }
                // process the view strategy change
                if (translateStatus) {
                    await restoreOriginalAction()
                    await translateAction()
                }
                break
            case CONFIG_KEY.TRANSLATION_CACHE_SWITCH:
                // Drop the memoized cache-enabled flag so the next translate
                // batch re-reads the toggle.
                if (typeof value !== "boolean") return
                resetTranslationCacheEnabled(value)
            case CONFIG_KEY.TARGET_LANGUAGE:
                if (typeof value === "string" && targetLanguage !== value && LANGUAGES_MAP.has(value)) {
                    targetLanguage = value
                    if (activeFlag && needsTranslate()) {
                        await restoreOriginalAction()
                        await translateAction()
                    }
                }
                break
            case CONFIG_KEY.FLOAT_BALL_SWITCH:
                if (typeof value !== "boolean") return
                if (value === floatBallSwitch) return
                console.log('float ball switch changed from ', floatBallSwitch, "to ", value)
                floatBallSwitch = value
                if (floatBallSwitch) {
                    await initFloatBall()
                } else {
                    await removeFloatBall()
                }
                break
            case CONFIG_KEY.CONTEXT_MENU_SWITCH:
                if (typeof value === "boolean") {
                    contextMenuSwitch = value
                }
                break
            case CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES:
                if (typeof value === "number") {
                    bilingualHighlightingMinSentences = value
                }
                break
            case CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH:
                if (typeof value === "boolean" && bilingualHighlightingSwitch !== value) {
                    bilingualHighlightingSwitch = value
                    if (activeFlag && translateStatus && viewStrategy === VIEW_STRATEGY.DOUBLE) {
                        await restoreOriginalAction()
                        await translateAction()
                    }
                }
            default:
                break
        }

    }

    async function updateDomainStrategy(strategy: string) {
        domainStrategy = strategy
        manualTrigger = true
        switch (domainStrategy) {
            case DOMAIN_STRATEGY.AUTO:
                switch (defaultStrategy) {
                    case DEFAULT_STRATEGY.AUTO:
                        manualTrigger = false
                        if (pageLanguage === undefined) {
                            pageLanguage = await detectLanguage()
                        }
                        let needTranslate = targetLanguage != pageLanguage
                        if (translateStatus && !needTranslate) {
                            await restoreOriginalAction()
                        } else if (!translateStatus && needTranslate) {
                            await translateAction()
                        }
                        break
                    case DEFAULT_STRATEGY.NEVER:
                        if (translateStatus) {
                            await restoreOriginalAction()
                        }
                        break
                    case DEFAULT_STRATEGY.ALWAYS:
                        if (!translateStatus) {
                            await translateAction()
                        }
                        break
                    default:
                        break
                }
                break
            case DOMAIN_STRATEGY.NEVER:
                if (translateStatus) {
                    await restoreOriginalAction()
                }
                break
            case DOMAIN_STRATEGY.ALWAYS:
                if (!translateStatus) {
                    await translateAction()
                }
                break
            default:
                break
        }
    }

    async function updateDefaultStrategy(strategy: string, activeFlag: boolean) {
        defaultStrategy = strategy
        if (!activeFlag) {
            return
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
                if (pageLanguage === undefined) {
                    pageLanguage = await detectLanguage()
                }
                if (translateStatus && targetLanguage === pageLanguage) {
                    await restoreOriginalAction()
                }
                if (!translateStatus && targetLanguage !== pageLanguage) {
                    await translateAction()
                }
                console.log('default strategy:', translateStatus)
                break
            case DEFAULT_STRATEGY.NEVER:
                if (translateStatus) {
                    await restoreOriginalAction()
                }
                break
            case DEFAULT_STRATEGY.ALWAYS:
                if (!translateStatus) {
                    await translateAction()
                }
                break
            default:
                break

        }
    }

    // Double-tap modifier handler. Only one action fires per gesture, checked in
    // priority order: an active text selection wins, then a focused editable
    // input, then the paragraph under the mouse. Each is gated by its own toggle.
    async function handleDoubleTapModifier() {
        const [doSelection, doInput, doParagraph] = await Promise.all([
            readConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TRANSLATE_SELECTION),
            readConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TRANSLATE_INPUT),
            readConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TOGGLE_PARAGRAPH),
        ]);

        if (doSelection) {
            const selection = window.getSelection();
            const text = selection?.toString().trim();
            if (text) {
                translateSelection(text, selection);
                return;
            }
        }
        if (doInput) {
            const active = document.activeElement;
            if (active instanceof HTMLElement && IsEditableElement(active)) {
                lastEditableElement = active;
                translateInputBox();
                return;
            }
        }
        if (doParagraph) {
            toggleTranslateParagraph();
        }
    }

    function translateSelectionInputBox() {
        let selection = window.getSelection()
        // console.log('translateSelectionInputBox selection: ', selection)
        let text = selection?.toString().trim()
        if (!text) {
            // translate input box
            const active = document.activeElement
            if (!active || !(active instanceof HTMLElement) || IsEditableElement(active)) return
            lastEditableElement = active
            translateInputBox()
            // console.log('translateSelectionInputBox active: ', active)
            return
        }
        // console.log('translateSelectionInputBox text: ', text)
        translateSelection(text, selection)

    }

    // Decide whether the pointer is over the paragraph's text — counting both
    // glyphs themselves and the blank gaps *between* lines (line-height leading,
    // <br>, wrapped lines), while still excluding the paragraph's outer padding
    // and the empty space past the end of a short line.
    //
    // `getClientRects()` over the paragraph's contents yields one rect per line
    // fragment. The pointer counts as "on text" when it is either directly on a
    // line fragment, or in a vertical gap that has a text line both above AND
    // below it at the same x (an inter-line gap) — outer padding only ever has a
    // line on one side, so it is correctly rejected.
    function isPointOverText(x: number, y: number, container: HTMLElement): boolean {
        const range = document.createRange();
        range.selectNodeContents(container);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        // Line fragments whose horizontal span covers the pointer.
        const overX = rects.filter((r) => x >= r.left && x <= r.right);
        if (overX.length === 0) return false;
        // Directly on a text line.
        if (overX.some((r) => y >= r.top && y <= r.bottom)) return true;
        // In a blank gap with a text line both above and below at this x.
        const hasAbove = overX.some((r) => r.bottom <= y);
        const hasBelow = overX.some((r) => r.top >= y);
        return hasAbove && hasBelow;
    };

    function toggleTranslateParagraph() {
        let ele = document.elementFromPoint(lastX, lastY) as Element | null
        let target = closestParagraph(ele)
        if (!(target instanceof HTMLElement)) return
        const translated = duoTranslatedElementMap.has(target) || translatedElementMap.has(target)
        if (translated) {
            restoreOriginalParagraphElement(target)
        } else {
            translateParagraphElements([target])
        }
    }

    function IsEditableElement(element: HTMLElement): boolean {
        if (element.isContentEditable) {
            return true
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return true
        }
        return false
    }

    async function translateInputBox() {
        if (!lastEditableElement) return
        const originalText = getElementText(lastEditableElement);
        if (originalText === "") return
        const runStream = startTranslate(originalText, shareConfig.aiTargetLanguage, shareConfig.aiTranslateServiceChoice);
        let translatedText = "";
        for await (const chunk of runStream.stream) {
            translatedText += chunk;
        }
        console.log("translateInputBox: ", translatedText);
        await applyTextToTarget(lastEditableElement, translatedText);

    }

    // "Translate selection" context-menu action. The menu fans out to every
    // frame of the tab, so only the frame that actually owns the selection
    // should show the popup. Translation reuses the PAGE translate service and
    // target language (streamed), and the result is shown in a Shadow-DOM card
    // anchored to the selection.
    function translateSelectionAction(selectionText: string) {
        const selection = window.getSelection()

        const localSelection = selection?.toString().trim() || ""
        // No local selection → the selection lives in another frame; skip so we
        // don't pop up a duplicate empty card here.
        if (localSelection === "") return
        const text = (selectionText && selectionText.trim() !== "") ? selectionText : localSelection
        if (text.trim() === "") return

        translateSelection(text, selection)
    }

    function translateSelection(text: string, selection: Selection | null) {
        let rect: DOMRect | null = null
        try {
            if (selection && selection.rangeCount > 0) {
                const r = selection.getRangeAt(0).getBoundingClientRect()
                if (r && (r.width > 0 || r.height > 0)) rect = r
            }
        } catch { /* detached range — fall back to centered placement */ }

        openSelectionTranslate({ text, rect })
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
        if (removedNode.nodeType !== Node.ELEMENT_NODE) return;
        const removed = removedNode as HTMLElement;
        if (isParagraph(removed)) {
            duoTranslatedElementMap.delete(removed);
            translatedElementMap.delete(removed);
            paragraphElementMap.delete(removed);
            cleanupParagraphMarks(removed);
            return;
        }
        cleanupParagraphMarks(removed);
        // Walk our own tracking map instead of querySelectorAll on the removed
        // subtree — the map is much smaller than a re-scan of the whole subtree.
        if (paragraphElementMap.size === 0) return;
        for (const tracked of Array.from(paragraphElementMap.keys())) {
            if (removed.contains(tracked)) {
                duoTranslatedElementMap.delete(tracked);
                translatedElementMap.delete(tracked);
                paragraphElementMap.delete(tracked);
            }
        }
    }

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
        initCSS()
        // The float ball is a single tab-level UI — top frame only.
        if (isTopFrame) await initFloatBall()
        await initTranslate()
        // AI Writing is independent of page-translation lifecycle: even when
        // page translation is off / restricted, the writing assistant should
        // still be available on user input fields. In sub-frames the dot mounts
        // inside the iframe and is deferred until an input there is focused.
        // Video bilingual subtitles — top frame on supported sites only. The
        // controller follows its own VIDEO_SUBTITLE_SWITCH internally; this
        // only ties it to the extension-wide global switch lifecycle.
        if (isTopFrame && window.location.hostname === "www.youtube.com" && !videoSubtitle) {
            videoSubtitle = initVideoSubtitle()
        }
        aiWritingDotDisposed = false
        if (isTopFrame) {
            mountAiWritingDot({ domain: domainWithPort })
                .then((teardown) => {
                    // Unloaded while the async mount was in flight — undo it.
                    if (aiWritingDotDisposed) { teardown(); return; }
                    aiWritingDotDispose = teardown
                })
                .catch((err) =>
                    console.warn(APP_NAME_WITH_SUFFIX, "mountAiWritingDot failed", err),
                )
        } else {
            aiWritingDotDispose = initAiWritingDotInFrame()
        }
    }

    async function removeAiWritingDot() {
        aiWritingDotDisposed = true
        aiWritingDotDispose?.()
        aiWritingDotDispose = null
        // The workbench is a separate Shadow-DOM singleton mounted alongside the
        // dot (ensureWorkbenchMounted in mountAiWritingDot) — tear it down too.
        destroyWorkbench()
    }

    /**
     * Execute unload function when turning off global switch
     */
    async function unload() {
        removeCSS()
        observer.disconnect()
        removeFloatBall()
        removeAiWritingDot()
        videoSubtitle?.destroy()
        videoSubtitle = null
        restoreOriginalPage(true, true)
    }

    function needsTranslate(): boolean | undefined {
        if (!globalSwitch) return false;
        if (domainStrategy === DOMAIN_STRATEGY.NEVER) return false;
        if (domainStrategy === DOMAIN_STRATEGY.ALWAYS) return true;
        if (defaultStrategy === DEFAULT_STRATEGY.NEVER) return false;
        if (defaultStrategy === DEFAULT_STRATEGY.ALWAYS) return true;
        if (pageLanguage !== undefined) {
            return pageLanguage !== targetLanguage
        }
    }

    async function initTranslate() {
        startObserveDom()
        let htmlElements = await markParagraphElement(document.body);
        let shouldTranslate = false
        if (isTopFrame) {
            let needs = needsTranslate()
            if (needs === undefined) {
                pageLanguage = await detectLanguage(htmlElements)
                needs = pageLanguage !== targetLanguage
            }
            shouldTranslate = needs
        }

        // Late-loading sub-frame catch-up: an iframe created AFTER the user
        // already turned translation on (e.g. a button that opens an iframe
        // dialog) must sync to the tab's current state. The top frame only
        // relays a toggle at the instant it happens, so a frame that loads
        // later would otherwise stay in its original language even though the
        // rest of the tab is translated. The top frame is the source of truth
        // and persists the status to session storage — read it here. (Only the
        // manual-on case needs this; isNeedsTranslate already covers the
        // strategy/auto path, and the top frame manages its own status.)
        if (!isTopFrame) {
            const tabTranslated = await getSessionStorage(tabTranslateStatusKey)
            if (tabTranslated === true) shouldTranslate = true
        }
        if (shouldTranslate || translateStatus) {
            await updateTranslateStatus(true, !translateStatus)
            // Push the decision to sub-frames as an explicit TRANSLATE instead
            // of relying on them winning the session-storage race: a sub-frame
            // whose catch-up read (above) ran BEFORE we persisted the status
            // here would otherwise stay untranslated. Combined with the
            // catch-up read this covers both init orders — the relay echo back
            // to us and to already-translated frames is an idempotent no-op.
            if (isTopFrame) relayToSubframes(TRANSLATE_ACTION.TRANSLATE)
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
        // The selected-region indicator is drawn by ruleMode's overlay (yellow
        // boxes), not a `.duo-selected` outline — an outline here would be clipped
        // by the page's `overflow:hidden` ancestors just like the hover highlight.
        document.head.appendChild(ruleModeStyle)
        await updateStyle()
    }

    async function removeCSS() {
        document.getElementById('rule-mode-style')?.remove()
        if (translationStyleSheet) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
                (s) => s !== translationStyleSheet,
            )
            translationStyleSheet = null
        }
        if (translationStyleElement) {
            translationStyleElement.remove()
            translationStyleElement = null
        }
        // Legacy cleanup — earlier versions used a <style id="duo-translation-style">.
        document.getElementById('duo-translation-style')?.remove()
    }

    function startObserveDom() {
        // No attribute observation: paragraph marks live in content-script
        // memory (paragraphMarks.ts), so page-side class rewrites can't touch
        // them and our own marking produces no attribute mutations to filter.
        //
        // Observe <html>, not <body>: SPAs that swap the whole <body> on soft
        // navigation (Turbo/Astro-style) would otherwise leave this observer
        // watching the old detached body, so post-navigation content would
        // never get marked/translated. The callback filters out <head>-level
        // noise and re-roots onto a freshly-added <body>.
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,// text content change
            // characterDataOldValue: true,
        });
    }

    // Fan a translate/restore out to this tab's sub-frames. The top frame can't
    // reach cross-origin iframes directly, so it asks the background to
    // re-broadcast the action to every frame of the tab. The echoed action also
    // comes back to the top frame, but translate/restore are idempotent (task +
    // status guards) so the re-entry is a harmless no-op. Sub-frames ignore raw
    // TOGGLE and rely on this explicit relay, so their on/off state never
    // diverges from the top frame's.
    function relayToSubframes(action: string) {
        void sendMessageToBackground({ action: ACTION.RELAY_FRAMES, data: { action } })
    }

    function setFloatBallSwitchStatus(status: boolean) {
        console.log("setFloatBallSwitchStatus", floatBall + " " + status);
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
            onTranslate: () => { translateAction(); relayToSubframes(TRANSLATE_ACTION.TRANSLATE) },
            onRestore: () => { restoreOriginalAction(); relayToSubframes(TRANSLATE_ACTION.SHOW_ORIGINAL) },
            onClose: () => {
                floatBallSwitch = false
                // Defer teardown: onClose fires from inside the ball's own React
                // click handler; unmounting the root synchronously from there is
                // unsafe, so let the current event finish first.
                setTimeout(() => removeFloatBall(), 0)
            },
        })
    }

    /**
     * save translate status, update float ball status and notify popup and background
     * @param status
     */
    async function updateTranslateStatus(status: boolean, persist = true) {
        if (translateStatus === status) {
            return
        }
        // Sub-frames mirror the status locally only — the tab-level session
        // record, the float ball, and the popup/badge broadcast are owned by
        // the top frame. If sub-frames wrote/broadcast too, they'd clobber the
        // tab status with their own per-frame decision.
        if (!isTopFrame) {
            translateStatus = status
            return
        }
        console.log("persist translate status", status);
        if (persist) {
            await setSessionStorage(tabTranslateStatusKey, status)
        }
        translateStatus = status
        setFloatBallSwitchStatus(status)
        // notify the popup and background to set translate status
        browser.runtime.sendMessage({
            action: TRANSLATE_ACTION.TRANSLATE_STATUS_CHANGED,
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
            await updateTranslateStatus(true)
            // some elements probably have been translated
            await restoreOriginalPage(false)
            needsTranslateParagraphs().forEach((ele) => {
                paragraphElementMap.set(ele, ELEMENT_STATUS.ORIGINAL)
                // console.log("translateAction observe element");
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
            await updateTranslateStatus(false)
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
            await restoreOriginalPage(false, false)
        }
        restoreOriginalTask = action()
        restoreOriginalTask.finally(() => {
            restoreOriginalTask = null
        })
    }

    async function restoreOriginalParagraphElement(element: HTMLElement) {
        let duoTexts = duoTranslatedElementMap.get(element)
        if (duoTexts) {
            ignoreMutationElements.add(element)
            highlightDisposers.get(element)?.()
            highlightDisposers.delete(element)
            try {
                // Remove only nodes owned by THIS container — a mixed
                // container may hold nested marked paragraphs (<li>) whose
                // translations/spans are restored by their own entries.
                for (let node of element.querySelectorAll(".duo-translation, .duo-divide")) {
                    if (closestParagraph(node) === element) node.remove()
                }
                for (let span of element.querySelectorAll("duo-span")) {
                    if (closestParagraph(span) === element) span.remove()
                }
            } catch (e) {
                console.error(APP_NAME_WITH_SUFFIX, "restore original paragraph error:", e)
            }
            duoTexts.forEach(t => {
                ignoreMutationElements.add(t)
                t.text.textContent = t.content
            })

            Promise.resolve().then(() => {
                ignoreMutationElements.delete(element)
                duoTexts.forEach(t => {
                    ignoreMutationElements.delete(t.text)
                })
                duoTranslatedElementMap.delete(element)
            })
            return
        }
        let results = translatedElementMap.get(element)
        if (results) {
            ignoreMutationElements.add(element)
            results.forEach(result => result.replacedTextNodes?.forEach(text => {
                ignoreMutationElements.add(text)
            }))
            await restore(results)
            Promise.resolve().then(() => {
                ignoreMutationElements.delete(element)
                results.forEach(result => result.replacedTextNodes?.forEach(text => {
                    ignoreMutationElements.delete(text)
                }))
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
            await updateTranslateStatus(false)
        }

        if (duoTranslatedElementMap.size > 0) {
            for (let [element, texts] of duoTranslatedElementMap) {
                if (!element) {
                    continue
                }
                ignoreMutationElements.add(element)
                highlightDisposers.get(element)?.()
                highlightDisposers.delete(element)
                try {
                    // Remove only nodes owned by THIS container — a mixed
                    // container may hold nested marked paragraphs (<li>) whose
                    // translations/spans are restored by their own entries.
                    // querySelectorAll: one container may carry several unit
                    // translations.
                    for (let node of element.querySelectorAll(".duo-translation, .duo-divide")) {
                        if (closestParagraph(node) === element) node.remove()
                    }
                    for (let span of element.querySelectorAll("duo-span")) {
                        if (closestParagraph(span) === element) span.remove()
                    }
                } catch (e) {
                    console.error(APP_NAME_WITH_SUFFIX, "restore original page error:", e)
                }
                texts.forEach(t => {
                    ignoreMutationElements.add(t.text)
                    t.text.textContent = t.content
                })
            }
            // add delete ignoreMutationElements task to the macro-task queue, will process after observe task when next event loop starts
            // setTimeout(() => {
            //     for (let element of duoTranslatedElementMap) {
            //         ignoreMutationElements.delete(element?.[0])
            //     }
            // }, 0);

            // add delete ignoreMutationElements task to the micro-task queue after observe task
            Promise.resolve().then(() => {
                for (let [element, texts] of duoTranslatedElementMap) {
                    ignoreMutationElements.delete(element)
                    texts.forEach(t => {
                        ignoreMutationElements.delete(t.text)
                    })
                }
                duoTranslatedElementMap.clear()
            })
        }
        if (translatedElementMap.size > 0) {
            let results: TranslateResult[] = []
            translatedElementMap.forEach((elementResults, element) => {
                ignoreMutationElements.add(element)
                // remote all text recursively node of element
                // removeTextNodes(element)
                results.push(...elementResults)
                elementResults.forEach(result => result.replacedTextNodes?.forEach(text => {
                    ignoreMutationElements.add(text)
                }))
            })
            await restore(results)
            Promise.resolve().then(() => {
                translatedElementMap.forEach((elementResults, element) => {
                    ignoreMutationElements.delete(element)
                    elementResults.forEach(result => result.replacedTextNodes?.forEach(text => {
                        ignoreMutationElements.delete(text)
                    }))
                })
                translatedElementMap.clear()
            })
        }
        if (pure) {
            // Strip leftover duo-* attributes/classes from marked paragraphs
            // BEFORE dropping the marks — the marks map is the only index left.
            allParagraphs().forEach(element => {
                removeDuoClassAndAttribute(element)
            })
            clearParagraphMarks()
            resetNoTranslateMarks()
        }
        // console.log('restore original page', duoTranslatedElementMap)

        // height and line limit restore
        // let heightBreakElements = document.querySelectorAll(".duo-height-break")
        // for (let heightBreakElement of heightBreakElements) {
        //     let element = heightBreakElement as HTMLElement
        //     element.style.maxHeight = element.getAttribute("duo-max-height") || ""
        //     element.removeAttribute("duo-max-height")
        //     element.classList.remove("duo-height-break")
        // }
        // let lineBreakElements = document.querySelectorAll(".duo-line-break")
        // for (let lineBreakElement of lineBreakElements) {
        //     let element = lineBreakElement as HTMLElement
        //     element.style.setProperty("-webkit-line-clamp", element.getAttribute("duo-webkit-line-clamp") || "")
        //     element.removeAttribute("duo-webkit-line-clamp")
        //     element.classList.remove("duo-line-break")
        // }
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

    // Only ever invoked in the top frame (the TOGGLE message case is gated).
    // After deciding translate-vs-restore from the top frame's status, fan the
    // resulting EXPLICIT action out to sub-frames so they don't toggle off their
    // own (possibly diverging) per-frame status.
    function toggleTranslateStatus() {
        // translateStatus = !translateStatus
        manualTrigger = true
        if (translateStatus) {
            restoreOriginalAction()
            relayToSubframes(TRANSLATE_ACTION.SHOW_ORIGINAL)
        } else {
            translateAction()
            relayToSubframes(TRANSLATE_ACTION.TRANSLATE)
        }
    }

    async function updateStyle() {
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

        if (!translationStyleSheet && !translationStyleElement) {
            if (import.meta.env.FIREFOX) {
                translationStyleElement = document.createElement('style')
                translationStyleElement.id = 'duo-translation-style'
                document.head.appendChild(translationStyleElement)
            } else {
                translationStyleSheet = new CSSStyleSheet()
                document.adoptedStyleSheets = [...document.adoptedStyleSheets, translationStyleSheet]
            }
        }
        // replaceSync replaces all rules atomically; far cheaper than re-parsing
        // an innerText concatenation on every drag tick from the color picker.
        if (translationStyleSheet) {
            translationStyleSheet.replaceSync(css)
        } else if (translationStyleElement) {
            translationStyleElement.textContent = css
        }
    }

    /**
     * search paragraph elements and record them as in-memory paragraph marks
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

        // Walk up — looking for an enclosing paragraph mark (early return) or
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
            if (isParagraph(p)) {
                if (isMixedParagraph(p)) {
                    // Mixed container: a mutation under one of its block-ish
                    // children belongs to a deeper unit — keep walking inward
                    // (a nested mark or the Phase B scan handles it). Anything
                    // else sits inside one of the container's own inline runs.
                    const child = (i > 0 ? parentElements[i - 1] : rawElement);
                    if (isBlockBoundary(child) || child.querySelector(BLOCK_SELECTOR)) {
                        continue;
                    }
                }
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
            if (!nt && rules?.length > 0) {
                try {
                    if (el.matches(rules.join(","))) {
                        // Cache the positive rule match so re-scans of this
                        // subtree short-circuit via isNotTranslateElement.
                        markNoTranslate(el);
                        nt = true
                    }
                } catch (e) {
                    console.warn(APP_NAME_WITH_SUFFIX, "markParagraphElement matches failed", e);
                }
            }

            if (isParagraph(el)) {
                // Re-segment on every visit: structural mutations can change
                // the element's runs/block children, so refresh the mixed
                // flag, re-collect when an untranslated unit exists, and keep
                // descending into block-ish children (their own marks live
                // deeper).
                const seg = segmentParagraph(el);
                markParagraph(el, !nt, seg.descendChildren.length > 0);
                if (!nt && seg.units.some(u => !u.translated)) collectElements.push(el);
                for (let j = seg.descendChildren.length - 1; j >= 0; j--) {
                    stack.push({ el: seg.descendChildren[j], notTranslate: nt, depth: depth + 1 });
                }
                continue;
            }
            if (isEditable(el)) continue;

            if (isParagraphElement(el)) {
                // >=1 valid direct text node guarantees >=1 unit.
                const seg = segmentParagraph(el);
                markParagraph(el, !nt, seg.descendChildren.length > 0);
                if (!nt && seg.units.some(u => !u.translated)) collectElements.push(el);
                for (let j = seg.descendChildren.length - 1; j >= 0; j--) {
                    stack.push({ el: seg.descendChildren[j], notTranslate: nt, depth: depth + 1 });
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

    // Delegated bilingual highlighting: one listener pair per paragraph instead
    // of per duo-span. The highlight is "sticky" — hovering blank areas inside
    // the paragraph (line gaps of a multi-line sentence, the divide, padding)
    // keeps the current sentence highlighted; it only switches when the pointer
    // enters another sentence's span, and only clears on leaving the paragraph.
    // Returns a disposer that clears the highlight and detaches the listeners.
    function bindHighlightHandler(originalElement: HTMLElement): () => void {
        let currentSequence: number | null = null

        // duo-sequence numbers are unique within one container (units of the
        // same container share a running offset), so a single delegated
        // binding per container pairs both sides. Ownership is resolved via
        // closestParagraph so spans of nested marked paragraphs (an <li>
        // inside a mixed container — they have their own binding and their
        // own numbering) are never touched by this one.
        function applyHighlight(sequence: number, add: boolean) {
            let sequenceElements = originalElement.querySelectorAll('duo-span[duo-sequence="' + sequence + '"]')
            for (let sequenceElement of sequenceElements) {
                if (closestParagraph(sequenceElement) !== originalElement) continue
                if (sequenceElement.closest('.duo-translation')) {
                    sequenceElement.classList.toggle("duo-highlight-translation", add)
                } else {
                    sequenceElement.classList.toggle("duo-highlight-original", add)
                }
            }
        }

        const onMouseOver = (event: Event) => {
            const target = event.target as Element | null
            const span = target?.closest?.('duo-span[duo-sequence]')
            // No span under the pointer (blank area) → keep the current highlight.
            // The ownership guard protects against spans of an enclosing or
            // nested paragraph (each has its own binding).
            if (!span || closestParagraph(span) !== originalElement) {
                return
            }
            const sequence = parseInt(span.getAttribute("duo-sequence")!)
            if (isNaN(sequence) || sequence === currentSequence) {
                return
            }
            if (currentSequence !== null) {
                applyHighlight(currentSequence, false)
            }
            currentSequence = sequence
            applyHighlight(sequence, true)
        }

        // mouseleave does not bubble, so this only fires when the pointer
        // actually exits the whole paragraph (original + translation).
        const onMouseLeave = () => {
            if (currentSequence === null) {
                return
            }
            applyHighlight(currentSequence, false)
            currentSequence = null
        }

        originalElement.addEventListener("mouseover", onMouseOver)
        originalElement.addEventListener("mouseleave", onMouseLeave)
        return () => {
            onMouseLeave()
            originalElement.removeEventListener("mouseover", onMouseOver)
            originalElement.removeEventListener("mouseleave", onMouseLeave)
        }
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
        let ignoreElements: Node[] = []
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
            // Expand each container into its untranslated logical-paragraph
            // units; containers with nothing left to do (translation in
            // flight, or every unit already translated) are skipped.
            const units: TranslationUnit[] = []
            for (const element of elements) {
                if (ignoreMutationElements.has(element)) continue
                const segUnits = segmentParagraph(element).units.filter(u => !u.translated)
                if (segUnits.length === 0) continue
                units.push(...segUnits)
                ignoreElements.push(element)
                ignoreMutationElements.add(element)
            }
            if (units.length === 0) {
                return
            }
            let service = translateService
            if (context && typeof context.targetTranslateService === "string" && context.targetTranslateService) {
                service = context.targetTranslateService
                console.log('context.targetTranslateService:', context.targetTranslateService)
            }
            if (service == "") {
                service = TRANSLATE_SERVICE.MICROSOFT
            }

            let translateResults = await getTranslateResult(service, units, targetLanguage, viewStrategyCopy, controller?.signal)
            if (!translateResults || translateResults.length === 0) {
                return
            }

            // remove the unit whose language is same as targetLanguage
            for (let i = translateResults.length - 1; i >= 0; i--) {
                let result = translateResults[i]
                if (result.sourceLang == targetLanguage && result.score >= 0.7) {
                    translateResults.splice(i, 1)
                    continue
                }
                result.textNodes?.forEach(text => {
                    ignoreElements.push(text)
                    ignoreMutationElements.add(text)
                })
            }
            if (translateResults.length === 0) {
                return
            }

            // the elements will be replaced(translated) in single view strategy
            // the copy of elements will be replaced(translated) in double view strategy
            await translate(translateService, translateResults)

            // Containers that actually received a translation this round.
            const translatedContainers = new Set<HTMLElement>()

            if (viewStrategyCopy == VIEW_STRATEGY.SINGLE) {
                for (const result of translateResults) {
                    const element = result.unit?.container
                    if (!element) continue
                    const elementResults = translatedElementMap.get(element) ?? []
                    elementResults.push(result)
                    translatedElementMap.set(element, elementResults)
                    translatedContainers.add(element)
                }
            }

            // append translated copy element to original element in double view strategy
            if (viewStrategyCopy == VIEW_STRATEGY.DOUBLE) {
                // Group per container: one bookkeeping entry and one highlight
                // binding per container; duo-sequence numbers run across its
                // units so pairing under the single binding stays unambiguous.
                const resultsByContainer = new Map<HTMLElement, TranslateResult[]>()
                for (const result of translateResults) {
                    const element = result.unit?.container
                    if (!element || !result.translatedCopyElement) continue
                    const list = resultsByContainer.get(element) ?? []
                    list.push(result)
                    resultsByContainer.set(element, list)
                }
                for (const [element, containerResults] of resultsByContainer) {
                    const originalTexts: { text: Text, content: string }[] = duoTranslatedElementMap.get(element) ?? []
                    // Continue sequence numbering after spans of earlier rounds.
                    let sequenceOffset = 0
                    for (const span of element.querySelectorAll('duo-span[duo-sequence]')) {
                        if (closestParagraph(span) !== element) continue
                        const seq = parseInt(span.getAttribute('duo-sequence')!)
                        if (!isNaN(seq) && seq >= sequenceOffset) sequenceOffset = seq + 1
                    }
                    let insertedAny = false
                    let wrappedAny = false
                    for (const result of containerResults) {
                        const unit = result.unit!
                        const translatedElement = result.translatedCopyElement!
                        // The unit's last text-bearing node is the insertion anchor.
                        let lastChild: ChildNode | null = null
                        for (let j = unit.nodes.length - 1; j >= 0; j--) {
                            if (isContainsValidTextElement(unit.nodes[j])) {
                                lastChild = unit.nodes[j]
                                break
                            }
                        }
                        // Unit nodes may have been detached while awaiting the
                        // provider — skip; that mutation requeues a scan.
                        if (!lastChild || lastChild.parentNode !== element) continue
                        // Already carries a translation (concurrent round) — skip.
                        const next = lastChild.nextSibling as HTMLElement | null
                        if (next?.classList?.contains("duo-divide") || next?.classList?.contains("duo-translation")) continue

                        const originalTextResult = getTextNodesAndTextOfNodes(unit.nodes)
                        originalTextResult.textNodes.forEach(textNode => {
                            ignoreElements.push(textNode)
                            ignoreMutationElements.add(textNode)
                        })
                        translatedElement.classList.add("duo-translation")
                        let divide: HTMLElement
                        if (originalTextResult.text.length >= translationLineBreakMinChars) {
                            divide = document.createElement('br')
                            divide.classList.add("duo-divide")
                        } else {
                            divide = document.createElement('span')
                            divide.classList.add("duo-divide")
                            divide.innerHTML = '&nbsp;&nbsp;'
                        }
                        if (lastChild.nextSibling) {
                            element.insertBefore(translatedElement, lastChild.nextSibling)
                            element.insertBefore(divide, lastChild.nextSibling)
                        } else {
                            element.appendChild(divide)
                            element.appendChild(translatedElement)
                        }
                        insertedAny = true

                        // Bilingual sentence highlighting, gated per unit — a
                        // unit failing the gates only skips its own wrapping.
                        if (!bilingualHighlightingSwitch) continue
                        if (originalTextResult.text == "" || originalTextResult.textNodes.length == 0) continue
                        const translatedTextResult = getTextNodesAndText(translatedElement)
                        if (translatedTextResult.text == "" || translatedTextResult.textNodes.length == 0) continue
                        const originalSentences = splitSentence(originalTextResult.text)
                        if (originalSentences.length === 0 || originalSentences.length < bilingualHighlightingMinSentences) continue
                        const translatedSentences = splitSentence(translatedTextResult.text)
                        if (translatedSentences.length != originalSentences.length) continue
                        originalTextResult.textNodes.forEach(textNode => {
                            originalTexts.push({ text: textNode, content: textNode.textContent })
                        })
                        let spans = wrapTextNode2Span(originalTextResult.textNodes, originalSentences, ignoreMutationElements, sequenceOffset)
                        spans.push(...wrapTextNode2Span(translatedTextResult.textNodes, translatedSentences, ignoreMutationElements, sequenceOffset))
                        sequenceOffset += originalSentences.length
                        if (spans.length > 0) wrappedAny = true
                    }
                    if (insertedAny) {
                        duoTranslatedElementMap.set(element, originalTexts)
                        translatedContainers.add(element)
                    }
                    if (wrappedAny) {
                        highlightDisposers.get(element)?.()
                        highlightDisposers.set(element, bindHighlightHandler(element))
                    }
                }
            }

            translatedContainers.forEach((element) => {
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
    //#endregion

}

//#region outer
export const shareConfig: {
    aiTranslateServiceChoice: TranslateServiceChoice,
    aiTargetLanguage: string,
    rules: string[]
} = {
    aiTranslateServiceChoice: { kind: 'trans', service: DEFAULT_VALUE.AI_TRANSLATE_SERVICE },
    aiTargetLanguage: DEFAULT_VALUE.AI_TARGET_LANGUAGE, rules: []
};

/**
 * Resolve the TOP document's domain from within a sub-frame. The dot's
 * per-domain disable must key off the page the user actually sees (the address
 * bar), not the iframe's own origin — otherwise "disable on this site" written
 * against the top domain would never match an iframe-mounted dot.
 *
 * `location.ancestorOrigins` is ordered parent→top and is readable even across
 * origins in Chromium, so its last entry is the top document's origin. Falls
 * back to a guarded same-origin `window.top.location` read, then to the
 * iframe's own domain if nothing else is available.
 */
function getTopFrameDomain(): string {
    const origins = window.location.ancestorOrigins;
    if (origins && origins.length > 0) {
        const topOrigin = origins[origins.length - 1];
        if (topOrigin && topOrigin !== "null") {
            const d = getDomainWithPortFromUrl(topOrigin);
            if (d !== "") return d;
        }
    }
    try {
        const href = window.top?.location?.href;
        if (href) {
            const d = getDomainWithPortFromUrl(href);
            if (d !== "") return d;
        }
    } catch { /* cross-origin top — not reachable, fall through */ }
    return getDomainWithPortFromUrl(window.location.href);
}

/**
 * Bring up the AI Writing dot inside a sub-frame. The dot MUST live in the
 * iframe's own document: focus events don't cross frame boundaries and
 * `position: fixed` resolves against the iframe viewport, so a top-frame dot
 * could never anchor to an input that lives in the iframe.
 *
 * Mounting is deferred until a real text field in this frame is focused —
 * eagerly spinning up a React root + workbench in every ad/tracking iframe
 * would be pure waste. `mountAiWritingDot` itself re-checks the global switch
 * and per-domain disable (keyed off the TOP domain), so all gating still holds.
 */
function initAiWritingDotInFrame(): () => void {
    const domain = getTopFrameDomain();
    if (domain === "") return () => { };
    let mounted = false;
    let disposed = false;
    let unmount: (() => void) | null = null;
    const tryMount = (el: Element | null) => {
        if (mounted || disposed || !isAiWritingTarget(el)) return;
        mounted = true;
        document.removeEventListener("focusin", onFocusIn, true);
        mountAiWritingDot({ domain })
            .then((teardown) => {
                // Unloaded while the async mount was in flight — undo it.
                if (disposed) { teardown(); return; }
                unmount = teardown;
            })
            .catch((err) =>
                console.warn(APP_NAME_WITH_SUFFIX, "mountAiWritingDot (iframe) failed", err),
            );
    };
    const onFocusIn = (e: FocusEvent) => tryMount(e.target as Element | null);
    document.addEventListener("focusin", onFocusIn, true);
    // Seed: the field may already be focused (e.g. an autofocused iframe editor).
    tryMount(document.activeElement);
    // Disposer: drop the pending focus listener and unmount if already up.
    return () => {
        disposed = true;
        document.removeEventListener("focusin", onFocusIn, true);
        unmount?.();
        unmount = null;
    };
}
//#endregion