import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Copy, CornerDownLeft, Eraser, Loader2, Maximize2, Minimize2, Sparkles, StopCircle, X } from "lucide-react";
import {
    ACTION,
    AI_TASK,
    CONFIG_KEY,
    DEFAULT_VALUE,
    LANGUAGES,
    browserTargetLanguage,
    type TranslateServiceMeta,
} from "@/main/constants";
import type { AiProvider } from "@/main/aiProvider";
import { startAiChatStream } from "@/main/aiClient";
import { buildServiceOptions, getAiTranslateService } from "@/utils/service";
import { getConfig, setConfig } from "@/utils/db";
import { notifyBackground } from "@/utils/message";
import { guardExtensionAlive } from "@/main/extensionDisabledNotice";
import { applyTextToTarget, canApplyToTarget } from "./applyText";
import { DiffView } from "./DiffView";
import {
    buildTranslateServiceKey,
    parseTranslateServiceKey,
    startTranslate,
    type TranslateServiceChoice,
} from "./translateRunner";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { attachOwnShadow } from "@/main/dom/shadowRoots";
import { keepHostMounted } from "@/main/dom/keepHostMounted";
import { bindThemeToElement } from "@/utils/theme";
import { NoProviderNotice } from "./NoProviderNotice";
import { t, useLang } from "./i18n";
import { useCopyFeedback } from "./useCopyFeedback";
import { useSlot, useSlots } from "./streamSlots";
import { BidirectionalMode, asWritingTask, type FocusPaneId } from "./bidirectional/BidirectionalMode";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";

// ---------------------------------------------------------------------------
// Singleton mount
// ---------------------------------------------------------------------------

const HOST_ID = "duo-ai-workbench-host";
let workbenchRoot: Root | null = null;
let openSignal: ((seed: WorkbenchSeed) => void) | null = null;
let stopKeepAlive: (() => void) | null = null;
let stopThemeWatch: (() => void) | null = null;

export interface WorkbenchSeed {
    text: string;
    task?: AI_TASK;
    targetEl?: HTMLElement | null;
}

export function ensureWorkbenchMounted(): void {
    if (workbenchRoot) return;
    let host = document.getElementById(HOST_ID) as HTMLElement | null;
    if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-ai-ui", "");
        document.documentElement.appendChild(host);
    }
    stopKeepAlive?.();
    stopKeepAlive = keepHostMounted(host);
    const shadow = attachOwnShadow(host);
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    stopThemeWatch?.();
    stopThemeWatch = bindThemeToElement(mount);
    workbenchRoot = createRoot(mount);
    workbenchRoot.render(
        <WorkbenchApp
            registerOpen={(fn) => {
                openSignal = fn;
            }}
        />,
    );
}

/**
 * Tear down the workbench singleton — unmount the React root, drop the Shadow
 * host, and clear module state so a later `ensureWorkbenchMounted` re-mounts
 * cleanly. Called from content.ts `unload()` on global-switch off.
 */
export function destroyWorkbench(): void {
    stopKeepAlive?.();
    stopKeepAlive = null;
    stopThemeWatch?.();
    stopThemeWatch = null;
    try { workbenchRoot?.unmount(); } catch { }
    workbenchRoot = null;
    openSignal = null;
    document.getElementById(HOST_ID)?.remove();
}

