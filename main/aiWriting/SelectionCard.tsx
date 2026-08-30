// ---------------------------------------------------------------------------
// The selection-translate card, as pure presentation.
//
// Split out of selectionPopup.tsx so the Options preview can render the REAL
// card instead of a mock-up: everything page-specific (anchoring to the
// selection, dragging, resizing, running the providers) stays in the popup and
// arrives here as props, and the preview simply supplies fake ones. A mock-up
// would have been half the code and would have started lying the first time
// either side changed.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Loader2, Pin, Settings2, Volume2, X } from "lucide-react";
import { t } from "./i18n";
import { useCopyFeedback } from "./useCopyFeedback";
import type { useTts } from "./useTts";
import type { SelectionPopupPrefs } from "./selectionPopupPrefs";
import { LANGUAGES } from "@/main/constants";
import type { ServiceOption } from "@/utils/service";
import { DUO_LOGO_SVG } from "@/main/floatBall/logo";
import { DictView } from "./DictView";
import type { DictEntry } from "@/main/dict/types";

export type TtsController = ReturnType<typeof useTts>;

/** One service's answer. Single-service mode is simply a list of one. */
export interface TranslationRun {
    /** Service key (`google`, `ai:<id>`). Doubles as the React and TTS key. */
    key: string;
    /** Display name, drawn above the text in multi-service mode. */
    label: string;
    output: string;
    running: boolean;
    error: string | null;
}

/** The eight resize handles, keyed by the compass directions they move. */
export const RESIZE_HANDLES: { dir: string; className: string; cursor: string }[] = [
    { dir: "n", className: "top-0 left-2 right-2 h-1.5", cursor: "ns-resize" },
    { dir: "s", className: "bottom-0 left-2 right-2 h-1.5", cursor: "ns-resize" },
    { dir: "w", className: "left-0 top-2 bottom-2 w-1.5", cursor: "ew-resize" },
    { dir: "e", className: "right-0 top-2 bottom-2 w-1.5", cursor: "ew-resize" },
    { dir: "nw", className: "top-0 left-0 h-2.5 w-2.5", cursor: "nwse-resize" },
    { dir: "se", className: "bottom-0 right-0 h-2.5 w-2.5", cursor: "nwse-resize" },
    { dir: "ne", className: "top-0 right-0 h-2.5 w-2.5", cursor: "nesw-resize" },
    { dir: "sw", className: "bottom-0 left-0 h-2.5 w-2.5", cursor: "nesw-resize" },
];

// ---------------------------------------------------------------------------
// One-line vs multi-line — which layout a text block gets
// ---------------------------------------------------------------------------

/**
 * Width the inline play+copy cluster takes off a row: 24px per button, a 2px
 * gap between them, plus the 8px gap to the text. Zero when the row has no
 * buttons at all — every one of them is individually switchable now, and
 * reserving space for buttons that are not there would wrap text early.
 */
function inlineActionsWidth(count: number): number {
    return count === 0 ? 0 : count * 24 + (count - 1) * 2 + 8;
}

/**
 * Does `text` need more than one line at the width it would have with the
 * buttons sitting inline next to it?
 *
 * Measured on an INVISIBLE one-line probe, not on the rendered text. The answer
 * decides the layout, and the layout decides the rendered text's width — so
 * measuring the real element lets the two chase each other: the buttons move to
 * their own row, the text gets ~58px wider, now it fits on one line, the
 * buttons come back inline, it overflows again… An absolutely positioned
 * `white-space: pre` copy has the text's natural single-line width regardless
 * of which layout is currently on screen, which breaks that loop.
 *
 * `cardWidth` is a dependency because the card is resizable; the probe itself
 * is width-independent, but the row it is compared against is not.
 */
