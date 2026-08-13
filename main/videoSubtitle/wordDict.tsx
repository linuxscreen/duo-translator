import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { X } from "lucide-react";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { attachOwnShadow } from "@/main/dom/shadowRoots";
import { registerSelectableSurface } from "@/main/dom/selectableSurfaces";
import { deepContains } from "@/main/dom/shadowTraversal";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import { DictView } from "@/main/aiWriting/DictView";
import { useTts } from "@/main/aiWriting/useTts";
import { lookupDict } from "@/main/dict/dictClient";
import { dictProviderChain } from "@/main/dict/select";
import { isEmptyDictEntry, type DictEntry } from "@/main/dict/types";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";

/**
 * Dictionary panel for the word under the pointer in the subtitle overlay.
 *
 * The body is the very same {@link DictView} the selection-translate popup
 * draws — only the shell differs, and the shell is deliberately minimal: no
 * drag, no resize, no pin. Its lifetime is the pointer's, so a gesture that
 * moved or resized it would be fighting the thing that keeps it alive.
 *
 * Placement is FLUSH with the top of the line box the hovered word sits on —
 * a behavioural requirement, not a cosmetic one. The pointer has to travel from
 * the word up into the panel, and whatever it crosses on the way is either a
 * dead strip (the close condition) or another word (which takes the panel
 * over). Anchoring per visual line means it crosses nothing; see
 * {@link WordDictAnchor} for the two anchors that were tried first and how each
 * broke. Which elements count as neutral while the pointer travels is decided
 * by the overlay (see its `bindWordHover`).
 *
 * Mounted INSIDE the player element, positioned in player coordinates, so it
 * survives fullscreen the same way the subtitle box and the quick menu do.
 */

const HOST_ID = "duo-yt-word-dict-host";
/** Preferred panel width; shrunk on narrow players. */
const PANEL_WIDTH = 360;
/** Clearance kept from the player's left/right/top edges. */
const MARGIN = 8;
/** How far the panel reaches past its anchor edge — see `placement`. */
const EDGE_OVERLAP_PX = 1;

interface PanelState {
    open: boolean;
    word: string;
    /** Caption-track language — known up front, so only one provider is asked. */
    sourceLang: string;
    targetLang: string;
    /** Player-relative geometry, in px. */
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
}

const CLOSED: PanelState = {
    open: false,
    word: "",
    sourceLang: "",
    targetLang: "",
    left: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    maxHeight: 0,
};

export interface WordDictAnchor {
    /** Viewport rect of the hovered word. */
    wordRect: DOMRect;
    /**
     * Viewport y of the top of THIS WORD's own box — the panel's bottom edge.
     * Three coarser anchors were tried first and each failed differently:
     *   - the subtitle box's top leaves its ~8px padding as a dead strip
     *     between the word and the panel, and crossing it closes the panel;
     *   - the original line element's top puts the panel above the whole block,
     *     so on a wrapped original a word on the second line can only be
     *     reached by crossing the first — hitting other words, each of which
     *     takes the panel over;
     *   - the word's LINE box top still leaves the half-leading, a couple of
     *     pixels that belong to neither the glyphs nor the panel; a slow
     *     upward drag lands there and the panel vanishes.
     * Anchored on the word itself there is nothing in between at all.
     */
    lineTopY: number;
}

export interface WordDictDeps {
    player: HTMLElement;
    /** The close button was pressed. */
    onClose(): void;
}

export class WordDictPanel {
    private host: HTMLElement;
    private root: Root;
    private stopTheme: () => void;
    private stopSelectable: () => void;
    private player: HTMLElement;
    private push: ((s: PanelState) => void) | null = null;
    /** State produced before React registered its setter (first show). */
    private pending: PanelState | null = null;
    private state: PanelState = CLOSED;

