import { Dispatch, SetStateAction, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { autoUpdate } from "@floating-ui/dom";
import {
    AlertCircle,
    LayoutPanelTop,
    Languages,
    Loader2,
    PenLine,
    Settings as SettingsIcon,
    X,
} from "lucide-react";
import { browser } from "wxt/browser";
import {
    ACTION,
    AI_TASK,
    CONFIG_KEY,
    DB_ACTION,
    DEFAULT_VALUE,
    LANGUAGES,
} from "@/main/constants";
import { notifyBackground, sendMessageToBackground } from "@/utils/message";
import { guardExtensionAlive } from "@/main/extensionDisabledNotice";
import type { AiProvider } from "@/main/aiProvider";
import { startAiChatStream } from "@/main/aiClient";
import { buildAiTranslateService, buildServiceOptions, type ServiceOption } from "@/utils/service";
import { getConfig, setConfig } from "@/utils/db";
import { useConfig } from "@/utils/reactiveConfig";
import {
    AiTarget,
    createLastTargetRef,
    isAiWritingTarget,
    startFocusTracker,
} from "./inputDetector";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { keepHostMounted } from "@/main/dom/keepHostMounted";
import { bindThemeToElement } from "@/utils/theme";
import { applyTextToTarget } from "./applyText";
import { DiffView } from "./DiffView";
import { ensureWorkbenchMounted, openWorkbench } from "./workbench";
import { NoProviderNotice } from "./NoProviderNotice";
import { t, useLang } from "./i18n";
import { useCopyFeedback } from "./useCopyFeedback";
import {
    buildTranslateServiceKey,
    parseTranslateServiceKey,
    startTranslate,
    TranslateServiceChoice,
} from "./translateRunner";
import { getElementText } from "@/utils/dom";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";
import { shareConfig } from "../content";

const HOST_ID = "duo-ai-dot-host";

// ---------------------------------------------------------------------------
// Mount entry point — called once from main/content.ts
// ---------------------------------------------------------------------------

export interface MountOptions {
    /** Hostname for domain-disable lookups. */
    domain: string;
}

const AI_WRITING_TAB_ID = 'aiWriting'
const SERVICES_TAB_ID = 'services'

export async function mountAiWritingDot(opts: MountOptions): Promise<() => void> {
    if (document.getElementById(HOST_ID)) return () => { };

    const [globalSwitch, whitelistMode, domainDoc, mode] = await Promise.all([
        getConfig(CONFIG_KEY.AI_WRITING_SWITCH),
        getConfig(CONFIG_KEY.AI_WRITING_WHITELIST_MODE),
        sendMessageToBackground({ action: DB_ACTION.DOMAIN_GET, data: { domain: opts.domain } }),
        getConfig(CONFIG_KEY.AI_DEFAULT_ENHANCE_MODE)
    ]);
    const enabled = globalSwitch === undefined ? !!DEFAULT_VALUE.AI_WRITING_SWITCH : !!globalSwitch;
    if (!enabled) return () => { };
    if (whitelistMode) {
        // Whitelist mode: mount ONLY when domain is explicitly enabled.
        if (!domainDoc?.aiWritingEnabled) return () => { };
    } else {
        // Blacklist mode (default): mount everywhere except disabled domains.
        if (domainDoc?.aiWritingDisabled) return () => { };
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-duo-ai-ui", "");
    document.documentElement.appendChild(host);
    const stopKeepAlive = keepHostMounted(host);
    const shadow = host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    const stopThemeWatch = bindThemeToElement(mount);
    const root = createRoot(mount);
    root.render(<FloatingDotApp domain={opts.domain} taskMode={mode} />);

    ensureWorkbenchMounted();

    return () => {
        stopKeepAlive();
        stopThemeWatch();
        try { root.unmount(); } catch { }
        host.remove();
    };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ResultPanel = null | {
    task: AI_TASK;
    original: string;
    output: string;
    running: boolean;
    error?: string;
    /** Identifier of the service producing this result.
     *  For translate: the same key shape as `buildTranslateServiceKey` returns.
     *  For enhance: the AI provider id. */
    serviceKey: string;
};

function FloatingDotApp({ domain, taskMode }: { domain: string, taskMode: AI_TASK }) {
    // Subscribe to interface-language changes so labels re-render when the
    // user flips the language in Options.
    useLang();
    const [target, setTarget] = useState<AiTarget | null>(null);
    const [visible, setVisible] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [closeMenuOpen, setCloseMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sessionHidden, setSessionHidden] = useState(false);
    const [result, setResult] = useState<ResultPanel>(null);
    // Anchor via `right` (distance from viewport's right edge) so the toolbar
    // grows leftward — keeps the dot pinned even when the toolbar/result
    // panel are wider than the dot itself.
    const [position, setPosition] = useState<{ right: number; top: number }>({ right: -1000, top: -1000 });
    // Flip the result panel BELOW the dot when there isn't enough room above
    // (input near top of viewport). Default: above (the historical layout).
    const [flipResult, setFlipResult] = useState(false);
    // Horizontal shift (in px) applied to the result panel when the
    // dot sits too close to the viewport's left edge — otherwise the
    // panel (which extends leftward from the dot) would clip off-screen.
    // A positive value moves the panel rightward of its default
    // right-aligned position.
    const [resultShiftRight, setResultShiftRight] = useState(0);

    // Preferences — reactive views over config. Editing any of these in Options
    // (or the popup, or this same panel) now updates the dot live via
    // chrome.storage's change event; no reload needed. See utils/reactiveConfig.
    const aiTargetLanguage = useConfig<string>(CONFIG_KEY.AI_TARGET_LANGUAGE);
    const aiTranslateKey = useConfig<string | undefined>(CONFIG_KEY.AI_TRANSLATE_SERVICE);
    // No DEFAULT_VALUE entry: unset means "no provider picked yet", and the
    // resolver below falls back to the first enabled one.
    const aiActiveProviderId = useConfig<string | undefined>(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID);
    const aiProvidersRaw = useConfig<AiProvider[] | undefined>(CONFIG_KEY.AI_PROVIDERS);
    const disabledTranslateServices = useConfig<string[] | undefined>(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES);

    // Derive the translate context synchronously from the raw config above.
    const { enabledTranslateServices, enabledAiProviders, totalAiProviders, activeService } = useMemo(
        () => buildAiTranslateService(aiTranslateKey, aiProvidersRaw, disabledTranslateServices),
        [aiTranslateKey, aiProvidersRaw, disabledTranslateServices],
    );
    const targetLang = aiTargetLanguage || DEFAULT_VALUE.AI_TARGET_LANGUAGE;
    const translateChoice = useMemo<TranslateServiceChoice>(
        () => parseTranslateServiceKey(activeService),
        [activeService],
    );
    const providers = enabledAiProviders;
    const translateServices = enabledTranslateServices;
    const hasConfiguredProviders = totalAiProviders > 0;
    // Resolve the enhance provider with the saved-id → first-enabled fallback.
    const enhanceProviderId = useMemo(
        () => enabledAiProviders.find((p) => p.id === aiActiveProviderId)?.id || enabledAiProviders[0]?.id || "",
        [enabledAiProviders, aiActiveProviderId],
    );

    const lastTargetRef = useMemo(createLastTargetRef, []);
    const containerRef = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<number | null>(null);
    const expandTimer = useRef<number | null>(null);
    const abortRef = useRef<(() => void) | null>(null);
    // Mirror of `target` state for read-only access from long-lived callbacks
    // (focus tracker, hide-timer) that must NOT be in effect deps — otherwise
    // the tracker is torn down and rebuilt on every focus change, losing its
    // internal `current` and silently dropping the next focusout.
    const targetRef = useRef<AiTarget | null>(null);
    // Mirrored UI state so the long-lived hide-timer callback can see the
    // latest values without invalidating the focus tracker effect.
    const settingsOpenRef = useRef(false);
    const closeMenuOpenRef = useRef(false);
    const resultRef = useRef<ResultPanel>(null);
    settingsOpenRef.current = settingsOpen;
    closeMenuOpenRef.current = closeMenuOpen;
    resultRef.current = result;
    const [task, setTask] = useState<AI_TASK>(taskMode);

    // ---- Focus tracking ----------------------------------------------------
    // IMPORTANT: deps must NOT include `target` — the focus tracker keeps its
    // own `current` in a closure, and re-running this effect creates a fresh
    // tracker with `current = null`, which causes the very next focusout to
    // be silently ignored (dot fails to hide). Use targetRef.current to read
    // the live target inside the deferred timer callback instead.
    useEffect(() => {
        if (sessionHidden) return;
        const stop = startFocusTracker({
            onTargetIn(el) {
                if (hideTimer.current !== null) {
                    clearTimeout(hideTimer.current);
                    hideTimer.current = null;
                }
                targetRef.current = el;
                setTarget(el);
                lastTargetRef.set(el);
                setVisible(true);
            },
            onTargetOut(el) {
                if (hideTimer.current !== null) clearTimeout(hideTimer.current);
                hideTimer.current = window.setTimeout(() => {
                    // If a popover or result panel is open, the user has
                    // explicitly engaged with the dot UI — keep it visible
                    // even after the original input loses focus. Closing the
                    // popover (X button / click-away) will re-evaluate.
                    if (settingsOpenRef.current || closeMenuOpenRef.current || resultRef.current) return;
                    const active = document.activeElement;
                    // Focus moved inside our Shadow DOM (e.g. a <select> in the
                    // settings popover that legitimately took focus). From the
                    // outer document `activeElement` is the shadow host —
                    // `containerRef.current.contains(...)` cannot cross the
                    // shadow boundary, so check host identity explicitly.
                    const rootNode = containerRef.current?.getRootNode();
                    const shadowHost = rootNode instanceof ShadowRoot ? rootNode.host : null;
                    if (active && active === shadowHost) return;
                    if (active && containerRef.current?.contains(active)) return;
                    if (isAiWritingTarget(active as Element)) return;
                    setVisible(false);
                    setExpanded(false);
                    setCloseMenuOpen(false);
                    setSettingsOpen(false);
                    setResult((r) => (r?.running ? r : null));
                    if (el === targetRef.current) {
                        targetRef.current = null;
                        setTarget(null);
                    }
                }, 200);
            },
        });
        return stop;
    }, [sessionHidden, lastTargetRef]);

    // ---- Anchoring -----------------------------------------------------
    // Two placement modes for the dot:
    //   * SINGLE-LINE — for <input> and short <textarea>: dot sits INSIDE
    //     the input but offset from the right edge to reserve room for
    //     native trailing widgets (clear button, mic, voice, search icon).
    //   * MULTI-LINE — for tall textarea / contentEditable: dot sits in
    //     the bottom-right corner of the input (4px inset).
    //
    // The container anchors via `right` (distance from viewport's right
    // edge) so the toolbar expands leftward and the result panel can
    // grow leftward without pushing the dot. The result panel flips
    // above/below based on vertical space (`flipResult`) and shifts
    // right when the dot is too close to the viewport's left edge
    // (`resultShiftRight`).
    useEffect(() => {
        if (!target || !visible) return;
        const reference = target;
        const update = () => {
            const el = containerRef.current;
            if (!el) return;
            const inputRect = reference.getBoundingClientRect();
            const cRect = el.getBoundingClientRect();
            const isSingleLine = reference.tagName === "INPUT" ||
                (reference.tagName === "TEXTAREA" && inputRect.height < 60);

            let right: number;
            let top: number;
            if (isSingleLine) {
                // Reserve ~28px on the input's far right for native clear
                // buttons / mic / voice icons. Dot's right edge sits at
                // inputRect.right - CLEAR_RESERVE.
                const CLEAR_RESERVE = 28;
                right = window.innerWidth - (inputRect.right - CLEAR_RESERVE);
                // Center vertically within the input.
                top = inputRect.top + (inputRect.height - cRect.height) / 2;
            } else {
                const INSET = 4;
                right = window.innerWidth - (inputRect.right - INSET);
                top = inputRect.bottom - cRect.height - INSET;
            }

            setPosition({ right, top });

            // Vertical flip: when the dot sits closer than the result
            // panel's max footprint to the viewport top, render the
            // panel below the dot instead of above.
            const RESULT_MAX_H = 340;
            setFlipResult(top < RESULT_MAX_H);

            // Horizontal shift: by default the result panel is
            // right-aligned with the dot and extends leftward. If
            // doing so would clip the panel off the left of the
            // viewport, slide the panel rightward (out from under
            // the dot) until its left edge fits with an 8px margin.
            const RESULT_W = 360;
            const MARGIN = 8;
            const dotRightX = window.innerWidth - right;
            const panelLeftX = dotRightX - RESULT_W;
            const overflowLeft = MARGIN - panelLeftX;
            setResultShiftRight(overflowLeft > 0 ? overflowLeft : 0);
        };
        const cleanup = autoUpdate(reference, containerRef.current!, update, {
            elementResize: true,
            ancestorScroll: true,
        });
        return cleanup;
    }, [target, visible, expanded, result, settingsOpen]);

    // Collapse the expanded toolbar (and close any open popover) when the user
    // clicks fully OUTSIDE the dot UI — e.g. back into the page's input box.
    // Without this, clicking into a valid AI-writing input while the Settings
    // popover is open closes the popover (via its own click-away) but leaves
    // the toolbar expanded: maybeHideAfterPopoverClose bails on the
    // `isAiWritingTarget(active)` guard before reaching setExpanded(false), so
    // the dot never collapses. Clicks INSIDE the container (the X button,
    // switching toolbar buttons) include the container in their composed path
    // and are intentionally left alone here.
    useEffect(() => {
        if (!expanded) return;
        const onDown = (e: MouseEvent) => {
            const container = containerRef.current;
            if (!container) return;
            if (e.composedPath().includes(container)) return;
            // Keep the panel while a result is being shown — the result bubble
            // is a sibling of the toolbar and manages its own dismissal.
            if (resultRef.current) return;
            setExpanded(false);
            setSettingsOpen(false);
            setCloseMenuOpen(false);
        };
        const id = window.setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [expanded]);

    // Re-evaluate visibility after a popover/result closes. If focus is no
    // longer on a valid AI target (and not on our own UI), hide the dot.
    const maybeHideAfterPopoverClose = () => {
        if (settingsOpenRef.current || closeMenuOpenRef.current || resultRef.current) return;
        const active = document.activeElement;
        const rootNode = containerRef.current?.getRootNode();
        const shadowHost = rootNode instanceof ShadowRoot ? rootNode.host : null;
        if (active && active === shadowHost) return;
        if (active && containerRef.current?.contains(active)) return;
        if (isAiWritingTarget(active as Element)) return;
        setVisible(false);
        setExpanded(false);
        targetRef.current = null;
        setTarget(null);
    };

    // ---- Hover-to-expand ---------------------------------------------------
    const onMouseEnter = () => {
        if (hideTimer.current !== null) {
            clearTimeout(hideTimer.current);
            hideTimer.current = null;
        }
        if (expandTimer.current !== null) clearTimeout(expandTimer.current);
        expandTimer.current = window.setTimeout(() => setExpanded(true), 150);
    };
    const onMouseLeave = () => {
        if (expandTimer.current !== null) clearTimeout(expandTimer.current);
        if (!result && !closeMenuOpen && !settingsOpen) {
            expandTimer.current = window.setTimeout(() => setExpanded(false), 200);
        }
    };

    // ---- Helpers -----------------------------------------------------------
    const getText = (): string => {
        const el = lastTargetRef.get() ?? target;
        if (!el) return "";
        return getElementText(el);
    };

    // These write config only — the reactive `useConfig` views above re-render
    // the panel when the change lands back through chrome.storage. The
    // `shareConfig` mirror stays until content.ts adopts the reactive store, so
    // the page-translation pipeline keeps seeing the latest AI-writing choice.
    const persistTargetLang = async (v: string) => {
        await setConfig(CONFIG_KEY.AI_TARGET_LANGUAGE, v);
        shareConfig.aiTargetLanguage = v;
    };
    const persistTranslateChoice = async (c: TranslateServiceChoice) => {
        await setConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE, buildTranslateServiceKey(c));
        shareConfig.aiTranslateServiceChoice = c;
    };
    const persistEnhanceProvider = async (id: string) => {
        await setConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID, id);
    };

    // ---- Run a task --------------------------------------------------------
    const runTranslate = async (overrideChoice?: TranslateServiceChoice, overrideLang?: string) => {
        // The dot outlives the extension being disabled/updated — the content
        // script is never unloaded — so every action re-checks before it touches
        // anything backed by chrome.*.
        if (!guardExtensionAlive()) return;
        const original = getText();
        if (!original.trim()) return;
        const choice = overrideChoice ?? translateChoice;
        const lang = overrideLang ?? targetLang;
        // Abort any in-flight stream from a prior run.
        if (abortRef.current) { abortRef.current(); abortRef.current = null; }
        setExpanded(true);
        setResult({
            task: AI_TASK.TRANSLATE,
            original,
            output: "",
            running: true,
            serviceKey: buildTranslateServiceKey(choice),
        });
        const { stream, abort } = startTranslate(original, lang, choice);
        abortRef.current = abort;
        try {
            for await (const delta of stream) {
                setResult((r) => (r ? { ...r, output: r.output + delta } : r));
            }
            setResult((r) => (r ? { ...r, running: false } : r));
        } catch (e: any) {
            setResult((r) => (r ? { ...r, running: false, error: e?.message || String(e) } : r));
            // `silent`: the result card above already shows this reason right
            // next to the input the user is looking at. A page-level bubble
            // would be the same error twice, in two places, each needing its
            // own dismissal.
            reportRequestError(ERROR_SCOPE.AI_WRITING, e, {
                silent: true,
                detail: { task: AI_TASK.TRANSLATE, service: buildTranslateServiceKey(choice), lang },
            });
        } finally {
            abortRef.current = null;
        }
    };

    const runEnhance = async (mode: AI_TASK, overrideProviderId?: string) => {
        if (!guardExtensionAlive()) return;
        const original = getText();
        if (!original.trim()) return;
        const providerId = overrideProviderId ?? enhanceProviderId;
        if (abortRef.current) { abortRef.current(); abortRef.current = null; }
        setExpanded(true);

        // No AI configured? Show empty-state and stop.
        if (providers.length === 0 || !providerId) {
            setResult({
                task: mode, original, output: "", running: false,
                error: "__NO_PROVIDER__", serviceKey: providerId || "",
            });
            return;
        }

        setResult({
            task: mode, original, output: "", running: true, serviceKey: providerId,
        });
        // startAiChatStream takes an explicit providerId, so the request is
        // pinned to the provider chosen here rather than the globally active one.
        const { stream, abort } = startAiChatStream({
            task: mode, providerId, payload: { text: original },
        });
        abortRef.current = abort;
        try {
            for await (const delta of stream) {
                setResult((r) => (r ? { ...r, output: r.output + delta } : r));
            }
            setResult((r) => (r ? { ...r, running: false } : r));
        } catch (e: any) {
            setResult((r) => (r ? { ...r, running: false, error: e?.message || String(e) } : r));
            // `silent` for the same reason as runTranslate above — the result
            // card renders `result.error` inline.
            reportRequestError(ERROR_SCOPE.AI_WRITING, e, {
                silent: true,
                detail: { task: mode, providerId },
            });
        } finally {
            abortRef.current = null;
        }
    };

    const apply = async () => {
        if (!result) return;
        const el = lastTargetRef.get();
        if (await applyTextToTarget(el, result.output)) setResult(null);
    };

    const onWorkbench = () => {
        if (!guardExtensionAlive()) return;
        const el = lastTargetRef.get() ?? target;
        openWorkbench({ text: getText(), targetEl: el });
        setExpanded(false);
    };

    const openOptions = (tab: string) => {
        if (!guardExtensionAlive()) return;
        notifyBackground({ action: ACTION.OPEN_OPTIONS_PAGE, data: { tab: tab } });
    };

    // ---- Settings popover change handlers ----------------------------------
    const onPickTranslateService = async (key: string) => {
        if (!guardExtensionAlive()) return;
        const c = parseTranslateServiceKey(key);
        await persistTranslateChoice(c);
        // If a translate result is currently shown, re-run with the new choice
        // for instant feedback (matches Better-Writing behavior).
        if (result?.task === AI_TASK.TRANSLATE) {
            await runTranslate(c, undefined);
        }
    };
    const onPickEnhanceProvider = async (id: string) => {
        if (!guardExtensionAlive()) return;
        await persistEnhanceProvider(id);
        // Mirror translate behavior: if an enhance result is open, re-run.
        if (result && result.task !== AI_TASK.TRANSLATE) {
            await runEnhance(result.task, id);
        }
    };
    const onPickTargetLang = async (lang: string) => {
        if (!guardExtensionAlive()) return;
        await persistTargetLang(lang);
        if (result?.task === AI_TASK.TRANSLATE) {
            await runTranslate(undefined, lang);
        }
    };

    // ---- Popover / menu toggles --------------------------------------------
    // Neither menu is worth opening once the extension is gone: every choice
    // they offer needs storage. Go straight to the notice instead. Closing an
    // already-open one is local state, so it stays allowed — the menu can have
    // been opened while the extension was still alive.
    const onCloseMenuToggle = () => {
        if (!closeMenuOpen && !guardExtensionAlive()) return;
        setCloseMenuOpen((v) => !v);
    };
    const onSettingsToggle = () => {
        if (!settingsOpen && !guardExtensionAlive()) return;
        setSettingsOpen((v) => !v);
    };

    // ---- Close menu --------------------------------------------------------
    const handleCloseChoice = async (choice: "session" | "site" | "forever") => {
        setCloseMenuOpen(false);
        setExpanded(false);
        setVisible(false);
        // "Hide until reload" is pure local state, so it keeps working; the two
        // persisted choices need storage and must report instead of failing mute.
        if (choice !== "session" && !guardExtensionAlive()) return;
        if (choice === "session") {
            setSessionHidden(true);
        } else if (choice === "site") {
            // Whitelist mode: "Disable on this site" means "remove from
            // whitelist" (clear aiWritingEnabled). Blacklist mode (default):
            // add to disabled list (set aiWritingDisabled=true).
            const whitelistMode = await getConfig(CONFIG_KEY.AI_WRITING_WHITELIST_MODE);
            if (whitelistMode) {
                await sendMessageToBackground({
                    action: DB_ACTION.DOMAIN_DELETE,
                    data: { domain, field: 'aiWritingEnabled' },
                });
            } else {
                await sendMessageToBackground({
                    action: DB_ACTION.DOMAIN_UPSERT,
                    data: { domain, aiWritingDisabled: true },
                });
            }
            setSessionHidden(true);
        } else if (choice === "forever") {
            await setConfig(CONFIG_KEY.AI_WRITING_SWITCH, false);
            setSessionHidden(true);
        }
    };

    if (sessionHidden || !visible) return null;

    const currentEnhanceProvider = providers.find((p) => p.id === enhanceProviderId);
    // Flat (ungrouped) translate-with options shared by the settings popover
    // and result bubble — translators + AI providers, same shape as the popup.
    const serviceOptions = buildServiceOptions(translateServices, providers);

    // Block focus theft from the user's input on ANY mousedown within our
    // UI — clicking on plain <div>s (panel body, header text, content area)
    // would otherwise move focus to <body>, fire focusout on the input,
    // start the hide timer, and make the panel vanish mid-interaction.
    // Form controls (select, input, textarea) are exempt so they can still
    // receive focus and work normally.
    const onPanelMouseDown = (e: React.MouseEvent) => {
        const t = e.target as HTMLElement;
        if (t && t.matches && t.matches("select, option, input, textarea, [contenteditable=true]")) return;
        e.preventDefault();
    };

    return (
        <div
            ref={containerRef}
            style={{
                position: "fixed",
                right: position.right,
                top: position.top,
                zIndex: 2147483600,
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onMouseDown={onPanelMouseDown}
            data-duo-ai-ui=""
        >
            <div className="relative inline-flex flex-col items-end pointer-events-auto">
                {result && (
                    <div
                        className={`absolute ${flipResult ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}
                        style={{ right: -resultShiftRight }}
                    >
                        <ResultBubble
                            result={result}
                            providers={providers}
                            hasConfiguredProviders={hasConfiguredProviders}
                            serviceOptions={serviceOptions}
                            currentEnhanceProvider={currentEnhanceProvider}
                            targetLang={targetLang}
                            translateKey={buildTranslateServiceKey(translateChoice)}
                            onApply={apply}
                            onClose={() => { setResult(null); resultRef.current = null; maybeHideAfterPopoverClose(); }}
                            onStop={() => { abortRef.current?.(); }}
                            onSwitchEnhanceProvider={onPickEnhanceProvider}
                            onSwitchMode={(mode) => runEnhance(mode)}
                            onSwitchLang={onPickTargetLang}
                            onSwitchTranslate={onPickTranslateService}
                            onOpenOptions={openOptions}
                            setTask={setTask}
                        />
                    </div>
                )}

                <div className="flex items-center gap-1">
                    {expanded ? (
                        // Layout: left→right is Close, Settings, Workbench,
                        // Better writing, Translate. Symmetric `p-1` padding
                        // (Translate's right inset == Close's left inset).
                        // The collapsed dot below carries an `mr-1` margin so
                        // its center sits exactly on Translate's center —
                        // hovering the dot lands the cursor on Translate.
                        <div className="flex items-center gap-1 rounded-full bg-surface/95 border border-line-strong shadow-[0_4px_18px_rgba(0,0,0,0.35)] backdrop-blur-md p-1">
                            <div className="relative">
                                <ToolBtn
                                    label={t("aiClose", "Close")}
                                    onClick={onCloseMenuToggle}
                                    icon={<X className="h-3.5 w-3.5" />}
                                />
                                {closeMenuOpen && (
                                    <CloseMenu
                                        onPick={handleCloseChoice}
                                        onClose={() => {
                                            setCloseMenuOpen(false);
                                            closeMenuOpenRef.current = false;
                                            maybeHideAfterPopoverClose();
                                        }}
                                    />
                                )}
                            </div>
                            <div className="relative">
                                <ToolBtn
                                    label={t("aiSettings", "Settings")}
                                    onClick={onSettingsToggle}
                                    icon={<SettingsIcon className="h-3.5 w-3.5" />}
                                />
                                {settingsOpen && (
                                    <SettingsPopover
                                        targetLang={targetLang}
                                        translateKey={buildTranslateServiceKey(translateChoice)}
                                        enhanceProviderId={enhanceProviderId}
                                        providers={providers}
                                        hasConfiguredProviders={hasConfiguredProviders}
                                        serviceOptions={serviceOptions}
                                        onPickLang={onPickTargetLang}
                                        onPickTranslate={onPickTranslateService}
                                        onPickEnhance={onPickEnhanceProvider}
                                        onClose={() => {
                                            setSettingsOpen(false);
                                            settingsOpenRef.current = false;
                                            maybeHideAfterPopoverClose();
                                        }}
                                        onOpenOptions={openOptions}
                                    />
                                )}
                            </div>
                            <ToolBtn
                                label={t("aiWorkbench", "Workbench")}
                                onClick={onWorkbench}
                                icon={<LayoutPanelTop className="h-3.5 w-3.5" />}
                            />
                            <ToolBtn
                                label={t("aiBetterWriting", "Better writing")}
                                onClick={() => runEnhance(task)}
                                icon={<PenLine className="h-3.5 w-3.5" />}
                            />
                            <ToolBtn
                                label={t("aiTranslate", "Translate")}
                                onClick={() => runTranslate()}
                                icon={<Languages className="h-3.5 w-3.5" />}
                            />
                        </div>
                    ) : (
                        <button
                            type="button"
                            aria-label={t("aiWriting", "AI Writing")}
                            onClick={() => setExpanded(true)}
                            onMouseDown={(e) => e.preventDefault()}
                            // Hit area matches the toolbar Translate button
                            // (h-7 w-7). The `mr-1` margin offsets the dot
                            // 4px from the column edge so it lines up with
                            // Translate's center (inside the toolbar's p-1
                            // right padding). Cursor stays on Translate when
                            // the toolbar expands.
                            className="h-7 w-7 mr-1 inline-flex items-center justify-center group"
                        >
                            <span className="h-3.5 w-3.5 rounded-full bg-accent/70 group-hover:bg-accent shadow-[0_0_10px_rgba(70,210,230,0.55)] transition-all" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ToolBtn({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            // Prevent the button from stealing focus from the user's input —
            // otherwise focusout fires on the input and the hide-timer kicks
            // in, making the toolbar vanish mid-click.
            onMouseDown={(e) => e.preventDefault()}
            title={label}
            aria-label={label}
            className="h-7 w-7 inline-flex items-center justify-center rounded-full text-ink hover:bg-hover-4 hover:text-accent"
        >
            {icon}
        </button>
    );
}

function CloseMenu({ onPick, onClose }: { onPick: (c: "session" | "site" | "forever") => void; onClose: () => void }) {
    useLang();
    // Flip above the trigger when default (below) placement would overflow
    // the viewport bottom — same logic as SettingsPopover.
    const ref = useRef<HTMLDivElement>(null);
    const [placeAbove, setPlaceAbove] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const overflowBottom = rect.bottom > window.innerHeight - 8;
        if (overflowBottom && rect.height + 8 < rect.top) setPlaceAbove(true);
    }, []);
    // Click-away — same shadow-aware logic as SettingsPopover.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const popover = ref.current;
            if (!popover) return;
            const path = e.composedPath();
            if (path.includes(popover)) return;
            const wrapper = popover.parentElement;
            if (wrapper && path.includes(wrapper)) return;
            onClose();
        };
        const id = setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [onClose]);
    return (
        <div
            ref={ref}
            className={`absolute right-0 min-w-[230px] rounded-md bg-surface border border-line-strong shadow-[0_8px_24px_rgba(0,0,0,0.5)] py-1 z-10 ${placeAbove ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
            <div className="flex items-center justify-between px-3 pb-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    {t("disableAIWriting", "Disable AI writing")}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label={t("aiCloseResult", "Close")}
                    className="h-5 w-5 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-2"
                >
                    <X className="h-3 w-3" />
                </button>
            </div>
            <MenuItem onClick={() => onPick("session")} label={t("aiCloseTemporary", "Hide until reload")} />
            <MenuItem onClick={() => onPick("site")} label={t("aiCloseThisSite", "Disable on this site")} />
            <MenuItem onClick={() => onPick("forever")} label={t("aiClosePermanently", "Disable everywhere")} danger />
        </div>
    );
}
function MenuItem({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseDown={(e) => e.preventDefault()}
            className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-hover-2 ${danger ? "text-danger-ink hover:text-danger-ink-2" : "text-ink"}`}
        >
            {label}
        </button>
    );
}

function SettingsPopover({
    targetLang,
    translateKey,
    enhanceProviderId,
    providers,
    hasConfiguredProviders,
    serviceOptions,
    onPickLang,
    onPickTranslate,
    onPickEnhance,
    onClose,
    onOpenOptions,
}: {
    targetLang: string;
    translateKey: string;
    enhanceProviderId: string;
    providers: AiProvider[];
    hasConfiguredProviders: boolean;
    serviceOptions: ServiceOption[];
    onPickLang: (v: string) => void;
    onPickTranslate: (v: string) => void;
    onPickEnhance: (v: string) => void;
    onClose: () => void;
    onOpenOptions: (tab: string) => void;
}) {
    useLang();
    // Click-away — track mousedowns outside the popover.
    // NOTE: we live inside a Shadow DOM, so events that bubble to `document`
    // are retargeted to the shadow host — `e.target` is no longer the actual
    // clicked element and `.contains()` always returns false. Use
    // `composedPath()` to inspect the real path through the shadow boundary.
    // Also exclude clicks on the trigger button (which sits in the same
    // `.relative` wrapper as the popover) — otherwise a 2nd click on the
    // trigger first closes here, then the trigger's onClick toggles back
    // open, making the popover impossible to dismiss via the button.
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const popover = ref.current;
            if (!popover) return;
            const path = e.composedPath();
            if (path.includes(popover)) return;
            const wrapper = popover.parentElement;
            if (wrapper && path.includes(wrapper)) return;
            onClose();
        };
        const id = setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [onClose]);

    // Flip above the trigger when default (below) placement overflows the
    // viewport bottom — common when the focused input sits near the bottom.
    const [placeAbove, setPlaceAbove] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const overflowBottom = rect.bottom > window.innerHeight - 8;
        if (overflowBottom && rect.height + 8 < rect.top) setPlaceAbove(true);
    }, []);

    return (
        <div
            ref={ref}
            className={`absolute right-0 w-[280px] rounded-md bg-surface border border-line-strong shadow-[0_8px_24px_rgba(0,0,0,0.5)] p-3 z-10 flex flex-col gap-2.5 ${placeAbove ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
            <div className="flex items-center justify-between -mb-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    {t("aiSettings", "Settings")}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label={t("aiCloseResult", "Close")}
                    className="h-5 w-5 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-2"
                >
                    <X className="h-3 w-3" />
                </button>
            </div>

            <Field label={t("aiBetterWritingWith", "Better writing with")}>
                {providers.length === 0 ? (
                    <NoProviderNotice
                        boxed
                        hasConfigured={hasConfiguredProviders}
                        onConfigure={() => onOpenOptions(SERVICES_TAB_ID)}
                    />
                ) : (
                    <select
                        value={enhanceProviderId}
                        onChange={(e) => onPickEnhance(e.target.value)}
                        className="h-7 w-full rounded bg-bg border border-line-strong text-[12px] text-ink px-1.5"
                    >
                        {providers.map((p) => (
                            <option key={p.id} value={p.id}>{p.getTitle()}</option>
                        ))}
                    </select>
                )}
            </Field>

            <Field label={t("aiTargetLang", "Target language")}>
                <select
                    value={targetLang}
                    onChange={(e) => onPickLang(e.target.value)}
                    className="h-7 w-full rounded bg-bg border border-line-strong text-[12px] text-ink px-1.5"
                >
                    {LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>{t(l.title, l.title)}</option>
                    ))}
                </select>
            </Field>

            <Field label={t("aiTranslateWith", "Translate with")}>
                <select
                    value={translateKey}
                    onChange={(e) => onPickTranslate(e.target.value)}
                    className="h-7 w-full rounded bg-bg border border-line-strong text-[12px] text-ink px-1.5"
                >
                    {serviceOptions.map((s) => (
                        <option key={s.value} value={s.value}>
                            {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                        </option>
                    ))}
                </select>
            </Field>

            <button
                type="button"
                onClick={() => onOpenOptions(AI_WRITING_TAB_ID)}
                className="self-end text-[11px] text-ink-soft hover:text-accent"
            >
                {t("aiOpenAiSettings", "Open AI settings →")}
            </button>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">{label}</label>
            {children}
        </div>
    );
}

const ENHANCE_MODES: AI_TASK[] = [AI_TASK.GRAMMAR, AI_TASK.POLISH, AI_TASK.FORMAL, AI_TASK.CASUAL];

function ResultBubble({
    result,
    providers,
    hasConfiguredProviders,
    serviceOptions,
    currentEnhanceProvider,
    targetLang,
    translateKey,
    onApply, onClose, onStop,
    onSwitchEnhanceProvider,
    onSwitchMode,
    onSwitchLang,
    onSwitchTranslate,
    onOpenOptions,
    setTask
}: {
    result: NonNullable<ResultPanel>;
    providers: AiProvider[];
    hasConfiguredProviders: boolean;
    serviceOptions: ServiceOption[];
    currentEnhanceProvider: AiProvider | undefined;
    targetLang: string;
    translateKey: string;
    onApply: () => void;
    onClose: () => void;
    onStop: () => void;
    onSwitchEnhanceProvider: (id: string) => void;
    onSwitchMode: (mode: AI_TASK) => void;
    onSwitchLang: (lang: string) => void;
    onSwitchTranslate: (key: string) => void;
    onOpenOptions: (tab: string) => void;
    setTask: Dispatch<SetStateAction<AI_TASK>>;
}) {
    useLang();
    const [copied, copy] = useCopyFeedback();
    const isTranslate = result.task === AI_TASK.TRANSLATE;
    const isNoProvider = result.error === "__NO_PROVIDER__";
    const showDiff = !isTranslate && result.output.length > 0;

    // Compact dark select — explicit `<option>` bg so platforms (notably
    // Windows/Linux) don't render a white dropdown that hides the text.
    const selectCls = "h-5 min-w-0 max-w-[150px] rounded bg-surface border border-line-strong text-[10.5px] text-ink px-1 truncate";
    const optionCls = "bg-surface text-ink";

    return (
        <div className="w-[360px] max-w-[80vw] max-h-[320px] flex flex-col rounded-lg bg-surface/95 border border-line-strong shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-md overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-line gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    {isTranslate ? (
                        <>
                            <select
                                value={targetLang}
                                onChange={(e) => onSwitchLang(e.target.value)}
                                title={t("aiTargetLang", "Target language")}
                                className={selectCls + " w-[90px] shrink-0"}
                            >
                                {LANGUAGES.map((l) => (
                                    <option key={l.value} value={l.value} className={optionCls}>{t(l.title, l.title)}</option>
                                ))}
                            </select>
                            <select
                                value={translateKey}
                                onChange={(e) => onSwitchTranslate(e.target.value)}
                                title={t("aiTranslateWith", "Translate with")}
                                className={selectCls}
                            >
                                {serviceOptions.map((s) => (
                                    <option key={s.value} value={s.value} className={optionCls}>
                                        {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                                    </option>
                                ))}
                            </select>
                        </>
                    ) : (
                        <>
                            <select
                                value={result.task}
                                onChange={(e) => {
                                    let task = e.target.value as AI_TASK
                                    setTask(task)
                                    onSwitchMode(task)
                                }}
                                title={t("aiBetterWritingWith", "Better writing with")}
                                className={selectCls + " max-w-[90px]"}
                                disabled={isNoProvider}
                            >
                                {ENHANCE_MODES.map((m) => (
                                    <option key={m} value={m} className={optionCls}>{labelForTask(m)}</option>
                                ))}
                            </select>
                            {!isNoProvider && providers.length > 0 && (
                                <select
                                    value={currentEnhanceProvider?.id || ""}
                                    onChange={(e) => onSwitchEnhanceProvider(e.target.value)}
                                    title={t("aiSwitchProvider", "Switch AI provider")}
                                    className={selectCls}
                                >
                                    {providers.map((p) => (
                                        <option key={p.id} value={p.id} className={optionCls}>{p.getTitle()}</option>
                                    ))}
                                </select>
                            )}
                        </>
                    )}
                    {result.running && <Loader2 className="h-3 w-3 animate-spin text-ink-soft shrink-0" />}
                </div>
                <div className="flex items-center gap-1">
                    {result.running && (
                        <button
                            type="button"
                            onClick={onStop}
                            onMouseDown={(e) => e.preventDefault()}
                            className="h-5 px-1.5 text-[10px] rounded text-ink-soft hover:text-danger-ink hover:bg-danger-soft"
                        >{t("aiStop", "Stop")}</button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        onMouseDown={(e) => e.preventDefault()}
                        className="h-5 w-5 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-2"
                        aria-label={t("aiCloseResult", "Close result")}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-2.5 py-2 text-[13px] leading-[1.45] text-ink whitespace-pre-wrap break-words">
                {isNoProvider ? (
                    <NoProviderNotice
                        hasConfigured={hasConfiguredProviders}
                        onConfigure={() => onOpenOptions(SERVICES_TAB_ID)}
                    />
                ) : result.error ? (
                    <span className="inline-flex items-center gap-1 text-danger-ink">
                        <AlertCircle className="h-3.5 w-3.5" /> {result.error}
                    </span>
                ) : showDiff ? (
                    <DiffView original={result.original} rewritten={result.output} compact />
                ) : (
                    result.output
                )}
            </div>

            {!isNoProvider && (
                <div className="flex items-center justify-end gap-1.5 px-2.5 py-1.5 border-t border-line bg-bg-deep">
                    <button
                        type="button"
                        onClick={() => copy(result.output)}
                        onMouseDown={(e) => e.preventDefault()}
                        disabled={!result.output}
                        className="h-6 px-2 rounded-md border border-line-strong text-[11px] text-ink hover:border-accent disabled:opacity-40"
                    >{copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}</button>
                    <button
                        type="button"
                        onClick={onApply}
                        onMouseDown={(e) => e.preventDefault()}
                        disabled={!result.output || result.running}
                        className="duo-ai-primary h-6 px-2.5 rounded-md text-[11px]"
                    >{t("aiApply", "Apply")}</button>
                </div>
            )}
        </div>
    );
}

function labelForTask(task: AI_TASK): string | undefined {
    switch (task) {
        case AI_TASK.TRANSLATE: return t("aiTranslate", "Translate");
        case AI_TASK.GRAMMAR: return t("aiGrammar", "Grammar fix");
        case AI_TASK.POLISH: return t("aiPolish", "Polish");
        case AI_TASK.FORMAL: return t("aiFormal", "Formal");
        case AI_TASK.CASUAL: return t("aiCasual", "Casual");
        case AI_TASK.CUSTOM: return t("aiBetterWriting", "Custom");
    }
}