function useNeedsOwnRow(text: string, cardWidth: number, actionsW: number) {
    const rowRef = useRef<HTMLDivElement>(null);
    const probeRef = useRef<HTMLSpanElement>(null);
    const [needsOwnRow, setNeedsOwnRow] = useState(false);
    useLayoutEffect(() => {
        const row = rowRef.current;
        const probe = probeRef.current;
        if (!row || !probe || text === "") {
            setNeedsOwnRow(false);
            return;
        }
        // `clientWidth` is the padding box, so the row's own padding has to come
        // off before comparing — otherwise every text gets 24px of slack it
        // does not actually have.
        const cs = getComputedStyle(row);
        const available =
            row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - actionsW;
        // An explicit newline is multi-line whatever the width says — the probe
        // is `pre`, so it would only report the longest line.
        setNeedsOwnRow(text.includes("\n") || probe.getBoundingClientRect().width > available);
    }, [text, cardWidth, actionsW]);
    return { rowRef, probeRef, needsOwnRow };
}

/** The hidden measuring copy — see {@link useNeedsOwnRow}. */
function LineProbe({ text, probeRef }: { text: string; probeRef: React.RefObject<HTMLSpanElement> }) {
    return (
        <span
            ref={probeRef}
            aria-hidden="true"
            // The probe is a one-line `pre` copy, so its box is as wide as the
            // whole text — which is exactly what makes it measurable, and also
            // what would hand the scrolling body a horizontal scrollbar. It
            // must NOT be shrunk (a zero-width box measures zero): the row it
            // sits in is `relative overflow-hidden`, so it is its containing
            // block AND clips it, and the overflow never reaches the body.
            className="invisible absolute left-0 top-0 whitespace-pre pointer-events-none text-[13px] leading-normal"
        >
            {text}
        </span>
    );
}

const ICON_BTN =
    "h-6 w-6 inline-flex items-center justify-center rounded hover:bg-hover-3 disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Play + copy cluster. Either half can be switched off independently, and with
 * both off the cluster renders nothing at all — callers pass the resulting
 * count to {@link useNeedsOwnRow} so the text reclaims the space.
 */
function AudioActions({
    ttsKey,
    text,
    lang,
    tts,
    showTts,
    showCopy,
}: {
    ttsKey: string;
    text: string;
    lang: string;
    tts: TtsController;
    showTts: boolean;
    showCopy: boolean;
}) {
    const [copied, copy] = useCopyFeedback();
    const playing = tts.playingKey === ttsKey;
    const disabled = !text.trim();
    if (!showTts && !showCopy) return null;
    return (
        <div className="flex items-center gap-0.5 shrink-0">
            {showTts && (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => tts.toggle(ttsKey, text, lang)}
                    title={playing ? t("selectionStopSpeech", "Stop") : t("selectionPlaySpeech", "Play")}
                    aria-label={playing ? t("selectionStopSpeech", "Stop") : t("selectionPlaySpeech", "Play")}
                    className={`${ICON_BTN} ${playing ? "text-accent" : "text-ink-soft"}`}
                >
                    <Volume2 className="h-3.5 w-3.5" />
                </button>
            )}
            {showCopy && (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => copy(text)}
                    title={copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                    aria-label={copied ? t("aiCopied", "Copied") : t("aiCopy", "Copy")}
                    className={`${ICON_BTN} ${copied ? "text-success" : "text-ink-soft"}`}
                >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
            )}
        </div>
    );
}

/**
 * The source text. A multi-line original is clipped to one line with a chevron
 * to expand; a one-line original keeps its buttons beside it.
 */