export function openWorkbench(seed: WorkbenchSeed): void {
    ensureWorkbenchMounted();
    // openSignal is set synchronously by initial render via useEffect on the
    // first paint — we may be called before that completes, so retry briefly.
    let tries = 0;
    const tick = () => {
        if (openSignal) {
            openSignal(seed);
            return;
        }
        if (tries++ < 20) setTimeout(tick, 30);
    };
    tick();
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

/** `单栏` (existing single-column workbench) vs `双向` (read/reply workbench). */
type WorkbenchMode = "single" | "bidirectional";

// Window sizing (A). The default is roomier than the old fixed 720×480 /
// 900×560 and is clamped to the viewport on open so a small window still fits.
const DEFAULT_SIZE = { w: 1080, h: 720 };
const MIN_SIZE = { w: 640, h: 420 };
/** Margin kept around the dialog when maximizing, and when clamping to viewport. */
const VIEWPORT_MARGIN = 20;
/** The header stays reachable near the viewport edges while dragging. */
const DRAG_KEEP_X = 200;
const DRAG_KEEP_Y = 40;

function clampSize(w: number, h: number): { w: number; h: number } {
    const maxW = Math.max(MIN_SIZE.w, window.innerWidth - VIEWPORT_MARGIN * 2);
    const maxH = Math.max(MIN_SIZE.h, window.innerHeight - VIEWPORT_MARGIN * 2);
    return {
        w: Math.round(Math.min(Math.max(w, MIN_SIZE.w), maxW)),
        h: Math.round(Math.min(Math.max(h, MIN_SIZE.h), maxH)),
    };
}

/**
 * Per-box "clear" button, shared by the single column. Input boxes clear
 * through the same handler the textarea uses so derived panes still reset;
 * result boxes go through `slots.reset`, which stops a live stream too.
 */
function ClearButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!!disabled}
            title={t("aiClear", "Clear")}
            aria-label={t("aiClear", "Clear")}
            className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded border border-line-strong text-ink hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
            <Eraser className="h-3 w-3" />
        </button>
    );
}

const TASK_OPTIONS: { value: AI_TASK; labelKey: string; fallback: string }[] = [
    { value: AI_TASK.GRAMMAR, labelKey: "aiGrammar", fallback: "Grammar fix" },
    { value: AI_TASK.POLISH, labelKey: "aiPolish", fallback: "Polish" },
    { value: AI_TASK.FORMAL, labelKey: "aiFormal", fallback: "Formal" },
    { value: AI_TASK.CASUAL, labelKey: "aiCasual", fallback: "Casual" },
    { value: AI_TASK.TRANSLATE, labelKey: "aiTranslate", fallback: "Translate" },
];

