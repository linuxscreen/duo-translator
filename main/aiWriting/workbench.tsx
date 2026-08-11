import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Copy, CornerDownLeft, Loader2, Sparkles, StopCircle, X } from "lucide-react";
import { browser } from "wxt/browser";
import {
    ACTION,
    AI_TASK,
    CONFIG_KEY,
    DEFAULT_VALUE,
    LANGUAGES,
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
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    // Snapshot of the original text at the moment Run was pressed. The diff is
    // computed against this, NOT the live `input`, so editing the original
    // afterward doesn't mutate the already-generated diff until the next Run.
    const [baseText, setBaseText] = useState("");
    const [output, setOutput] = useState("");
    const [task, setTask] = useState<AI_TASK>(AI_TASK.POLISH);
    const [targetLang, setTargetLang] = useState<string>(DEFAULT_VALUE.AI_TARGET_LANGUAGE);
    const [running, setRunning] = useState(false);
    const [copied, copy] = useCopyFeedback();
    const [error, setError] = useState<string | null>(null);
    // Enhance mode defaults to the Diff view (Diff sits before Text in the
    // toggle); translate mode ignores `view` and always renders plain text.
    const [view, setView] = useState<"text" | "diff">("diff");
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
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
    const abortRef = useRef<(() => void) | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        registerOpen((seed) => {
            setOpen(true);
            setInput(seed.text || "");
            setOutput("");
            setError(null);
            setView("diff");
            if (seed.task) setTask(seed.task);
            targetRef.current = seed.targetEl ?? null;
            // Center on viewport on first open.
            const w = 720;
            const h = 480;
            setPos({
                x: Math.max(20, Math.round((window.innerWidth - w) / 2)),
                y: Math.max(20, Math.round((window.innerHeight - h) / 2)),
            });
            // Hydrate selections from saved config on each open so the
            // workbench mirrors the floating dot's remembered choices.
            (async () => {
                const [lang, transKey, activeId, mode] = await Promise.all([
                    getConfig(CONFIG_KEY.AI_TARGET_LANGUAGE),
                    getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
                    getConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID),
                    getConfig(CONFIG_KEY.AI_DEFAULT_ENHANCE_MODE)
                ]);
                if (lang) setTargetLang(lang);
                // Shared loader: enabled translators + enabled AI providers, plus
                // the resolved active translate service (same logic the popup uses).
                const { activeService, enabledTranslateServices, enabledAiProviders, totalAiProviders } =
                    await getAiTranslateService(transKey);
                setTranslateServices(enabledTranslateServices);
                setProviders(enabledAiProviders);
                setHasConfiguredProviders(totalAiProviders > 0);
                setTranslateChoice(parseTranslateServiceKey(activeService));
                setEnhanceProviderId(enabledAiProviders.find((p) => p.id === activeId)?.id || enabledAiProviders[0]?.id || "");
                setTask(mode)
            })();
        });
    }, [registerOpen]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                close();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);

    const close = () => {
        if (abortRef.current) abortRef.current();
        abortRef.current = null;
        setRunning(false);
        setOpen(false);
    };

    const run = async () => {
        // The workbench outlives the extension being disabled/updated — the
        // content script is never unloaded — so Run re-checks before it opens a
        // port to a background that no longer exists.
        if (!guardExtensionAlive()) return;
        if (!input.trim() || running) return;
        // Translate ignores `view`; enhance defaults to Diff.
        setView(task === AI_TASK.TRANSLATE ? "text" : "diff");
        setOutput("");
        setError(null);
        // Freeze the original for the diff so later edits to the left pane
        // don't retroactively change this run's diff.
        setBaseText(input);

        let running$: { stream: AsyncIterable<string>; abort: () => void };
        if (task === AI_TASK.TRANSLATE) {
            running$ = startTranslate(input, targetLang, translateChoice);
        } else {
            // Enhance needs an AI provider (the chosen model).
            if (providers.length === 0 || !enhanceProviderId) {
                setError(t("aiNoProviderShort", "Configure a provider in Options → AI Writing first."));
                return;
            }
            running$ = startAiChatStream({
                task,
                providerId: enhanceProviderId,
                payload: { text: input },
            });
        }
        setRunning(true);
        const { stream, abort } = running$;
        abortRef.current = abort;
        try {
            for await (const delta of stream) {
                setOutput((prev) => prev + delta);
            }
        } catch (e: any) {
            setError(e?.message || String(e));
            // `silent`: the workbench renders `error` in its own body. Console
            // only, so the reason survives closing the modal.
            reportRequestError(ERROR_SCOPE.AI_WRITING, e, {
                silent: true,
                detail: {
                    task,
                    service: task === AI_TASK.TRANSLATE
                        ? buildTranslateServiceKey(translateChoice)
                        : enhanceProviderId,
                },
            });
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    // Switching the task starts a fresh, independent result — drop whatever
    // the previous task produced so a stale diff/translation isn't shown.
    const onChangeTask = (next: AI_TASK) => {
        if (next === task) return;
        if (abortRef.current) { abortRef.current(); abortRef.current = null; }
        setTask(next);
        setOutput("");
        setError(null);
        setRunning(false);
        setView(next === AI_TASK.TRANSLATE ? "text" : "diff");
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

    const stop = () => {
        if (abortRef.current) abortRef.current();
        abortRef.current = null;
        setRunning(false);
    };

    const apply = async () => {
        const ok = await applyTextToTarget(targetRef.current, output);
        if (ok) close();
    };

    // Drag handling.
    const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
    const onHeaderMouseDown = (e: React.MouseEvent) => {
        dragRef.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y };
        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const { startX, startY, ox, oy } = dragRef.current;
            setPos({
                x: Math.max(0, Math.min(window.innerWidth - 200, ox + ev.clientX - startX)),
                y: Math.max(0, Math.min(window.innerHeight - 40, oy + ev.clientY - startY)),
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

    if (!open) return null;

    const showDiffToggle = task !== AI_TASK.TRANSLATE && output.length > 0;

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
                style={{
                    position: "fixed",
                    left: pos.x, top: pos.y,
                    width: 720, maxWidth: "calc(100vw - 40px)",
                    height: 480, maxHeight: "calc(100vh - 40px)",
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
                    <button
                        type="button"
                        onClick={close}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-2 text-ink-soft"
                        aria-label={t("aiClose", "Close")}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
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
                            <select
                                title={t("aiTargetLang", "Translate to")}
                                value={targetLang}
                                onChange={(e) => setTargetLang(e.target.value)}
                                className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                            >
                                {LANGUAGES.map((l) => (
                                    <option key={l.value} value={l.value}>{t(l.title, l.title)}</option>
                                ))}
                            </select>
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
                    {running ? (
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
                </div>

                {/* Body: input / output two-column */}
                <div className="flex-1 grid grid-cols-2 gap-0 min-h-0">
                    <div className="flex flex-col min-h-0 border-r border-line">
                        <div className="px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                            {t("aiOriginal", "Original")}
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
                                        onClick={() => setView("diff")}
                                        className={`px-1.5 py-0.5 rounded ${view === "diff" ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                                    >{t("aiViewDiff", "Diff")}</button>
                                    <button
                                        type="button"
                                        onClick={() => setView("text")}
                                        className={`px-1.5 py-0.5 rounded ${view === "text" ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                                    >{t("aiViewText", "Text")}</button>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-auto px-3 py-2 text-[13px] leading-[1.5] text-ink whitespace-pre-wrap break-words">
                            {error ? (
                                <span className="text-error">{error}</span>
                            ) : running && !output ? (
                                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                                    <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
                                </span>
                            ) : output && view === "diff" && task !== AI_TASK.TRANSLATE ? (
                                <DiffView original={baseText} rewritten={output} />
                            ) : (
                                output
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-line bg-bg-deep">
                    <button
                        type="button"
                        onClick={() => copy(output)}
                        disabled={!output}
                        className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-line-strong text-[12px] text-ink hover:border-accent disabled:opacity-40"
                    >
                        <Copy className="h-3 w-3" /> {copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                    </button>
                    <button
                        type="button"
                        onClick={apply}
                        disabled={!output || !canApplyToTarget(targetRef.current)}
                        title={!canApplyToTarget(targetRef.current) ? t("aiNoEditableTarget", "Place the cursor in an editable input to apply") : undefined}
                        className="duo-ai-primary h-7 px-3 inline-flex items-center gap-1 rounded-md text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t("aiApplyToInput", "Apply to input")}
                    </button>
                </div>
            </div>
        </>
    );
}