function OriginalBlock({
    text,
    lang,
    expanded,
    onToggleExpanded,
    cardWidth,
    tts,
    prefs,
}: {
    text: string;
    lang: string;
    expanded: boolean;
    onToggleExpanded: () => void;
    cardWidth: number;
    tts: TtsController;
    prefs: SelectionPopupPrefs;
}) {
    const actionsW = inlineActionsWidth(Number(prefs.originalTts) + Number(prefs.originalCopy));
    const { rowRef, probeRef, needsOwnRow } = useNeedsOwnRow(text, cardWidth, actionsW);
    const actions = (
        <AudioActions
            ttsKey="orig"
            text={text}
            lang={lang}
            tts={tts}
            showTts={prefs.originalTts}
            showCopy={prefs.originalCopy}
        />
    );
    return (
        <div ref={rowRef} className="relative overflow-hidden px-3 py-2 border-b border-line">
            <LineProbe text={text} probeRef={probeRef} />
            {needsOwnRow ? (
                <>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={onToggleExpanded}
                            title={expanded ? t("collapse", "Collapse") : t("expand", "Expand")}
                            aria-label={expanded ? t("collapse", "Collapse") : t("expand", "Expand")}
                            aria-expanded={expanded}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-3 hover:text-ink-2"
                        >
                            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
                        </button>
                        <div className="ml-auto">{actions}</div>
                    </div>
                    <div
                        className={`text-[13px] leading-normal text-ink-2 ${expanded ? "whitespace-pre-wrap wrap-break-word" : "truncate"}`}
                    >
                        {text}
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 truncate text-[13px] leading-normal text-ink-2">{text}</div>
                    {actions}
                </div>
            )}
        </div>
    );
}

