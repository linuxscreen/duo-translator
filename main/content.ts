import { alignSentenceBlocks, splitSentence, wrapTextNode2Span } from "@/main/dom/sentence";
import { TAB_ACTION, TRANSLATE_STATUS_KEY, CONFIG_KEY, DB_ACTION, TRANSLATE_SERVICE, DOMAIN_STRATEGY, TRANSLATE_ACTION, ACTION, STORAGE_ACTION, VIEW_STRATEGY, DEFAULT_STRATEGY, ELEMENT_STATUS, APP_NAME, APP_NAME_WITH_SUFFIX, DEFAULT_VALUE, STATUS_SUCCESS, CONFIG_VALUE_TO_KEY, LANGUAGES_MAP, IS_FIREFOX, browserTargetLanguage, FLOAT_BALL_STYLE, EXTENSION_INVALID_CONTEXT_MSG, STYLE_BLUR, TRANSLATING_ANIMATION, IS_MAC } from "./constants";
import { restore, translateParams, getTranslateResult, translate, TranslateResult, detectTextsLanguages } from "./translateClient";
import { buildNoTranslateLanguageSet, isNoTranslateLanguage } from "./noTranslateLanguage";
import {
    needsCompanionDetect,
    partitionByLocalLanguage,
    rejectByDetectedLanguage,
} from "./noTranslateLanguageFilter";
import { notifyBackground, runtimeSendMessage, sendMessageToBackground } from "../utils/message";
import { browser } from "wxt/browser"
import { mountFloatBall, type FloatBallController } from "./floatBall";
import { mountAiWritingDot } from "./aiWriting/floatingDot";
import { isAiWritingTarget } from "./aiWriting/inputDetector";
import { openWorkbench, ensureWorkbenchMounted, destroyWorkbench } from "./aiWriting/workbench";
import { isInSelectionPopup, openSelectionTranslate } from "./aiWriting/selectionPopup";
import { mountSelectionIcon } from "./selectionIcon";
import { getConfig, listRuleFromDB } from "@/utils/db";
import { createRuleMode, type RuleModeController } from "./ruleMode";
import { ERROR_SCOPE, reportRequestError, showRelayedError, type ErrorScope as ERROR_SCOPE_VALUE } from "./errorReport";
import { confirmRuleModeHint } from "./ruleHintDialog";
import { detectLanguage, getElementTextContent } from "@/main/lang";
import { parseTranslateServiceKey, startTranslate, TranslateServiceChoice } from "./aiWriting/translateRunner";
import { applyTextToTarget } from "./aiWriting/applyText";
import { getElementText } from "@/utils/dom";
import { readConfig, watchConfig } from "@/utils/reactiveConfig";
import { getDomainWithPortFromUrl } from "@/utils/url";
import { createGestureEngine } from "@/main/customShortcut/gestureEngine";
import {
    CUSTOM_SHORTCUT_ACTION,
    MOUSE_MIDDLE_KEY,
    actionsForGesture,
    findShortcut,
    gestureKeyOf,
    normalizeBindings,
    normalizeCustomShortcuts,
    resolveGestures,
    type CustomShortcut,
    type ShortcutBinding,
} from "@/main/customShortcut/types";
import { removeTypedEcho } from "@/main/dom/typedEcho";
import { extendTypedRun, typedRunForShortcut, type TypedRun } from "@/main/customShortcut/typedRun";
import { getAiTranslateService, getTranslateService } from "@/utils/service";
import { buildTranslationCss } from "@/main/css";
import { TRANSLATE_INDICATOR_CSS } from "@/main/translateIndicator/indicatorCss";
import {
    beginTranslateIndicator,
    clearTranslateIndicators,
    ingestFrameIndicatorState,
    retryFailedTranslations,
    setTranslateIndicatorMode,
    translateIndicatorActive,
    type TranslateIndicatorSession,
} from "@/main/translateIndicator";
import {
    compileCandidates,
    fetchSiteRuleCandidates,
    hasConditionalRules,
    unmatchedConditions,
} from "@/main/siteRules/siteRuleClient";
import { compileSelectorList } from "@/main/siteRules/selectors";
import { EMPTY_CANDIDATES, EMPTY_COMPILED, type CompiledSiteRules, type SiteRuleCandidates } from "@/main/siteRules/types";
import { isEditable, isNotMarkElement, isNotTranslateElement, isOwnNoTranslateElement } from "@/main/dom/predicates";
import { getTextNodesAndText, getTextNodesAndTextOfNodes, isContainsValidTextElement, removeDuoClassAndAttribute, removeTextNodes } from "@/main/dom/textNodes";
import {
    allParagraphs,
    clearParagraphMarks,
    closestNeedsTranslate,
    closestParagraph,
    isMixedParagraph,
    isParagraph,
    markNoTranslate,
    markParagraph,
    needsTranslateParagraphs,
    resetNoTranslateMarks,
    sweepDetachedParagraphMarks,
} from "@/main/dom/paragraphMarks";
import { isSegmentBoundary, segmentParagraph, type TranslationUnit, type UnitContainer, type UnitRange } from "@/main/dom/segments";
import { containersFor, observeContainer, resetObserveTargets, unobserveContainer } from "@/main/dom/observeTargets";
import { composedTarget, deepActiveElement, deepElementFromPoint, deepSelection, isShadowRoot, parentOrHost, type DeepSelection } from "@/main/dom/shadowTraversal";
import { partitionRules, resolveRulePaths } from "@/main/dom/ruleSelector";
import {
    flushShadowRootStyles,
    queueShadowRootStyle,
    removeShadowCss,
    resetShadowCss,
    setShadowCss,
    unstyleShadowRoot,
} from "@/main/dom/shadowCss";
import {
    deepQuerySelector,
    forgetDisconnectedRoots,
    knownRoots,
    noteElement,
    resetShadowRoots,
    startShadowDiscovery,
} from "@/main/dom/shadowRoots";
// Type-only + one const: the progress bar surface itself is loaded lazily (see
// onBuiltinAiDownloadProgress), so this adds no weight to the content bundle.
import { BUILTIN_AI_MODEL_DOWNLOADING, type BuiltinAiDownloadProgress } from "@/main/builtinAi/types";
import { directChildOf, nodesInRange, rangeContains, resolveCandidateAtPoint, siblingSkippingIndicators, unitRangeOf } from "@/main/dom/unitHit";
import { planUnit as planUnitCoverage } from "@/main/dom/unitCoverage";
import {
    buildSentenceRanges,
    clearSentenceHighlight,
    isPointOverRange,
    showSentenceHighlight,
    supportsHighlightApi,
} from "@/main/dom/sentenceHighlight";
import { initVideoSubtitle, type VideoSubtitleController } from "@/main/videoSubtitle";
import { initMinimalPlayerUi, type MinimalPlayerUiController } from "@/main/videoSubtitle/minimalPlayerUi";

