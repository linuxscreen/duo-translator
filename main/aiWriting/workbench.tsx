import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Copy, CornerDownLeft, Loader2, Sparkles, StopCircle, X } from "lucide-react";
import {
    AI_TASK,
    CONFIG_KEY,
    DEFAULT_VALUE,
    LANGUAGES,
    LANGUAGES_MAP,
} from "@/main/constants";
import { startAiChatStream } from "@/main/aiService";
import { getConfig } from "@/utils/db";
import { applyTextToTarget } from "./applyText";
import { DiffView } from "./DiffView";
import { loadTailwindIntoShadow } from "./shadowStyle";
import { t, useLang } from "./i18n";

// ---------------------------------------------------------------------------
// Singleton mount
// ---------------------------------------------------------------------------

const HOST_ID = "duo-ai-workbench-host";
let workbenchRoot: Root | null = null;
let openSignal: ((seed: WorkbenchSeed) => void) | null = null;

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
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    workbenchRoot = createRoot(mount);
    workbenchRoot.render(
        <WorkbenchApp
            registerOpen={(fn) => {
                openSignal = fn;
            }}
        />,
    );
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
    { value: AI_TASK.GRAMMAR,   labelKey: "aiGrammar",   fallback: "Grammar fix" },
    { value: AI_TASK.POLISH,    labelKey: "aiPolish",    fallback: "Polish" },
    { value: AI_TASK.FORMAL,    labelKey: "aiFormal",    fallback: "Formal" },
    { value: AI_TASK.CASUAL,    labelKey: "aiCasual",    fallback: "Casual" },
    { value: AI_TASK.TRANSLATE, labelKey: "aiTranslate", fallback: "Translate" },
];

