import { splitSentence, wrapTextNode2Span } from "@/main/dom/sentence";
import { TAB_ACTION, TRANSLATE_STATUS_KEY, CONFIG_KEY, DB_ACTION, TRANSLATE_SERVICE, DOMAIN_STRATEGY, TRANSLATE_ACTION, ACTION, STORAGE_ACTION, VIEW_STRATEGY, DEFAULT_STRATEGY, ELEMENT_STATUS, APP_NAME, APP_NAME_WITH_SUFFIX, DEFAULT_VALUE, STATUS_SUCCESS, CONFIG_VALUE_TO_KEY, LANGUAGES_MAP, IS_FIREFOX, browserTargetLanguage } from "./constants";
import { restore, translateParams, getTranslateResult, translate, TranslateResult } from "./translateClient";
import { notifyBackground, runtimeSendMessage, sendMessageToBackground } from "../utils/message";
import { browser } from "wxt/browser"
import { mountFloatBall, type FloatBallController } from "./floatBall";
import { mountAiWritingDot } from "./aiWriting/floatingDot";
import { isAiWritingTarget } from "./aiWriting/inputDetector";
import { openWorkbench, ensureWorkbenchMounted, destroyWorkbench } from "./aiWriting/workbench";
import { openSelectionTranslate } from "./aiWriting/selectionPopup";
import { getConfig, listRuleFromDB } from "@/utils/db";
import { createRuleMode, type RuleModeController } from "./ruleMode";
import { ERROR_SCOPE, reportRequestError, showRelayedError, type ErrorScope as ERROR_SCOPE_VALUE } from "./errorReport";
import { confirmRuleModeHint } from "./ruleHintDialog";
import { detectLanguage, getElementTextContent } from "@/main/lang";
import { parseTranslateServiceKey, startTranslate, TranslateServiceChoice } from "./aiWriting/translateRunner";
import { applyTextToTarget } from "./aiWriting/applyText";
import { getElementText } from "@/utils/dom";
import { readConfig } from "@/utils/reactiveConfig";
import { getDomainWithPortFromUrl } from "@/utils/url";
import { getAiTranslateService, getTranslateService } from "@/utils/service";
import { buildTranslationCss } from "@/main/css";
import {
    compileCandidates,
    fetchSiteRuleCandidates,
    hasConditionalRules,
    unmatchedConditions,
} from "@/main/siteRules/siteRuleClient";
import { compileSelectorList } from "@/main/siteRules/selectors";
import { EMPTY_CANDIDATES, EMPTY_COMPILED, type CompiledSiteRules, type SiteRuleCandidates } from "@/main/siteRules/types";
import { isEditable, isNotMarkElement, isNotTranslateElement } from "@/main/dom/predicates";
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
import { isSegmentBoundary, segmentParagraph, type TranslationUnit, type UnitRange } from "@/main/dom/segments";
import { directChildOf, nodesInRange, rangeContains, resolveCandidateAtPoint, unitRangeOf } from "@/main/dom/unitHit";
import {
    buildSentenceRanges,
    clearSentenceHighlight,
    isPointOverRange,
    showSentenceHighlight,
    supportsHighlightApi,
} from "@/main/dom/sentenceHighlight";
import { initVideoSubtitle, type VideoSubtitleController } from "@/main/videoSubtitle";

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

    // A THIRD sheet, separate from the two above, carrying the `injectCss` of
    // the matched website rules. Separate because `replaceSync` replaces a
    // sheet's whole rule set — sharing one sheet would make every style-config
    // change wipe the rule CSS and vice versa. Same Firefox branch as above.
    let siteRuleStyleSheet: CSSStyleSheet | null = null
    let siteRuleStyleElement: HTMLStyleElement | null = null

    let batchElements: HTMLElement[] = [];
    let batchTimer: NodeJS.Timeout | null = null
    const pendingTranslateParagraphElementsTask: Set<Promise<void>> = new Set()
    let translateTask: Promise<void> | null = null
    let restoreOriginalTask: Promise<void> | null = null
    let controller: AbortController | null = null
    const MARK_BUDGET_MS = 20;
    const MARK_MAX_DEPTH = 50;
    // get the id of the current tab,which used unique defines the page
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
    // DOUBLE: one record per translated unit, grouped by container.
    //
    // The key stays the *container* even though the granularity is per unit: a
    // unit is derived data with no object identity to key on, and its only
    // stable identity is (container, exclusive anchors) — which is exactly this
    // shape. Container keys are also load-bearing elsewhere:
    // cleanupRemovedSubtree sweeps by `removed.contains(key)`, ignoreMutation
    // walks real nodes, IntersectionObserver takes elements, and the highlight
    // binding is one-per-container by design.
    interface DuoUnitRecord {
        /** Exclusive anchors captured before our nodes were inserted. */
        range: UnitRange
        /** The inserted `.duo-translation` and its `.duo-divide` separator. */
        translation: HTMLElement
        divide: HTMLElement
        /**
         * Bilingual highlighting, Highlight-API path: index-aligned sentence
         * ranges of the two sides. Live Ranges — no page DOM was modified to get
         * them. Null when the unit failed the gates, or on the fallback path.
         */
        sentences: { original: Range[], translation: Range[] } | null
        /**
         * Bilingual highlighting, <duo-span> fallback path: the original text
         * captured before wrapping emptied those nodes, replayed on restore.
         * Empty on the Highlight-API path, which never touches the text.
         */
        texts: { text: Text, content: string }[]
    }
    let duoTranslatedElementMap = new Map<HTMLElement, DuoUnitRecord[]>()

    /**
     * One logical-paragraph unit resolved from a pointer position, tagged with
     * how (or whether) it is currently translated. `range` is the unit's stable
     * identity, so a stored target can be re-validated after page mutations.
     */
    type UnitTarget =
        | { container: HTMLElement, kind: "unit", range: UnitRange, unit: TranslationUnit }
        | { container: HTMLElement, kind: "duo", range: UnitRange, record: DuoUnitRecord }
        | { container: HTMLElement, kind: "single", range: UnitRange, result: TranslateResult }
    // per-paragraph disposers for the delegated bilingual-highlight listeners;
    // WeakMap so paragraphs removed by the page don't pin the closures
    const highlightDisposers = new WeakMap<HTMLElement, () => void>()
    // Which bilingual-highlight strategy this frame uses: the CSS Custom
    // Highlight API where available, the <duo-span> wrapper otherwise. Resolved
    // once so a record's write path and its restore path can never disagree.
    const highlightApiSupported = supportsHighlightApi()
    // translated elements of SINGLE view strategy
    // SINGLE: one TranslateResult per translated unit, grouped by container.
    let translatedElementMap = new Map<HTMLElement, TranslateResult[]>()
    // Website rules, matched against THIS frame's own URL — a rule's selectors
    // are written against one document, and this frame's URL is what identifies
    // that document. (Per-domain strategy below deliberately uses the TOP
    // domain instead: different question, different answer.)
    //
    // Started here but NOT awaited on the startup path. Everything awaited
    // before the document event listeners are registered delays them, and the
    // double-tap gesture is then lost for pages the user acts on immediately;
    // the rules are not needed until the first marking scan, so the await sits
    // in initTranslate. Kicking the request off now means it has resolved long
    // before then.
    const siteRuleCandidatesPromise = fetchSiteRuleCandidates(currentUrl)
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
                getSessionStorage(tabTranslateStatusKey),
            ]
        )
    translateStatus = !!translateStatusConfig
    rules = rules || []
    shareConfig.rules = rules
    // Pre-join once instead of `rules.join(",")` per visited element, and drop
    // selectors the engine rejects — one malformed selector used to make
    // `el.matches()` throw for the whole list, silently disabling every rule.
    let legacyRuleSelector = compileSelectorList(rules, "no-translate")
    let legacyRuleVersion = shareConfig.rulesVersion
    // Website rules arrive as candidates (URL-matched only); their
    // `matchSelectors` conditions are evaluated against the live document, here
    // and again once per scan cycle. Populated by awaitSiteRules() from
    // initTranslate — see siteRuleCandidatesPromise above for why not here.
    let siteRuleCandidates: SiteRuleCandidates = EMPTY_CANDIDATES
    let siteRulesConditional = false
    let siteRules: CompiledSiteRules = EMPTY_COMPILED
    let translateService = (await getTranslateService(translateServiceConfig)).activeService
    let aiTranslateService = (await getAiTranslateService(aiTranslateServiceKey)).activeService
    let parsedAiTranslateService = parseTranslateServiceKey(aiTranslateService)
    shareConfig.aiTargetLanguage = aiTargetLanguageConfig
    shareConfig.aiTranslateServiceChoice = parsedAiTranslateService
    let targetLanguage = targetLanguageConfig || browserTargetLanguage()
    let domainStrategy = (rawDomainStrategy?.strategy || DOMAIN_STRATEGY.AUTO) as string
    let lastX = 0, lastY = 0
    // The unit the context menu was opened over (see resolveUnitTargetAtPoint).
    let lastContextMenuTarget: UnitTarget | null = null
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
            case ACTION.REPORT_ERROR:
                // A sub-frame's request failed and background forwarded it here
                // (frameId 0). The console line was already written in the frame
                // that failed; this side only draws the bubble.
                if (!isTopFrame) break
                showRelayedError(message.data)
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
                // `break` was missing here: translating an input box also fell
                // through into the paragraph translate/restore case below and
                // ran a second, unrelated action on whatever was under the
                // pointer.
                translateInputBox();
                break
            case TRANSLATE_ACTION.TRANSLATE_PARA:
            case TRANSLATE_ACTION.SHOW_ORIGINAL_PARA:
                // Both menu items act on the unit that was under the pointer
                // when the menu opened; which one the menu showed was decided by
                // that unit's state (see notifyParaContextMenuUpdate). The page
                // may have mutated since, so re-validate and fall back to the
                // whole container if the unit is gone.
                if (!lastContextMenuTarget) return
                const menuTarget = revalidateUnitTarget(lastContextMenuTarget)
                if (menuTarget) {
                    applyUnitTarget(menuTarget)
                } else if (lastContextMenuTarget.container.isConnected) {
                    toggleTranslateContainer(lastContextMenuTarget.container)
                }
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
            notifyParaContextMenuUpdate(e.clientX, e.clientY)
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
            notifyParaContextMenuUpdate(lastX, lastY)
        }
    })
    //#endregion

    //#region functions
    function notifyParaContextMenuUpdate(lastX: number, lastY: number) {
        const target = resolveUnitTargetAtPoint(lastX, lastY)
        if (target) {
            runtimeSendMessage({
                action: ACTION.SHOW_TRANSLATE_RESTORE_PARA_MENU,
                // "unit" is the only untranslated kind, so the menu title
                // follows the state of the unit under the pointer, not of the
                // whole container.
                data: { translated: target.kind !== "unit" },
            }).then((msg: any) => {
                if (msg?.status === STATUS_SUCCESS) {
                    lastContextMenuTarget = target
                }
            }).catch(() => { });

        } else {
            runtimeSendMessage({ action: ACTION.HIDE_TRANSLATE_RESTORE_PARA_MENU }).then((msg: any) => {
                if (msg?.status === STATUS_SUCCESS) {
                    lastContextMenuTarget = null
                }
            }).catch(() => { });
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
                // No-op here: the cache and its switch are both read in
                // background now (see translateTextsWithCache), which re-reads
                // the toggle per batch — nothing on this side to invalidate.
                break
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

    /**
     * Which logical-paragraph unit is the pointer over, and is it translated?
     *
     * Pointer gestures act on one unit, not on the whole container: a single
     * `<div>` can hold several visual paragraphs (`text<br><br>text`) or a run
     * plus a list, and "translate this paragraph" should mean the one under the
     * cursor. Single-unit containers — the vast majority — resolve to their one
     * unit, so their behavior is unchanged.
     *
     * Already-translated candidates come first so a pointer over translated text
     * toggles it off rather than re-translating it (in SINGLE the same unit
     * appears in both lists — `unit.translated` is DOUBLE-only, derived from the
     * adjacent .duo-translation).
     *
     * Returns null when the pointer is over no unit's text (container padding,
     * the blank space past a short line): callers then fall back to whole-
     * container behavior so the gesture never silently does nothing.
     */
    function resolveUnitTargetAtPoint(x: number, y: number): UnitTarget | null {
        const hit = document.elementFromPoint(x, y) as Element | null
        const container = closestParagraph(hit)
        if (!(container instanceof HTMLElement)) return null

        const candidates: UnitTarget[] = []
        for (const record of duoTranslatedElementMap.get(container) ?? []) {
            candidates.push({ container, kind: "duo", range: record.range, record })
        }
        for (const result of translatedElementMap.get(container) ?? []) {
            candidates.push({
                container,
                kind: "single",
                range: result.unitRange ?? { start: null, end: null },
                result,
            })
        }
        for (const unit of segmentParagraph(container).units) {
            if (unit.translated) continue
            candidates.push({ container, kind: "unit", range: unitRangeOf(unit), unit })
        }
        if (candidates.length === 0) return null

        const index = resolveCandidateAtPoint(
            container,
            candidates.map(c => nodesInRange(container, c.range)),
            hit,
            x,
            y,
        )
        return index < 0 ? null : candidates[index]
    }

    /**
     * Is a stored target still actionable? The context menu keeps one across the
     * gap between right-click and menu click, during which the page may mutate.
     * A stale target degrades to whole-container behavior rather than doing
     * nothing.
     */
    function revalidateUnitTarget(target: UnitTarget): UnitTarget | null {
        if (!target.container.isConnected) return null
        switch (target.kind) {
            case "duo":
                return duoTranslatedElementMap.get(target.container)?.includes(target.record)
                    ? target : null
            case "single":
                return translatedElementMap.get(target.container)?.includes(target.result)
                    ? target : null
            case "unit": {
                // Units are re-derived, so match by the stable identity: the
                // exclusive anchors.
                for (const unit of segmentParagraph(target.container).units) {
                    if (unit.translated) continue
                    const range = unitRangeOf(unit)
                    if (range.start === target.range.start && range.end === target.range.end) {
                        return { ...target, range, unit }
                    }
                }
                return null
            }
        }
    }

    /** Translate or restore the resolved unit. */
    function applyUnitTarget(target: UnitTarget) {
        switch (target.kind) {
            case "unit":
                // Pointer-driven single-paragraph translate — reported under its
                // own label so the bubble matches what the user just did.
                translateUnits([target.unit], undefined, ERROR_SCOPE.PARAGRAPH_TRANSLATE)
                break
            case "duo":
                restoreDuoRecords(target.container, [target.record])
                break
            case "single":
                restoreSingleResults(target.container, [target.result])
                break
        }
    }

    /** Whole-container fallback — the behavior before per-unit targeting. */
    function toggleTranslateContainer(container: HTMLElement) {
        const translated = duoTranslatedElementMap.has(container) || translatedElementMap.has(container)
        if (translated) {
            restoreOriginalParagraphElement(container)
        } else {
            translateParagraphElements([container])
        }
    }

    function toggleTranslateParagraph() {
        const target = resolveUnitTargetAtPoint(lastX, lastY)
        if (target) {
            applyUnitTarget(target)
            return
        }
        const ele = document.elementFromPoint(lastX, lastY) as Element | null
        const container = closestParagraph(ele)
        if (container instanceof HTMLElement) toggleTranslateContainer(container)
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
        try {
            for await (const chunk of runStream.stream) {
                translatedText += chunk;
            }
        } catch (e) {
            // This path has NO UI of its own — it is a double-tap gesture that
            // silently rewrites the focused input in place. So a failure here
            // was completely invisible: the text simply never changed. The
            // bubble is the only channel it has.
            reportRequestError(ERROR_SCOPE.SELECTION_TRANSLATE, e, {
                detail: { via: "double-tap translate input", targetLang: shareConfig.aiTargetLanguage },
            })
            return
        }
        // Never overwrite the user's text with a partial or empty result: a
        // stream that ends early would otherwise wipe the input.
        if (translatedText === "") return
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
            // Cheapest possible SPA-navigation detector: one string compare on
            // a callback the DOM already woke us for. A soft navigation changes
            // which website rules match (`/item*` and friends), and without
            // this the whole URL dimension would be dead on SPAs. No history
            // patching, no extra permission, no timer.
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                await refreshSiteRules(currentUrl);
            } else if (siteRulesConditional && refreshCompiledSiteRules()) {
                // A page-identity marker changed without the URL changing
                // (hydration, a client-side view swap). Re-probing costs one
                // querySelector per conditional rule, once per scan cycle.
                syncSiteRuleCss();
            }
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
            // The listeners go with the detached node, but the highlight paint is
            // document-global — drop it if this paragraph is the one holding it.
            clearSentenceHighlight(removed);
            highlightDisposers.delete(removed);
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
                clearSentenceHighlight(tracked);
                highlightDisposers.delete(tracked);
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
        // The first marking scan is the earliest consumer of the website rules,
        // so this is where the request started at entry is collected.
        await awaitSiteRules()
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
        warnOnRuleMiss()
        if (shouldTranslate || translateStatus) {
            await updateTranslateStatus(true, !translateStatus)
            // updateTranslateStatus returns early when the status is already
            // true (a tab restored mid-session), so the CSS needs applying here
            // as well. Idempotent.
            syncSiteRuleCss(true)
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

    /**
     * Report website rules whose selectors found nothing. Both directions fail
     * silently in the DOM, and one of them fails in the dangerous direction:
     *
     * - `includeSelectors` missing → the page is not translated at all. Loud in
     *   effect but indistinguishable from "the extension is broken".
     * - `matchSelectors` missing → the whole rule is skipped, so the page IS
     *   translated, just without the exclusions the rule meant to apply. Nothing
     *   looks wrong at all — this line is the only signal.
     *
     * Deferred to `load`: a marker that the SPA has not rendered yet is normal,
     * and the per-scan re-probe picks it up when it appears. Only a still-empty
     * match after load is worth reporting.
     */
    function warnOnRuleMiss() {
        const includeSelector = siteRules.includeSelector
        const conditional = siteRulesConditional
        if (!includeSelector && !conditional) return
        const check = () => {
            if (includeSelector && !document.querySelector(includeSelector)) {
                console.log(
                    APP_NAME_WITH_SUFFIX,
                    `website rule includeSelectors matched no element — nothing on this page will be translated.`,
                    { selector: includeSelector, rules: siteRules.matchedIds },
                )
            }
            for (const rule of unmatchedConditions(siteRuleCandidates)) {
                console.log(
                    APP_NAME_WITH_SUFFIX,
                    `website rule "${rule.key}" is inactive: none of its matchSelectors matched this page.`,
                    { matchSelectors: rule.matchSelectors },
                )
            }
        }
        if (document.readyState === 'complete') check()
        else window.addEventListener('load', check, { once: true })
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

    /** Join two already-validated selector strings, either of which may be empty. */
    function joinSelectors(a: string, b: string): string {
        if (a === "") return b
        if (b === "") return a
        return `${a},${b}`
    }

    /**
     * `el.matches(selector)` with an empty selector meaning "no". Selectors
     * reaching here were validated by compileSelectorList, but a page can still
     * put an element in a state the engine rejects, so it stays defensive —
     * without the old failure mode where the throw disabled every rule at once
     * (the malformed entry is now dropped at compile time, not caught here).
     */
    function matchesSelector(el: HTMLElement, selector: string): boolean {
        if (selector === "") return false
        try {
            return el.matches(selector)
        } catch (e) {
            console.log(APP_NAME_WITH_SUFFIX, "selector match failed", selector, e)
            return false
        }
    }

    /**
     * Apply or drop the matched rules' `injectCss` according to whether this
     * frame currently shows any translation at all.
     *
     * The condition is deliberately NOT "the page translate switch is on": a
     * per-paragraph translate (double-tap modifier, context menu) writes a
     * translation without ever flipping that switch, and the whole reason
     * these declarations exist is to make room for a translation — lifting a
     * `-webkit-line-clamp`, undoing an `overflow:hidden`. So the CSS follows
     * the translations, and the page switch is merely one way to get some.
     *
     * The opposite extreme — injecting at page load — was rejected: this is
     * arbitrary CSS restyling the host page, it can come from a third-party
     * subscription, and it would then apply to pages the user never asked to
     * translate (including ones the domain strategy says NEVER to translate).
     */
    function syncSiteRuleCss(pageTranslated: boolean = translateStatus) {
        if (pageTranslated || duoTranslatedElementMap.size > 0 || translatedElementMap.size > 0) {
            applySiteRuleCss()
        } else {
            removeSiteRuleCss()
        }
    }

    function applySiteRuleCss() {
        const css = siteRules.injectCss
        if (!css) {
            removeSiteRuleCss()
            return
        }
        if (!siteRuleStyleSheet && !siteRuleStyleElement) {
            if (import.meta.env.FIREFOX) {
                siteRuleStyleElement = document.createElement('style')
                siteRuleStyleElement.id = 'duo-site-rule-style'
                document.head.appendChild(siteRuleStyleElement)
            } else {
                siteRuleStyleSheet = new CSSStyleSheet()
                document.adoptedStyleSheets = [...document.adoptedStyleSheets, siteRuleStyleSheet]
            }
        }
        if (siteRuleStyleSheet) {
            siteRuleStyleSheet.replaceSync(css)
        } else if (siteRuleStyleElement) {
            siteRuleStyleElement.textContent = css
        }
    }

    function removeSiteRuleCss() {
        if (siteRuleStyleSheet) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
                (s) => s !== siteRuleStyleSheet,
            )
            siteRuleStyleSheet = null
        }
        if (siteRuleStyleElement) {
            siteRuleStyleElement.remove()
            siteRuleStyleElement = null
        }
    }

    /**
     * Re-evaluate the candidates' `matchSelectors` conditions against the DOM as
     * it is right now, and recompile. Returns true when the effective rule set
     * changed.
     *
     * A condition is a LIVE predicate, not a one-shot gate — that distinction is
     * the whole point. Evaluated once at content start it would silently mis-fire
     * on anything whose page-identity marker is not in the initial HTML, and the
     * failure direction is the bad one: the rule quietly does not apply, so the
     * page gets translated *without* its intended exclusions, and nothing looks
     * wrong. (Contrast `includeSelectors` missing, which is loud — nothing gets
     * translated at all.)
     *
     * Cost is one `querySelector` per conditional candidate per scan cycle —
     * typically zero, at worst a handful.
     */
    /**
     * Take delivery of the candidate set started at content-script entry and
     * compile it. Idempotent — awaiting a settled promise costs a microtask.
     */
    async function awaitSiteRules() {
        siteRuleCandidates = await siteRuleCandidatesPromise
        siteRulesConditional = hasConditionalRules(siteRuleCandidates)
        refreshCompiledSiteRules()
    }

    function refreshCompiledSiteRules(): boolean {
        const next = compileCandidates(siteRuleCandidates)
        const changed = next.includeSelector !== siteRules.includeSelector
            || next.excludeSelector !== siteRules.excludeSelector
            || next.injectCss !== siteRules.injectCss
        siteRules = next
        return changed
    }

    /**
     * Re-resolve the rules after an SPA route change.
     *
     * Only the URL matters here — rules edited in Options deliberately take
     * effect on the next page load, so there is no broadcast to handle. Already
     * marked content is left alone: a route change replaces the DOM, and the
     * MutationObserver marks the replacement with the new rules.
     */
    async function refreshSiteRules(url: string) {
        siteRuleCandidates = await fetchSiteRuleCandidates(url)
        siteRulesConditional = hasConditionalRules(siteRuleCandidates)
        refreshCompiledSiteRules()
        syncSiteRuleCss()
    }

    async function removeCSS() {
        document.getElementById('rule-mode-style')?.remove()
        removeSiteRuleCss()
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
        // This is the one place every page-level entry point funnels through
        // (popup, shortcut, float ball, context menu, auto-translate, sub-frame
        // relays). Placed above the isTopFrame gate on purpose: a sub-frame's
        // own document needs its rule CSS too. `status` is passed explicitly
        // because `translateStatus` is only assigned further down — and turning
        // the page off does NOT drop the CSS while per-paragraph translations
        // are still standing; the restore paths sync it once they are gone.
        syncSiteRuleCss(status)
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
        // notify the popup and background to set translate status. Fire-and-
        // forget: an orphaned content script (extension reloaded under a live
        // page) has no background to reach, and there is nothing to retry.
        notifyBackground({
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

    /**
     * Remove the highlight `duo-span`s inside `nodes` that belong to
     * `container` (fallback path only). A mixed container's nested marked
     * paragraphs (an `<li>`) own their spans and restore them through their own
     * bookkeeping, so they must be left alone — hence the closestParagraph
     * ownership filter.
     */
    function removeDuoSpansIn(container: HTMLElement, nodes: ChildNode[]) {
        for (const node of nodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue
            const el = node as HTMLElement
            if (el.tagName === "DUO-SPAN") {
                el.remove()
                continue
            }
            for (const span of el.querySelectorAll("duo-span")) {
                if (closestParagraph(span) === container) span.remove()
            }
        }
    }

    /**
     * DOUBLE: undo `records` of `element`. Passing every record of the container
     * is a whole-container restore; passing a single one is the per-unit toggle,
     * which leaves the container's other translated units untouched.
     *
     * Both highlight strategies are undone here, keyed off the record itself:
     * `texts` is non-empty only for the <duo-span> fallback, which is the only
     * one that modified the page's own text.
     */
    function restoreDuoRecords(element: HTMLElement, records: DuoUnitRecord[]) {
        const all = duoTranslatedElementMap.get(element) ?? []
        const remaining = all.filter(r => !records.includes(r))
        ignoreMutationElements.add(element)
        // The painted sentence may belong to a record we are dropping, and its
        // translation-side range is about to collapse; drop the paint either way
        // — it is transient hover state and the next move re-resolves it.
        clearSentenceHighlight(element)
        if (remaining.length === 0) {
            // Nothing translated left in this container: drop the delegated
            // highlight binding with it.
            highlightDisposers.get(element)?.()
            highlightDisposers.delete(element)
        }
        try {
            for (const record of records) {
                record.divide.remove()
                record.translation.remove()
                // Our inserted nodes are known exactly; the unit's range scopes
                // the span sweep so sibling units keep theirs.
                if (record.texts.length > 0) {
                    removeDuoSpansIn(element, nodesInRange(element, record.range))
                }
            }
            if (remaining.length === 0) {
                // Full restore: also sweep anything left over that no record
                // accounts for (a translation inserted by a round whose
                // bookkeeping was dropped by a re-scan).
                for (const node of element.querySelectorAll(".duo-translation, .duo-divide")) {
                    if (closestParagraph(node) === element) node.remove()
                }
                if (!highlightApiSupported) {
                    removeDuoSpansIn(element, Array.from(element.childNodes))
                }
            }
        } catch (e) {
            console.error(APP_NAME_WITH_SUFFIX, "restore original paragraph error:", e)
        }
        for (const record of records) {
            record.texts.forEach(t => {
                ignoreMutationElements.add(t.text)
                t.text.textContent = t.content
            })
        }
        // Delete the ignore marks after the observer task of the next event loop.
        Promise.resolve().then(() => {
            ignoreMutationElements.delete(element)
            for (const record of records) {
                record.texts.forEach(t => {
                    ignoreMutationElements.delete(t.text)
                })
            }
            if (remaining.length > 0) {
                duoTranslatedElementMap.set(element, remaining)
            } else {
                duoTranslatedElementMap.delete(element)
            }
            // Inside the microtask: the map delete above is what makes the last
            // translation "gone", so this has to run after it.
            syncSiteRuleCss()
        })
    }

    /**
     * SINGLE: replay the original text of `results` (one per unit). Same
     * split as restoreDuoRecords — all of them, or just the hovered unit's.
     */
    async function restoreSingleResults(element: HTMLElement, results: TranslateResult[]) {
        const all = translatedElementMap.get(element) ?? []
        const remaining = all.filter(r => !results.includes(r))
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
            if (remaining.length > 0) {
                translatedElementMap.set(element, remaining)
            } else {
                translatedElementMap.delete(element)
            }
            syncSiteRuleCss()
        })
    }

    async function restoreOriginalParagraphElement(element: HTMLElement) {
        const records = duoTranslatedElementMap.get(element)
        if (records) {
            restoreDuoRecords(element, [...records])
            return
        }
        const results = translatedElementMap.get(element)
        if (results) {
            await restoreSingleResults(element, [...results])
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
            // Every container, every record — same code path as the per-unit
            // toggle, so the two can't drift. Each call defers its ignore-mark
            // cleanup and its map delete to a microtask that runs after the
            // observer's, exactly as the single batched version used to.
            for (const [element, records] of Array.from(duoTranslatedElementMap)) {
                if (!element) {
                    continue
                }
                restoreDuoRecords(element, [...records])
            }
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
                syncSiteRuleCss()
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
        // Website rules, resolved for this frame's URL. `excludeSelector` is
        // merged with the legacy per-host list (both mean "never translate in
        // here"); `includeSelector` is the positive gate — when non-empty, only
        // content inside a matching subtree is marked as needing translation.
        // Rule mode edits the per-host list in place while the page is open;
        // recompile only when it says something changed (once per scan at
        // most, never per element).
        if (legacyRuleVersion !== shareConfig.rulesVersion) {
            legacyRuleVersion = shareConfig.rulesVersion;
            legacyRuleSelector = compileSelectorList(shareConfig.rules, "no-translate");
        }
        const excludeSelector = joinSelectors(legacyRuleSelector, siteRules.excludeSelector);
        const includeSelector = siteRules.includeSelector;
        // With no include restriction the flag is true everywhere and every
        // `matches()` below is skipped outright.
        let inInclude = includeSelector === "";

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
            // Accumulate the include flag here too: a mutation-driven re-scan
            // starts deep inside the include region, and without this walk it
            // would look like it is outside one.
            if (!inInclude && matchesSelector(p, includeSelector)) inInclude = true;
            if (isParagraph(p)) {
                if (isMixedParagraph(p)) {
                    // Mixed container: a mutation under one of its block-ish
                    // children belongs to a deeper unit — keep walking inward
                    // (a nested mark or the Phase B scan handles it). Anything
                    // else sits inside one of the container's own inline runs.
                    const child = (i > 0 ? parentElements[i - 1] : rawElement);
                    if (isSegmentBoundary(child)) {
                        continue;
                    }
                }
                if (!notTranslate && inInclude) collectElements.push(p);
                return collectElements;
            }
        }

        // Iterative DFS via a stack. Children are pushed in reverse order so
        // pop-order matches the original left-to-right recursion.
        type Frame = { el: HTMLElement; notTranslate: boolean; inInclude: boolean; depth: number };
        const stack: Frame[] = [{ el: rawElement, notTranslate, inInclude, depth: 0 }];
        let chunkStart = performance.now();

        while (stack.length > 0) {
            if (performance.now() - chunkStart >= MARK_BUDGET_MS) {
                await yieldToBrowser();
                chunkStart = performance.now();
            }
            const frame = stack.pop()!;
            const el = frame.el;
            let nt = frame.notTranslate;
            let inc = frame.inInclude;
            const depth = frame.depth;

            if (depth > MARK_MAX_DEPTH) continue;
            // Page may have removed the node while we were yielding.
            if (!el.isConnected) continue;
            if (isNotMarkElement(el)) continue;
            if (!nt && isNotTranslateElement(el)) nt = true;
            if (!nt && matchesSelector(el, excludeSelector)) {
                // Cache the positive rule match so re-scans of this
                // subtree short-circuit via isNotTranslateElement.
                markNoTranslate(el);
                nt = true
            }
            // The positive gate. NOT a `continue` when still outside: the
            // include root may be further down, so the walk keeps descending
            // and only withholds the needs-translate flag on the way.
            if (!inc && matchesSelector(el, includeSelector)) inc = true;

            if (isEditable(el)) continue;

            // One segmentation decides everything about this element. There is
            // no separate "is this a paragraph?" gate any more: an element is a
            // unit container iff segmentParagraph finds a qualifying run in it,
            // and `descendChildren` is exactly what the scan should visit next
            // (block-ish children, unwrapped lone inline wrappers, and the
            // elements of runs holding no translatable text).
            //
            // Re-segmenting on every visit — including already-marked elements —
            // is deliberate: structural mutations change an element's runs and
            // block children, so the mixed flag, the collect decision and the
            // descent list all have to be recomputed from the live DOM.
            const seg = segmentParagraph(el);
            // An existing mark is kept alive even when the element momentarily
            // has no qualifying run (its text may be mid-mutation): dropping it
            // would strand the bookkeeping keyed by this container, and
            // refreshing `mixed` is what lets cleanupParagraphMarks sweep the
            // marks nested underneath it.
            if (seg.units.length > 0 || isParagraph(el)) {
                markParagraph(el, !nt && inc, seg.descendChildren.length > 0);
                if (!nt && inc && seg.units.some(u => !u.translated)) collectElements.push(el);
            }
            // Push in reverse so pop order = forward visit. Skip children the
            // page detached while we were yielding.
            for (let j = seg.descendChildren.length - 1; j >= 0; j--) {
                const child = seg.descendChildren[j];
                if (child.parentElement === el) {
                    stack.push({ el: child, notTranslate: nt, inInclude: inc, depth: depth + 1 });
                }
            }
        }
        return collectElements;
    }

    // Delegated bilingual highlighting: one listener pair per paragraph, in one
    // of two strategies chosen once per frame by the browser's capabilities.
    // Both are "sticky" — hovering blank areas inside the paragraph (line gaps
    // of a multi-line sentence, the divide, padding) keeps the current sentence
    // highlighted; it only switches over another sentence's text, and only
    // clears on leaving the paragraph. Returns a disposer that clears the
    // highlight and detaches the listeners.
    function bindHighlightHandler(container: HTMLElement): () => void {
        return highlightApiSupported
            ? bindRangeHighlightHandler(container)
            : bindSpanHighlightHandler(container)
    }

    // Preferred strategy. There are no per-sentence elements: each sentence is a
    // live Range (see main/dom/sentenceHighlight.ts), found under the pointer by
    // its client rects and painted through the CSS Custom Highlight API.
    // isPointOverRects supplies the sticky judgement — it counts the glyphs and
    // the gaps *between* lines but not the blank past a short line.
    //
    // mousemove replaces mouseover, since crossing a sentence boundary no longer
    // crosses an element boundary; it is throttled to one resolve per animation
    // frame. The reads stay cheap because this path writes nothing to the DOM:
    // layout is clean, so every getClientRects after the first in a frame is a
    // lookup rather than a reflow.
    function bindRangeHighlightHandler(container: HTMLElement): () => void {
        let current: { record: DuoUnitRecord, index: number } | null = null
        let frame = 0
        let pointerX = 0
        let pointerY = 0

        /** Is the pointer over sentence `index` of `record`, on either side? */
        function hits(record: DuoUnitRecord, index: number): boolean {
            const pair = record.sentences
            if (!pair) return false
            const original = pair.original[index]
            const translation = pair.translation[index]
            return (!!original && isPointOverRange(pointerX, pointerY, original))
                || (!!translation && isPointOverRange(pointerX, pointerY, translation))
        }

        function resolve() {
            frame = 0
            const records = duoTranslatedElementMap.get(container) ?? []
            // The record may have been restored away under us.
            if (current && !records.includes(current.record)) current = null
            // Cheapest first: the pointer usually stays inside the sentence it
            // is already on.
            if (current && hits(current.record, current.index)) return
            for (const record of records) {
                const pair = record.sentences
                if (!pair) continue
                // Both sides are indexed by non-blank sentence order and the
                // gate equalized their counts; min() is belt-and-braces.
                const count = Math.min(pair.original.length, pair.translation.length)
                for (let i = 0; i < count; i++) {
                    if (!hits(record, i)) continue
                    current = { record, index: i }
                    showSentenceHighlight(container, pair.original[i], pair.translation[i])
                    return
                }
            }
            // Over no sentence's text → keep whatever is painted (sticky).
        }

        const onMouseMove = (event: MouseEvent) => {
            pointerX = event.clientX
            pointerY = event.clientY
            if (frame) return
            frame = requestAnimationFrame(resolve)
        }

        // mouseleave does not bubble, so this only fires when the pointer
        // actually exits the whole paragraph (original + translation).
        const onMouseLeave = () => {
            current = null
            clearSentenceHighlight(container)
        }

        container.addEventListener("mousemove", onMouseMove)
        container.addEventListener("mouseleave", onMouseLeave)
        return () => {
            if (frame) cancelAnimationFrame(frame)
            frame = 0
            onMouseLeave()
            container.removeEventListener("mousemove", onMouseMove)
            container.removeEventListener("mouseleave", onMouseLeave)
        }
    }

    // Fallback strategy for browsers without the Highlight API: each sentence is
    // a <duo-span duo-sequence="i">, so the pointer is resolved by element
    // identity (mouseover, no geometry) and painted with a class.
    //
    // duo-sequence numbers are unique within one container (units of the same
    // container share a running offset), so a single delegated binding per
    // container pairs both sides. Ownership is resolved via closestParagraph so
    // spans of nested marked paragraphs (an <li> inside a mixed container — they
    // have their own binding and their own numbering) are never touched by this
    // one.
    function bindSpanHighlightHandler(originalElement: HTMLElement): () => void {
        let currentSequence: number | null = null

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
        if (elements.length == 0) {
            return
        }
        console.log('translateParagraphElements: ', elements.length)
        // @debuglog
        // elements.forEach((element) => {
        //     console.log('translateParagraphElements element:', element.textContent)
        // })
        if (context && typeof context.hasDuplicated === 'boolean' && !context.hasDuplicated) {
            // remove duplicate elements
            elements = Array.from(new Set(elements))
        }
        // Expand each container into its untranslated logical-paragraph units;
        // containers with nothing left to do (translation in flight, or every
        // unit already translated) are skipped.
        const units: TranslationUnit[] = []
        for (const element of elements) {
            units.push(...segmentParagraph(element).units.filter(u => !u.translated))
        }
        await translateUnits(units, context)
    }

    /**
     * Translate the given logical-paragraph units. The only entry point that
     * actually talks to the provider and writes translations: the whole-container
     * path above expands to units first, and the pointer-driven per-unit toggle
     * passes a single unit — so both share this body verbatim.
     */
    async function translateUnits(
        allUnits: TranslationUnit[],
        context?: any,
        /** Label a failure is reported under; the pointer gesture overrides it. */
        errorScope: ERROR_SCOPE_VALUE = ERROR_SCOPE.PAGE_TRANSLATE,
    ) {
        let viewStrategyCopy = viewStrategy
        // A container whose guard is already set has a translation in flight —
        // drop its units so we never translate the same text twice.
        const units = allUnits.filter(u => !ignoreMutationElements.has(u.container))
        if (units.length === 0) {
            return
        }
        // Every translation this frame writes passes through here, including the
        // per-paragraph gesture that never touches the page translate switch —
        // so this is where the rules' injectCss earns its keep. Done before the
        // provider call rather than after the insert: the declarations exist to
        // make room, and applying them first means one reflow instead of a
        // visible clip-then-unclip.
        syncSiteRuleCss(true)
        let ignoreElements: Node[] = []
        try {
            // Guard the containers, deduplicated — several units may share one.
            for (const container of new Set(units.map(u => u.container))) {
                ignoreElements.push(container)
                ignoreMutationElements.add(container)
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
                // binding per container, which then resolves the pointer against
                // every record's sentence ranges.
                const resultsByContainer = new Map<HTMLElement, TranslateResult[]>()
                for (const result of translateResults) {
                    const element = result.unit?.container
                    if (!element || !result.translatedCopyElement) continue
                    const list = resultsByContainer.get(element) ?? []
                    list.push(result)
                    resultsByContainer.set(element, list)
                }
                for (const [element, containerResults] of resultsByContainer) {
                    // Records of units translated in earlier rounds are kept —
                    // this round appends, never overwrites.
                    const records: DuoUnitRecord[] = duoTranslatedElementMap.get(element) ?? []
                    let insertedAny = false
                    let highlightedAny = false
                    // Fallback path only: duo-sequence must stay unique within
                    // the container, so continue numbering after the spans of
                    // earlier rounds. (The Highlight-API path pairs by array
                    // index inside each record and needs no shared counter.)
                    let sequenceOffset = 0
                    if (!highlightApiSupported) {
                        for (const span of element.querySelectorAll('duo-span[duo-sequence]')) {
                            if (closestParagraph(span) !== element) continue
                            const seq = parseInt(span.getAttribute('duo-sequence')!)
                            if (!isNaN(seq) && seq >= sequenceOffset) sequenceOffset = seq + 1
                        }
                    }
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

                        // Capture the unit's anchors BEFORE inserting our nodes,
                        // so the record's range brackets the unit (and the
                        // translation we are about to put inside it).
                        const range = unitRangeOf(unit)
                        const originalTextResult = getTextNodesAndTextOfNodes(unit.nodes)
                        if (!highlightApiSupported) {
                            // Only the <duo-span> fallback rewrites these nodes;
                            // the Highlight-API path is read-only, so it needs no
                            // mutation guard on them.
                            originalTextResult.textNodes.forEach(textNode => {
                                ignoreElements.push(textNode)
                                ignoreMutationElements.add(textNode)
                            })
                        }
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
                        const record: DuoUnitRecord = { range, translation: translatedElement, divide, sentences: null, texts: [] }
                        records.push(record)

                        // Bilingual sentence highlighting, gated per unit — a
                        // unit failing the gates only loses its own sentences.
                        if (!bilingualHighlightingSwitch) continue
                        if (originalTextResult.text == "" || originalTextResult.textNodes.length == 0) continue
                        const translatedTextResult = getTextNodesAndText(translatedElement)
                        if (translatedTextResult.text == "" || translatedTextResult.textNodes.length == 0) continue
                        const originalSentences = splitSentence(originalTextResult.text)
                        let validOriginalSentencesLen = originalSentences.filter(s => s.trim() !== '').length;
                        if (originalSentences.length === 0 || validOriginalSentencesLen < bilingualHighlightingMinSentences) continue
                        const translatedSentences = splitSentence(translatedTextResult.text)
                        if (translatedSentences.filter(s => s.trim() !== '').length != validOriginalSentencesLen) continue // todo fallback to using AI for sentence segmentation
                        if (highlightApiSupported) {
                            // Blank segments yield no range, so both arrays are
                            // indexed by non-blank sentence order — the very count
                            // the gate above equalized, which is what makes
                            // pairing by index correct.
                            const originalRanges = buildSentenceRanges(originalTextResult.textNodes, originalSentences)
                            const translationRanges = buildSentenceRanges(translatedTextResult.textNodes, translatedSentences)
                            if (originalRanges.length === 0 || translationRanges.length === 0) continue
                            record.sentences = { original: originalRanges, translation: translationRanges }
                            highlightedAny = true
                        } else {
                            // Fallback: wrapping empties the original text nodes,
                            // so back them up first — this is what restore replays.
                            originalTextResult.textNodes.forEach(textNode => {
                                record.texts.push({ text: textNode, content: textNode.textContent })
                            })
                            const spans = wrapTextNode2Span(originalTextResult.textNodes, originalSentences, ignoreMutationElements, sequenceOffset)
                            spans.push(...wrapTextNode2Span(translatedTextResult.textNodes, translatedSentences, ignoreMutationElements, sequenceOffset))
                            sequenceOffset += originalSentences.length
                            if (spans.length > 0) highlightedAny = true
                        }
                    }
                    if (insertedAny) {
                        duoTranslatedElementMap.set(element, records)
                        translatedContainers.add(element)
                    }
                    if (highlightedAny) {
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
            // The resilience boundary for page translation: one failed batch
            // must not stop the rest of the page. It stays a catch — but the
            // reason is no longer dropped here. Providers now throw (see the
            // failure note in main/translateService.ts) and this is where that
            // throw becomes a page-console line and a bubble.
            //
            // `reportRequestError` filters aborts itself, so a user cancelling
            // mid-translation still raises nothing.
            reportRequestError(errorScope, e, {
                detail: { service: translateService, targetLanguage, units: units.length },
            })
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
    rules: string[],
    /**
     * Bumped by rule mode on every add/remove so the marking scan knows to
     * recompile its joined selector string. Without it, a removed selector kept
     * matching for the rest of the session (rule mode only ever pushed, never
     * spliced) and the user had to reload to see their own deletion take effect.
     */
    rulesVersion: number,
} = {
    aiTranslateServiceChoice: { kind: 'trans', service: DEFAULT_VALUE.AI_TRANSLATE_SERVICE },
    aiTargetLanguage: DEFAULT_VALUE.AI_TARGET_LANGUAGE, rules: [], rulesVersion: 0
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