/** One service's translation. */
function TranslationBlock({
    run,
    targetLang,
    cardWidth,
    tts,
    prefs,
    showLabel,
    divided,
}: {
    run: TranslationRun;
    targetLang: string;
    cardWidth: number;
    tts: TtsController;
    prefs: SelectionPopupPrefs;
    /** Name the service above the text — multi-service mode only. */
    showLabel: boolean;
    /** Separator above, for every block after the first. */
    divided: boolean;
}) {
    const actionsW = inlineActionsWidth(Number(prefs.translationTts) + Number(prefs.translationCopy));
    const { rowRef, probeRef, needsOwnRow } = useNeedsOwnRow(run.output, cardWidth, actionsW);
    const body = run.error ? (
        <span className="text-error">{run.error}</span>
    ) : run.running && !run.output ? (
        <span className="inline-flex items-center gap-1.5 text-ink-soft">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("aiStreaming", "Streaming...")}
        </span>
    ) : (
        run.output
    );
    const actions = (
        <AudioActions
            ttsKey={`trans:${run.key}`}
            text={run.output}
            lang={targetLang}
            tts={tts}
            showTts={prefs.translationTts}
            showCopy={prefs.translationCopy}
        />
    );
    return (
        <div
            ref={rowRef}
            className={`relative overflow-hidden px-3 py-2.5 ${divided ? "border-t border-line" : ""}`}
        >
            <LineProbe text={run.output} probeRef={probeRef} />
            {/* Whose answer this is. Deliberately small and quiet: it is a
                provenance mark on the translation, not a heading over it. */}
            {showLabel && (
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    {run.label}
                </div>
            )}
            {needsOwnRow ? (
                <>
                    <div className="flex justify-end">{actions}</div>
                    <div className="text-[13px] leading-normal text-ink whitespace-pre-wrap wrap-break-word">{body}</div>
                </>
            ) : (
                <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 text-[13px] leading-normal text-ink whitespace-pre-wrap wrap-break-word">
                        {body}
                    </div>
                    {actions}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

const SELECT_CLS =
    // Fixed width in the header, NOT `flex-1`: the card is resizable, and a
    // stretching picker would turn every widening into a pair of ever-longer
    // boxes. Still shrinkable (`min-w-0`, no `shrink-0`) — at the minimum card
    // width two rigid 150px boxes would push pin/close out of the header.
    "h-6 min-w-0 rounded border border-line-strong bg-surface px-1.5 text-[11px] text-ink-2 outline-none focus:border-accent";

const serviceName = (o: ServiceOption) => (o.i18nKey ? t(o.i18nKey, o.label) : o.label);

/**
 * A menu hanging off one of the header buttons.
 *
 * Plain `absolute` positioning inside the card, which is why the card root no
 * longer sets `overflow-hidden` (its rounding moved onto the header and the
 * body instead) — a clipped menu was the whole reason an earlier version put
 * these controls in a strip inside the body.
 *
 * Deliberately NOT `position: fixed` with measured viewport coordinates: the
 * Options preview renders this same card inside a `backdrop-blur` ancestor,
 * and a filtered ancestor becomes the containing block for fixed descendants —
 * the coordinates would be right and the menu would still land in the wrong
 * place, only on that one surface.
 *
 * It does flip above the button when there is no room below, so a card near the
 * bottom of the viewport still shows the whole menu. Measured after layout and
 * before paint, so the flip is never visible.
 */
function HeaderMenu({
    align,
    children,
}: {
    align: "left" | "right";
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [dropUp, setDropUp] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // Only flip when flipping actually helps — above the button can be just
        // as cramped, and a menu pinned to the top edge is no better.
        setDropUp(r.bottom > window.innerHeight - 8 && r.height + 8 < r.top);
    }, []);
    return (
        <div
            ref={ref}
            className={[
                "absolute z-40 w-[230px] rounded-lg border border-line-strong bg-surface p-1.5",
                "shadow-[0_10px_28px_rgba(0,0,0,0.45)]",
                align === "right" ? "right-0" : "left-0",
                dropUp ? "bottom-full mb-1" : "top-full mt-1",
            ].join(" ")}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </div>
    );
}

/** Multi-service picker, shown inside a {@link HeaderMenu}. */
function ServiceChecklist({
    options,
    selected,
    onToggle,
}: {
    options: ServiceOption[];
    selected: string[];
    onToggle: (key: string) => void;
}) {
    return (
        <div className="flex flex-col gap-0.5 max-h-[210px] overflow-y-auto">
            {options.map((o) => {
                const on = selected.includes(o.value);
                return (
                    <label
                        key={o.value}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-ink-2 hover:bg-hover-3"
                    >
                        <input
                            type="checkbox"
                            checked={on}
                            onChange={() => onToggle(o.value)}
                            className="h-3 w-3 accent-[var(--color-accent)]"
                        />
                        <span className="min-w-0 truncate">{serviceName(o)}</span>
                    </label>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface SelectionCardProps {
    prefs: SelectionPopupPrefs;

    origText: string;
    origLang: string;
    origExpanded: boolean;
    onToggleOrigExpanded: () => void;

    runs: TranslationRun[];
    /** Target language of every run — drives the translation TTS voice. */
    targetLang: string;

    dictEntry: DictEntry | null;
    dictLoading: boolean;
    dictError: string | null;

    serviceOptions: ServiceOption[];
    /** Single-service mode: `''` means "follow the page translation". */
    serviceValue: string;
    onServiceChange: (v: string) => void;
    followServiceLabel: string;
    /** Multi-service mode: the resolved selection (never empty). */
    selectedServices: string[];
    onToggleService: (key: string) => void;

    /** `''` means "follow the page translation". */
    langValue: string;
    onLangChange: (v: string) => void;
    followLangLabel: string;

    pinned: boolean;
    onTogglePin: () => void;
    onClose: () => void;

    tts: TtsController;
    /** Current card width — the one-line/multi-line probe compares against it. */
    cardWidth: number;

    /** Live popup only; the preview leaves all four out and gets a static card. */
    cardRef?: React.Ref<HTMLDivElement>;
    style?: React.CSSProperties;
    onHeaderMouseDown?: (e: React.MouseEvent) => void;
    onResizeMouseDown?: (dir: string) => (e: React.MouseEvent) => void;
}

export function SelectionCard(props: SelectionCardProps) {
    const {
        prefs, origText, origLang, origExpanded, onToggleOrigExpanded,
        runs, targetLang, dictEntry, dictLoading, dictError,
        serviceOptions, serviceValue, onServiceChange, followServiceLabel,
        selectedServices, onToggleService,
        langValue, onLangChange, followLangLabel,
        pinned, onTogglePin, onClose, tts, cardWidth,
        cardRef, style, onHeaderMouseDown, onResizeMouseDown,
    } = props;

    // Which inline strip is open. Both are body strips rather than popovers —
    // see ServiceChecklist for why.
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [serviceListOpen, setServiceListOpen] = useState(false);
    const menuOpen = settingsOpen || serviceListOpen;
    const closeMenus = () => {
        setSettingsOpen(false);
        setServiceListOpen(false);
    };

    const followWith = (name: string) =>
        t("selectionFollowWeb", "Follow page ({{name}})").replace("{{name}}", name);

    // Parameterised by width: in the header they sit side by side at a fixed
    // 150px, inside the gear menu they fill it.
    const langSelect = (width = "w-[150px]") => (
        <select
            value={langValue}
            onChange={(e) => onLangChange(e.target.value)}
            title={t("targetLanguage", "Target language")}
            className={`${SELECT_CLS} ${width}`}
        >
            <option value="">{followWith(followLangLabel)}</option>
            {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                    {t(l.title, l.name)}
                </option>
            ))}
        </select>
    );

    const singleServiceSelect = (width = "w-[150px]") => (
        <select
            value={serviceValue}
            onChange={(e) => onServiceChange(e.target.value)}
            title={t("translateService", "Translate service")}
            className={`${SELECT_CLS} ${width}`}
        >
            {/* Dropped in multi-service mode: the chosen SET is the answer, and
                "follow the page" is a single value with nothing to add to it. */}
            <option value="">{followWith(followServiceLabel)}</option>
            {serviceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                    {serviceName(o)}
                </option>
            ))}
        </select>
    );

    /**
     * The chosen services, named and comma-separated.
     *
     * Not a count ("3 services"): the whole point of the multi-service mode is
     * WHICH services answered, and a number makes the user open the menu to
     * find out. The button truncates, so a long set degrades to an ellipsis
     * rather than stretching the header — the full list is on the tooltip.
     * Falls back to the raw key for a service the picker no longer offers, so
     * a stale entry is still visible instead of silently vanishing.
     */
    const selectedServiceNames = selectedServices
        .map((key) => {
            const o = serviceOptions.find((x) => x.value === key);
            return o ? serviceName(o) : key;
        })
        .join(", ");

    return (
        <div
            ref={cardRef}
            // No `overflow-hidden`: the header menus hang outside the card and
            // a clip is exactly what used to make that impossible. The rounding
            // it used to provide now lives on the two children instead.
            className="relative flex flex-col rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md"
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Resize handles — thin strips inset on each edge and corner. They
                sit above the body so the bottom-right one is grabbable even
                where the scrollbar is. */}
            {onResizeMouseDown &&
                RESIZE_HANDLES.map((h) => (
                    <div
                        key={h.dir}
                        onMouseDown={onResizeMouseDown(h.dir)}
                        className={`absolute z-20 ${h.className}`}
                        style={{ cursor: h.cursor }}
                    />
                ))}

            {/* Click-away for the header menus. The card stops mousedown from
                reaching the document, so a document-level listener would never
                hear it — an overlay over the CARD is the one surface that does,
                which is also why it cannot live inside the menu's own anchor
                (that box is the button, a few pixels wide). */}
            {menuOpen && <div className="absolute inset-0 z-30" onMouseDown={closeMenus} />}

            {/* Header — logo, pickers (unless hidden), then gear/pin/close. Its
                empty space is the drag surface (hence `cursor-move`). */}
            <div
                className={`flex items-center gap-1.5 rounded-t-xl px-3 py-2 border-b border-line-2 bg-surface-2 select-none ${onHeaderMouseDown ? "cursor-move" : ""}`}
                onMouseDown={onHeaderMouseDown}
            >
                <span
                    aria-hidden="true"
                    className="block h-4 w-4 shrink-0 mr-2"
                    // Inlined SVG rather than <img src=chrome-extension://…>:
                    // the icon files are not in `web_accessible_resources`, so
                    // a host page cannot load them. Same reason as the float
                    // ball, which is where this constant comes from.
                    dangerouslySetInnerHTML={{ __html: DUO_LOGO_SVG }}
                />
                {!prefs.hideHeaderConfig && (
                    <>
                        {prefs.multiService ? (
                            <span className="relative inline-flex min-w-0">
                                <button
                                    type="button"
                                    onClick={() => setServiceListOpen((v) => !v)}
                                    // The full set on hover — the label itself
                                    // is the truncated half of the same thing.
                                    title={`${t("translateService", "Translate service")}: ${selectedServiceNames}`}
                                    aria-expanded={serviceListOpen}
                                    className={`${SELECT_CLS} w-[150px] flex items-center justify-between gap-1 text-left`}
                                >
                                    <span className="min-w-0 truncate">{selectedServiceNames}</span>
                                    <ChevronRight
                                        className={`h-3 w-3 shrink-0 transition-transform ${serviceListOpen ? "rotate-90" : ""}`}
                                    />
                                </button>
                                {serviceListOpen && (
                                    <HeaderMenu align="left">
                                        <ServiceChecklist
                                            options={serviceOptions}
                                            selected={selectedServices}
                                            onToggle={onToggleService}
                                        />
                                    </HeaderMenu>
                                )}
                            </span>
                        ) : (
                            singleServiceSelect()
                        )}
                        {langSelect()}
                    </>
                )}
                <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                    {prefs.hideHeaderConfig && (
                        <span className="relative inline-flex">
                            <button
                                type="button"
                                onClick={() => setSettingsOpen((v) => !v)}
                                title={t("settings", "Settings")}
                                aria-label={t("settings", "Settings")}
                                aria-expanded={settingsOpen}
                                className={`${ICON_BTN} ${settingsOpen ? "text-accent" : "text-ink-soft"}`}
                            >
                                <Settings2 className="h-3.5 w-3.5" />
                            </button>
                            {settingsOpen && (
                                <HeaderMenu align="right">
                                    <div className="flex flex-col gap-2 p-1">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[11px] text-ink-soft">
                                                {t("translateService", "Translate service")}
                                            </span>
                                            {prefs.multiService ? (
                                                <ServiceChecklist
                                                    options={serviceOptions}
                                                    selected={selectedServices}
                                                    onToggle={onToggleService}
                                                />
                                            ) : (
                                                singleServiceSelect("w-full")
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[11px] text-ink-soft">
                                                {t("targetLanguage", "Target language")}
                                            </span>
                                            {langSelect("w-full")}
                                        </div>
                                    </div>
                                </HeaderMenu>
                            )}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onTogglePin}
                        title={pinned ? t("selectionUnpin", "Unpin") : t("selectionPin", "Pin")}
                        aria-label={pinned ? t("selectionUnpin", "Unpin") : t("selectionPin", "Pin")}
                        className={`${ICON_BTN} ${pinned ? "text-accent" : "text-ink-soft"}`}
                    >
                        <Pin className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        title={t("aiClose", "Close")}
                        aria-label={t("aiClose", "Close")}
                        className={`${ICON_BTN} text-ink-soft`}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 rounded-b-xl overflow-y-auto overflow-x-hidden">
                {prefs.showOriginal && (
                    <OriginalBlock
                        text={origText}
                        lang={origLang}
                        expanded={origExpanded}
                        onToggleExpanded={onToggleOrigExpanded}
                        cardWidth={cardWidth}
                        tts={tts}
                        prefs={prefs}
                    />
                )}

                {runs.map((run, i) => (
                    <TranslationBlock
                        key={run.key}
                        run={run}
                        targetLang={targetLang}
                        cardWidth={cardWidth}
                        tts={tts}
                        prefs={prefs}
                        showLabel={prefs.multiService}
                        // The first block sits right under the original's own
                        // border (or the header), so it must not add a second.
                        divided={i > 0}
                    />
                ))}

                {/* Dictionary — only for single-word selections. Renders nothing
                    at all when the word has no entry, so ordinary prose
                    selections look exactly as they did before. */}
                {prefs.dict && (dictLoading || dictError || dictEntry) && (
                    <DictView
                        entry={dictEntry}
                        loading={dictLoading}
                        error={dictError}
                        wordLang={origLang}
                        showExamples={prefs.dictExamples}
                        audio={{
                            playingKey: tts.playingKey,
                            playUrl: tts.toggleUrl,
                            speak: tts.toggle,
                        }}
                    />
                )}
            </div>
        </div>
    );
}