export async function content() {
    //#region main
    console.log('content script loaded');

    window.addEventListener("error", (e) => {
        if (e.message.includes(EXTENSION_INVALID_CONTEXT_MSG)) {
            e.preventDefault()
            console.log(APP_NAME_WITH_SUFFIX, "Extension invalid: ", e)
        }
    });

    window.addEventListener(
        "unhandledrejection",
        (e) => {
            if (e?.reason?.message?.includes(EXTENSION_INVALID_CONTEXT_MSG)) {
                e.preventDefault()
                console.log(APP_NAME_WITH_SUFFIX, "Extension invalid (Promise): ", e)
            }
        }
    );

    // The script runs in all frames. The translation pipeline runs in every
    // frame (so iframe content gets translated too), but a few concerns are
    // strictly tab-level and belong to the TOP frame only: the float ball,
    // writing the tab's translate-status to session storage, broadcasting that
    // status to the popup/badge, and orchestrating manual toggles down to
    // sub-frames. `isTopFrame` gates those. Comparing window references is safe
    // even across origins (no property access).
    const isTopFrame = window.top === window.self;

    //#region event listeners
    //
    // These are registered in content()'s FIRST SYNCHRONOUS PASS, before
    // anything is awaited. Everything below this block awaits — the tab id, then
    // ~15 config reads, then init()'s marking scan — and each of those can wake
    // a suspended MV3 service worker, so on a loaded machine the total is
    // routinely hundreds of milliseconds and can reach seconds.
    //
    // A listener registered after those awaits does not exist while the user is
    // already looking at a rendered page. These gestures are one-shot and
    // nothing retries them, so a double-tap right after load was swallowed
    // without a trace. Moving one await out of the way (as the website-rules
    // request did) only shortens the window; it does not close it.
    //
    // So the LISTENER is early and the ACTION is what waits: `startupReady`
    // resolves once the first marking scan has run, which is exactly the state
    // the pointer gestures need. Handlers must not touch anything declared
    // below this block until after awaiting it — those bindings are in their
    // temporal dead zone until the awaits above them have resolved.
    let startupAborted = false
    let markStartupReady: () => void = () => { }
    const startupReady = new Promise<void>((resolve) => { markStartupReady = resolve })

    // Shadow-root discovery is registered in this first synchronous pass so the
    // handlers exist before anything can find a root.
    //
    // `shadowPipelineReady` is a temporal-dead-zone gate, and it stays even
    // though every root now arrives from the marking scan (which cannot run
    // before the pipeline exists). Everything below the first `await` — the
    // observer, the pending-scan queue, the observe-state flags — is in its TDZ
    // until then, and reading any of it from a handler that fires early throws
    // ReferenceError and takes the whole content script down. That happened
    // once, back when a MAIN-world bridge could report roots at document_start.
    // Before the pipeline is up the only safe action is styling (module-level
    // state), and nothing else is needed anyway: `startObserveDom()` observes
    // every root discovered so far, and the initial body scan descends into
    // every root reachable from <body>.
    let shadowPipelineReady = false;
    startShadowDiscovery({
        onRootAdded: (root) => {
            // Queued, not styled: this fires from inside the marking scan, and
            // injecting a stylesheet between two of its `getComputedStyle` calls
            // costs a forced style recalc every time. Flushed when the scan ends
            // and at the top of translateUnits — see main/dom/shadowCss.ts.
            queueShadowRootStyle(root);
            if (!shadowPipelineReady) return;
            // No scan to queue: the only caller is the marking scan itself, and
            // the root it just found is already on its DFS stack.
            observeShadowRoot(root);
        },
        onRootRemoved: (root) => {
            unstyleShadowRoot(root);
            if (shadowPipelineReady) noteRootForgotten();
        },
    });

    // Accept messages from the popup, the shortcut dispatcher and the context
    // menu. Registered here rather than next to its body for the same reason as
    // the gestures below — the popup's translate button can be clicked the
    // instant the page renders, and a listener that does not exist yet drops
    // the message with no error on either side. This mirrors the rule the
    // background already follows for its own onMessage.
    browser.runtime.onMessage.addListener(async (message) => {
        if (!message) return
        await startupReady
        if (startupAborted) return
        return handleRuntimeMessage(message)
    });

    let lastX = 0, lastY = 0
    document.addEventListener('mousemove', e => { lastX = e.clientX; lastY = e.clientY; }, { passive: true });

    // Double-tap shortcut: pressing the configured modifier (Ctrl/Alt) twice in
    // quick succession, with no other key in between, runs a quick action. The
    // toggles are read live on trigger so the latest settings apply.
    const DOUBLE_TAP_INTERVAL_MS = 400;
    let lastModifierTapTime = 0;
    /**
     * Whether a bare Alt press has to be taken from the browser for this
     * feature — see the Alt claim further down for what that means.
     *
     * A live mirror rather than a read, because the decision cannot wait:
     * `preventDefault()` does nothing once the handler has awaited, the event's
     * dispatch being over by then, and the handler below awaits `readConfig`
     * before it looks at anything. Unknown (nothing hydrated yet) claims
     * nothing.
     *
     * Note what it can and cannot ask. The custom-shortcut layer asks whether
     * this very press completes a configured combo; here the FIRST tap of the
     * pair is indistinguishable from a solo tap, so the question can only be
     * "is Alt the configured modifier, with at least one action left on". That
     * makes it an honest trade rather than a free win: choosing double-tap Alt
     * gives up the browser's own solo-Alt behaviour. Letting the first tap
     * through instead is not an option — the menu bar takes focus on it, and
     * the second tap then never reaches the page at all, which is exactly the
     * bug this fixes.
     */
    let doubleTapClaimsAlt = false;
    {
        let modifier: string | undefined;
        let selection = false, input = false, paragraph = false;
        const refresh = () => {
            doubleTapClaimsAlt = modifier === 'alt' && (selection || input || paragraph);
        };
        watchConfig<string>(CONFIG_KEY.DOUBLE_TAP_MODIFIER, (v) => { modifier = v; refresh() });
        watchConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TRANSLATE_SELECTION, (v) => { selection = !!v; refresh() });
        watchConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TRANSLATE_INPUT, (v) => { input = !!v; refresh() });
        watchConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TOGGLE_PARAGRAPH, (v) => { paragraph = !!v; refresh() });
    }
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
            // The tap pair is recognized immediately; only the action waits for
            // the pipeline. Tapping on a page that is still initializing now
            // translates as soon as it can instead of doing nothing.
            await startupReady;
            if (startupAborted) return;
            void handleDoubleTapModifier();
        } else {
            lastModifierTapTime = now;
        }
    }, true);

    // Customization › custom shortcuts. A second, independent gesture layer
    // that COEXISTS with the double-tap above and with the browser commands —
    // it never consumes their input, and it ships off.
    //
    // Recognition is synchronous (timing is the whole point) and only the
    // ACTION waits for `startupReady`, exactly like the double-tap block. The
    // watch list is a live view of config, so saving in Options arms or
    // disarms a gesture on already-open pages with no reload.
    let customShortcutBindings: ShortcutBinding[] = []
    // Kept beside the bindings rather than inside the watch block below: the
    // fired gesture's DEFINITION is needed to know how many characters it can
    // have typed (see takeTypedEcho).
    let customShortcutList: CustomShortcut[] = []
    const customShortcuts = createGestureEngine((shortcutId) => {
        void runCustomShortcutGesture(shortcutId)
    })
    {
        let enabled = false
        const refresh = () => {
            customShortcuts.setGestures(enabled ? resolveGestures(customShortcutList, customShortcutBindings) : [])
        }
        watchConfig<boolean>(CONFIG_KEY.CUSTOM_SHORTCUT_SWITCH, (v) => { enabled = !!v; refresh() })
        watchConfig<unknown[]>(CONFIG_KEY.CUSTOM_SHORTCUT_LIST, (v) => { customShortcutList = normalizeCustomShortcuts(v); refresh() })
        watchConfig<unknown[]>(CONFIG_KEY.CUSTOM_SHORTCUT_BINDINGS, (v) => { customShortcutBindings = normalizeBindings(v); refresh() })
    }
    /**
     * The run of identical characters the focused editable has just received.
     * The rules live in main/customShortcut/typedRun.ts; this only feeds it
     * events and the element they would land in.
     */
    let typedEcho: TypedRun | null = null
    // Set when a middle-button press was claimed by a gesture, so the auxclick
    // that follows can be suppressed too — open-link-in-new-tab is dispatched
    // from auxclick, which a preventDefault on mousedown does NOT cancel.
    let middleClaimed = false
    // The same for Alt, which Windows/Linux browsers read as "focus the menu
    // bar" when it is tapped on its own: without this an Alt gesture fires AND
    // pulls focus out of the page — and where focus lands is the browser's own
    // UI, so every following key goes there too, not just this one.
    //
    // BOTH Alt features are claimants and either is enough: the double-tap
    // above (which is why it was broken on Windows long before custom shortcuts
    // existed) and a custom gesture. Neither claims Alt merely for being
    // installed — the custom layer asks whether this press completes a
    // configured combo, so binding `Alt+Shift` leaves a bare Alt alone, and the
    // double-tap asks whether Alt is its configured modifier at all.
    //
    // Both events have to be cancelled, for different reasons on each engine:
    // Firefox cancels the menu when the KEYDOWN was default-prevented, while
    // Chromium routes to its own handler exactly those key events the renderer
    // left unhandled, so the KEYUP that opens the menu must be taken too.
    //
    // Alt+F and friends are unaffected: a browser accelerator is decided on the
    // ACCELERATOR key's event (the F), which is not this one, and modifier
    // state itself does not come from the default action of a modifier press.
    //
    // `Meta` gets no equivalent on purpose: the Start / Command menu belongs to
    // the OS, which takes that key before the page is offered it at all.
    let altClaimed = false
    document.addEventListener('keydown', (e) => {
        const key = gestureKeyOf(e)
        if (key === 'Alt') {
            // Before `press` below: `wouldActivate` probes what the key set
            // WOULD become, so it has to be asked while Alt is still out of it.
            if (!e.repeat && !altClaimed && (doubleTapClaimsAlt || customShortcuts.wouldActivate(key, e))) altClaimed = true
            // Auto-repeats included: the menu opens on the release, and a press
            // half of which was cancelled is not a state worth handing over.
            if (altClaimed) e.preventDefault()
        }
        // Before the repeat guard: a held printable key really does insert a
        // character per repeat, and those are just as much the shortcut's doing.
        noteTypedEcho(e)
        // Auto-repeat is not a second press. Every key is forwarded, part of a
        // configured combo or not: a key from outside the combo is precisely
        // what has to end it, which is how real shortcuts (Ctrl+C) stay out of
        // the recognizer.
        if (e.repeat) return
        customShortcuts.press(key, e)
    }, true);
    document.addEventListener('keyup', (e) => {
        const key = gestureKeyOf(e)
        if (key === 'Alt' && altClaimed) {
            altClaimed = false
            e.preventDefault()
        }
        customShortcuts.release(key, e)
    }, true);
    document.addEventListener('mousedown', (e) => {
        if (e.button !== 1) return
        // Suppress the browser's own middle-button behaviour — autoscroll on
        // Windows, primary-selection paste on Linux — but ONLY for a press that
        // actually completes a configured combo. Asking about the whole combo
        // rather than the button alone is what lets a `Ctrl+middle` gesture
        // leave a plain middle-click doing what the page expects.
        if (!customShortcuts.wouldActivate(MOUSE_MIDDLE_KEY, e)) return
        e.preventDefault()
        middleClaimed = true
        customShortcuts.press(MOUSE_MIDDLE_KEY, e)
    }, true);
    document.addEventListener('mouseup', (e) => {
        if (e.button !== 1) return
        customShortcuts.release(MOUSE_MIDDLE_KEY, e)
    }, true);
    document.addEventListener('auxclick', (e) => {
        if (e.button !== 1 || !middleClaimed) return
        middleClaimed = false
        e.preventDefault()
    }, true);
    // A press whose release happens outside the page (alt-tab, a native menu)
    // would otherwise stay latched and pair with the next press.
    // Alt-tab is the ordinary way an Alt press ends off-page: the keyup never
    // arrives, so the claim has to be dropped here or the NEXT Alt press starts
    // out already claimed and is suppressed for nothing.
    window.addEventListener('blur', () => { altClaimed = false; typedEcho = null; customShortcuts.reset() });

    // add 'Translate/Restore this paragraph' menu when mouse is over the text of
    // a paragraph element and right mouse clicked
    // Due to chrome limitations, currently context menu of 'Translate/Restore this paragraph' can only be implemented in this way.
    // chrome known issue: The context menu that is not triggered by the right mouse button may be abnormal.
    //
    // Skipped entirely on macOS (IS_MAC, both engines): a right click there
    // selects the word under the pointer, so the selection path already covers
    // that gesture and this menu item only duplicates it. Not registering the
    // listener at all keeps the per-right-click work — and the swap of the
    // page-level menu item for the paragraph one — off that platform.
    if (!IS_FIREFOX && !IS_MAC) {
        document.addEventListener("mousedown", (e) => {
            if (e.button !== 2) return // ignore non right click
            // Read the position synchronously — the pointer may have moved by
            // the time the pipeline is ready.
            const x = e.clientX, y = e.clientY
            void (async () => {
                await startupReady
                if (startupAborted || !contextMenuSwitch) return
                notifyParaContextMenuUpdate(x, y)
            })()
        }, true);
    }


    document.addEventListener("contextmenu", (e) => {
        const target = e.target as HTMLElement | null;
        void (async () => {
            await startupReady
            if (startupAborted || !contextMenuSwitch) return
            if (target && IsEditableElement(target)) {
                // console.log("isContentEditable", target);
                lastEditableElement = target
            }
            if (IS_FIREFOX && !IS_MAC) {
                notifyParaContextMenuUpdate(lastX, lastY)
            }
        })()
    })
    //#endregion

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

    let batchElements: UnitContainer[] = [];
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
        // Bailing out leaves the already-registered gesture listeners in place,
        // so mark the pipeline unusable and release anything waiting on it.
        startupAborted = true
        markStartupReady()
        return
    }
    let tabTranslateStatusKey = TRANSLATE_STATUS_KEY + tabId
    // Get the domain name and port of the current page. Sub-frames key off the
    // TOP document's domain so per-domain rules / strategy / disable stay
    // consistent with what the user configured for the page they actually see.
    let currentUrl = window.location.href;
    const domainWithPort = isTopFrame ? getDomainWithPortFromUrl(currentUrl) : getTopFrameDomain();
    if (domainWithPort === "") {
        startupAborted = true
        markStartupReady()
        return
    }
    const ruleMode: RuleModeController = createRuleMode(domainWithPort)
    let floatBall: FloatBallController | null = null
    // Video bilingual subtitles (YouTube only for now) — top-frame singleton.
    let videoSubtitle: VideoSubtitleController | null = null
    let minimalPlayerUi: MinimalPlayerUiController | null = null
    // AI Writing dot teardown. Top frame: the mount's unmount fn. Sub-frame: the
    // deferred-mount disposer (drops the focus listener + unmounts if up). Reset
    // on each init() so a global-switch off→on cycle re-mounts cleanly.
    let aiWritingDotDispose: (() => void) | null = null
    let aiWritingDotDisposed = false
    // Selection translate icon — mounted per frame (a selection belongs to the
    // document it lives in), same off→on reset semantics as the dot above.
    let selectionIconDispose: (() => void) | null = null
    let selectionIconDisposed = false

    // return
    // set translate status to false when the page is loaded
    let translateStatus = false
    // This frame has paragraphs waiting on an on-device model download. Set when
    // a batch bails out with BUILTIN_AI_MODEL_DOWNLOADING, cleared when the
    // download finishes. Gates both the progress bar and the automatic
    // re-translation, because background broadcasts progress to every frame of
    // every tab and only the waiting ones should react.
    let builtinAiAwaitingModel = false
    // Counts batches that bailed out waiting for the model. The retry loop uses
    // it as a liveness signal: an interval with no new bail means translation is
    // working again, which is how the polling knows to stop.
    let builtinAiBailSeq = 0
    let builtinAiSeqAtLastRetry = -1
    let builtinAiRetryTimer: ReturnType<typeof setTimeout> | null = null
    let builtinAiRetryDelay = 0
    let builtinAiRetryDeadline = 0
    const BUILTIN_AI_RETRY_MIN_MS = 4_000
    const BUILTIN_AI_RETRY_MAX_MS = 30_000
    /** Stop polling eventually — a download that never lands must not poll forever. */
    const BUILTIN_AI_RETRY_GIVE_UP_MS = 15 * 60_000
    let manualTrigger = false // @deprecated
    const ignoreMutationElements = new WeakSet();
    const paragraphElementMap = new Map<UnitContainer, ELEMENT_STATUS>();
    // DOUBLE: one record per translated unit, grouped by container.
    //
    // The key stays the *container* even though the granularity is per unit: a
    // unit is derived data with no object identity to key on, and its only
    // stable identity is (container, exclusive anchors) — which is exactly this
    // shape. Container keys are also load-bearing elsewhere:
    // sweepDetachedBookkeeping sweeps by `key.isConnected`, ignoreMutation
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
        /**
         * The run's source text nodes at the moment it was translated — what
         * makes this record recognizable again on a later scan.
         *
         * Not the same thing as `texts`, which only exists on the fallback path
         * and means "backup to replay on restore". This one is populated on both
         * paths and is never written back.
         */
        covered: Text[]
    }
    let duoTranslatedElementMap = new Map<UnitContainer, DuoUnitRecord[]>()

    /** The bookkeeping a re-translation of a unit supersedes, per view. */
    type UnitReplacement = { duo?: DuoUnitRecord, single?: TranslateResult }

    /**
     * What this unit needs: a first translation, nothing, or a re-translation
     * that replaces what is already there.
     *
     * The two container-keyed maps are the bookkeeping; see
     * main/dom/unitCoverage.ts for why the DOM-side `translated` flag cannot
     * answer this on its own.
     */
    function planUnit(unit: TranslationUnit) {
        return planUnitCoverage<DuoUnitRecord, TranslateResult>(
            unit,
            duoTranslatedElementMap.get(unit.container),
            translatedElementMap.get(unit.container),
        )
    }

    /** Does this unit still have to go to a provider — freshly or again? */
    function needsTranslation(unit: TranslationUnit): boolean {
        return planUnit(unit).action !== "skip"
    }

    /**
     * Plan every unit of `container` in one pass, and hand back units derived
     * from the settled DOM.
     *
     * "Settled" is the whole point of doing this in one place: a unit about to
     * be replaced has its highlight wrappers unwrapped first, and that changes
     * the container's children — so the segmentation has to be redone before
     * anyone holds on to a unit's node list.
     */
    function planContainerUnits(container: UnitContainer) {
        let seg = segmentParagraph(container)
        let plans = seg.units.map(planUnit)
        // Not while a batch is in flight here: translateUnits drops this
        // container's units, so unwrapping now would strip the highlighting off
        // a translation that is not being replaced after all.
        if (!ignoreMutationElements.has(container)
            && plans.some(p => p.action === "replace" && (p.duo?.texts.length ?? 0) > 0)) {
            for (const plan of plans) {
                if (plan.action === "replace" && plan.duo) unwrapHighlightSpans(container, plan.duo)
            }
            seg = segmentParagraph(container)
            plans = seg.units.map(planUnit)
        }
        return seg.units.map((unit, index) => ({ unit, plan: plans[index] }))
    }

    /**
     * One logical-paragraph unit resolved from a pointer position, tagged with
     * how (or whether) it is currently translated. `range` is the unit's stable
     * identity, so a stored target can be re-validated after page mutations.
     */
    type UnitTarget =
        | { container: UnitContainer, kind: "unit", range: UnitRange, unit: TranslationUnit }
        | { container: UnitContainer, kind: "duo", range: UnitRange, record: DuoUnitRecord }
        | { container: UnitContainer, kind: "single", range: UnitRange, result: TranslateResult }
    // per-paragraph disposers for the delegated bilingual-highlight listeners;
    // WeakMap so paragraphs removed by the page don't pin the closures
    const highlightDisposers = new WeakMap<UnitContainer, () => void>()
    // Which bilingual-highlight strategy this frame uses: the CSS Custom
    // Highlight API where available, the <duo-span> wrapper otherwise. Resolved
    // once so a record's write path and its restore path can never disagree.
    const highlightApiSupported = supportsHighlightApi()
    // Is the translation currently rendered blurred (STYLE_BLUR)? Kept in sync
    // by updateStyle. The bilingual-highlight handlers read it: a blurred
    // translation is only legible while the pointer rests on it (the blur is
    // lifted by `.duo-translation:hover`), so a hover over the ORIGINAL must
    // paint nothing at all — half the pair would be unreadable.
    let translationBlurred = false
    // translated elements of SINGLE view strategy
    // SINGLE: one TranslateResult per translated unit, grouped by container.
    let translatedElementMap = new Map<UnitContainer, TranslateResult[]>()
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
        rawDomainStrategy, floatBallSwitch, floatBallStyleConfig, bilingualHighlightingSwitch, bilingualHighlightingMinSentences, translationLineBreakMinChars, aiTranslateServiceKey,
        aiTargetLanguageConfig, contextMenuSwitch, translateStatusConfig, translatingAnimationConfig, noTranslateLanguagesConfig]
        : [string[], VIEW_STRATEGY, string | undefined, string | undefined, boolean, string, any, boolean, string, boolean, number,
            number, string | undefined, string, boolean, boolean, string | undefined, string[] | undefined]
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
                getConfig(CONFIG_KEY.FLOAT_BALL_STYLE),
                getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
                getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES),
                getConfig(CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS),
                getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
                getConfig(CONFIG_KEY.AI_TARGET_LANGUAGE),
                getConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH),
                getSessionStorage(tabTranslateStatusKey),
                getConfig(CONFIG_KEY.TRANSLATING_ANIMATION),
                getConfig(CONFIG_KEY.NO_TRANSLATE_LANGUAGES),
            ]
        )
    translateStatus = !!translateStatusConfig
    // Every frame keeps its own copy: the inline markers are drawn in the frame
    // that owns the paragraph, and in corner mode a sub-frame still has to know
    // it should report instead of staying silent.
    setTranslateIndicatorMode(translatingAnimationConfig ?? DEFAULT_VALUE.TRANSLATING_ANIMATION)
    rules = rules || []
    shareConfig.rules = rules
    // Pre-join once instead of `rules.join(",")` per visited element, and drop
    // selectors the engine rejects — one malformed selector used to make
    // `el.matches()` throw for the whole list, silently disabling every rule.
    //
    // Rules addressing an element inside a shadow root are stored as a `>>>`
    // PATH (see main/dom/ruleSelector.ts) and must be kept OUT of that joined
    // string: `>>>` is illegal CSS, and one bad selector kills the whole list.
    // They are resolved to elements once per scan instead.
    let { plain: legacyPlainRules, paths: legacyRulePaths } = partitionRules(rules)
    let legacyRuleSelector = compileSelectorList(legacyPlainRules, "no-translate")
    let legacyRuleVersion = shareConfig.rulesVersion
    let shadowRuleTargets: Set<Element> = new Set()
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
    // Languages the user never wants translated, pre-normalized once. An empty
    // set is the "feature not configured" fast path every consumer checks
    // first, so nobody who leaves this alone pays for it.
    let noTranslateLanguages = buildNoTranslateLanguageSet(noTranslateLanguagesConfig)
    let domainStrategy = (rawDomainStrategy?.strategy || DOMAIN_STRATEGY.AUTO) as string
    // Per-domain "translate all elements": the user's own exclusions stop
    // applying on this site — both the legacy per-host no-translate areas and
    // the website rules' include/exclude selectors. Read off the domain doc we
    // already fetched above, so it costs nothing at startup. Sub-frames resolve
    // the same (top) domain, so the whole tab agrees.
    let translateAllElements = !!rawDomainStrategy?.translateAllElements
    let floatBallStyle = Object.values(FLOAT_BALL_STYLE).includes(floatBallStyleConfig as FLOAT_BALL_STYLE)
        ? floatBallStyleConfig as FLOAT_BALL_STYLE
        : DEFAULT_VALUE.FLOAT_BALL_STYLE
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
    let pendingMarkRoots = new Set<UnitContainer>();
    let pendingProcessTimer: number | null = null;
    let processingActive = false;
    // "The page detached something since we last looked." Set by the observer,
    // consumed by sweepDetachedBookkeeping() — the observer no longer cleans up
    // per removed node, see that function.
    let detachSweepPending = false;

    // ===== Observer state =====
    //
    // Declared HERE, in content()'s first synchronous pass — NOT next to
    // startObserveDom() further down. `startShadowDiscovery` is registered above,
    // and any handler of it that fires while the startup awaits are still
    // pending would read these: a `let` further down the closure body is in its
    // temporal dead zone until execution reaches it, so touching it from an
    // early callback throws ReferenceError and takes the whole content script
    // down with it. That is a real regression, not a hypothetical — it is why
    // `shadowPipelineReady` gates that callback. (Function declarations are
    // hoisted, so the functions themselves may stay where they read best — only
    // their state has to move.)
    //
    // No attribute observation: paragraph marks live in content-script memory
    // (paragraphMarks.ts), so page-side class rewrites can't touch them and our
    // own marking produces no attribute mutations to filter.
    const OBSERVE_INIT: MutationObserverInit = {
        childList: true,
        subtree: true,
        characterData: true,// text content change
        // characterDataOldValue: true,
    };
    let domObserved = false;
    const ROOT_COMPACT_THRESHOLD = 32;
    let forgottenRootCount = 0;

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
                // console.debug('characterData', mutation);
                // parentNode, not parentElement: a text node directly under a
                // ShadowRoot has no parent element, and the mutation would be
                // dropped before the walk even started.
                let p = closestNeedsTranslate(target.parentNode)
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
            // A ShadowRoot is a valid mutation target (we observe each root
            // directly — `subtree: true` does not cross the boundary) and a valid
            // scan root, so it must not be filtered out here.
            if (mutation.target.nodeType !== Node.ELEMENT_NODE && !isShadowRoot(mutation.target)) continue;
            const target = mutation.target as UnitContainer;

            // We observe <html> (not <body>) so a wholesale <body> swap stays
            // visible — some SPAs (Turbo/Astro-style soft navigation) replace
            // the entire <body> element on route change while keeping the JS
            // context alive. A body-scoped observer would be stranded on the
            // old, detached body and never see the new page. Mutations at the
            // <html>/<head> level are otherwise not page content: only re-root
            // marking when a fresh <body> is added, and never mark <head>.
            if (target === document.documentElement || target.nodeName === 'HEAD') {
                if (mutation.removedNodes.length > 0) detachSweepPending = true;
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'BODY') pendingMarkRoots.add(node as HTMLElement);
                });
                continue;
            }

            // Cheap structural skip — bail before queueing.
            if (isIgnoreMutationElement(target)) continue;
            // console.log('mutation target', target);
            // console.log('start mutation');
            // Removals are only *flagged* here. Cleaning them up per removed
            // node was the single most expensive thing this extension did — see
            // sweepDetachedBookkeeping.
            if (mutation.removedNodes.length > 0) detachSweepPending = true;
            pendingMarkRoots.add(target);
        }
        if (pendingMarkRoots.size > 0 || detachSweepPending) scheduleMutationProcess();
    });

    const intersectionObserver = new IntersectionObserver(items => {
        // console.log("intersectionObserver items: ", items.length)
        if (!translateStatus) {
            return
        }
        for (const item of items) {
            if (!item.isIntersecting) {
                continue
            }
            // One observed element can stand in for several containers — itself,
            // its shadow root, and any boxless descendant host that handed its
            // observation up here. See main/dom/observeTargets.ts.
            for (const el of containersFor(item.target)) {
                // translated and translating elements should be ignored
                if (paragraphElementMap.get(el) != ELEMENT_STATUS.ORIGINAL) {
                    continue
                }
                batchElements.push(el)
                paragraphElementMap.set(el, ELEMENT_STATUS.PENDING)
                // console.log("IntersectionObserver in item", el.textContent)
            }
        }
        if (batchTimer == null) {
            batchTimer = setTimeout(() => {
                trackParagraphTranslation(batchElements)
                console.log("batchElements translated", batchElements.length)
                batchElements = [];
                batchTimer = null
            }, 50);
        }
    }, {
        rootMargin: '300px 0px',
    });

    /**
     * Run a paragraph-translation batch and register it, so a whole-page
     * translate/restore waits for it instead of racing its write-back.
     */
    function trackParagraphTranslation(elements: UnitContainer[], staleOnly = false) {
        const task = translateParagraphElements(elements, undefined, staleOnly)
        pendingTranslateParagraphElementsTask.add(task)
        task.finally(() => {
            pendingTranslateParagraphElementsTask.delete(task)
        })
        return task
    }
    //#endregion

    //#endregion

    // console.debug("get config:", "ruleStrategy: ", ruleStrategy, "viewStrategy: ", viewStrategy,
    //     "targetLanguage: ", targetLanguage, "translateService: ", translateService, "globalSwitch: ",
    //     globalSwitch, "defaultStrategy: ", defaultStrategy, "domainStrategy: ", domainStrategy)

    //#region message listener
    // Body of the runtime.onMessage listener, which is registered at the top of
    // content() instead of here — see the note there. A function declaration so
    // the registration above can reference it before this point.
    async function handleRuntimeMessage(message: any) {
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
            case ACTION.BUILTIN_AI_DOWNLOAD_PROGRESS:
                // Broadcast to EVERY frame: the top frame draws the bar, and
                // each frame re-runs its own paragraphs once the model lands.
                onBuiltinAiDownloadProgress(message.data)
                break
            case ACTION.REPORT_ERROR:
                // A sub-frame's request failed and background forwarded it here
                // (frameId 0). The console line was already written in the frame
                // that failed; this side only draws the bubble.
                if (!isTopFrame) break
                showRelayedError(message.data)
                break
            case ACTION.TRANSLATE_INDICATOR_STATE:
                // A sub-frame's translating-indicator state, forwarded here by
                // background with the sender's frameId attached. Corner mode
                // only — the inline markers are drawn by the frame that owns
                // the paragraph and never travel.
                if (!isTopFrame) break
                if (typeof message.data?.frameId === "number" && message.data?.state) {
                    ingestFrameIndicatorState(message.data.frameId, message.data.state)
                }
                break
            case ACTION.RETRY_FAILED_TRANSLATIONS:
                // Broadcast to every frame (the top one included) by the corner
                // pill's retry button: each frame re-runs its own failures.
                retryFailedTranslations()
                break
            case ACTION.AI_OPEN_WORKBENCH: {
                // The workbench is a single tab-level surface. Keep it top-frame
                // only so a fanned-out message doesn't open one per frame.
                if (!isTopFrame) break
                ensureWorkbenchMounted()
                // deepActiveElement: for an input inside a web component,
                // `document.activeElement` is the host, so the workbench would
                // open with no seed text and a disabled "apply to input".
                const active = deepActiveElement() as HTMLElement | null
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
            case ACTION.TRANSLATE_ALL_ELEMENTS_CHANGED:
                await applyTranslateAllElements(!!message.data)
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
    }
    //#endregion

    // The gesture listeners at the top of content() have been queueing on
    // `startupReady` this whole time. Release them even if init() throws —
    // otherwise every later gesture waits on a promise that never settles.
    // (initTranslate resolves it earlier, right after the first marking scan;
    // this is the backstop for the global-switch-off and failure paths.)
    try {
        if (globalSwitch) {
            await init()
        }
    } finally {
        markStartupReady()
    }

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
            case CONFIG_KEY.NO_TRANSLATE_LANGUAGES: {
                const next = buildNoTranslateLanguageSet(value)
                if (next.size === noTranslateLanguages.size
                    && [...next].every(l => noTranslateLanguages.has(l))) return
                noTranslateLanguages = next
                // Takes effect on the next batch only. Deliberately NOT a
                // restore + re-translate like TARGET_LANGUAGE does: the two
                // directions are not symmetric. Adding a language would have to
                // find and tear down translations that are already correct on
                // screen, and removing one would have to re-detect the whole
                // page to know what to pick up — for a setting the user edits
                // once. Reloading the tab is the honest answer, same as the
                // website rules.
                break
            }
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
            case CONFIG_KEY.FLOAT_BALL_STYLE:
                if (!Object.values(FLOAT_BALL_STYLE).includes(value as FLOAT_BALL_STYLE)) return
                if (floatBallStyle === value) return
                floatBallStyle = value as FLOAT_BALL_STYLE
                if (floatBallSwitch) {
                    await removeFloatBall()
                    await initFloatBall()
                }
                break
            case CONFIG_KEY.SELECTION_ICON_SWITCH: {
                if (typeof value !== "boolean") return
                // Re-mounting re-runs the gate (global switch off means there is
                // nothing to mount onto), so both directions go through the same
                // pair of calls rather than caching a flag here.
                removeSelectionIcon()
                if (value && globalSwitch) {
                    selectionIconDisposed = false
                    const teardown = await mountSelectionIcon({ domain: domainWithPort })
                    if (selectionIconDisposed) teardown()
                    else selectionIconDispose = teardown
                }
                break
            }
            case CONFIG_KEY.TRANSLATING_ANIMATION:
                if (typeof value !== "string") return
                // Takes effect on the next batch; markers already in the page
                // for an in-flight batch keep their original style until it
                // settles (see setTranslateIndicatorMode).
                setTranslateIndicatorMode(value)
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
                        let needTranslate = autoNeedsTranslate()
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

    /**
     * Apply a flip of the per-domain "translate all elements" option live.
     *
     * Both directions need the same two steps, in this order:
     *  1. Re-mark from `<body>`. Marking re-runs `markParagraph` on every
     *     visited element, so needs-translate flags are refreshed both ways —
     *     regions that were excluded gain the flag, regions that just became
     *     excluded lose it. (Regions that were excluded were never marked as
     *     paragraphs at all, so only a fresh scan can find them.)
     *  2. Re-drive translation. `retranslateNeedsTranslateParagraphs` restores
     *     the whole page first and then re-observes exactly the paragraphs that
     *     now need translating, which is precisely the difference we want —
     *     including dropping the translations of regions that just became
     *     excluded.
     *
     * Rule-derived no-translate marks are NOT cleared: while the option is on
     * the scan reads only the own-UI set (see `noTranslateOf`), so the cache
     * stays valid for the moment the option is turned back off.
     */
    async function applyTranslateAllElements(value: boolean) {
        if (value === translateAllElements) return
        translateAllElements = value
        // Website rules are gated at compile time — recompile with the new
        // answer before anything reads `siteRules`.
        refreshCompiledSiteRules()
        await markParagraphElement(document.body)
        if (!translateStatus) return
        controller = new AbortController()
        void retranslateNeedsTranslateParagraphs()
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
                if (translateStatus && !autoNeedsTranslate()) {
                    await restoreOriginalAction()
                }
                if (!translateStatus && autoNeedsTranslate()) {
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
            const { selection, text, inPopup } = currentTranslateSelection();
            if (text) {
                translateSelection(text, selection, inPopup);
                return;
            }
        }
        if (doInput) {
            const active = deepActiveElement();
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

    /**
     * Feed one keydown to the run tracker. A function declaration so the
     * listener above, registered in the first synchronous pass, can call it.
     */
    function noteTypedEcho(e: KeyboardEvent) {
        const active = deepActiveElement()
        const el = active instanceof HTMLElement && IsEditableElement(active) ? active : null
        typedEcho = extendTypedRun(typedEcho, e, el)
    }

    /** What the shortcut that just fired can account for, taken and cleared. */
    function takeTypedEcho(shortcutId: string): TypedRun | null {
        const run = typedEcho
        typedEcho = null
        return typedRunForShortcut(run, findShortcut(shortcutId, customShortcutList))
    }

    /**
     * A custom gesture fired. Runs the actions bound to it in the order the
     * user arranged them, stopping at the first whose precondition holds — the
     * same "one action per gesture" rule as the double-tap handler, except the
     * priority is the user's row order rather than a fixed one. A gesture bound
     * only once (the normal case) therefore just runs that action.
     */
    async function runCustomShortcutGesture(shortcutId: string) {
        const actions = actionsForGesture(shortcutId, customShortcutBindings)
        if (actions.length === 0) return
        // Synchronously, before the await: the run is live state, and more
        // typing during the wait would change what this gesture is answerable
        // for. Same rule as capturing a pointer position off an event.
        const echo = takeTypedEcho(shortcutId)
        // The gesture is recognized immediately; only the action waits for the
        // pipeline, so a gesture on a still-initializing page acts as soon as
        // it can instead of doing nothing.
        await startupReady
        if (startupAborted) return
        for (const action of actions) {
            if (runCustomShortcutAction(action, echo)) return
        }
    }

    /** @returns whether the action's precondition was met and it actually ran. */
    function runCustomShortcutAction(
        action: CUSTOM_SHORTCUT_ACTION,
        echo: TypedRun | null,
    ): boolean {
        switch (action) {
            case CUSTOM_SHORTCUT_ACTION.TRANSLATE_SELECTION: {
                const { selection, text, inPopup } = currentTranslateSelection();
                if (!text) return false
                translateSelection(text, selection, inPopup);
                return true
            }
            case CUSTOM_SHORTCUT_ACTION.TRANSLATE_INPUT: {
                const active = deepActiveElement();
                if (!(active instanceof HTMLElement) || !IsEditableElement(active)) return false
                // Take the shortcut's own characters back out FIRST: they are
                // in the field the user is asking us to translate, so leaving
                // them in would both send them to the provider and leave them
                // behind whenever the translation fails or comes back empty
                // (the success path replaces the whole value, which is what hid
                // this until a shortcut on a printable key existed).
                if (echo && echo.el === active) removeTypedEcho(active, echo.text);
                lastEditableElement = active;
                void translateInputBox();
                return true
            }
            case CUSTOM_SHORTCUT_ACTION.TOGGLE_PARAGRAPH:
                // Always "runs": it falls back to whole-container behaviour when
                // the pointer is over no unit, so it never silently does nothing.
                toggleTranslateParagraph();
                return true
            // The page-level three are broadcast rather than run here, even in
            // the top frame. A key event only reaches the FOCUSED frame, so
            // acting locally would translate an iframe and nothing else; going
            // through background's fan-out is exactly what the popup and the
            // browser commands do, and every frame then handles it once. The
            // echo back to this frame is a no-op for the same reason it is for
            // the float ball (task + status guards).
            //
            // TOGGLE stays a broadcast too, and specifically must not be
            // decided here: sub-frames ignore raw TOGGLE by design and take the
            // explicit translate/restore the top frame relays afterwards, so
            // letting a sub-frame flip its own status is how they drift out of
            // phase with the tab.
            case CUSTOM_SHORTCUT_ACTION.TOGGLE_PAGE:
                relayToSubframes(TRANSLATE_ACTION.TOGGLE);
                return true
            case CUSTOM_SHORTCUT_ACTION.TRANSLATE_PAGE:
                relayToSubframes(TRANSLATE_ACTION.TRANSLATE);
                return true
            case CUSTOM_SHORTCUT_ACTION.RESTORE_PAGE:
                relayToSubframes(TRANSLATE_ACTION.SHOW_ORIGINAL);
                return true
            case CUSTOM_SHORTCUT_ACTION.OPEN_WORKBENCH:
                // Broadcast for the same reason, and the handler is already
                // top-frame-only, so the tab still gets exactly one workbench.
                relayToSubframes(ACTION.AI_OPEN_WORKBENCH);
                return true
            case CUSTOM_SHORTCUT_ACTION.TOGGLE_VIDEO_SUBTITLE:
                // Not broadcast, and not a config write either. It flips the
                // controller's per-tab session switch — the same one the player
                // menu shows — so turning it off just stops drawing subtitles,
                // leaving the player button and the menu where they are.
                //
                // `VIDEO_SUBTITLE_SWITCH` would be the wrong lever: that is the
                // "disable everywhere" setting the menu puts behind a confirm
                // dialog, and it tears the injected UI down with it.
                //
                // No controller means no player to act on (a sub-frame, or a
                // site the feature does not support), which is a precondition
                // that failed rather than an action that ran.
                if (!videoSubtitle) return false
                videoSubtitle.toggleEnabled();
                return true
        }
        return false
    }

    function translateSelectionInputBox() {
        const { selection, text, inPopup } = currentTranslateSelection()
        if (!text) {
            // translate input box
            const active = deepActiveElement()
            if (!active || !(active instanceof HTMLElement) || IsEditableElement(active)) return
            lastEditableElement = active
            translateInputBox()
            // console.log('translateSelectionInputBox active: ', active)
            return
        }
        // console.log('translateSelectionInputBox text: ', text)
        translateSelection(text, selection, inPopup)

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
        // deepElementFromPoint: the native call retargets to the shadow HOST, so
        // inside a component it would resolve to the wrong container (or none).
        const hit = deepElementFromPoint(x, y)
        const container = closestParagraph(hit)
        if (!container) return null

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
            if (!needsTranslation(unit)) continue
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
                    if (!needsTranslation(unit)) continue
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
    function toggleTranslateContainer(container: UnitContainer) {
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
        const ele = deepElementFromPoint(lastX, lastY)
        const container = closestParagraph(ele)
        if (container) toggleTranslateContainer(container)
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
        const { selection, text: localSelection, inPopup } = currentTranslateSelection()

        // No local selection → the selection lives in another frame; skip so we
        // don't pop up a duplicate empty card here.
        if (localSelection === "") return
        const text = (selectionText && selectionText.trim() !== "") ? selectionText : localSelection
        if (text.trim() === "") return

        translateSelection(text, selection, inPopup)
    }

    /**
     * The selection a translate gesture acts on.
     *
     * `deepSelection` rather than `window.getSelection()`: the latter collapses
     * a selection made inside ANY shadow tree — a page component's as much as
     * our own card's — onto the host, so `toString()` is still right while the
     * rect measured below is empty. An unmeasurable rect reads as "no anchor",
     * which is exactly the centered placement, so the card landed in the middle
     * of the screen instead of at the text.
     */
    function currentTranslateSelection(): { selection: DeepSelection | null; text: string; inPopup: boolean } {
        const selection = deepSelection()
        return {
            selection,
            text: selection?.toString().trim() ?? "",
            inPopup: isInSelectionPopup(selection?.anchorNode) || isInSelectionPopup(selection?.focusNode),
        }
    }

    function translateSelection(text: string, selection: DeepSelection | null, keepPosition = false) {
        let rect: DOMRect | null = null
        let range: Range | undefined
        try {
            if (selection && selection.rangeCount > 0) {
                const r = selection.getRangeAt(0)
                // Live clone: the selection collapses once the popup's click-away
                // handler runs, but a clone keeps its endpoints, so a page scroll
                // can still re-anchor the card to the text.
                range = r.cloneRange()
                const rr = r.getBoundingClientRect()
                if (rr && (rr.width > 0 || rr.height > 0)) rect = rr
            }
        } catch { /* detached range — fall back to centered placement */ }

        openSelectionTranslate({ text, rect, range, keepPosition })
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
            // Drain in waves: roots added — and removals flagged — during our
            // async work get picked up on the next iteration of the outer loop.
            // Both conditions are re-read here rather than latched, and nothing
            // awaits between leaving this loop and clearing `processingActive`,
            // so the observer can never flag a sweep that no one comes back for.
            while (detachSweepPending || pendingMarkRoots.size > 0) {
                if (detachSweepPending) {
                    // Before the scan, not after: it is what makes the roots
                    // this wave is about to skip cheap to skip.
                    detachSweepPending = false;
                    sweepDetachedBookkeeping();
                }
                const roots = Array.from(pendingMarkRoots);
                pendingMarkRoots.clear();
                for (const root of roots) {
                    // isConnected check at every yield boundary so we drop nodes the page
                    // already removed during our wait.
                    if (!root.isConnected) continue;
                    if (isIgnoreMutationElement(root)) continue;
                    // console.log("processPendingMutations root");
                    //
                    // Hand containers to the IntersectionObserver as the scan
                    // finds them, not only when it finishes. A Reddit post page
                    // takes ~200 ms of chunked scanning, and waiting for all of
                    // it means the first paragraph — which the scan reaches in
                    // its first chunk — sits untranslated for that whole time,
                    // for no reason: the observer already gates on visibility,
                    // and the containers below the fold would not be translated
                    // any sooner if it had them.
                    //
                    // `handed` is not an optimization, it is what keeps a
                    // container from being translated twice: the sink sees each
                    // one at a chunk boundary AND again in the final list, and
                    // re-setting a container that the observer has already moved
                    // to PENDING back to ORIGINAL would queue it a second time.
                    // Feeding the full list at the end is what covers a switch
                    // that was flipped ON midway through the scan.
                    const handed = new Set<UnitContainer>();
                    const observeCollected = (batch: UnitContainer[]) => {
                        if (!translateStatus) return;
                        for (const ele of batch) {
                            if (handed.has(ele)) continue;
                            handed.add(ele);
                            paragraphElementMap.set(ele, ELEMENT_STATUS.ORIGINAL);
                            observeContainer(intersectionObserver, ele);
                        }
                    };
                    const collected = await markParagraphElement(root, observeCollected);
                    if (!translateStatus) {
                        // Page translation is off, so nothing here may START
                        // translating. One exception: a container the user
                        // translated by hand, which the page has since changed —
                        // its translation now sits next to text it does not
                        // match, exactly the staleness the page-translation path
                        // repairs. `staleOnly` is what keeps this from becoming
                        // "translate the page anyway": only units the records
                        // already cover are re-run.
                        //
                        // The filter also bounds the cost: with the switch off
                        // the bookkeeping holds a handful of containers, while
                        // `collected` can be the whole page.
                        const stale = collected.filter(
                            el => duoTranslatedElementMap.has(el) || translatedElementMap.has(el)
                        )
                        if (stale.length > 0) trackParagraphTranslation(stale, true)
                        continue
                    }
                    observeCollected(collected);
                }
            }
        } finally {
            processingActive = false;
            // After the queue has drained, so the disconnect/re-observe window
            // in which a record could be dropped is as small as possible.
            compactRootObservations();
        }
    }

    /**
     * Drop every piece of bookkeeping whose container the page has detached.
     * One pass per mutation batch, run from processPendingMutations.
     *
     * It replaced a cleanupRemovedSubtree(removed) called once per removed node,
     * which asked `deepContains(removed, key)` of every mark, every registered
     * shadow root and every tracked container — O(removed x bookkeeping x depth),
     * with the depth factor being a JS ancestor climb paid on every key that was
     * *not* under `removed`, which is nearly all of them. A Zen profile of
     * ui.shadcn.com had 70% of the whole tab thread inside that shape, and each
     * keystroke in the docs search blocked the main thread for over a second
     * (the list re-render removes hundreds of nodes per character). Chrome pays
     * the same complexity with a cheaper constant; Firefox's Xray wrappers make
     * every step of the climb a cross-compartment property read.
     *
     * `isConnected` asks the same question with one native boolean read, and
     * stays false once it flips — so this can also be deferred out of the
     * observer callback into the debounced processor, where it costs one pass
     * per 50 ms window rather than one per removed node.
     *
     * Two behavioural differences, both wanted: a container the page *moves*
     * keeps its records instead of losing them, and a removal under a container
     * we are mid-write on (`ignoreMutationElements`, which used to skip cleanup
     * entirely) is no longer stranded.
     */
    function sweepDetachedBookkeeping() {
        sweepDetachedParagraphMarks();
        // Shadow roots go too: the observations and injected stylesheets they
        // own have to be released whether or not the tree held any marks.
        forgetDisconnectedRoots();
        const drop = (el: UnitContainer) => {
            duoTranslatedElementMap.delete(el);
            translatedElementMap.delete(el);
            paragraphElementMap.delete(el);
            // The listeners went with the detached node, but the highlight paint
            // is document-global — drop it if this container is holding it.
            clearSentenceHighlight(el);
            highlightDisposers.delete(el);
        };
        for (const el of paragraphElementMap.keys()) if (!el.isConnected) drop(el);
        // The translation maps are written alongside paragraphElementMap, so the
        // loop above covers them in practice — sweep them anyway rather than
        // depend on that, since a stranded record makes its container read as
        // "already translated" forever.
        for (const el of duoTranslatedElementMap.keys()) if (!el.isConnected) drop(el);
        for (const el of translatedElementMap.keys()) if (!el.isConnected) drop(el);
    }

    function isIgnoreMutationElement(element: Node) {
        // closest() is a native O(depth) walk — faster than the JS loop and
        // catches the common UI-framework patterns in one shot.
        // if (element.closest && element.closest(IGNORE_CONTAINER_SELECTOR)) return true;
        //
        // Climbs the composed ancestry: a guard set on a container outside the
        // component must still be seen from inside its shadow tree, or the
        // observer re-enters on our own writes and translate/restore loops.
        // "BODY" stays the terminator (and, as before, is itself never tested),
        // but the walk can now actually reach it from a shadow tree — with
        // `parentElement` it stopped dead at the boundary.
        for (let current: Node | null = element; current && current.nodeName !== "BODY"; current = parentOrHost(current)) {
            if (ignoreMutationElements.has(current)) {
                return true
            }
        }
        return false
    }

    /**
     * Yield to the browser between work chunks of the marking scan.
     *
     * This used to be `requestIdleCallback({timeout: 50})`, on the reasoning
     * that idle time is the polite place for a background scan. Measured, that
     * reasoning inverts: idle time is exactly what a page under load does not
     * have, so the scan only ever ran on the timeout path — and even then it
     * queued behind whatever the page was doing. On a Reddit SPA route change
     * the six yields of one scan waited **139 / 58 / 42 / 68 / 54 / 19 ms** for
     * 191 ms of actual work: 380 ms of pure waiting, two thirds of the scan's
     * wall time, on the one kind of page where the user is most likely to
     * notice translation lagging behind the content.
     *
     * `scheduler.yield()` is the primitive built for this: it ends the current
     * task (so the browser can style, lay out and paint — including the shadow
     * root stylesheets flushed just before us) but puts the continuation ahead
     * of ordinary queued tasks, so we resume at the next opportunity instead of
     * waiting for one that never comes. `postTask` at user-visible priority is
     * the same bargain without the continuation boost. `setTimeout(0)` is the
     * floor, and is still far better here than idle-callback scheduling.
     *
     * Responsiveness is bounded by `MARK_BUDGET_MS`, not by the yield: a chunk
     * is capped at 20 ms whichever primitive resumes it. What changes is the
     * gap between chunks, not their length.
     */
    function yieldToBrowser(): Promise<void> {
        const scheduler = (window as any).scheduler;
        if (typeof scheduler?.yield === 'function') {
            // Can reject if the frame's task is aborted — resolve either way,
            // the scan re-checks `isConnected` at every boundary anyway.
            return scheduler.yield().catch(() => undefined);
        }
        if (typeof scheduler?.postTask === 'function') {
            return scheduler
                .postTask(() => undefined, { priority: 'user-visible' })
                .catch(() => undefined);
        }
        return new Promise<void>((resolve) => setTimeout(resolve, 0));
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
        // Minimal player UI — same host gate, separate lifecycle: it is governed
        // by its own setting and works whether or not subtitles are on.
        if (isTopFrame && window.location.hostname === "www.youtube.com" && !minimalPlayerUi) {
            minimalPlayerUi = initMinimalPlayerUi()
        }
        // Selection translate icon — every frame, since a selection is scoped
        // to the document it was made in. The mount is cheap (three document
        // listeners); the Shadow-DOM surface is built on the first selection.
        selectionIconDisposed = false
        mountSelectionIcon({ domain: domainWithPort })
            .then((teardown) => {
                if (selectionIconDisposed) { teardown(); return; }
                selectionIconDispose = teardown
            })
            .catch((err) =>
                console.warn(APP_NAME_WITH_SUFFIX, "mountSelectionIcon failed", err),
            )
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

    function removeSelectionIcon() {
        selectionIconDisposed = true
        selectionIconDispose?.()
        selectionIconDispose = null
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
        domObserved = false
        observer.disconnect()
        resetShadowRoots()
        resetShadowCss()
        removeFloatBall()
        removeAiWritingDot()
        removeSelectionIcon()
        videoSubtitle?.destroy()
        videoSubtitle = null
        minimalPlayerUi?.destroy()
        minimalPlayerUi = null
        restoreOriginalPage(true, true)
    }

    /**
     * The AUTO/AUTO verdict, for an already-detected `pageLanguage`: translate
     * unless the page is already in the target language, or is in a language
     * the user put on the no-translate list.
     *
     * Four call sites ask exactly this (startup, the per-domain strategy
     * switch, the default strategy switch, and `needsTranslate` below) and used
     * to spell it out inline — one place now, so a change cannot land in three
     * of the four.
     */
    function autoNeedsTranslate(): boolean {
        if (isNoTranslateLanguage(pageLanguage, noTranslateLanguages)) return false
        return pageLanguage !== targetLanguage
    }

    function needsTranslate(): boolean | undefined {
        if (!globalSwitch) return false;
        if (domainStrategy === DOMAIN_STRATEGY.NEVER) return false;
        if (domainStrategy === DOMAIN_STRATEGY.ALWAYS) return true;
        if (defaultStrategy === DEFAULT_STRATEGY.NEVER) return false;
        if (defaultStrategy === DEFAULT_STRATEGY.ALWAYS) return true;
        if (pageLanguage !== undefined) {
            // AUTO only. An ALWAYS strategy above is the user naming this site,
            // which outranks a global list — see main/strategy.ts, the pure
            // twin of this function.
            return autoNeedsTranslate()
        }
    }

    async function initTranslate() {
        // The first marking scan is the earliest consumer of the website rules,
        // so this is where the request started at entry is collected.
        await awaitSiteRules()
        startObserveDom()
        let htmlElements = await markParagraphElement(document.body);
        // Paragraph marks now exist, which is everything the pointer gestures
        // need — release them here rather than at the end of init(), so a
        // double-tap does not have to wait behind a full auto-translation of
        // the page below.
        markStartupReady()
        let shouldTranslate = false
        if (isTopFrame) {
            let needs = needsTranslate()
            if (needs === undefined) {
                pageLanguage = await detectLanguage(htmlElements)
                needs = autoNeedsTranslate()
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
                observeContainer(intersectionObserver, element)
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
            if (includeSelector && !deepQuerySelector(includeSelector)) {
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

    /**
     * Neutralize the website rules' element gates when this site is set to
     * "translate all elements".
     *
     * Done here rather than at the consumption point so that everything reading
     * `siteRules` agrees — the marking scan AND `warnOnRuleMiss`, which would
     * otherwise report an include selector that is no longer in force.
     *
     * `injectCss` is deliberately kept: it is a display fix that makes room for
     * a translation (lifting a line-clamp, undoing an overflow:hidden), not a
     * filter on which elements get translated. Dropping it on the site where
     * MORE gets translated is the wrong direction.
     */
    function applyTranslateAllOverride(compiled: CompiledSiteRules): CompiledSiteRules {
        if (!translateAllElements) return compiled
        return { ...compiled, includeSelector: "", excludeSelector: "" }
    }

    function refreshCompiledSiteRules(): boolean {
        const next = applyTranslateAllOverride(compileCandidates(siteRuleCandidates))
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
        removeShadowCss("translation")
    }

    function startObserveDom() {
        domObserved = true;
        // Everything the discovery handlers need now exists (see the gate at
        // the top of content()).
        shadowPipelineReady = true;
        // Observe <html>, not <body>: SPAs that swap the whole <body> on soft
        // navigation (Turbo/Astro-style) would otherwise leave this observer
        // watching the old detached body, so post-navigation content would
        // never get marked/translated. The callback filters out <head>-level
        // noise and re-roots onto a freshly-added <body>.
        observer.observe(document.documentElement, OBSERVE_INIT);
        for (const root of knownRoots()) observer.observe(root, OBSERVE_INIT);
    }

    // `subtree: true` does NOT cross a shadow boundary, so every root needs its
    // own observe() call. It is the SAME observer instance — one MutationObserver
    // may hold many targets and the callback already dispatches on
    // `mutation.target`, so a per-root observer would buy nothing and cost a
    // callback each.
    function observeShadowRoot(root: ShadowRoot) {
        if (!domObserved) return;
        observer.observe(root, OBSERVE_INIT);
    }

    // MutationObserver keeps a strong reference to every target and offers no
    // per-target unobserve, so roots that leave the page would pin their whole
    // detached tree. `disconnect()` + re-observe is the only tool; batch it
    // behind a threshold and run it after the mutation queue has drained, so the
    // window in which a pending record could be dropped is as small as possible.
    function noteRootForgotten() {
        forgottenRootCount++;
    }

    function compactRootObservations() {
        if (forgottenRootCount < ROOT_COMPACT_THRESHOLD) return;
        forgottenRootCount = 0;
        if (!domObserved) return;
        observer.disconnect();
        startObserveDom();
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
            style: floatBallStyle,
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

    /**
     * Re-drive translation over every needs-translate paragraph.
     *
     * Split out of `translateAction` because the built-in AI model download has
     * to re-run the page WITHOUT going through it: by then the page is already
     * "on" (auto-translate switched it on, then the model turned out to be
     * missing), and `translateAction` early-returns while `translateStatus` is
     * true. The caller owns `controller`, so the ordering in `translateAction`
     * — new controller before `updateTranslateStatus` — is unchanged.
     */
    async function retranslateNeedsTranslateParagraphs() {
        // some elements probably have been translated
        await restoreOriginalPage(false)
        needsTranslateParagraphs().forEach((ele) => {
            paragraphElementMap.set(ele, ELEMENT_STATUS.ORIGINAL)
            // console.log("translateAction observe element");
            // unobserve FIRST. `observe()` on an element the observer is already
            // watching is a silent no-op — no fresh callback is delivered — and
            // elements only leave the observer on a SUCCESSFUL translation
            // (see the unobserve in translateUnits). So after a batch fails,
            // its paragraphs are still observed, and re-observing them queues
            // absolutely nothing: the page stays in its original language with
            // no error anywhere. That is what made the built-in AI model
            // download look broken — the model arrived, the retry ran, and
            // every retry was a no-op.
            //
            // `translateAction` never hit this because the only way to reach it
            // is with translation OFF, and `restoreOriginalAction` disconnects
            // the whole observer on the way there. `restoreOriginalPage` — the
            // one called here — does NOT disconnect.
            unobserveContainer(intersectionObserver, ele)
            observeContainer(intersectionObserver, ele)
        })
    }

    /**
     * Swallow the "the on-device model is still downloading" signal.
     *
     * This is NOT a failure and must not raise an error bubble: background has
     * already started the download by itself (a service worker needs no user
     * gesture for it), and the page will re-translate when the progress
     * broadcast reports `done`. Returns true when it took ownership.
     *
     * The progress bar itself is drawn by the broadcast handler, not here — a
     * batch can fail this way many times over while one download runs.
     */
    function isBuiltinAiModelDownloading(e: any): boolean {
        if (e?.originalName !== BUILTIN_AI_MODEL_DOWNLOADING) return false
        // Remember that THIS frame has paragraphs waiting on the model. The
        // progress broadcast goes to every frame of every tab (background has
        // no idea who is waiting), so without this flag an unrelated tab would
        // draw a progress bar for someone else's download and — worse —
        // re-translate itself from scratch when it finished.
        builtinAiBailSeq++
        if (!builtinAiAwaitingModel) {
            builtinAiAwaitingModel = true
            builtinAiRetryDelay = BUILTIN_AI_RETRY_MIN_MS
            builtinAiRetryDeadline = Date.now() + BUILTIN_AI_RETRY_GIVE_UP_MS
        }
        scheduleBuiltinAiRetry()
        return true
    }

    function stopBuiltinAiWait(): void {
        builtinAiAwaitingModel = false
        if (builtinAiRetryTimer) {
            clearTimeout(builtinAiRetryTimer)
            builtinAiRetryTimer = null
        }
    }

    /**
     * Poll for the model instead of trusting the "download finished" broadcast.
     *
     * That broadcast is a nice-to-have fast path, NOT something recovery can
     * depend on: a first-time model download takes minutes, and an MV3 service
     * worker is terminated after ~30s idle — which destroys the pending
     * `create()` promise, its progress monitor and the final broadcast, while
     * the browser goes on fetching the model anyway. The page was then stuck in
     * its original language forever, because a failed batch leaves its
     * paragraphs in ELEMENT_STATUS.PENDING and the IntersectionObserver only
     * ever picks up ORIGINAL ones. Nothing retried, nothing said so.
     *
     * Each poll costs background one `availability()` check, so the backoff can
     * stay short at the start and still be cheap.
     */
    function scheduleBuiltinAiRetry(): void {
        if (builtinAiRetryTimer || !builtinAiAwaitingModel) return
        builtinAiRetryTimer = setTimeout(() => {
            builtinAiRetryTimer = null
            if (!builtinAiAwaitingModel) return
            // Nothing bailed out since the previous retry actually ran, so the
            // model landed and translation is proceeding normally. Stop.
            if (builtinAiBailSeq === builtinAiSeqAtLastRetry) {
                stopBuiltinAiWait()
                return
            }
            if (Date.now() > builtinAiRetryDeadline) {
                console.log(APP_NAME_WITH_SUFFIX, "built-in AI: gave up waiting for the on-device model")
                stopBuiltinAiWait()
                return
            }
            builtinAiSeqAtLastRetry = builtinAiBailSeq
            builtinAiRetryDelay = Math.min(builtinAiRetryDelay * 2, BUILTIN_AI_RETRY_MAX_MS)
            if (translateStatus) {
                controller = new AbortController()
                void retranslateNeedsTranslateParagraphs()
            }
            scheduleBuiltinAiRetry()
        }, builtinAiRetryDelay)
    }

    /**
     * Render download progress, and re-run translation once the model lands.
     *
     * Every frame re-translates (each owns its own paragraphs); only the top
     * frame draws the bar, since a sub-frame's would be clipped to its box.
     */
    function onBuiltinAiDownloadProgress(progress: BuiltinAiDownloadProgress): void {
        // Only frames actually blocked on this model care. Everyone else gets
        // the broadcast too and must ignore it completely.
        if (!builtinAiAwaitingModel) return
        if (isTopFrame) {
            // Lazy — same reasoning as the error bubble in main/errorReport.ts:
            // this pulls in React, i18n and the Tailwind sheet, which every page
            // would otherwise pay for to show a bar it will rarely need.
            void import("@/main/builtinAi/modelDownloadPrompt")
                .then(({ showBuiltinAiDownloadProgress }) => showBuiltinAiDownloadProgress(progress))
                .catch((err) => {
                    console.log(APP_NAME_WITH_SUFFIX, "built-in AI progress bar failed to render:", err)
                })
        }
        if (!progress.done) return
        // Fast path only. The retry loop above is what actually guarantees
        // recovery; this just avoids waiting for the next poll when background
        // did survive long enough to tell us.
        stopBuiltinAiWait()
        // The user stopped it. Re-translating now would ask for the very model
        // they just declined — and background would refuse anyway, since a
        // cancel latches the pair until asked again explicitly.
        if (progress.cancelled) return
        if (progress.error) return
        // Model is on disk — the batches that bailed out earlier can now run.
        if (!translateStatus) return
        controller = new AbortController()
        void retranslateNeedsTranslateParagraphs()
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
            // Asking for a translation by hand overrides an earlier "stop
            // downloading": background latches a cancelled model so that
            // scrolling cannot silently restart it, and this is the click that
            // says otherwise. Fire-and-forget — if it does not land, the worst
            // case is the pre-existing "download was cancelled" message.
            if (translateService === TRANSLATE_SERVICE.BUILTIN) {
                void sendMessageToBackground({ action: ACTION.BUILTIN_AI_RESUME_DOWNLOAD })
            }
            await updateTranslateStatus(true)
            await retranslateNeedsTranslateParagraphs()
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
        // BEFORE anything asynchronous, including the `restoreOriginalTask`
        // guard's own awaits. "Show me the original" is an instant intent, and
        // everything below it waits: on a translate task, on the provider
        // actually noticing the abort, on the restore itself. Leaving the
        // spinners up for that wait is the same silence this indicator exists to
        // end, only inverted — the page looks like it is still working on a
        // translation the user just cancelled.
        clearTranslateIndicators()
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
            resetObserveTargets()

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
    function removeDuoSpansIn(container: UnitContainer, nodes: ChildNode[]) {
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
    function restoreDuoRecords(element: UnitContainer, records: DuoUnitRecord[]) {
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
     * <duo-span> highlight fallback only: give the run its own text back and
     * drop our wrappers, leaving the translation itself on screen.
     *
     * A unit about to be re-translated is serialized straight from the page,
     * and on this path the page's own text nodes are empty — the text lives in
     * our wrappers. Serializing that would ship `<duo-span duo-sequence>`
     * scaffolding to the provider and clone it into the new translation.
     *
     * Only the wrapping is undone here, not the translation: taking that down
     * before the replacement exists is exactly the flash-back this whole path
     * is built to avoid. It comes down in the insert loop, with its successor
     * in hand.
     */
    function unwrapHighlightSpans(element: UnitContainer, record: DuoUnitRecord) {
        if (record.texts.length === 0) return
        const texts = record.texts
        record.texts = []
        ignoreMutationElements.add(element)
        // The painted sentence is anchored in nodes we are about to empty.
        clearSentenceHighlight(element)
        try {
            removeDuoSpansIn(element, nodesInRange(element, record.range))
        } catch (e) {
            console.error(APP_NAME_WITH_SUFFIX, "unwrap highlight spans error:", e)
        }
        for (const t of texts) {
            ignoreMutationElements.add(t.text)
            t.text.textContent = t.content
        }
        Promise.resolve().then(() => {
            ignoreMutationElements.delete(element)
            for (const t of texts) ignoreMutationElements.delete(t.text)
        })
    }

    /**
     * Take down the translation a re-translation supersedes, at the moment its
     * successor is ready to go in.
     *
     * `records` is the container's live array (the very object in
     * duoTranslatedElementMap when there is one), so the splice IS the
     * bookkeeping update.
     */
    function dropDuoRecord(element: UnitContainer, records: DuoUnitRecord[], record: DuoUnitRecord) {
        clearSentenceHighlight(element)
        record.divide.remove()
        record.translation.remove()
        const index = records.indexOf(record)
        if (index >= 0) records.splice(index, 1)
    }

    /**
     * SINGLE: replay the original text of `results` (one per unit). Same
     * split as restoreDuoRecords — all of them, or just the hovered unit's.
     */
    async function restoreSingleResults(element: UnitContainer, results: TranslateResult[]) {
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

    async function restoreOriginalParagraphElement(element: UnitContainer) {
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
        // Whatever was in flight is being abandoned and whatever failed is no
        // longer on offer to retry — a marker outliving the translation it
        // belongs to would be pointing at nothing.
        clearTranslateIndicators()

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
                // A ShadowRoot container carries no attributes of its own.
                if (!isShadowRoot(element)) removeDuoClassAndAttribute(element)
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
            bgColor, fontColor, borderStyle, borderColor, quoteBorderColor,
            highlightBg, highlightFontColor, highlightStyle, highlightBorderColor,
            highlightSwitch,
        ] = await Promise.all([
            getConfig(CONFIG_KEY.BG_COLOR),
            getConfig(CONFIG_KEY.FONT_COLOR),
            getConfig(CONFIG_KEY.STYLE),
            getConfig(CONFIG_KEY.BORDER_COLOR),
            getConfig(CONFIG_KEY.QUOTE_BORDER_COLOR),
            getConfig(CONFIG_KEY.HIGHLIGHT_BG_COLOR),
            getConfig(CONFIG_KEY.HIGHLIGHT_FONT_COLOR),
            getConfig(CONFIG_KEY.HIGHLIGHT_STYLE),
            getConfig(CONFIG_KEY.HIGHLIGHT_BORDER_COLOR),
            getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        ])
        translationBlurred = borderStyle === STYLE_BLUR
        // The translating indicator's rules ride along with the translation
        // stylesheet: a marker is inserted INSIDE a translation container, so it
        // needs the one delivery path that also reaches page shadow roots
        // (setShadowCss below). Appended unconditionally — the rules match
        // nothing when the feature is off, and making delivery conditional would
        // mean re-pushing a sheet to every root when the setting changes.
        const css = TRANSLATE_INDICATOR_CSS + "\n" + buildTranslationCss({
            bgColor: bgColor || '',
            fontColor: fontColor || '',
            borderStyle: borderStyle || 'noneStyleSelect',
            borderColor: borderColor || '',
            quoteBorderColor: quoteBorderColor || '',
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
        // The document sheet does not reach inside a page's shadow roots, and
        // that includes the ::highlight() rules — same string, delivered per
        // root. See main/dom/shadowCss.ts.
        setShadowCss("translation", css)
    }

    /**
     * search paragraph elements and record them as in-memory paragraph marks
     * @param element
     * @param onCollected optional sink for containers found so far, called at
     *   every yield boundary and once more when the walk ends. Lets a caller
     *   start translating the top of the page while the bottom is still being
     *   scanned — see the note in processPendingMutations. The return value is
     *   still the COMPLETE list, so callers that ignore the sink are unaffected;
     *   ones that use it must dedupe (they will see each container twice).
     * @returns the elements that need to translate
     */
    // Async + iterative to avoid blocking the main thread on large subtrees.
    // The walk yields to the browser every MARK_BUDGET_MS so a body-sized
    // input still mark-completes without freezing the page. Behaviour matches
    // the previous recursive version (depth limit, text-node→duo-span wrapping,
    // mutation suppression around our own DOM writes).
    async function markParagraphElement(
        element: UnitContainer,
        onCollected?: (batch: UnitContainer[]) => void,
    ): Promise<UnitContainer[]> {
        let notTranslate = false;
        const rawElement = element;
        const collectElements: UnitContainer[] = [];
        // Website rules, resolved for this frame's URL. `excludeSelector` is
        // merged with the legacy per-host list (both mean "never translate in
        // here"); `includeSelector` is the positive gate — when non-empty, only
        // content inside a matching subtree is marked as needing translation.
        // Rule mode edits the per-host list in place while the page is open;
        // recompile only when it says something changed (once per scan at
        // most, never per element).
        if (legacyRuleVersion !== shareConfig.rulesVersion) {
            legacyRuleVersion = shareConfig.rulesVersion;
            const split = partitionRules(shareConfig.rules);
            legacyPlainRules = split.plain;
            legacyRulePaths = split.paths;
            legacyRuleSelector = compileSelectorList(legacyPlainRules, "no-translate");
        }
        // Once per scan, not per element — and skipped entirely when no shadow
        // rule exists, which is the overwhelming majority of pages.
        shadowRuleTargets = (translateAllElements || legacyRulePaths.length === 0)
            ? shadowRuleTargets.size === 0 ? shadowRuleTargets : new Set()
            : resolveRulePaths(legacyRulePaths);
        // "Translate all elements" for this site: every user-authored exclusion
        // is off. `siteRules` was already neutralized at compile time (see
        // applyTranslateAllOverride); the legacy per-host list is dropped here.
        const excludeSelector = translateAllElements
            ? ""
            : joinSelectors(legacyRuleSelector, siteRules.excludeSelector);
        const includeSelector = siteRules.includeSelector;
        // Cached rule matches and rule-mode selections live in the same
        // in-memory set; while the option is on, only our own inserted UI still
        // counts as a no-translate region.
        const noTranslateOf = translateAllElements ? isOwnNoTranslateElement : isNotTranslateElement;
        // With no include restriction the flag is true everywhere and every
        // `matches()` below is skipped outright.
        let inInclude = includeSelector === "";

        // Walk up — looking for an enclosing paragraph mark (early return) or
        // an isNotTranslateElement ancestor (sets the flag for descent).
        //
        // Climbs the *composed* ancestry (`parentOrHost`), so a re-scan starting
        // inside a shadow tree still sees the no-translate marks, include gate
        // and enclosing paragraph that live outside the component. It stops at
        // `document.body` exactly as before — which is what keeps
        // `includeSelectors: "body"` a no-op — and at the Document above it.
        const ancestors: UnitContainer[] = [];
        for (let cur: Node | null = parentOrHost(element); cur && cur !== document.body; cur = parentOrHost(cur)) {
            if (cur.nodeType !== Node.ELEMENT_NODE && !isShadowRoot(cur)) break;
            ancestors.push(cur as UnitContainer);
        }
        for (let i = ancestors.length - 1; i >= 0; i--) {
            const p = ancestors[i];
            if (!isShadowRoot(p)) {
                if (isNotMarkElement(p)) return collectElements;
                if (!notTranslate && noTranslateOf(p)) notTranslate = true;
                // Accumulate the include flag here too: a mutation-driven re-scan
                // starts deep inside the include region, and without this walk it
                // would look like it is outside one.
                if (!inInclude && matchesSelector(p, includeSelector)) inInclude = true;
            }
            if (isParagraph(p)) {
                if (isMixedParagraph(p)) {
                    // Mixed container: a mutation under one of its block-ish
                    // children belongs to a deeper unit — keep walking inward
                    // (a nested mark or the Phase B scan handles it). Anything
                    // else sits inside one of the container's own inline runs.
                    const child = (i > 0 ? ancestors[i - 1] : rawElement);
                    // A shadow root is always a boundary: its content is a
                    // separate tree and can never be part of one of the host's
                    // own inline runs.
                    if (isShadowRoot(child) || isSegmentBoundary(child)) {
                        continue;
                    }
                }
                if (!notTranslate && inInclude) collectElements.push(p);
                return collectElements;
            }
        }

        // Iterative DFS via a stack. Children are pushed in reverse order so
        // pop-order matches the original left-to-right recursion.
        type Frame = { node: UnitContainer; notTranslate: boolean; inInclude: boolean; depth: number };
        const stack: Frame[] = [{ node: rawElement, notTranslate, inInclude, depth: 0 }];
        let chunkStart = performance.now();
        let handedOff = 0;
        const drain = () => {
            if (!onCollected || collectElements.length === handedOff) return;
            const batch = collectElements.slice(handedOff);
            handedOff = collectElements.length;
            onCollected(batch);
        };

        try {
            while (stack.length > 0) {
                if (performance.now() - chunkStart >= MARK_BUDGET_MS) {
                    // Style the roots this chunk discovered before handing the
                    // thread back: injecting into a root dirties its tree scope,
                    // and doing it here means the browser's own rendering step
                    // absorbs the recalc instead of the scan's next
                    // `getComputedStyle` paying for it. One recalc per chunk
                    // rather than one per root — see main/dom/shadowCss.ts.
                    // Deliberately NOT flushing the shadow-root stylesheets here.
                    // Doing it per chunk dirties a batch of tree scopes that the
                    // next chunk's first `getComputedStyle` then has to recalc:
                    // measured on a Reddit post page, a 5-chunk scan cost 94.5 ms
                    // of CPU with a flush per chunk and 67.9 ms with one flush at
                    // the end (a 3-chunk scan: 65.8 → 24.3 ms). The guarantee
                    // "a root is styled before anything is written into it" is
                    // kept at the single write site instead — translateUnits.
                    drain();
                    await yieldToBrowser();
                    chunkStart = performance.now();
                }
                const frame = stack.pop()!;
                const el = frame.node;
                let nt = frame.notTranslate;
                let inc = frame.inInclude;
                const depth = frame.depth;

                if (depth > MARK_MAX_DEPTH) continue;
                // Page may have removed the node while we were yielding.
                if (!el.isConnected) continue;

                // The page-owned shadow root of this element, registered on first
                // sight. One property read per visited element — see
                // main/dom/shadowRoots.ts for why the scan is one of the three
                // discovery sources.
                let shadow: ShadowRoot | null = null;
                if (isShadowRoot(el)) {
                    // A root has no tag, no class list, no selector identity and
                    // cannot be editable, so every per-element predicate is skipped.
                    // The inherited notTranslate / inInclude flags carry across the
                    // boundary unchanged — the component sits inside whatever region
                    // its host sits in.
                } else {
                    if (isNotMarkElement(el)) continue;
                    if (!nt && noTranslateOf(el)) nt = true;
                    if (!nt && matchesSelector(el, excludeSelector)) {
                        // Cache the positive rule match so re-scans of this
                        // subtree short-circuit via isNotTranslateElement.
                        markNoTranslate(el);
                        nt = true
                    }
                    if (!nt && shadowRuleTargets.size > 0 && shadowRuleTargets.has(el)) {
                        markNoTranslate(el);
                        nt = true
                    }
                    // The positive gate. NOT a `continue` when still outside: the
                    // include root may be further down, so the walk keeps descending
                    // and only withholds the needs-translate flag on the way.
                    if (!inc && matchesSelector(el, includeSelector)) inc = true;

                    if (isEditable(el)) continue;

                    shadow = noteElement(el);
                }

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
                // would strand the bookkeeping keyed by this container. Refreshing
                // `mixed` keeps the ancestor walk above honest — it is what tells
                // that walk a mutation under this container may belong to a deeper
                // unit rather than to one of the container's own inline runs.
                if (seg.units.length > 0 || isParagraph(el)) {
                    // A host with a shadow root counts as *mixed* even when it has
                    // no block children of its own: marks can live inside the root,
                    // and a pure mark would make the walk stop here and translate
                    // the whole host as one unit.
                    markParagraph(el, !nt && inc, seg.descendChildren.length > 0 || shadow !== null);
                    if (!nt && inc && seg.units.some(needsTranslation)) collectElements.push(el);
                }
                // Push in reverse so pop order = forward visit. Skip children the
                // page detached while we were yielding. `parentNode`, not
                // `parentElement`: the parent of a ShadowRoot container's child IS
                // the root, and parentElement would reject every one of them.
                for (let j = seg.descendChildren.length - 1; j >= 0; j--) {
                    const child = seg.descendChildren[j];
                    if (child.parentNode === el) {
                        stack.push({ node: child, notTranslate: nt, inInclude: inc, depth: depth + 1 });
                    }
                }
                // Pushed last so it pops first: for a component, the shadow tree is
                // usually *the* content, and visiting it before the host's light
                // children keeps the scan's output in rendering order.
                if (shadow) {
                    stack.push({ node: shadow, notTranslate: nt, inInclude: inc, depth: depth + 1 });
                }
            }
        } finally {
            // The last chunk's discoveries, plus anything still queued if the
            // walk threw: a root left unstyled would render its translations
            // (and its `::highlight()` paint) with no CSS at all.
            flushShadowRootStyles();
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
    function bindHighlightHandler(container: UnitContainer): () => void {
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
    function bindRangeHighlightHandler(container: UnitContainer): () => void {
        let current: { record: DuoUnitRecord, index: number } | null = null
        let frame = 0
        let pointerX = 0
        let pointerY = 0
        // Blur style only: is the pointer inside a translation? Captured from the
        // event rather than derived from the ranges, because the two answers
        // differ exactly where it matters — a pointer in the blank between two
        // lines of the translation is over no range, yet must keep the
        // highlight (sticky), while a pointer on the original is over a range
        // and must drop it.
        let pointerInTranslation = false

        /** Is the pointer over sentence `index` of `record`, on either side? */
        function hits(record: DuoUnitRecord, index: number): boolean {
            const pair = record.sentences
            if (!pair) return false
            const original = pair.original[index]
            const translation = pair.translation[index]
            // Under the blur style the original side never selects a sentence:
            // it cannot lift the blur, so the pair it would light up is half
            // unreadable. Hovering the translation still highlights both — by
            // then the blur is gone and the original is the useful half.
            if (translationBlurred) {
                return !!translation && isPointOverRange(pointerX, pointerY, translation)
            }
            return (!!original && isPointOverRange(pointerX, pointerY, original))
                || (!!translation && isPointOverRange(pointerX, pointerY, translation))
        }

        function resolve() {
            frame = 0
            const records = duoTranslatedElementMap.get(container) ?? []
            // The record may have been restored away under us.
            if (current && !records.includes(current.record)) current = null
            // Blurred: leaving the translation for the original re-blurs it, so
            // the paint has to go with it — stickiness stops at the translation's
            // edge instead of at the paragraph's.
            if (translationBlurred && !pointerInTranslation) {
                if (current) {
                    current = null
                    clearSentenceHighlight(container)
                }
                return
            }
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
            // Read from the event, not in resolve(): by the next frame the
            // pointer may have moved on. composedTarget because a listener on
            // the container sees `target` retargeted to the host for anything
            // inside a nested shadow root.
            if (translationBlurred) {
                pointerInTranslation = !!composedTarget(event)?.closest?.(".duo-translation")
            }
            if (frame) return
            frame = requestAnimationFrame(resolve)
        }

        // mouseleave does not bubble, so this only fires when the pointer
        // actually exits the whole paragraph (original + translation).
        const onMouseLeave = () => {
            // Cancel first: a resolve() queued by the last mousemove INSIDE the
            // paragraph would otherwise run after this and repaint from the
            // stale coordinates, i.e. re-highlight what we just cleared.
            if (frame) cancelAnimationFrame(frame)
            frame = 0
            current = null
            pointerInTranslation = false
            clearSentenceHighlight(container)
        }

        // A ShadowRoot is an EventTarget like any other, but its
        // addEventListener is typed generically, hence the cast.
        const onMove = onMouseMove as EventListener
        container.addEventListener("mousemove", onMove)
        container.addEventListener("mouseleave", onMouseLeave)
        return () => {
            onMouseLeave()
            container.removeEventListener("mousemove", onMove)
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
    function bindSpanHighlightHandler(originalElement: UnitContainer): () => void {
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
            // composedTarget: for a listener bound on the container, `target` is
            // retargeted to the host whenever the span lives in a nested root.
            const target = composedTarget(event)
            const span = target?.closest?.('duo-span[duo-sequence]')
            // No span under the pointer (blank area) → keep the current highlight.
            // The ownership guard protects against spans of an enclosing or
            // nested paragraph (each has its own binding).
            if (!span || closestParagraph(span) !== originalElement) {
                return
            }
            // Same rule as the Highlight-API path: with the translation blurred,
            // only the translation side may select a sentence, and moving onto
            // the original drops the paint (it re-blurs as soon as
            // `.duo-translation:hover` stops matching).
            if (translationBlurred && !span.closest('.duo-translation')) {
                onMouseLeave()
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
    async function translateParagraphElements(
        elements: UnitContainer[],
        context?: any,
        /**
         * Only repair translations that have gone stale; never start a new one.
         * What a page with the translate switch OFF allows: the user translated
         * a paragraph by hand and the page then changed it, so its translation
         * has to follow — but nothing else may pick one up.
         */
        staleOnly = false,
    ) {
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
        // Expand each container into the logical-paragraph units that still
        // need work — never translated, or translated and since grown. Units
        // fully accounted for by the records are dropped here, which is what
        // keeps an unrelated mutation from re-sending the whole page.
        const units: TranslationUnit[] = []
        const replacements = new Map<TranslationUnit, UnitReplacement>()
        for (const element of elements) {
            let pending = 0
            for (const { unit, plan } of planContainerUnits(element)) {
                if (plan.action === "skip") continue
                // Repair only. A unit that was never translated stays that way.
                if (staleOnly && plan.action !== "replace") continue
                pending++
                units.push(unit)
                if (plan.action === "replace") {
                    replacements.set(unit, { duo: plan.duo, single: plan.single })
                }
            }
            // Nothing to settle in repair mode: these containers were never put
            // into PENDING by the IntersectionObserver (it is gated off with the
            // page switch), so there is no state owed back to it.
            if (pending === 0 && !staleOnly) {
                // No provider request, no DOM write. Settle it here anyway: the
                // IntersectionObserver put it in PENDING on its way in, and
                // nothing further down this function will ever see it, so
                // without this it stays PENDING and observed forever.
                paragraphElementMap.set(element, ELEMENT_STATUS.TRANSLATED)
                unobserveContainer(intersectionObserver, element)
            }
        }
        await translateUnits(
            units,
            context,
            // Repair mode only ever runs with the page switch off, i.e. on a
            // paragraph the user translated by hand — so a failure belongs to
            // that gesture, not to a page translation the user never started.
            staleOnly ? ERROR_SCOPE.PARAGRAPH_TRANSLATE : ERROR_SCOPE.PAGE_TRANSLATE,
            replacements,
        )
    }

    /**
     * Re-run units whose translation failed, from a retry button on the
     * indicator (one unit for an inline marker, every failed unit of the frame
     * for the corner pill's retry-all).
     *
     * A unit is derived data with no identity of its own, and a failed request's
     * worth of time has passed since these were computed — so each one is
     * re-derived from the live DOM by its range, which IS its identity. Three
     * outcomes: the unit is still there and untranslated (retry the fresh one);
     * it has since been translated by another path (drop it, retrying would
     * translate it twice); its container is gone or re-segmented beyond
     * recognition (drop it, or fall back to the stale unit when its nodes are
     * demonstrably still in place).
     */
    function retryTranslateUnits(failedUnits: TranslationUnit[], errorScope: ERROR_SCOPE_VALUE) {
        const fresh: TranslationUnit[] = []
        const replacements = new Map<TranslationUnit, UnitReplacement>()
        for (const stale of failedUnits) {
            const container = stale.container
            if (!container.isConnected) continue
            const range = unitRangeOf(stale)
            let matched: TranslationUnit | null = null
            let alreadyTranslated = false
            for (const { unit, plan } of planContainerUnits(container)) {
                const candidate = unitRangeOf(unit)
                if (candidate.start !== range.start || candidate.end !== range.end) continue
                if (plan.action === "skip") alreadyTranslated = true
                else {
                    matched = unit
                    // The page grew this unit while the failed batch was out —
                    // the retry has to supersede, not append.
                    if (plan.action === "replace") {
                        replacements.set(unit, { duo: plan.duo, single: plan.single })
                    }
                }
                break
            }
            if (alreadyTranslated) continue
            if (matched) fresh.push(matched)
            else if (stale.nodes.some(n => n.parentNode === container)) fresh.push(stale)
        }
        if (fresh.length === 0) return
        void translateUnits(fresh, undefined, errorScope, replacements)
    }

    /** A unit's source text, as the language filter reads it. */
    function unitSourceText(unit: TranslationUnit): string {
        return getTextNodesAndTextOfNodes(unit.nodes).text
    }

    /**
     * Does the no-translate-language filter apply to this batch?
     *
     * Not to an explicit single-paragraph gesture: the user pointed at that
     * paragraph and asked for it, which is a stronger statement than a list
     * they configured once. `staleOnly` repairs run under the same scope and
     * are covered by the same reasoning — they only ever follow a paragraph the
     * user translated by hand.
     */
    function noTranslateLanguageFilterApplies(errorScope: ERROR_SCOPE_VALUE): boolean {
        return noTranslateLanguages.size > 0 && errorScope === ERROR_SCOPE.PAGE_TRANSLATE
    }

    /**
     * Containers that lost every unit they had in this batch to the language
     * filter are never coming back: the IntersectionObserver moved them to
     * PENDING on the way in and only ever picks up ORIGINAL, and nothing
     * downstream of the filter will see them again. Settle them here, exactly
     * as translateParagraphElements settles a container whose units were all
     * `skip` — otherwise they sit PENDING and observed for the page's life.
     */
    function settleLanguageFilteredContainers(excluded: TranslationUnit[], kept: TranslationUnit[]) {
        if (excluded.length === 0) return
        const keptContainers = new Set(kept.map(u => u.container))
        for (const container of new Set(excluded.map(u => u.container))) {
            if (keptContainers.has(container)) continue
            paragraphElementMap.set(container, ELEMENT_STATUS.TRANSLATED)
            unobserveContainer(intersectionObserver, container)
        }
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
        /**
         * Units being re-translated because the page grew them, mapped to the
         * bookkeeping their result supersedes. Everything else is an append.
         */
        replacements?: Map<TranslationUnit, UnitReplacement>,
    ) {
        let viewStrategyCopy = viewStrategy
        // Every page shadow root discovered so far gets its stylesheet now.
        // This is the guarantee the marking scan deliberately stops making at
        // its chunk boundaries (see the note there): the scan streams containers
        // to the IntersectionObserver as it finds them, so a translation can be
        // written into a root while the scan that discovered it is still
        // running. One flush per batch, and it early-returns once the queue is
        // empty — not one per chunk, which is what made it expensive.
        flushShadowRootStyles()
        // A container whose guard is already set has a translation in flight —
        // drop its units so we never translate the same text twice.
        const guardedUnits = allUnits.filter(u => !ignoreMutationElements.has(u.container))
        // "Do not translate these languages", pass 1: local (franc), free.
        // Runs BEFORE the translating indicator is started, so a paragraph that
        // never leaves this frame never flashes a spinner either.
        //
        // A unit being re-translated is exempt: it was vetted when it was first
        // translated, and under SINGLE what stands in the page now is OUR
        // OUTPUT — detecting a language from that would answer with the target
        // language, not the paragraph's.
        let units = guardedUnits
        let undeterminedUnits: TranslationUnit[] = []
        if (noTranslateLanguageFilterApplies(errorScope)) {
            const candidates = replacements
                ? guardedUnits.filter(u => !replacements.has(u))
                : guardedUnits
            const partition = partitionByLocalLanguage(candidates, unitSourceText, noTranslateLanguages)
            // Rebuilt by subtraction rather than assembled from the partition,
            // so the batch keeps its original order (the insertion loops walk
            // it) and the exempt re-translations keep their place in it.
            const dropped = new Set(partition.excluded)
            units = guardedUnits.filter(u => !dropped.has(u))
            undeterminedUnits = partition.undetermined
            settleLanguageFilteredContainers(partition.excluded, units)
        }
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
        let indicator: TranslateIndicatorSession | null = null
        // Set when the batch failed and the indicator now owns its markers, so
        // the `finally` below does not take them straight back down again.
        let indicatorFailed = false
        try {
            // Guard the containers, deduplicated — several units may share one.
            for (const container of new Set(units.map(u => u.container))) {
                ignoreElements.push(container)
                ignoreMutationElements.add(container)
            }
            // Started INSIDE the guard on purpose: an inline marker is a real
            // insertion into a translation container, and an unguarded one would
            // queue a mutation that re-scans the very paragraph being
            // translated. (The markers themselves are invisible to segmentation,
            // ranges and serialization — see isTranslateIndicator.)
            indicator = beginTranslateIndicator(units, (retryUnits) => {
                retryTranslateUnits(retryUnits, errorScope)
            })
            let service = translateService
            if (context && typeof context.targetTranslateService === "string" && context.targetTranslateService) {
                service = context.targetTranslateService
                console.log('context.targetTranslateService:', context.targetTranslateService)
            }
            if (service == "") {
                service = TRANSLATE_SERVICE.MICROSOFT
            }

            // SINGLE overwrote the page's own text nodes, so a unit being
            // re-translated cannot be read from the DOM — this is where its
            // source comes from instead. One flat map, since a text node
            // belongs to exactly one unit.
            let sourceTextOf: ((node: Text) => string | undefined) | undefined
            if (replacements) {
                const sourceText = new Map<Text, string>()
                for (const replacement of replacements.values()) {
                    replacement.single?.sourceText?.forEach((content, node) => sourceText.set(node, content))
                }
                if (sourceText.size > 0) sourceTextOf = (node) => sourceText.get(node)
            }

            // "Do not translate these languages", pass 2: the provider's word
            // on the paragraphs franc could not name.
            //
            // Google / Microsoft / DeepL report a source language per text, so
            // their own reply answers and nothing extra is sent. Everyone else
            // (Yandex answers per batch, the AI providers not at all) gets a
            // Microsoft detect fired CONCURRENTLY with the translation — the
            // texts are captured here, before any write-back touches them.
            const filterLanguages = noTranslateLanguageFilterApplies(errorScope)
            const companionUnits = filterLanguages && needsCompanionDetect(service)
                ? undeterminedUnits
                : []
            const [translateResults, companionLangs] = await Promise.all([
                getTranslateResult(service, units, targetLanguage, viewStrategyCopy, controller?.signal, sourceTextOf),
                companionUnits.length > 0
                    ? detectTextsLanguages(companionUnits.map(unitSourceText), controller?.signal)
                    : Promise.resolve<string[]>([]),
            ])
            if (!translateResults || translateResults.length === 0) {
                return
            }

            if (filterLanguages) {
                const companionLangOf = new Map<TranslationUnit, string>()
                companionUnits.forEach((unit, i) => companionLangOf.set(unit, companionLangs[i] ?? ""))
                const excluded: TranslationUnit[] = []
                for (let i = translateResults.length - 1; i >= 0; i--) {
                    const result = translateResults[i]
                    const unit = result.unit
                    // Re-translations stay exempt on this side too, for the same
                    // reason they were exempt from the local pass.
                    if (!unit || replacements?.has(unit)) continue
                    // On the per-text path the reply carries an answer for
                    // EVERY unit, including ones franc already cleared — it is
                    // free and better informed, so it wins over the local guess
                    // (and replaces it in the memo).
                    const lang = needsCompanionDetect(service) ? companionLangOf.get(unit) : result.sourceLang
                    if (!rejectByDetectedLanguage(unitSourceText(unit), lang, noTranslateLanguages)) continue
                    excluded.push(unit)
                    translateResults.splice(i, 1)
                }
                settleLanguageFilteredContainers(
                    excluded,
                    translateResults.map(r => r.unit).filter((u): u is TranslationUnit => !!u),
                )
                if (translateResults.length === 0) {
                    return
                }
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

            // SINGLE is about to overwrite these nodes, so this is the last
            // moment their source content exists anywhere. For a unit that is
            // itself a re-translation the live content is already ours — the
            // resolver, not the DOM, is the source of truth.
            const sourceBefore = new Map<Text, string>()
            if (viewStrategyCopy == VIEW_STRATEGY.SINGLE) {
                for (const result of translateResults) {
                    result.textNodes?.forEach(node => {
                        sourceBefore.set(node, sourceTextOf?.(node) ?? node.textContent ?? "")
                    })
                }
            }

            // the elements will be replaced(translated) in single view strategy
            // the copy of elements will be replaced(translated) in double view strategy
            await translate(translateService, translateResults)

            // Containers that actually received a translation this round.
            const translatedContainers = new Set<UnitContainer>()

            if (viewStrategyCopy == VIEW_STRATEGY.SINGLE) {
                for (const result of translateResults) {
                    const element = result.unit?.container
                    if (!element) continue
                    // Every node now holding our output, with what it used to
                    // say. Nodes the write-back minted map to "" — they carry
                    // no source but must still be cleared next time round.
                    const sourceText = new Map<Text, string>()
                    result.replacedTextNodes?.forEach(node => {
                        sourceText.set(node, sourceBefore.get(node) ?? "")
                    })
                    result.sourceText = sourceText
                    const superseded = result.unit ? replacements?.get(result.unit)?.single : undefined
                    let elementResults = translatedElementMap.get(element) ?? []
                    if (superseded) elementResults = elementResults.filter(r => r !== superseded)
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
                const resultsByContainer = new Map<UnitContainer, TranslateResult[]>()
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
                        // A unit the page grew: the translation it supersedes
                        // comes down only HERE, with its replacement in hand, so
                        // the page never shows the untranslated original in
                        // between. Before the `next` probe, which would
                        // otherwise read the old pair as "already translated".
                        const superseded = replacements?.get(unit)?.duo
                        if (superseded) dropDuoRecord(element, records, superseded)
                        // Already carries a translation (concurrent round) — skip.
                        // Stepping over our own translating indicator, which is
                        // sitting exactly here while this batch is in flight.
                        const next = siblingSkippingIndicators(lastChild.nextSibling, "next") as HTMLElement | null
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
                        const record: DuoUnitRecord = {
                            range, translation: translatedElement, divide, sentences: null, texts: [],
                            // Captured above, before anything was inserted — the
                            // run's own source nodes, which is what makes this
                            // record findable again on a later scan.
                            covered: originalTextResult.textNodes,
                        }
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
                        // The hover pairing pairs the two sides by index, so
                        // they must carry the same number of segments.
                        // Machine translators keep sentence structure and pass
                        // through unchanged; an AI provider freely merges or
                        // splits sentences, and one mismatched count used to
                        // drop the WHOLE unit's highlighting (the old gate was
                        // strict equality). Mismatched sides are re-segmented
                        // into proportional blocks instead — coarser pairing,
                        // but the highlight survives.
                        const aligned = alignSentenceBlocks(originalSentences, translatedSentences)
                        if (!aligned) continue
                        // Re-apply the minimum to the BLOCK count: when the
                        // model merged the whole paragraph into one sentence,
                        // the alignment collapses to a single block and the
                        // hover would light the entire original and its whole
                        // translation at once — the very bluntness the
                        // min-sentences setting exists to avoid.
                        if (aligned.original.length < bilingualHighlightingMinSentences) continue
                        if (highlightApiSupported) {
                            // Blank segments yield no range, so both arrays are
                            // indexed by non-blank sentence order — equal on
                            // both sides by construction (equal counts in, one
                            // non-blank block out), which is what makes
                            // pairing by index correct.
                            const originalRanges = buildSentenceRanges(originalTextResult.textNodes, aligned.original)
                            const translationRanges = buildSentenceRanges(translatedTextResult.textNodes, aligned.translated)
                            if (originalRanges.length === 0 || translationRanges.length === 0) continue
                            record.sentences = { original: originalRanges, translation: translationRanges }
                            highlightedAny = true
                        } else {
                            // Fallback: wrapping empties the original text nodes,
                            // so back them up first — this is what restore replays.
                            originalTextResult.textNodes.forEach(textNode => {
                                record.texts.push({ text: textNode, content: textNode.textContent })
                            })
                            const spans = wrapTextNode2Span(originalTextResult.textNodes, aligned.original, ignoreMutationElements, sequenceOffset)
                            spans.push(...wrapTextNode2Span(translatedTextResult.textNodes, aligned.translated, ignoreMutationElements, sequenceOffset))
                            sequenceOffset += aligned.original.length
                            if (spans.length > 0) highlightedAny = true
                        }
                    }
                    if (insertedAny) {
                        duoTranslatedElementMap.set(element, records)
                        translatedContainers.add(element)
                    } else if (records.length === 0) {
                        // Every record was superseded and none of the successors
                        // made it in (detached nodes, a dropped echo). Leaving an
                        // empty array behind would read as "this container is
                        // translated" to everything that only asks `has`.
                        duoTranslatedElementMap.delete(element)
                        highlightDisposers.get(element)?.()
                        highlightDisposers.delete(element)
                    }
                    if (highlightedAny) {
                        highlightDisposers.get(element)?.()
                        highlightDisposers.set(element, bindHighlightHandler(element))
                    }
                }
            }

            translatedContainers.forEach((element) => {
                paragraphElementMap.set(element, ELEMENT_STATUS.TRANSLATED)
                unobserveContainer(intersectionObserver, element)
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
            //
            // One case is not a failure at all: the built-in AI model for this
            // language pair is still downloading. Background started it on its
            // own and the page re-translates when it lands, so a bubble here
            // would be alarming and wrong — the progress bar already says it.
            if (!isBuiltinAiModelDownloading(e)) {
                // `silent` while an indicator is up: the marker (or the corner
                // pill) carries the reason and a retry, and its "details"
                // button opens this very payload as the usual bubble. Two
                // copies of one failure would mean dismissing it twice, and
                // dismissing the bubble is what makes the leftover marker read
                // as "still broken".
                const failure = reportRequestError(errorScope, e, {
                    detail: { service: translateService, targetLanguage, units: units.length },
                    silent: translateIndicatorActive(),
                })
                // No payload means the reporter classified this as an abort (or
                // itself failed) — nothing to show, so the markers just go.
                if (failure && indicator) {
                    indicator.fail(failure)
                    indicatorFailed = true
                }
            }
        }
        finally {
            // A batch that failed keeps its markers: they are now the details +
            // retry pair. Everything else — success, abort, an empty result, the
            // model-download bail — takes them down.
            if (!indicatorFailed) indicator?.done()
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
    // composedTarget / deepActiveElement: focus events are composed but their
    // target is retargeted to the shadow host, which is never an input.
    const onFocusIn = (e: FocusEvent) => tryMount(composedTarget(e));
    document.addEventListener("focusin", onFocusIn, true);
    // Seed: the field may already be focused (e.g. an autofocused iframe editor).
    tryMount(deepActiveElement());
    // Disposer: drop the pending focus listener and unmount if already up.
    return () => {
        disposed = true;
        document.removeEventListener("focusin", onFocusIn, true);
        unmount?.();
        unmount = null;
    };
}
//#endregion