    constructor(deps: WordDictDeps) {
        this.player = deps.player;
        document.getElementById(HOST_ID)?.remove();
        this.host = document.createElement("div");
        this.host.id = HOST_ID;
        this.host.setAttribute("data-duo-ai-ui", "");
        deps.player.appendChild(this.host);
        const shadow = attachOwnShadow(this.host);
        loadTailwindIntoShadow(shadow);
        const mount = document.createElement("div");
        mount.className = "duo-ai-root";
        shadow.appendChild(mount);
        this.stopTheme = bindThemeToElement(mount);
        // The panel is a reading surface: selecting inside it must raise the
        // selection icon like page text would, instead of being written off as
        // extension chrome.
        this.stopSelectable = registerSelectableSurface(this.host);
        this.root = createRoot(mount);
        this.root.render(
            <WordDictApp
                onClose={deps.onClose}
                register={(fn) => {
                    this.push = fn;
                    if (this.pending) {
                        fn(this.pending);
                        this.pending = null;
                    }
                }}
            />,
        );
    }

    /** Word currently shown, or "" when closed. */
    get word(): string {
        return this.state.open ? this.state.word : "";
    }

    isOpen(): boolean {
        return this.state.open;
    }

    show(word: string, sourceLang: string, targetLang: string, anchor: WordDictAnchor): void {
        this.apply({
            open: true,
            word,
            sourceLang,
            targetLang,
            ...this.placement(anchor),
        });
    }

    /** Re-run the placement maths for the same word (player resized / box moved). */
    reposition(anchor: WordDictAnchor): void {
        if (!this.state.open) return;
        this.apply({ ...this.state, ...this.placement(anchor) });
    }

    hide(): void {
        if (!this.state.open) return;
        this.clearOwnSelection();
        this.apply({ ...CLOSED });
    }

    /**
     * Drop a selection living in the panel before its content is unmounted.
     *
     * Letting React take the text away underneath it is not enough. Whether
     * that fires `selectionchange` is not something to rely on, and Chrome
     * retargets a shadow selection to the HOST on `window.getSelection()` — so
     * the selection icon is left holding an anchor on a host box that no longer
     * has any text in it, and the pill hangs on screen pointing at nothing.
     * `removeAllRanges` fires the event unconditionally, and the icon's own
     * re-sync then finds nothing and hides.
     *
     * The ownership test is what keeps this from stealing an unrelated page
     * selection; a document has only one, so once it is established as ours,
     * clearing both views of it is the same act.
     */
    private clearOwnSelection(): void {
        let scoped: Selection | null = null;
        try {
            const root = this.host.shadowRoot as
                | (ShadowRoot & { getSelection?: () => Selection | null })
                | null;
            scoped = root?.getSelection?.() ?? null;
        } catch {
            scoped = null;
        }
        // Firefox has no ShadowRoot.getSelection(); there the window selection
        // carries the real shadow nodes, so it answers the ownership question.
        const win = window.getSelection();
        const owns = (sel: Selection | null) =>
            !!sel && sel.rangeCount > 0 && deepContains(this.host, sel.anchorNode);
        if (!owns(scoped) && !owns(win)) return;
        scoped?.removeAllRanges();
        if (win !== scoped) win?.removeAllRanges();
    }

    destroy(): void {
        this.clearOwnSelection();
        this.push = null;
        this.stopSelectable();
        this.stopTheme();
        // Unmount on a later task: React refuses to unmount a root while it is
        // rendering, and destroy() can be reached from inside an event handler
        // the panel itself dispatched.
        const root = this.root;
        setTimeout(() => root.unmount(), 0);
        this.host.remove();
    }

    private apply(next: PanelState): void {
        this.state = next;
        if (this.push) this.push(next);
        else this.pending = next;
    }

    /**
     * Player-relative box: bottom flush with the word's line-box top edge,
     * horizontally centred on the word and clamped inside the player.
     *
     * The panel is never flipped below the subtitle. Below would put the
     * translation line between the word and the panel, and crossing it closes
     * the panel — so a flip would make the panel unreachable, which is worse
     * than the cramped-but-scrollable panel a subtitle dragged near the top
     * produces.
     */
    private placement(anchor: WordDictAnchor): Omit<PanelState, "open" | "word" | "sourceLang" | "targetLang"> {
        const pr = this.player.getBoundingClientRect();
        const width = Math.max(200, Math.min(PANEL_WIDTH, pr.width - 2 * MARGIN));
        const centre = anchor.wordRect.left + anchor.wordRect.width / 2 - pr.left;
        const left = Math.max(MARGIN, Math.min(centre - width / 2, pr.width - width - MARGIN));
        return {
            left,
            // The extra pixel absorbs sub-pixel rounding: rects are fractional,
            // and an exact edge match can still leave a hairline the pointer
            // lands in for one frame — which is one close too many.
            bottom: pr.bottom - anchor.lineTopY - EDGE_OVERLAP_PX,
            width,
            maxHeight: Math.max(0, anchor.lineTopY - pr.top - MARGIN),
        };
    }
}