function WorkbenchApp({ registerOpen }: { registerOpen: (fn: (s: WorkbenchSeed) => void) => void }) {
    // Subscribe so labels swap when the user changes interface language.
    useLang();
    // Slot-level streaming state. The single-column workbench is just the
    // `result` slot; 双向 adds mailTranslation / replyRewrite / replyTranslation,
    // each with its own running/error/output/abort (design §6).
    const slots = useSlots();
    const result = useSlot(slots, "result");

    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<WorkbenchMode>("single");
    const [input, setInput] = useState("");
    // 双向 ① / ③ live here (not inside BidirectionalMode) so switching
    // single ⇄ bidirectional doesn't throw away what the user typed.
    const [mailOriginal, setMailOriginal] = useState("");
    const [myReply, setMyReply] = useState("");
    const [task, setTask] = useState<AI_TASK>(AI_TASK.POLISH);
    // 双向 ③ default task — mirrors Options › "Default enhance mode".
    const [writingTask, setWritingTask] = useState<AI_TASK>(AI_TASK.POLISH);
    // Single-column translate target. Shares its config key with 双向's 对方语言.
    const [targetLang, setTargetLang] = useState<string>(DEFAULT_VALUE.AI_TARGET_LANGUAGE);
    // 双向 ② target = 我的语言. Its own config key (AI_MY_LANGUAGE) that
    // *follows* the page-translation target by default but never writes to it,
    // so the two settings stay independent once the user overrides either.
    const [myLang, setMyLang] = useState<string>(() => browserTargetLanguage());
    const [copied, copy] = useCopyFeedback();
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    // Window sizing (A). `size` drives the dialog width/height; `maximized`
    // temporarily overrides it to fill the viewport without losing `size`;
    // `focusPane` (B) is owned here so Esc can unfocus before it closes.
    const [size, setSize] = useState(DEFAULT_SIZE);
    const [maximized, setMaximized] = useState(false);
    const [focusPane, setFocusPane] = useState<FocusPaneId | null>(null);
    // Service selection — translate routes through a translator/AI provider,
    // enhance routes through an AI provider (the "model").
    const [providers, setProviders] = useState<AiProvider[]>([]);
    const [hasConfiguredProviders, setHasConfiguredProviders] = useState(false);
    const [translateServices, setTranslateServices] = useState<TranslateServiceMeta[]>([]);
    const [translateChoice, setTranslateChoice] = useState<TranslateServiceChoice>({
        kind: "trans", service: String(DEFAULT_VALUE.AI_TRANSLATE_SERVICE),
    });
    const [enhanceProviderId, setEnhanceProviderId] = useState<string>("");
    const targetRef = useRef<HTMLElement | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        registerOpen((seed) => {
            // Fresh session: drop anything the previous visit left streaming.
            slots.stopAll();
            slots.reset("result");
            slots.reset("mailTranslation");
            slots.reset("replyRewrite");
            slots.reset("replyTranslation");
            setOpen(true);
            setInput(seed.text || "");
            // The seed (the input box's current text) is a *draft reply*, so it
            // lands in ③. ① stays empty for the incoming message to be pasted.
            setMailOriginal("");
            setMyReply(seed.text || "");
            if (seed.task) setTask(seed.task);
            targetRef.current = seed.targetEl ?? null;
            // Reset window state on every open (A/B): a fresh default size
            // clamped to the viewport, no stale maximize, no focused pane.
            setMaximized(false);
            setFocusPane(null);
            const s = clampSize(DEFAULT_SIZE.w, DEFAULT_SIZE.h);
            setSize(s);
            setPos({
                x: Math.max(VIEWPORT_MARGIN, Math.round((window.innerWidth - s.w) / 2)),
                y: Math.max(VIEWPORT_MARGIN, Math.round((window.innerHeight - s.h) / 2)),
            });
            // Hydrate selections from saved config on each open so the
            // workbench mirrors the floating dot's remembered choices.
            (async () => {
                const [lang, transKey, activeId, mode, myLangSaved, pageLang] = await Promise.all([
                    getConfig(CONFIG_KEY.AI_TARGET_LANGUAGE),
                    getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
                    getConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID),
                    getConfig(CONFIG_KEY.AI_DEFAULT_ENHANCE_MODE),
                    getConfig(CONFIG_KEY.AI_MY_LANGUAGE),
                    getConfig(CONFIG_KEY.TARGET_LANGUAGE),
                ]);
                if (typeof lang === "string" && lang) setTargetLang(lang);
                // 我的语言: own key first, then follow the page-translation
                // target, then the browser UI language. Reading the page key
                // as a fallback is one-way — we never write it back.
                setMyLang(
                    typeof myLangSaved === "string" && myLangSaved
                        ? myLangSaved
                        : typeof pageLang === "string" && pageLang
                            ? pageLang
                            : browserTargetLanguage(),
                );
                // Shared loader: enabled translators + enabled AI providers, plus
                // the resolved active translate service (same logic the popup uses).
                const { activeService, enabledTranslateServices, enabledAiProviders, totalAiProviders } =
                    await getAiTranslateService(transKey);
                setTranslateServices(enabledTranslateServices);
                setProviders(enabledAiProviders);
                setHasConfiguredProviders(totalAiProviders > 0);
                setTranslateChoice(parseTranslateServiceKey(activeService));
                setEnhanceProviderId(enabledAiProviders.find((p) => p.id === activeId)?.id || enabledAiProviders[0]?.id || "");
                setTask(mode as AI_TASK);
                setWritingTask(asWritingTask(mode));
            })();
        });
    }, [registerOpen, slots]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                // B: a focused pane is the innermost layer — Esc backs out of
                // it first, and only a second Esc closes the workbench.
                if (focusPane !== null) {
                    e.preventDefault();
                    setFocusPane(null);
                    return;
                }
                close();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open, focusPane]);

    const close = () => {
        slots.stopAll();
        setFocusPane(null);
        setOpen(false);
    };

    const reportRunError = (error: unknown) => {
        // `silent`: the workbench renders `error` in its own body. Console
        // only, so the reason survives closing the modal.
        reportRequestError(ERROR_SCOPE.AI_WRITING, error, {
            silent: true,
            detail: {
                task,
                service: task === AI_TASK.TRANSLATE
                    ? buildTranslateServiceKey(translateChoice)
                    : enhanceProviderId,
            },
        });
    };

    const run = () => {
        // The workbench outlives the extension being disabled/updated — the
        // content script is never unloaded — so Run re-checks before it opens a
        // port to a background that no longer exists.
        if (!guardExtensionAlive()) return;
        if (!input.trim() || result.running) return;
        // Translate ignores the view; enhance defaults to Diff.
        slots.setView("result", task === AI_TASK.TRANSLATE ? "text" : "diff");
        // Freeze the original for the diff so later edits to the left pane
        // don't retroactively change this run's diff.
        slots.setBase("result", input);

        if (task === AI_TASK.TRANSLATE) {
            void slots.run("result", () => startTranslate(input, targetLang, translateChoice), reportRunError);
            return;
        }
        // Enhance needs an AI provider (the chosen model).
        if (providers.length === 0 || !enhanceProviderId) {
            slots.setError("result", t("aiNoProviderShort", "Configure a provider in Options → AI Writing first."));
            return;
        }
        void slots.run("result", () => startAiChatStream({
            task,
            providerId: enhanceProviderId,
            payload: { text: input },
        }), reportRunError);
    };

    // Switching the task starts a fresh, independent result — drop whatever
    // the previous task produced so a stale diff/translation isn't shown.
    const onChangeTask = (next: AI_TASK) => {
        if (next === task) return;
        slots.reset("result");
        slots.setView("result", next === AI_TASK.TRANSLATE ? "text" : "diff");
        setTask(next);
    };

    // Persist + apply service selection (mirrors the floating dot).
    const onPickTranslateService = (key: string) => {
        if (!guardExtensionAlive()) return;
        const c = parseTranslateServiceKey(key);
        setTranslateChoice(c);
        setConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE, buildTranslateServiceKey(c));
    };
    const onPickEnhanceProvider = (id: string) => {
        if (!guardExtensionAlive()) return;
        setEnhanceProviderId(id);
        setConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID, id);
    };
    // 双向 toolbar language pair. 我的语言 has its own key and is NOT written
    // to TARGET_LANGUAGE, so picking it here leaves page translation alone.
    const onPickMyLang = (value: string) => {
        setMyLang(value);
        if (guardExtensionAlive()) setConfig(CONFIG_KEY.AI_MY_LANGUAGE, value);
    };
    const onPickPeerLang = (value: string) => {
        setTargetLang(value);
        if (guardExtensionAlive()) setConfig(CONFIG_KEY.AI_TARGET_LANGUAGE, value);
    };

    // Editing ① / ③ invalidates the derived translation next to it — ② / ④
    // are functions of the text on their left, so keep them from going stale.
    const onChangeMailOriginal = (value: string) => {
        setMailOriginal(value);
        slots.reset("mailTranslation");
    };
    const onChangeMyReply = (value: string) => {
        setMyReply(value);
        slots.reset("replyTranslation");
    };

    const stop = () => slots.stop("result");

    const apply = async () => {
        const ok = await applyTextToTarget(targetRef.current, result.output);
        if (ok) close();
    };

    // Drag handling. A maximized dialog is pinned to the viewport, so its
    // header is not draggable until the user restores it.
    const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
    const onHeaderMouseDown = (e: React.MouseEvent) => {
        if (maximized) return;
        dragRef.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y };
        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const { startX, startY, ox, oy } = dragRef.current;
            setPos({
                x: Math.max(0, Math.min(window.innerWidth - DRAG_KEEP_X, ox + ev.clientX - startX)),
                y: Math.max(0, Math.min(window.innerHeight - DRAG_KEEP_Y, oy + ev.clientY - startY)),
            });
        };
        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    // A: bottom-right resize handle. Mirrors the header drag (window-level
    // move/up listeners) and clamps to the viewport; disabled while maximized.
    const onResizeMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (maximized) return;
        const start = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
        const onMove = (ev: MouseEvent) => {
            setSize(clampSize(start.w + ev.clientX - start.x, start.h + ev.clientY - start.y));
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const toggleMaximize = () => setMaximized((v) => !v);

    if (!open) return null;

    const bidirectional = mode === "bidirectional";
    const showDiffToggle = !bidirectional && task !== AI_TASK.TRANSLATE && result.output.length > 0;

    return (
        <>
            {/* Backdrop — light click-shield, NOT a full overlay (we want page
                still legible underneath; user dismisses via Esc or × button). */}
            <div
                style={{
                    position: "fixed", inset: 0,
                    background: "var(--color-backdrop)", zIndex: 2147483646,
                }}
                onMouseDown={close}
            />
            <div
                ref={dialogRef}
                className="bg-surface border border-line-strong rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
                style={maximized
                    ? {
                        position: "fixed",
                        left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN,
                        right: VIEWPORT_MARGIN, bottom: VIEWPORT_MARGIN,
                        zIndex: 2147483647,
                    }
                    : {
                        position: "fixed",
                        left: pos.x, top: pos.y,
                        width: size.w,
                        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
                        height: size.h,
                        maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
                        zIndex: 2147483647,
                    }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between px-3 py-2 border-b border-line-mid cursor-move select-none bg-surface-2"
                    onMouseDown={onHeaderMouseDown}
                >
                    <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.1em] text-ink-soft">
                        <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.8} />
                        {t("aiWorkbenchTitle", "AI Writing Workbench")}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* A: maximize / restore. Sits to the left of × and
                            stops propagation so it never starts a header drag. */}
                        <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); toggleMaximize(); }}
                            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-2 text-ink-soft"
                            title={maximized ? t("aiRestore", "Restore") : t("aiMaximize", "Maximize")}
                            aria-label={maximized ? t("aiRestore", "Restore") : t("aiMaximize", "Maximize")}
                        >
                            {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={close}
                            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-2 text-ink-soft"
                            aria-label={t("aiClose", "Close")}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
                    <div className="inline-flex overflow-hidden rounded-md border border-line-strong">
                        <button
                            type="button"
                            onClick={() => setMode("single")}
                            className={`h-7 px-2.5 text-[12px] ${!bidirectional ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                        >
                            {t("aiModeSingle", "Single")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("bidirectional")}
                            className={`h-7 px-2.5 text-[12px] border-l border-line-strong ${bidirectional ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                        >
                            {t("aiModeBidirectional", "Bidirectional")}
                        </button>
                    </div>

                    {bidirectional ? (
                        /* 双向 runs two engines at once, so both are spelled out:
                           the writing service (A) rewrites ③, the translate
                           service (B) drives ② / ④. Each pane owns its own
                           Run/Stop, so there is no global Run button here. */
                        <>
                            <span className="text-[11px] text-ink-mute">
                                {t("aiBetterWritingWith", "Better writing with")}
                            </span>
                            {providers.length > 0 ? (
                                <select
                                    value={enhanceProviderId}
                                    onChange={(e) => onPickEnhanceProvider(e.target.value)}
                                    title={t("aiSwitchProvider", "Switch AI provider")}
                                    className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                                >
                                    {providers.map((p) => (
                                        <option key={p.id} value={p.id}>{p.getTitle()}</option>
                                    ))}
                                </select>
                            ) : (
                                <NoProviderNotice
                                    hasConfigured={hasConfiguredProviders}
                                    onConfigure={() =>
                                        guardExtensionAlive() &&
                                        notifyBackground({ action: ACTION.OPEN_OPTIONS_PAGE, data: { tab: "services" } })
                                    }
                                />
                            )}
                            <span className="text-[11px] text-ink-mute">
                                {t("aiTranslateWith", "Translate with")}
                            </span>
                            <select
                                value={buildTranslateServiceKey(translateChoice)}
                                onChange={(e) => onPickTranslateService(e.target.value)}
                                title={t("aiTranslateWith", "Translate with")}
                                className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                            >
                                {buildServiceOptions(translateServices, providers).map((s) => (
                                    <option key={s.value} value={s.value}>
                                        {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                                    </option>
                                ))}
                            </select>
                        </>
                    ) : (
                        <>
                            <select
                                value={task}
                                onChange={(e) => onChangeTask(e.target.value as AI_TASK)}
                                className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                            >
                                {TASK_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{t(o.labelKey, o.fallback)}</option>
                                ))}
                            </select>
                            {task === AI_TASK.TRANSLATE ? (
                                <>
                                    {/* Translate service: built-in translators + configured AI providers (flat list). */}
                                    <select
                                        value={buildTranslateServiceKey(translateChoice)}
                                        onChange={(e) => onPickTranslateService(e.target.value)}
                                        title={t("aiTranslateWith", "Translate with")}
                                        className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                                    >
                                        {buildServiceOptions(translateServices, providers).map((s) => (
                                            <option key={s.value} value={s.value}>
                                                {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                                            </option>
                                        ))}
                                    </select>
                                    <select
                                        title={t("aiTargetLang", "Translate to")}
                                        value={targetLang}
                                        onChange={(e) => onPickPeerLang(e.target.value)}
                                        className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                                    >
                                        {LANGUAGES.map((l) => (
                                            <option key={l.value} value={l.value}>{t(l.title, l.title)}</option>
                                        ))}
                                    </select>
                                </>
                            ) : (
                                /* Enhance modes: pick the AI provider (model). */
                                providers.length > 0 ? (
                                    <select
                                        value={enhanceProviderId}
                                        onChange={(e) => onPickEnhanceProvider(e.target.value)}
                                        title={t("aiSwitchProvider", "Switch AI provider")}
                                        className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                                    >
                                        {providers.map((p) => (
                                            <option key={p.id} value={p.id}>{p.getTitle()}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <NoProviderNotice
                                        hasConfigured={hasConfiguredProviders}
                                        onConfigure={() =>
                                            guardExtensionAlive() &&
                                            notifyBackground({ action: ACTION.OPEN_OPTIONS_PAGE, data: { tab: "services" } })
                                        }
                                    />
                                )
                            )}
                            <div className="flex-1" />
                            {result.running ? (
                                <button
                                    type="button"
                                    onClick={stop}
                                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-line-strong text-[12px] text-ink hover:border-red-400"
                                >
                                    <StopCircle className="h-3 w-3" /> {t("aiStop", "Stop")}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={run}
                                    disabled={!input.trim()}
                                    className="duo-ai-primary h-7 px-3 inline-flex items-center gap-1 rounded-md text-[12px] shadow-[0_0_14px_rgba(70,210,230,0.4)]"
                                >
                                    <CornerDownLeft className="h-3 w-3" /> {t("aiRun", "Run")}
                                </button>
                            )}
                        </>
                    )}
                </div>

                {bidirectional ? (
                    <BidirectionalMode
                        slots={slots}
                        translateChoice={translateChoice}
                        enhanceProviderId={enhanceProviderId}
                        myLang={myLang}
                        peerLang={targetLang}
                        targetEl={targetRef.current}
                        defaultTask={writingTask}
                        mailOriginal={mailOriginal}
                        onMailOriginalChange={onChangeMailOriginal}
                        myReply={myReply}
                        onMyReplyChange={onChangeMyReply}
                        onMyLangChange={onPickMyLang}
                        onPeerLangChange={onPickPeerLang}
                        focusPane={focusPane}
                        onFocusPaneChange={setFocusPane}
                    />
                ) : (
                    <>
                        {/* Body: input / output two-column */}
                        <div className="flex-1 grid grid-cols-2 gap-0 min-h-0">
                            <div className="flex flex-col min-h-0 border-r border-line">
                                <div className="px-3 py-1.5 flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                                    <span>{t("aiOriginal", "Original")}</span>
                                    <ClearButton onClick={() => { setInput(""); slots.reset("result"); }} disabled={!input} />
                                </div>
                                <textarea
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder={t("aiTypeOrPaste", "Type or paste text...")}
                                    className="flex-1 resize-none bg-bg border-0 outline-none px-3 py-2 text-[13px] leading-[1.5] text-ink placeholder:text-ink-mute"
                                />
                            </div>
                            <div className="flex flex-col min-h-0">
                                <div className="px-3 py-1.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                                    <span>{t("aiResult", "Result")}</span>
                                    {showDiffToggle && (
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => slots.setView("result", "diff")}
                                                className={`px-1.5 py-0.5 rounded ${result.view === "diff" ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                                            >{t("aiViewDiff", "Diff")}</button>
                                            <button
                                                type="button"
                                                onClick={() => slots.setView("result", "text")}
                                                className={`px-1.5 py-0.5 rounded ${result.view === "text" ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                                            >{t("aiViewText", "Text")}</button>
                                        </div>
                                    )}
                                    <ClearButton
                                        onClick={() => slots.reset("result")}
                                        disabled={!result.output && !result.error}
                                    />
                                </div>
                                <div className="flex-1 overflow-auto px-3 py-2 text-[13px] leading-[1.5] text-ink whitespace-pre-wrap break-words">
                                    {result.error ? (
                                        <span className="text-error">{result.error}</span>
                                    ) : result.running && !result.output ? (
                                        <span className="inline-flex items-center gap-1.5 text-ink-soft">
                                            <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
                                        </span>
                                    ) : result.output && result.view === "diff" && task !== AI_TASK.TRANSLATE ? (
                                        <DiffView original={result.base} rewritten={result.output} />
                                    ) : (
                                        result.output
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-line bg-bg-deep">
                            <button
                                type="button"
                                onClick={() => copy(result.output)}
                                disabled={!result.output}
                                className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-line-strong text-[12px] text-ink hover:border-accent disabled:opacity-40"
                            >
                                <Copy className="h-3 w-3" /> {copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                            </button>
                            <button
                                type="button"
                                onClick={apply}
                                disabled={!result.output || !canApplyToTarget(targetRef.current)}
                                title={!canApplyToTarget(targetRef.current) ? t("aiNoEditableTarget", "Place the cursor in an editable input to apply") : undefined}
                                className="duo-ai-primary h-7 px-3 inline-flex items-center gap-1 rounded-md text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {t("aiApplyToInput", "Apply to input")}
                            </button>
                        </div>
                    </>
                )}

                {/* A: bottom-right resize grip. Visual affordance only; the
                    actual drag math lives in onResizeMouseDown, which no-ops
                    while maximized. */}
                {!maximized && (
                    <div
                        onMouseDown={onResizeMouseDown}
                        title={t("aiResize", "Resize")}
                        style={{
                            position: "absolute", right: 0, bottom: 0,
                            width: 16, height: 16, cursor: "nwse-resize",
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.2" opacity="0.45" fill="none" />
                        </svg>
                    </div>
                )}
            </div>
        </>
    );
}
