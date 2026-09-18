import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, CornerDownLeft, Eraser, Loader2, Maximize2, Minimize2, StopCircle } from "lucide-react";
import { AI_TASK, LANGUAGES } from "@/main/constants";
import { startAiChatStream } from "@/main/aiClient";
import { AI_MAX_INPUT_CHARS } from "@/main/aiLimits";
import { applyTextToTarget, canApplyToTarget } from "../applyText";
import { DiffView } from "../DiffView";
import { t } from "../i18n";
import { useCopyFeedback } from "../useCopyFeedback";
import { startTranslate, type TranslateServiceChoice } from "../translateRunner";
import { useSlot, type SlotId, type SlotState, type SlotStore } from "../streamSlots";

/**
 * Writing tasks offered by the ③ reply pane. Deliberately excludes
 * `AI_TASK.TRANSLATE`: ③ is the only *writing* slot, and translating is what
 * the ② / ④ slots do (design invariant I1/I2 — translate is translate, write
 * is write).
 */
const WRITING_TASKS: { value: AI_TASK; labelKey: string; fallback: string }[] = [
    { value: AI_TASK.POLISH, labelKey: "aiPolish", fallback: "Polish" },
    { value: AI_TASK.FORMAL, labelKey: "aiFormal", fallback: "Formal" },
    { value: AI_TASK.GRAMMAR, labelKey: "aiGrammar", fallback: "Grammar fix" },
    { value: AI_TASK.CASUAL, labelKey: "aiCasual", fallback: "Casual" },
];

/** Coerce any stored/config value into one of {@link WRITING_TASKS}. */
export function asWritingTask(value: unknown, fallback = AI_TASK.POLISH): AI_TASK {
    return WRITING_TASKS.some((item) => item.value === value) ? (value as AI_TASK) : fallback;
}

/**
 * The four bidirectional panes, in reading order: ① incoming original,
 * ③ my reply, ② incoming translation, ④ reply translation. Pane focus (B) is
 * owned by the workbench so its Esc handler can leave focus before closing
 * the dialog, and so focus never survives a close.
 */
export type FocusPaneId = "mailOriginal" | "myReply" | "mailTranslation" | "replyTranslation";

/** Always-on grid borders per pane (kept in the DOM even while focus hides it). */
const PANE_CLASS: Record<FocusPaneId, string> = {
    mailOriginal: "border-r border-b border-line",
    myReply: "border-b border-line",
    mailTranslation: "border-r border-line",
    replyTranslation: "",
};

/**
 * Every pane keeps its node (and its DOM/scroll/textarea state) mounted; in
 * focus mode the three unfocused ones are merely hidden, so returning to the
 * 2×2 grid never loses what the user typed or where they had scrolled to.
 */
function paneClassName(pane: FocusPaneId, focusPane: FocusPaneId | null): string {
    const hidden = focusPane !== null && focusPane !== pane;
    return `flex flex-col min-h-0 ${PANE_CLASS[pane]}${hidden ? " hidden" : ""}`;
}

interface Props {
    slots: SlotStore;
    translateChoice: TranslateServiceChoice;
    /** Resolved writing provider (model). Empty ⇒ the ③ pane cannot run. */
    enhanceProviderId: string;
    /** Language the incoming message is translated into (② target). */
    myLang: string;
    /** Language the reply is translated into (④ target). */
    peerLang: string;
    targetEl: HTMLElement | null;
    defaultTask: AI_TASK;
    mailOriginal: string;
    onMailOriginalChange: (value: string) => void;
    myReply: string;
    onMyReplyChange: (value: string) => void;
    onMyLangChange: (value: string) => void;
    onPeerLangChange: (value: string) => void;
    /** B: focused pane, or null for the normal 2×2 grid. Owned by the workbench. */
    focusPane: FocusPaneId | null;
    onFocusPaneChange: (pane: FocusPaneId | null) => void;
}

function languageLabel(value: string): string {
    const lang = LANGUAGES.find((item) => item.value === value);
    return lang ? t(lang.title, lang.title) : value;
}

function limitMessage(length: number): string {
    return `${t("aiInputTooLong", "Text too long for one AI request.")} (${length}/${AI_MAX_INPUT_CHARS})`;
}