// ---------------------------------------------------------------------------
// React shell
// ---------------------------------------------------------------------------

function WordDictApp({
    register,
    onClose,
}: {
    register: (fn: (s: PanelState) => void) => void;
    onClose: () => void;
}) {
    useLang();
    const [state, setState] = useState<PanelState>(CLOSED);
    useEffect(() => register(setState), [register]);

    const [entry, setEntry] = useState<DictEntry | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tts = useTts();

    const { open, word, sourceLang, targetLang } = state;

    // Stop any pronunciation still playing when the panel goes away — the
    // panel stays mounted, so unmount cleanup would never run.
    useEffect(() => {
        if (!open) tts.stop();
    }, [open, tts.stop]);

    useEffect(() => {
        if (!open || !word) return;
        let cancelled = false;
        setEntry(null);
        setError(null);
        setLoading(true);
        void (async () => {
            // Sequential, not concurrent: the caption track states its
            // language, so the preferred provider is known before asking. The
            // second provider is only reached when the first has no entry.
            let found: DictEntry | null = null;
            let failure: unknown = null;
            for (const provider of dictProviderChain(sourceLang, targetLang)) {
                try {
                    const got = await lookupDict(provider, word, targetLang);
                    if (cancelled) return;
                    if (!isEmptyDictEntry(got)) {
                        found = got;
                        break;
                    }
                } catch (e) {
                    if (cancelled) return;
                    if (!failure) failure = e;
                }
            }
            setEntry(found);
            setLoading(false);
            // `silent`: the panel renders the reason itself (below). Only the
            // full console line is added here, so a broken provider stays
            // diagnosable after the pointer moved and the panel closed.
            if (failure) {
                reportRequestError(ERROR_SCOPE.DICTIONARY, failure, {
                    silent: true,
                    detail: { word, sourceLang, targetLang, source: "video subtitle" },
                });
                if (!found) setError((failure as Error)?.message || String(failure));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, word, sourceLang, targetLang]);

    // Nothing to draw for a word with no entry: an empty card hanging over the
    // subtitle on every hover would be worse than no reaction at all.
    if (!open || (!loading && !error && !entry)) return null;

    return (
        <div
            style={{
                position: "absolute",
                left: state.left,
                bottom: state.bottom,
                width: state.width,
                maxHeight: state.maxHeight,
                // Above the subtitle box (999) and its drag grip, which the
                // panel covers while it is open.
                zIndex: 2147483000,
            }}
            // The player toggles play/pause on any click that reaches it.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            // `select-text` is required, not decorative: the panel lives inside
            // the player, and YouTube sets `user-select: none` there. Shadow DOM
            // does not save us — `:host { all: initial }` resolves to
            // `user-select: auto`, and `auto` asks the flat-tree ancestor, which
            // is the player. Only an explicit value stops that walk. The
            // subtitle lines carry the same declaration for the same reason.
            className="relative flex flex-col select-text rounded-xl bg-surface/97 border border-line-strong shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden"
        >
            <button
                type="button"
                onClick={onClose}
                title={t("aiClose", "Close")}
                aria-label={t("aiClose", "Close")}
                className="absolute right-1.5 top-1.5 z-10 h-6 w-6 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-3"
            >
                <X className="h-3.5 w-3.5" />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <DictView
                    standalone
                    entry={entry}
                    loading={loading}
                    error={error}
                    wordLang={sourceLang}
                    audio={{
                        playingKey: tts.playingKey,
                        playUrl: tts.toggleUrl,
                        speak: tts.toggle,
                    }}
                />
            </div>
        </div>
    );
}