function WorkbenchApp({ registerOpen }: { registerOpen: (fn: (s: WorkbenchSeed) => void) => void }) {
    // Subscribe so labels swap when the user changes interface language.
    useLang();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [output, setOutput] = useState("");
    const [task, setTask] = useState<AI_TASK>(AI_TASK.POLISH);
    const [targetLang, setTargetLang] = useState<string>(DEFAULT_VALUE.AI_TARGET_LANG);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<"text" | "diff">("text");
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const targetRef = useRef<HTMLElement | null>(null);
    const abortRef = useRef<(() => void) | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        registerOpen((seed) => {
            setOpen(true);
            setInput(seed.text || "");
            setOutput("");
            setError(null);
            setView("text");
            if (seed.task) setTask(seed.task);
            targetRef.current = seed.targetEl ?? null;
            // Center on viewport on first open.
            const w = 720;
            const h = 480;
            setPos({
                x: Math.max(20, Math.round((window.innerWidth - w) / 2)),
                y: Math.max(20, Math.round((window.innerHeight - h) / 2)),
            });
            // Seed default targetLang from saved config when available.
            getConfig(CONFIG_KEY.AI_TARGET_LANG).then((v) => {
                if (v) setTargetLang(v);
            });
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
        if (!input.trim() || running) return;
        setRunning(true);
        setOutput("");
        setError(null);
        setView("text");
        const { stream, abort } = startAiChatStream({
            task,
            payload: { text: input, lang: targetLang },
        });
        abortRef.current = abort;
        try {
            for await (const delta of stream) {
                setOutput((prev) => prev + delta);
            }
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    const stop = () => {
        if (abortRef.current) abortRef.current();
        abortRef.current = null;
        setRunning(false);
    };

    const apply = () => {
        const ok = applyTextToTarget(targetRef.current, output);
        if (ok) close();
    };

    const copy = async () => {
        try { await navigator.clipboard.writeText(output); } catch { /* ignore */ }
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
                    background: "rgba(2,6,16,0.45)", zIndex: 2147483646,
                }}
                onMouseDown={close}
            />
            <div
                ref={dialogRef}
                className="bg-[#0f1623] border border-[rgba(140,180,230,0.18)] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
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
                    className="flex items-center justify-between px-3 py-2 border-b border-[rgba(140,180,230,0.12)] cursor-move select-none bg-[#141d2e]"
                    onMouseDown={onHeaderMouseDown}
                >
                    <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.1em] text-[#8a93a8]">
                        <Sparkles className="h-3.5 w-3.5 text-[oklch(0.86_0.16_195)]" strokeWidth={1.8} />
                        {t("aiWorkbenchTitle", "AI Writing Workbench")}
                    </div>
                    <button
                        type="button"
                        onClick={close}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-[rgba(120,200,230,0.08)] text-[#8a93a8]"
                        aria-label={t("aiClose", "Close")}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[rgba(140,180,230,0.08)]">
                    <select
                        value={task}
                        onChange={(e) => setTask(e.target.value as AI_TASK)}
                        className="h-7 rounded-md bg-[#0f1623] border border-[rgba(140,180,230,0.18)] text-[12px] text-[#eef1f8] px-2"
                    >
                        {TASK_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{t(o.labelKey, o.fallback)}</option>
                        ))}
                    </select>
                    {task === AI_TASK.TRANSLATE && (
                        <select
                            value={targetLang}
                            onChange={(e) => setTargetLang(e.target.value)}
                            className="h-7 rounded-md bg-[#0f1623] border border-[rgba(140,180,230,0.18)] text-[12px] text-[#eef1f8] px-2"
                        >
                            {LANGUAGES.map((l) => (
                                <option key={l.value} value={l.value}>{t(l.title, l.title)}</option>
                            ))}
                        </select>
                    )}
                    <div className="flex-1" />
                    {running ? (
                        <button
                            type="button"
                            onClick={stop}
                            className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-[rgba(140,180,230,0.18)] text-[12px] text-[#eef1f8] hover:border-red-400"
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
                    <div className="flex flex-col min-h-0 border-r border-[rgba(140,180,230,0.08)]">
                        <div className="px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#545d75]">
                            {t("aiOriginal", "Original")}
                        </div>
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={t("aiTypeOrPaste", "Type or paste text...")}
                            className="flex-1 resize-none bg-[#070b14] border-0 outline-none px-3 py-2 text-[13px] leading-[1.5] text-[#eef1f8] placeholder:text-[#545d75]"
                        />
                    </div>
                    <div className="flex flex-col min-h-0">
                        <div className="px-3 py-1.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#545d75]">
                            <span>{t("aiResult", "Result")}</span>
                            {showDiffToggle && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setView("text")}
                                        className={`px-1.5 py-0.5 rounded ${view === "text" ? "bg-[rgba(120,200,230,0.12)] text-[oklch(0.86_0.16_195)]" : "text-[#8a93a8] hover:bg-[rgba(120,200,230,0.05)]"}`}
                                    >{t("aiViewText", "Text")}</button>
                                    <button
                                        type="button"
                                        onClick={() => setView("diff")}
                                        className={`px-1.5 py-0.5 rounded ${view === "diff" ? "bg-[rgba(120,200,230,0.12)] text-[oklch(0.86_0.16_195)]" : "text-[#8a93a8] hover:bg-[rgba(120,200,230,0.05)]"}`}
                                    >{t("aiViewDiff", "Diff")}</button>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-auto px-3 py-2 text-[13px] leading-[1.5] text-[#eef1f8] whitespace-pre-wrap break-words">
                            {error ? (
                                <span className="text-red-400">{error}</span>
                            ) : running && !output ? (
                                <span className="inline-flex items-center gap-1.5 text-[#8a93a8]">
                                    <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
                                </span>
                            ) : view === "diff" && task !== AI_TASK.TRANSLATE ? (
                                <DiffView original={input} rewritten={output} />
                            ) : (
                                output
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[rgba(140,180,230,0.08)] bg-[#0a111c]">
                    <button
                        type="button"
                        onClick={copy}
                        disabled={!output}
                        className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-[rgba(140,180,230,0.18)] text-[12px] text-[#eef1f8] hover:border-[oklch(0.86_0.16_195)] disabled:opacity-40"
                    >
                        <Copy className="h-3 w-3" /> {t("aiCopy", "Copy")}
                    </button>
                    <button
                        type="button"
                        onClick={apply}
                        disabled={!output || !targetRef.current?.isConnected}
                        title={!targetRef.current?.isConnected ? t("aiOriginalInputGone", "Original input is no longer available") : undefined}
                        className="duo-ai-primary h-7 px-3 inline-flex items-center gap-1 rounded-md text-[12px]"
                    >
                        {t("aiApplyToInput", "Apply to input")}
                    </button>
                </div>
            </div>
        </>
    );
}