function PaneHeader({
    title,
    right,
    paneId,
    focusPane,
    onFocusPaneChange,
}: {
    title: string;
    right?: ReactNode;
    /** When set, the header grows a focus toggle (double-click also works). */
    paneId?: FocusPaneId;
    focusPane?: FocusPaneId | null;
    onFocusPaneChange?: (pane: FocusPaneId | null) => void;
}) {
    const focused = paneId !== undefined && focusPane === paneId;
    const toggleFocus = paneId === undefined
        ? undefined
        : () => onFocusPaneChange?.(focused ? null : paneId);
    return (
        <div
            className="px-3 py-1.5 flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute"
            onDoubleClick={toggleFocus}
        >
            <span className="shrink-0">{title}</span>
            <div className="flex items-center gap-1">
                {right}
                {paneId !== undefined && (
                    <button
                        type="button"
                        onClick={toggleFocus}
                        title={focused
                            ? t("aiUnfocusPane", "Exit focus")
                            : t("aiFocusPane", "Focus pane")}
                        aria-label={focused
                            ? t("aiUnfocusPane", "Exit focus")
                            : t("aiFocusPane", "Focus pane")}
                        className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded border border-line-strong text-ink hover:border-accent"
                    >
                        {focused ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                    </button>
                )}
            </div>
        </div>
    );
}

function RunButton({
    running,
    disabled,
    onClick,
    onStop,
    labelKey,
    fallback,
}: {
    running: boolean;
    disabled: boolean;
    onClick: () => void;
    onStop: () => void;
    labelKey: string;
    fallback: string;
}) {
    if (running) {
        return (
            <button
                type="button"
                onClick={onStop}
                className="h-6 px-2 inline-flex items-center gap-1 rounded border border-line-strong text-[11px] text-ink hover:border-red-400"
            >
                <StopCircle className="h-3 w-3" />
                {t("aiStop", "Stop")}
            </button>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="duo-ai-primary h-6 px-2 inline-flex items-center gap-1 rounded text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
        >
            <CornerDownLeft className="h-3 w-3" />
            {t(labelKey, fallback)}
        </button>
    );
}

function ResultBody({
    state,
    diffOriginal,
    showDiff,
}: {
    state: SlotState;
    diffOriginal: string;
    showDiff: boolean;
}) {
    if (state.error) {
        return <span className="text-error">{state.error}</span>;
    }
    if (state.running && !state.output) {
        return (
            <span className="inline-flex items-center gap-1.5 text-ink-soft">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("aiStreaming", "Streaming...")}
            </span>
        );
    }
    if (state.output && showDiff && state.view === "diff") {
        return <DiffView original={diffOriginal} rewritten={state.output} />;
    }
    return state.output;
}

/**
 * Default share of the ③ body handed to the reply editor. The remainder goes
 * to the rewrite result, which used to be squeezed into an even 50/50 split.
 * The divider between the two is draggable, so this is only the opening ratio.
 */
const DEFAULT_REPLY_SPLIT = 0.42;
/** Clamp so neither half of ③ can be dragged away entirely. */
const MIN_REPLY_SPLIT = 0.15;
const MAX_REPLY_SPLIT = 0.85;

/**
 * Per-box "clear" button. Input boxes clear their text through the same
 * handlers the textarea already uses, so the derived panes still reset;
 * result boxes go through `slots.reset`, which also stops an in-flight
 * stream and drops any error from the previous run.
 */
function ClearButton({
    onClick,
    disabled,
}: {
    onClick: () => void;
    disabled?: boolean;
}) {
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

export function BidirectionalMode({
    slots,
    translateChoice,
    enhanceProviderId,
    myLang,
    peerLang,
    targetEl,
    defaultTask,
    mailOriginal,
    onMailOriginalChange,
    myReply,
    onMyReplyChange,
    onMyLangChange,
    onPeerLangChange,
    focusPane,
    onFocusPaneChange,
}: Props) {
    const [task, setTask] = useState<AI_TASK>(() => asWritingTask(defaultTask));
    const [mailCopied, copyMail] = useCopyFeedback();
    const [replyCopied, copyReply] = useCopyFeedback();
    // ③ vertical split between the editor and the rewrite result. Kept in
    // px-free fractional units so it survives both window resize and the focus
    // toggle; the drag handler converts pointer deltas against the live height.
    const [replySplit, setReplySplit] = useState(DEFAULT_REPLY_SPLIT);
    const replyBodyRef = useRef<HTMLDivElement>(null);
    const mailTranslation = useSlot(slots, "mailTranslation");
    const replyRewrite = useSlot(slots, "replyRewrite");
    const replyTranslation = useSlot(slots, "replyTranslation");

    useEffect(() => {
        setTask((current) => (current === defaultTask ? current : asWritingTask(defaultTask)));
    }, [defaultTask]);

    const runTranslation = (slot: SlotId, text: string, targetLang: string) => {
        if (!text.trim()) return;
        if (text.length > AI_MAX_INPUT_CHARS) {
            slots.setError(slot, limitMessage(text.length));
            return;
        }
        void slots.run(slot, () => startTranslate(text, targetLang, translateChoice));
    };

    const runRewrite = () => {
        if (!myReply.trim() || replyRewrite.running) return;
        if (myReply.length > AI_MAX_INPUT_CHARS) {
            slots.setError("replyRewrite", limitMessage(myReply.length));
            return;
        }
        if (!enhanceProviderId) {
            slots.setError("replyRewrite", t("aiNoProviderShort", "Configure a provider in Options → AI Writing first."));
            return;
        }
        slots.setBase("replyRewrite", myReply);
        slots.setView("replyRewrite", "diff");
        void slots.run("replyRewrite", () => startAiChatStream({
            task,
            providerId: enhanceProviderId,
            payload: { text: myReply },
        }));
    };

    // ③ split drag. Fraction-based so it survives a window resize; clamped so
    // neither the editor nor the rewrite result can be collapsed to nothing.
    const onReplySplitMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const box = replyBodyRef.current;
        if (!box) return;
        const rect = box.getBoundingClientRect();
        if (rect.height <= 0) return;
        const onMove = (ev: MouseEvent) => {
            const ratio = (ev.clientY - rect.top) / rect.height;
            setReplySplit(Math.min(MAX_REPLY_SPLIT, Math.max(MIN_REPLY_SPLIT, ratio)));
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    // ③ 【采纳】: fold the rewrite back into the editor so the next task runs
    // on it (otherwise a second task would re-run against the pre-rewrite text).
    const acceptRewrite = () => {
        if (!replyRewrite.output) return;
        onMyReplyChange(replyRewrite.output);
        slots.reset("replyRewrite");
    };

    const applyReplyTranslation = async () => {
        if (!replyTranslation.output) return;
        await applyTextToTarget(targetEl, replyTranslation.output);
    };

    // ③ only splits once a rewrite exists; before that the editor owns the pane.
    const hasRewrite = !!(replyRewrite.output || replyRewrite.running || replyRewrite.error);
    const mailTargetLang = languageLabel(myLang);
    const replyTargetLang = languageLabel(peerLang);
    const canApply = canApplyToTarget(targetEl);

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* Language pair: 我的语言 reads the incoming mail, 对方语言 writes
                the reply. Each has its own config key — 我的语言 never writes
                the page-translation target, so the two stay independent. */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-surface-2">
                <span className="text-[11px] text-ink-mute">{t("aiMailLang", "Languages")}</span>
                <select
                    value={myLang}
                    onChange={(e) => onMyLangChange(e.target.value)}
                    title={t("aiMyLanguage", "My language")}
                    className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                >
                    {LANGUAGES.map((item) => (
                        <option key={item.value} value={item.value}>{t(item.title, item.title)}</option>
                    ))}
                </select>
                <span className="text-ink-mute">↔</span>
                <select
                    value={peerLang}
                    onChange={(e) => onPeerLangChange(e.target.value)}
                    title={t("aiPeerLanguage", "Recipient language")}
                    className="h-7 rounded-md bg-surface border border-line-strong text-[12px] text-ink px-2"
                >
                    {LANGUAGES.map((item) => (
                        <option key={item.value} value={item.value}>{t(item.title, item.title)}</option>
                    ))}
                </select>
                <div className="flex-1" />
                <span className="text-[11px] text-ink-mute">
                    {mailTargetLang} → {replyTargetLang}
                </span>
            </div>

            <div
                className={`flex-1 min-h-0 grid ${focusPane === null ? "grid-cols-2 grid-rows-2" : "grid-cols-1 grid-rows-1"}`}
            >
                {/* ① Incoming original */}
                <div className={paneClassName("mailOriginal", focusPane)}>
                    <PaneHeader
                        title={t("aiMailOriginal", "Incoming message")}
                        paneId="mailOriginal"
                        focusPane={focusPane}
                        onFocusPaneChange={onFocusPaneChange}
                        right={<ClearButton onClick={() => onMailOriginalChange("")} disabled={!mailOriginal} />}
                    />
                    <textarea
                        value={mailOriginal}
                        onChange={(e) => onMailOriginalChange(e.target.value)}
                        placeholder={t("aiTypeOrPaste", "Type or paste text...")}
                        className="flex-1 min-h-0 resize-none bg-bg border-0 outline-none px-3 py-2 text-[13px] leading-[1.5] text-ink placeholder:text-ink-mute"
                    />
                </div>

                {/* ③ My reply: editor + writing task + rewrite result/diff */}
                <div className={paneClassName("myReply", focusPane)}>
                    <PaneHeader
                        title={t("aiMyReply", "My reply")}
                        paneId="myReply"
                        focusPane={focusPane}
                        onFocusPaneChange={onFocusPaneChange}
                        right={(
                            <div className="flex items-center gap-1">
                                <select
                                    value={task}
                                    onChange={(e) => {
                                        slots.reset("replyRewrite");
                                        setTask(e.target.value as AI_TASK);
                                    }}
                                    className="h-6 rounded bg-surface border border-line-strong text-[11px] text-ink px-1.5"
                                >
                                    {WRITING_TASKS.map((item) => (
                                        <option key={item.value} value={item.value}>
                                            {t(item.labelKey, item.fallback)}
                                        </option>
                                    ))}
                                </select>
                                <RunButton
                                    running={replyRewrite.running}
                                    disabled={!myReply.trim()}
                                    onClick={runRewrite}
                                    onStop={() => slots.stop("replyRewrite")}
                                    labelKey="aiRun"
                                    fallback="Run"
                                />
                                <ClearButton
                                    onClick={() => {
                                        onMyReplyChange("");
                                        slots.reset("replyRewrite");
                                    }}
                                    disabled={!myReply && !replyRewrite.output && !replyRewrite.error}
                                />
                            </div>
                        )}
                    />
                    {/* Editor and rewrite result share ③ by an explicit fraction
                        rather than an even flex-1 split, so the rewrite box gets
                        real height; the divider between them is draggable. */}
                    <div ref={replyBodyRef} className="flex-1 min-h-0 flex flex-col">
                        <textarea
                            value={myReply}
                            onChange={(e) => onMyReplyChange(e.target.value)}
                            placeholder={t("aiTypeOrPaste", "Type or paste text...")}
                            style={hasRewrite ? { flexBasis: `${replySplit * 100}%` } : undefined}
                            className={`min-h-0 resize-none bg-bg border-0 outline-none px-3 py-2 text-[13px] leading-[1.5] text-ink placeholder:text-ink-mute ${hasRewrite ? "grow-0 shrink-0" : "flex-1"}`}
                        />
                        {hasRewrite && (
                            <div
                                onMouseDown={onReplySplitMouseDown}
                                title={t("aiResize", "Resize")}
                                className="h-1.5 shrink-0 cursor-row-resize bg-line hover:bg-accent"
                            />
                        )}
                        {hasRewrite && (
                            <div className="min-h-0 flex-1 flex flex-col">
                                <PaneHeader
                                    title={t("aiRewrite", "Rewrite")}
                                    right={(
                                        <div className="flex items-center gap-1">
                                            {replyRewrite.output.length > 0 && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => slots.setView("replyRewrite", "diff")}
                                                        className={`px-1.5 py-0.5 rounded ${replyRewrite.view === "diff" ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                                                    >
                                                        {t("aiViewDiff", "Diff")}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => slots.setView("replyRewrite", "text")}
                                                        className={`px-1.5 py-0.5 rounded ${replyRewrite.view === "text" ? "bg-hover-4 text-accent" : "text-ink-soft hover:bg-hover"}`}
                                                    >
                                                        {t("aiViewText", "Text")}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={acceptRewrite}
                                                        className="h-6 px-2 rounded border border-line-strong text-[11px] text-ink hover:border-accent"
                                                    >
                                                        {t("aiAccept", "Accept")}
                                                    </button>
                                                </>
                                            )}
                                            <ClearButton
                                                onClick={() => slots.reset("replyRewrite")}
                                                disabled={!replyRewrite.output && !replyRewrite.error}
                                            />
                                        </div>
                                    )}
                                />
                                <div className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[13px] leading-[1.5] text-ink whitespace-pre-wrap break-words">
                                    <ResultBody
                                        state={replyRewrite}
                                        diffOriginal={replyRewrite.base}
                                        showDiff
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ② Incoming translation — read direction */}
                <div className={paneClassName("mailTranslation", focusPane)}>
                    <PaneHeader
                        title={t("aiMailTranslation", "Incoming translation")}
                        paneId="mailTranslation"
                        focusPane={focusPane}
                        onFocusPaneChange={onFocusPaneChange}
                        right={(
                            <div className="flex items-center gap-1">
                                <span className="normal-case tracking-normal text-[10px] text-ink-mute">→ {mailTargetLang}</span>
                                <RunButton
                                    running={mailTranslation.running}
                                    disabled={!mailOriginal.trim()}
                                    onClick={() => runTranslation("mailTranslation", mailOriginal, myLang)}
                                    onStop={() => slots.stop("mailTranslation")}
                                    labelKey="aiTranslate"
                                    fallback="Translate"
                                />
                                <button
                                    type="button"
                                    onClick={() => copyMail(mailTranslation.output)}
                                    disabled={!mailTranslation.output}
                                    title={t("aiCopy", "Copy")}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-line-strong text-ink hover:border-accent disabled:opacity-40"
                                >
                                    <Copy className="h-3 w-3" />
                                </button>
                                <ClearButton
                                    onClick={() => slots.reset("mailTranslation")}
                                    disabled={!mailTranslation.output && !mailTranslation.error}
                                />
                            </div>
                        )}
                    />
                    <div className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[13px] leading-[1.5] text-ink whitespace-pre-wrap break-words">
                        {mailCopied && <span className="mr-2 text-[11px] text-accent">{t("aiCopied", "Copied")}</span>}
                        <ResultBody state={mailTranslation} diffOriginal="" showDiff={false} />
                    </div>
                </div>

                {/* ④ Reply translation — write direction */}
                <div className={paneClassName("replyTranslation", focusPane)}>
                    <PaneHeader
                        title={t("aiReplyTranslation", "Reply translation")}
                        paneId="replyTranslation"
                        focusPane={focusPane}
                        onFocusPaneChange={onFocusPaneChange}
                        right={(
                            <div className="flex items-center gap-1">
                                <span className="normal-case tracking-normal text-[10px] text-ink-mute">→ {replyTargetLang}</span>
                                <RunButton
                                    running={replyTranslation.running}
                                    disabled={!myReply.trim()}
                                    onClick={() => runTranslation("replyTranslation", myReply, peerLang)}
                                    onStop={() => slots.stop("replyTranslation")}
                                    labelKey="aiTranslateReply"
                                    fallback="Translate reply"
                                />
                                <button
                                    type="button"
                                    onClick={() => copyReply(replyTranslation.output)}
                                    disabled={!replyTranslation.output}
                                    title={t("aiCopy", "Copy")}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-line-strong text-ink hover:border-accent disabled:opacity-40"
                                >
                                    <Copy className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void applyReplyTranslation()}
                                    disabled={!replyTranslation.output || !canApply}
                                    title={canApply
                                        ? t("aiApplyToInput", "Apply to input")
                                        : t("aiNoEditableTarget", "Place the cursor in an editable input to apply")}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-line-strong text-ink hover:border-accent disabled:opacity-40"
                                >
                                    <CornerDownLeft className="h-3 w-3" />
                                </button>
                                <ClearButton
                                    onClick={() => slots.reset("replyTranslation")}
                                    disabled={!replyTranslation.output && !replyTranslation.error}
                                />
                            </div>
                        )}
                    />
                    <div className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[13px] leading-[1.5] text-ink whitespace-pre-wrap break-words">
                        {replyCopied && <span className="mr-2 text-[11px] text-accent">{t("aiCopied", "Copied")}</span>}
                        <ResultBody state={replyTranslation} diffOriginal="" showDiff={false} />
                    </div>
                </div>
            </div>
        </div>
    );
}
