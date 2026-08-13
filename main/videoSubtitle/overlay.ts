import { VIDEO_SUBTITLE_DISPLAY_MODE } from "@/main/constants";
import type { SubtitleCue, VideoSubtitleStyle } from "./types";
import { markNoTranslate } from "../dom/paragraphMarks";
import { isDictWord } from "@/main/dict/select";
import { WordDictPanel, type WordDictAnchor } from "./wordDict";
import { isInOwnUi } from "@/main/dom/shadowRoots";
import { isSelectionPopupOpen, watchSelectionPopupOpen } from "@/main/aiWriting/selectionPopup";

/**
 * Subtitle overlay — the bilingual caption box drawn inside the player.
 *
 * Deliberately LIGHT DOM (no Shadow DOM, no React): the text must be freely
 * selectable and the page-level selection APIs (window.getSelection) that the
 * existing selection-translate feature relies on do not cross shadow
 * boundaries. Styling is 100% inline so page CSS cannot leak in. The box
 * lives INSIDE the player element so it stays visible in fullscreen, and it
 * is anchored to the player's bottom edge by a percentage — independent of
 * the native control bar, so showing/hiding the controls never moves it.
 *
 * Interaction: the box itself is never draggable (its whole surface must stay
 * available for text selection) — hovering it reveals a six-dot grip above it,
 * and dragging THAT moves the box vertically. Horizontal position is always
 * centered.
 *
 * The translate button that appears on a selection is NOT drawn here: it is
 * the extension-wide selection icon (main/selectionIcon), which already
 * watches the document and reaches inside the player (it reparents itself into
 * the fullscreen element). This overlay keeps only the parts that are genuinely
 * its own — pausing playback while the user is reading (a selection, or a word
 * being looked up), and the per-word dictionary hover (see bindWordHover).
 */

export interface OverlayCallbacks {
    /** Drag finished — persist the new bottom-offset percentage. */
    onPositionChange(bottomPct: number): void;
    /**
     * Height in px at the bottom of the player that the subtitle must stay
     * clear of (the site's control bar / progress bar). Which elements make up
     * that band is site-specific, so the controller measures it; omitted means
     * "nothing reserved". Read on every clamp, so it tracks player resizes.
     */
    reservedBottomPx?(): number;
}

const BOX_ID = "duo-video-subtitle-box";
/**
 * Absolute floor, used only when the controller reports no reserved band. The
 * real floor is measured from the player's control bar — see
 * `OverlayCallbacks.reservedBottomPx` and clampPct.
 */
const MIN_BOTTOM_PCT = 0;
/** Fallback ceiling used only while the box can't be measured (not yet laid out). */
const MAX_BOTTOM_PCT = 88;
/**
 * Keep this much clear of the player's top edge. Generous enough that the grip
 * at the topmost position still has room to be approached without the pointer
 * overshooting out of the player.
 */
const EDGE_MARGIN_PX = 10;
/** Visual gap between the drag grip and the subtitle box (transparent, hoverable). */
const HANDLE_GAP_PX = 5;
const HANDLE_PILL_PX = 18;
/** Full vertical footprint the grip needs outside the box. */
const HANDLE_TOTAL_PX = HANDLE_PILL_PX + HANDLE_GAP_PX;
/**
 * Grace period before hiding the grip after the pointer leaves. Tolerates the
 * brief excursions a real pointer makes around the box/grip edges.
 */
const HANDLE_HIDE_DELAY_MS = 200;

/** Reference player height the configured px font sizes are relative to. */
const BASE_PLAYER_HEIGHT = 720;
/** Box line-height. Also used to work out where one visual line ends — see withinWordLine. */
const LINE_HEIGHT = 1.35;

/**
 * Runs of Latin letters (plus the joiners a headword may carry) in the original
 * line. Everything the scan does not match — spaces, punctuation, digits, CJK —
 * stays a plain text node and is never hoverable, which is what keeps the
 * feature to the same "word" the selection popup recognises: each match is put
 * through `isDictWord` before it becomes a token.
 */
const WORD_SCAN_RE = /\p{Script=Latin}[\p{Script=Latin}\p{M}'’-]*/gu;
/** Joiners a match may end on ("well-" before a line break) — not part of the word. */
const TRAILING_JOINERS_RE = /[-'’]+$/u;
/** Marks a hoverable word; its value is the word to look up. */
const WORD_ATTR = "data-duo-word";

/**
 * How long the pointer must rest on a word before it counts as a hover.
 *
 * Not cosmetic: opening is not a free action — it stops the video. The subtitle
 * sits between the picture and the control bar, so the pointer crosses it on
 * the way to almost anything, and without this every crossing would pause,
 * flash a panel and resume. Only OPENING is delayed; closing stays immediate,
 * and moving between words once a panel is up is immediate too (the intent was
 * established when the first one opened).
 */
const HOVER_OPEN_DELAY_MS = 200;

/** Why playback is currently held. Reasons are independent and released separately. */
const PAUSE_SELECTION = "selection";
const PAUSE_HOVER = "hover";

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return `rgba(0,0,0,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export class SubtitleOverlay {
    private player: HTMLElement;
    private callbacks: OverlayCallbacks;
    private box: HTMLDivElement;
    private originalLine: HTMLDivElement;
    private translationLine: HTMLDivElement;
    /**
     * The text itself, one inline span per line.
     *
     * They exist so the overlay's HIT AREA can be the glyphs rather than the
     * box. See applyBaseStyles for why that matters; the short version is that
     * everything from the box down is `pointer-events: none` and only these two
     * take it back, and an inline box's hit area is its text fragments — so the
     * blank tail of a wrapped line stays click-through too.
     */
    private originalText: HTMLSpanElement;
    private translationText: HTMLSpanElement;
    /**
     * Six-dot grip above the box — the only drag affordance. `dragHandle` is a
     * transparent wrapper whose bottom padding bridges the visual gap to the
     * box (see bindDrag); `handlePill` is the visible pill inside it.
     */
    private dragHandle: HTMLDivElement;
    private handlePill: HTMLDivElement;
    private handleHideTimer: number | null = null;
    private pauseOnSelect = false;
    /**
     * Whether the pause currently in effect is OURS. Playback is only resumed
     * when this is set, so a video the user paused themselves before selecting
     * is never started behind their back.
     */
    private pausedByUs = false;
    /**
     * Live pause reasons (selection / word hover). Two features hold the video
     * for overlapping stretches, so a single boolean would let whichever
     * finished first restart playback under the other.
     */
    private pauseReasons = new Set<string>();
    /** A selection drag is in progress (button held down inside the box). */
    private selecting = false;
    /** Hover-to-look-up is on: the original line is rendered as word tokens. */
    private hoverDict = false;
    /** Caption-track language, so the dictionary provider is picked up front. */
    private sourceLang = "";
    private dictTargetLang = "";
    /** Built on the first lookup — a React root per player is not free. */
    private dict: WordDictPanel | null = null;
    /** The word token the panel is currently showing, or null. */
    private activeWord: HTMLElement | null = null;
    /** Word waiting out {@link HOVER_OPEN_DELAY_MS}. */
    private pendingWord: HTMLElement | null = null;
    private hoverOpenTimer: number | null = null;
    /** Whether the original line currently holds word tokens (see writeOriginalLine). */
    private wordsRendered = false;
    /** Last pointer position, tracked only while a panel is open — see reevaluateHover. */
    private lastPointer: { x: number; y: number } | null = null;
    /**
     * Position is tracked as two values: `desiredPct` is what the user/config
     * asked for, `bottomPct` is that value clamped to what actually fits right
     * now. Keeping them apart means a tall cue can push the box down without
     * destroying the user's chosen position — it springs back once a shorter
     * cue is shown.
     */
    private desiredPct: number;
    private style: VideoSubtitleStyle;
    private mode: string = VIDEO_SUBTITLE_DISPLAY_MODE.BILINGUAL;
    private bottomPct: number;
    private currentCue: SubtitleCue | null = null;
    // Last-rendered snapshot — show() is called from a polling tick, so a
    // re-render must only happen on real change or it would wipe an active
    // text selection inside the box every 150ms.
    private renderedText: string | null = null;
    private renderedTranslated: string | undefined | null = null;
    private dragging = false;
    private disposed = false;
    private disposers: (() => void)[] = [];

    constructor(
        player: HTMLElement,
        style: VideoSubtitleStyle,
        bottomPct: number,
        callbacks: OverlayCallbacks,
    ) {
        this.player = player;
        this.style = style;
        // Assign before the first clampPct call — it reads `reservedBottomPx`
        // off the callbacks to work out the floor.
        this.callbacks = callbacks;
        this.desiredPct = bottomPct;
        this.bottomPct = this.clampPct(bottomPct);

        document.getElementById(BOX_ID)?.remove();
        this.box = document.createElement("div");
        // `own`: our own UI, not a user rule — stays excluded even on a site the
        // user set to "translate all elements".
        markNoTranslate(this.box, { own: true })
        this.box.id = BOX_ID;
        this.originalLine = document.createElement("div");
        this.translationLine = document.createElement("div");
        this.originalText = document.createElement("span");
        this.translationText = document.createElement("span");
        this.originalLine.appendChild(this.originalText);
        this.translationLine.appendChild(this.translationText);
        this.dragHandle = document.createElement("div");
        this.handlePill = document.createElement("div");
        this.dragHandle.appendChild(this.handlePill);
        // A child of the box, so hovering the handle keeps the box "hovered"
        // (mouseleave doesn't fire for descendants) and it travels with the box.
        this.box.appendChild(this.dragHandle);
        this.box.appendChild(this.originalLine);
        this.box.appendChild(this.translationLine);

        this.applyBaseStyles();
        this.applyStyle();

        player.appendChild(this.box);
        this.bindDrag();
        this.bindSelection();
        this.bindWordHover();
        this.bindResize();
        this.hide();
    }

    /**
     * Restyle immediately when the player is resized (window resize, theater
     * mode, fullscreen, mini player).
     *
     * Font sizes are scaled by the player height (see fontScale), but they are
     * only written in `applyStyle`, which used to run solely from `render` —
     * and `render` early-returns while the cue text is unchanged. So a resize
     * left the old font size on screen until the NEXT subtitle line arrived.
     * A ResizeObserver catches the size change itself, whatever caused it.
     */
    private bindResize(): void {
        const observer = new ResizeObserver(() => {
            if (this.disposed) return;
            this.applyStyle();
            // New font size / player width ⇒ new box height ⇒ the clamp range
            // moved too, so re-apply the position against the new geometry.
            this.applyPosition();
            // The panel is anchored to the box's top edge and to the word,
            // both of which just moved.
            if (this.activeWord) this.dict?.reposition(this.anchorFor(this.activeWord));
        });
        // Observing the player (not the box) — our own writes target the box,
        // so this can't feed back into itself.
        observer.observe(this.player);
        this.disposers.push(() => observer.disconnect());
    }

    /**
     * Clamp a requested bottom-offset to what currently fits.
     *
     * The ceiling is measured, not a fixed percentage: the box has real height
     * (1-2 lines, growing with font size and wrapping) and the grip needs room
     * ABOVE it. A constant ceiling let a tall cue push the box past the
     * player's top edge, clipping the text and putting the grip out of reach.
     */
    private clampPct(v: number): number {
        const playerH = this.player.clientHeight || 0;
        let min = MIN_BOTTOM_PCT;
        let max = MAX_BOTTOM_PCT;
        if (playerH > 0) {
            // Floor: clear of the player's control bar. The box now paints above
            // ALL player chrome (see the box's zIndex), so stacking order no
            // longer protects the progress bar — this does.
            const reservedBottom = this.callbacks.reservedBottomPx?.() ?? 0;
            if (reservedBottom > 0) min = (reservedBottom / playerH) * 100;

            const boxH = this.box?.getBoundingClientRect().height ?? 0;
            if (boxH > 0) {
                const reservedTop = boxH + HANDLE_TOTAL_PX + EDGE_MARGIN_PX;
                max = ((playerH - reservedTop) / playerH) * 100;
            }
        }
        // A very short player (or a very tall cue) can leave no valid range at
        // all; the floor wins there, since covering the controls is worse than
        // overflowing the top.
        if (max < min) max = min;
        return Math.min(max, Math.max(min, v));
    }

    /** Re-clamp the desired position against the current box size and apply it. */
    private applyPosition(): void {
        this.bottomPct = this.clampPct(this.desiredPct);
        this.box.style.bottom = `${this.bottomPct}%`;
    }

    /** Scale configured px sizes with the player so fullscreen text grows. */
    private fontScale(): number {
        const h = this.player.clientHeight || BASE_PLAYER_HEIGHT;
        return Math.min(1.8, Math.max(0.65, h / BASE_PLAYER_HEIGHT));
    }

    private applyBaseStyles(): void {
        Object.assign(this.box.style, {
            position: "absolute",
            // Centered by auto margins between zero insets, NOT by
            // `left:50% + translateX(-50%)`. An absolutely positioned box with
            // `width:auto` shrink-to-fits into "containing block width − left",
            // so anchoring at left:50% capped the box at HALF the player
            // however large `maxWidth` was, and long lines wrapped early.
            // `transform` only moves the paint, it does not give the layout any
            // room back. With both insets at 0 the available width is the whole
            // player, `fit-content` keeps the background hugging the text, and
            // maxWidth is what actually limits it.
            left: "0",
            right: "0",
            marginInline: "auto",
            width: "fit-content",
            bottom: `${this.bottomPct}%`,
            maxWidth: "86%",
            padding: "8px 16px",
            borderRadius: "6px",
            textAlign: "center",
            // Above ALL player chrome. This must beat YouTube's top bar
            // (.ytp-chrome-top, z-index 58): when the subtitle sits near the top
            // of the player, that bar otherwise covers the drag grip's band, so
            // the pointer moving up from the text lands on
            // `.ytp-chrome-top-buttons` — not a descendant of this box — which
            // fires `mouseleave` and makes the grip vanish mid-approach, and
            // also swallows the click. Threading a value between the top (58)
            // and bottom (59) bars was tried and did not hold in practice.
            // Since this now also paints over the bottom bar, the progress bar
            // is protected by the measured floor in clampPct
            // (`reservedBottomPx`), not by stacking order.
            zIndex: "999",
            cursor: "default",
            userSelect: "none",
            pointerEvents: "none",
            lineHeight: String(LINE_HEIGHT),
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily:
                '"YouTube Noto", Roboto, "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
        } as Partial<CSSStyleDeclaration>);
        // The box is a transparent sheet lying over someone else's UI, so it
        // must not collect clicks it has no use for. It is drawn above ALL
        // player chrome (see the zIndex note above), it is as wide as the
        // subtitle, and it sits in the same band as the player's bottom-right
        // action buttons — with `pointer-events: auto` it swallowed every press
        // aimed at Like / Dislike / Comment in fullscreen, from an area the
        // user perceives as empty.
        //
        // So: none from the box down, taken back only by the text spans. What
        // stays click-through is the padding, the gaps around a short line and
        // the blank tail of a wrapped one — the parts that look transparent and
        // now behave that way. The drag grip re-enables itself the same way
        // while it is visible (see setHandleVisible).
        //
        // The box remains in the EVENT PATH of anything the spans dispatch —
        // `pointer-events: none` stops an element being a hit target, it does
        // not remove it from its descendants' propagation or hover chain — so
        // `:hover`, mouseenter/mouseleave and the stopPropagation guards below
        // all keep working unchanged.
        for (const line of [this.originalLine, this.translationLine]) {
            Object.assign(line.style, {
                pointerEvents: "none",
            } as Partial<CSSStyleDeclaration>);
        }
        for (const text of [this.originalText, this.translationText]) {
            Object.assign(text.style, {
                userSelect: "text",
                cursor: "text",
                pointerEvents: "auto",
            } as Partial<CSSStyleDeclaration>);
        }

        // Drag grip, revealed on hover, sitting just above the box so it never
        // overlaps the text the user is selecting.
        //
        // Always ABOVE the box — never flipped below, so the grip is where the
        // user last saw it no matter how high the box is dragged. That is safe
        // because clampPct reserves HANDLE_TOTAL_PX of headroom above the box,
        // so there is always space for it inside the player.
        //
        // The wrapper is a transparent hover BRIDGE and must span the box's
        // FULL width (`left:0; right:0`), with the visible pill centred inside
        // it. A shrink-to-fit wrapper only covers the pill's own ~34px, so
        // moving the pointer up from anywhere off-centre on a wide subtitle
        // leaves the box into a strip owned by nobody — `mouseleave` fires and
        // the grip vanishes while the pointer is still over the subtitle.
        //
        // It is also anchored FLUSH to the box's top edge (`bottom: 100%`),
        // creating the visual gap with transparent bottom padding rather than
        // `calc(100% + Npx)`, which would reintroduce the same dead strip
        // vertically.
        Object.assign(this.dragHandle.style, {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "100%",
            paddingBottom: `${HANDLE_GAP_PX}px`,
            display: "flex",
            justifyContent: "center",
            opacity: "0",
            pointerEvents: "none",
            transition: "opacity 0.12s ease",
        } as Partial<CSSStyleDeclaration>);
        this.dragHandle.setAttribute("aria-hidden", "true");
        // Only the pill is grabbable — the rest of the wrapper is an invisible
        // hover bridge, so neither its cursor nor a drag should extend there.
        Object.assign(this.handlePill.style, {
            width: "34px",
            height: `${HANDLE_PILL_PX}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "5px",
            background: "rgba(28,28,28,0.85)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
            cursor: "grab",
        } as Partial<CSSStyleDeclaration>);
        // Six dots (2 rows x 3), the conventional "drag me" affordance.
        this.handlePill.innerHTML =
            '<svg width="16" height="10" viewBox="0 0 16 10" fill="#d0d0d0" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="2" cy="2.5" r="1.5"/><circle cx="8" cy="2.5" r="1.5"/><circle cx="14" cy="2.5" r="1.5"/>' +
            '<circle cx="2" cy="7.5" r="1.5"/><circle cx="8" cy="7.5" r="1.5"/><circle cx="14" cy="7.5" r="1.5"/>' +
            "</svg>";
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    setStyle(style: VideoSubtitleStyle): void {
        this.style = style;
        this.applyStyle();
        this.render(true);
    }

    setMode(mode: string): void {
        if (this.mode === mode) return;
        this.mode = mode;
        this.render(true);
    }

    /**
     * When on, selecting subtitle text pauses playback and clearing the
     * selection resumes it (opt-in setting).
     */
    setPauseOnSelect(v: boolean): void {
        this.pauseOnSelect = v;
        // Turning the setting off mid-pause must not strand the video.
        if (!v) this.releasePause(PAUSE_SELECTION);
    }

    /**
     * Hover-to-look-up: whether it is on, and the two languages the lookup
     * needs. The source language comes from the caption track, so — unlike the
     * selection popup, which has to guess from the selected text — the provider
     * can be chosen before asking anyone.
     */
    setDictContext(ctx: { enabled: boolean; sourceLang: string; targetLang: string }): void {
        const was = this.hoverDict;
        this.hoverDict = ctx.enabled;
        this.sourceLang = ctx.sourceLang;
        this.dictTargetLang = ctx.targetLang;
        if (!ctx.enabled) this.closeWordDict(true);
        // The original line is built differently in each mode, so a live toggle
        // has to redraw it.
        if (was !== ctx.enabled) this.render(true);
    }

    setPosition(bottomPct: number): void {
        this.desiredPct = bottomPct;
        this.applyPosition();
    }

    /** Show a cue (or refresh the current one after translation arrived). */
    show(cue: SubtitleCue): void {
        this.currentCue = cue;
        this.render(false);
    }

    hide(): void {
        // Unconditional and forced: the panel is anchored to a box that is
        // about to disappear, and its own pause must not outlive it. The early
        // return below only skips the (idempotent) box work.
        this.closeWordDict(true);
        if (this.currentCue === null && this.box.style.display === "none") return;
        this.currentCue = null;
        this.renderedText = null;
        this.renderedTranslated = null;
        this.box.style.display = "none";
    }

    destroy(): void {
        this.disposed = true;
        if (this.handleHideTimer !== null) {
            clearTimeout(this.handleHideTimer);
            this.handleHideTimer = null;
        }
        this.disposers.forEach((d) => d());
        this.disposers = [];
        this.cancelPendingWord();
        this.dict?.destroy();
        this.dict = null;
        this.activeWord = null;
        // Never leave the video stuck on a pause whose owner just went away
        // (feature switched off, player replaced on SPA navigation…).
        this.releaseAllPauses();
        this.box.remove();
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    private applyStyle(): void {
        const s = this.style;
        const scale = this.fontScale();
        this.box.style.background = hexToRgba(s.bgColor, s.bgOpacity);
        Object.assign(this.originalLine.style, {
            color: s.originalColor,
            fontSize: `${Math.round(s.originalSize * scale)}px`,
            fontWeight: String(s.originalWeight),
        } as Partial<CSSStyleDeclaration>);
        Object.assign(this.translationLine.style, {
            color: s.translationColor,
            fontSize: `${Math.round(s.translationSize * scale)}px`,
            fontWeight: String(s.translationWeight),
        } as Partial<CSSStyleDeclaration>);
    }

    /**
     * Replace one line's text, dropping any selection that covered it.
     *
     * Clearing has to be explicit. Overwriting `textContent` detaches the old
     * text node, which does collapse a selection anchored INSIDE that node —
     * but a range anchored on the LINE ELEMENT (what select-all and
     * triple-click produce: element + child offsets) survives the swap and
     * simply re-covers whatever text lands there, so every following subtitle
     * line came up looking fully selected.
     *
     * Skipping unchanged lines is what keeps a selection of the original text
     * alive when only the translation arrives a moment later.
     */
    private writeLine(el: HTMLElement, text: string): void {
        if (el.textContent === text) return;
        this.dropSelectionOver(el);
        el.textContent = text;
    }

    /** See {@link writeLine} — the half that has to happen before any rewrite. */
    private dropSelectionOver(el: HTMLElement): void {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.getRangeAt(0).intersectsNode(el)) {
            sel.removeAllRanges();
        }
    }

    /**
     * Write the original line, as one text node or as hoverable word tokens.
     *
     * The `wordsRendered` half of the guard is what makes a live toggle of the
     * setting take effect: the text is unchanged, so the textContent comparison
     * alone would skip the rebuild and leave the line in the old shape.
     */
    private writeOriginalLine(text: string): void {
        const el = this.originalText;
        if (el.textContent === text && this.wordsRendered === this.hoverDict) return;
        this.dropSelectionOver(el);
        this.wordsRendered = this.hoverDict;
        if (!this.hoverDict) {
            el.textContent = text;
            return;
        }
        el.textContent = "";
        el.append(...buildWordNodes(text));
    }

    private render(force: boolean): void {
        const cue = this.currentCue;
        if (!cue) return;
        if (!force && cue.text === this.renderedText && cue.translated === this.renderedTranslated) return;
        this.renderedText = cue.text;
        this.renderedTranslated = cue.translated;
        // Refresh scaled font sizes — cheap, and covers player resizes.
        this.applyStyle();
        // Translation-only still falls back to the original until the
        // translation lands, so the cue is never blank; original-only never
        // shows a translation even if one is already cached from a previous
        // mode.
        const showOriginal =
            this.mode !== VIDEO_SUBTITLE_DISPLAY_MODE.TRANSLATION || !cue.translated;
        const showTranslation =
            this.mode !== VIDEO_SUBTITLE_DISPLAY_MODE.ORIGINAL && !!cue.translated;
        this.writeOriginalLine(showOriginal ? cue.text : "");
        this.originalLine.style.display = showOriginal ? "" : "none";
        this.writeLine(this.translationText, showTranslation ? cue.translated ?? "" : "");
        this.translationLine.style.display = showTranslation ? "" : "none";
        this.box.style.display = "";
        // The hovered token belongs to the line that was just replaced. This
        // only happens when playback continues under an open panel — i.e. the
        // video was already paused by the user, so our own pause was a no-op.
        if (this.activeWord && !this.activeWord.isConnected) this.closeWordDict(true);
        // The box just changed height (line count / mode / font size), so the
        // fit ceiling moved — re-clamp so a tall cue can't overflow the top,
        // and let a short one spring back to the user's chosen position.
        this.applyPosition();
    }

    // ------------------------------------------------------------------
    // Vertical drag
    // ------------------------------------------------------------------

    private setHandleVisible(visible: boolean): void {
        if (this.handleHideTimer !== null) {
            clearTimeout(this.handleHideTimer);
            this.handleHideTimer = null;
        }
        // The dictionary panel sits exactly where the grip does and paints over
        // it. Hovering a word keeps the box hovered, so without this the grip
        // would be revealed and then half-covered for as long as the panel is
        // up. Restored by closeWordDict.
        const show = visible && this.activeWord === null;
        this.dragHandle.style.opacity = show ? "1" : "0";
        this.dragHandle.style.pointerEvents = show ? "auto" : "none";
    }

    /** Hide after a grace period, unless the pointer comes back or a drag starts. */
    private scheduleHandleHide(): void {
        if (this.handleHideTimer !== null) clearTimeout(this.handleHideTimer);
        this.handleHideTimer = window.setTimeout(() => {
            this.handleHideTimer = null;
            if (this.dragging) return;
            if (this.box.matches(":hover")) return;
            this.setHandleVisible(false);
        }, HANDLE_HIDE_DELAY_MS);
    }

    private bindDrag(): void {
        // The grip only appears while the pointer is over the subtitle box (or
        // while a drag is in flight, which can travel far outside it).
        const onEnter = () => this.setHandleVisible(true);
        const onLeave = () => {
            if (!this.dragging) this.scheduleHandleHide();
        };
        // Clicking the box must not reach the player, or YouTube toggles
        // play/pause under the user while they select text. stopPropagation
        // only — preventDefault would kill the selection itself.
        const swallow = (e: Event) => e.stopPropagation();

        const onHandleDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            this.dragging = true;
            this.setHandleVisible(true); // cancels any pending hide
            this.handlePill.style.cursor = "grabbing";
            const startY = e.clientY;
            // Drag from where the box actually IS, not from an out-of-range
            // desired value, so pushing past the ceiling and coming back down
            // doesn't need the same overshoot in reverse.
            const startPct = this.bottomPct;
            const playerH = this.player.clientHeight || 1;
            const onMove = (ev: MouseEvent) => {
                const deltaPct = ((startY - ev.clientY) / playerH) * 100;
                this.setPosition(startPct + deltaPct);
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove, true);
                document.removeEventListener("mouseup", onUp, true);
                this.dragging = false;
                this.handlePill.style.cursor = "grab";
                // Collapse intent onto what is actually shown, then persist it.
                this.desiredPct = this.bottomPct;
                // Pointer may have ended up outside the box during the drag.
                if (!this.box.matches(":hover")) this.scheduleHandleHide();
                this.callbacks.onPositionChange(this.bottomPct);
            };
            document.addEventListener("mousemove", onMove, true);
            document.addEventListener("mouseup", onUp, true);
        };

        this.box.addEventListener("mouseenter", onEnter);
        this.box.addEventListener("mouseleave", onLeave);
        this.box.addEventListener("mousedown", swallow);
        this.box.addEventListener("click", swallow);
        this.handlePill.addEventListener("mousedown", onHandleDown);
        this.disposers.push(() => {
            this.box.removeEventListener("mouseenter", onEnter);
            this.box.removeEventListener("mouseleave", onLeave);
            this.box.removeEventListener("mousedown", swallow);
            this.box.removeEventListener("click", swallow);
            this.handlePill.removeEventListener("mousedown", onHandleDown);
        });
    }

    // ------------------------------------------------------------------
    // Pause while subtitle text is selected
    // ------------------------------------------------------------------

    /** True while a non-empty selection lives inside the subtitle box. */
    private hasSelectionInBox(): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        if ((sel.toString().trim()) === "") return false;
        const anchor = sel.anchorNode;
        return !!anchor && this.box.contains(anchor);
    }

    private pauseFor(reason: string): void {
        this.pauseReasons.add(reason);
        const video = this.player.querySelector("video");
        // Already paused by the user — leave it alone, and remember that the
        // pause is not ours so we never "resume" into a state they chose.
        if (!video || video.paused) return;
        video.pause();
        this.pausedByUs = true;
    }

    /** Undo our own pause, once no reason is left and it is still ours to undo. */
    private releasePause(reason: string): void {
        this.pauseReasons.delete(reason);
        if (this.pauseReasons.size > 0) return;
        if (!this.pausedByUs) return;
        this.pausedByUs = false;
        const video = this.player.querySelector("video");
        // Not paused any more means the user restarted it themselves; nothing
        // to undo. `play()` rejects if the element is torn down mid-call.
        if (video && video.paused) void video.play().catch(() => { });
    }

    private releaseAllPauses(): void {
        this.pauseReasons.clear();
        this.releasePause(PAUSE_SELECTION);
    }

    private bindSelection(): void {
        const onMouseUp = () => {
            // Let the click finish first — the selection is final after mouseup.
            setTimeout(() => {
                if (this.disposed || this.dragging) return;
                if (!this.hasSelectionInBox()) {
                    this.releasePause(PAUSE_SELECTION);
                    return;
                }
                if (this.pauseOnSelect) this.pauseFor(PAUSE_SELECTION);
            }, 0);
        };
        const onDocMouseDown = (e: MouseEvent) => {
            // A press inside the box starts a new selection drag: hold off the
            // resume until it ends, or the video would stutter back to life for
            // the length of the drag (`selectionchange` collapses the old
            // selection the moment the drag begins).
            this.selecting = this.box.contains(e.target as Node);
            // A press on a word starts a selection, not a lookup: get the panel
            // out of the way rather than have it hover over the drag.
            if (this.selecting) this.closeWordDict();
        };
        const onDocMouseUp = () => {
            if (!this.selecting) return;
            this.selecting = false;
            // The drag may have ended on empty space — settle after the
            // selection is final (same reason as onMouseUp's timeout).
            setTimeout(() => {
                if (this.disposed) return;
                if (!this.hasSelectionInBox()) this.releasePause(PAUSE_SELECTION);
            }, 0);
        };
        /**
         * Single source of truth for "the selection went away": covers every
         * route out of a selection — clicking elsewhere, pressing a key,
         * Escape, the page rewriting the subtitle text under it — instead of
         * one handler per route.
         */
        const onSelectionChange = () => {
            if (this.disposed || this.selecting) return;
            if (this.hasSelectionInBox()) return;
            this.releasePause(PAUSE_SELECTION);
        };
        this.box.addEventListener("mouseup", onMouseUp);
        document.addEventListener("mousedown", onDocMouseDown, true);
        document.addEventListener("mouseup", onDocMouseUp, true);
        document.addEventListener("selectionchange", onSelectionChange);
        this.disposers.push(() => {
            this.box.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("mousedown", onDocMouseDown, true);
            document.removeEventListener("mouseup", onDocMouseUp, true);
            document.removeEventListener("selectionchange", onSelectionChange);
        });
    }

    // ------------------------------------------------------------------
    // Hover a word → dictionary panel
    // ------------------------------------------------------------------

    /**
     * One document-level `mouseover` decides both halves — which word to open
     * and when to close — because they are the same question asked of one
     * pointer position, and splitting them across `mouseenter`/`mouseleave`
     * pairs on two different trees (the tokens in the light DOM, the panel in a
     * ShadowRoot) means every ordering bug in that pair becomes a stuck panel
     * or a stuck pause.
     *
     * Neutral ground while travelling is ANY of our own surfaces plus the part
     * of the original line that is ON or ABOVE the hovered word's own visual
     * line (`withinWordLine`).
     *
     * "Any of our own surfaces", not just the panel: a lookup started from
     * inside the panel goes panel → selection pill → selection-translate card,
     * three separate hosts. Testing only for the panel closed it the instant
     * the pointer reached the pill — which removed the panel, which killed the
     * selection the pill was offering to translate. Everything in that chain is
     * one interaction; the page and the player are what "somewhere else" means.
     *
     * The two halves of the line rule are both load-bearing:
     *   - the gaps between words on the same line, or the panel would close and
     *     reopen for every word the pointer passes — a flicker and a second
     *     lookup each time;
     *   - everything above it, because on a wrapped original the way up to the
     *     panel crosses the earlier line.
     * Anything BELOW — the next wrapped line, the translation line, the rest of
     * the page — closes the panel.
     *
     * `mouseover` alone cannot enforce that: it fires when the target element
     * changes, and drifting from one blank spot of the line to another never
     * changes the target. The geometry therefore also runs on `mousemove`,
     * which costs one null check per event while no panel is open.
     */
    private bindWordHover(): void {
        const onOver = (e: MouseEvent) => {
            if (this.disposed || !this.hoverDict) return;
            // Mid-selection the pointer is dragging, not resting: opening a
            // panel over the text being selected helps nobody.
            if (this.selecting) return;
            const path = e.composedPath();
            const word = this.wordFromPath(path);
            if (word) {
                this.openWordDict(word);
                return;
            }
            // Left the word before the delay ran out — that was a sweep, not a
            // hover. The neutral ground below only protects an OPEN panel.
            this.cancelPendingWord();
            if (!this.activeWord) return;
            if (this.keepDictOpen(path[0] ?? null, e.clientX, e.clientY)) return;
            this.closeWordDict();
        };
        const onMove = (e: MouseEvent) => {
            if (!this.activeWord || this.disposed) return;
            // Recorded only while a panel is open, to answer one question once:
            // where the pointer was when a derived card closed.
            this.lastPointer = { x: e.clientX, y: e.clientY };
            // `mouseover` only fires when the TARGET changes, and drifting from
            // one blank spot of the subtitle to another never changes it — so
            // the same decision is re-taken on every move.
            if (this.keepDictOpen(e.target, e.clientX, e.clientY)) return;
            this.closeWordDict();
        };
        // The pointer leaving the window fires no further `mouseover`, so the
        // panel would hang there until it came back.
        const onDocLeave = () => this.closeWordDict();
        const stopWatchPopup = watchSelectionPopupOpen((open) => {
            if (!open) this.reevaluateHover();
        });
        document.addEventListener("mouseover", onOver, true);
        document.addEventListener("mousemove", onMove, true);
        document.documentElement.addEventListener("mouseleave", onDocLeave);
        this.disposers.push(() => {
            stopWatchPopup();
            document.removeEventListener("mouseover", onOver, true);
            document.removeEventListener("mousemove", onMove, true);
            document.documentElement.removeEventListener("mouseleave", onDocLeave);
        });
    }

    /**
     * Re-apply the auto-hide rules after a derived selection-translate card
     * closed, using where the pointer actually is.
     *
     * Needed because the rules are event-driven: they were suppressed for the
     * card's whole lifetime, and the events that would have closed the panel
     * (the pointer leaving the word) happened while they were off. Simply
     * waiting for the next pointer move is not enough — the card is often
     * dismissed with Escape or a click, after which the pointer may never move
     * again, and the panel plus a paused video would sit there for good.
     *
     * `elementFromPoint` retargets to the shadow HOST, which `isInOwnUi`
     * resolves back to the surface it belongs to — the same answer a live
     * event would have given.
     */
    private reevaluateHover(): void {
        if (this.disposed || !this.activeWord) return;
        const p = this.lastPointer;
        if (p && this.keepDictOpen(document.elementFromPoint(p.x, p.y), p.x, p.y)) return;
        this.closeWordDict();
    }

    /**
     * Should the panel survive a pointer at this target / position?
     *
     * Two independent reasons to keep it: the pointer is on one of our own
     * surfaces (the panel, the selection pill, the card it spawns — one
     * interaction, see bindWordHover), or it is still on the hovered word's own
     * line.
     *
     * The second test is GEOMETRIC and has to be. It used to ask whether the
     * event had hit `originalLine`, which stopped working the moment the
     * overlay was made click-through for the player's buttons: only the glyphs
     * are hit targets now, so the spaces between words and the leading above
     * and below them all resolve to the video underneath. Measuring the line
     * band directly asks the question the rule always meant.
     */
    private keepDictOpen(target: EventTarget | null, x: number, y: number): boolean {
        if (target instanceof Node && isInOwnUi(target)) return true;
        const word = this.activeWord;
        if (!word) return false;
        const line = this.originalLine.getBoundingClientRect();
        if (x < line.left || x > line.right) return false;
        const bounds = this.wordLineBounds(word);
        return y >= bounds.top && y <= bounds.bottom;
    }

    /** The word token under the pointer, or null if the path leaves the line first. */
    private wordFromPath(path: EventTarget[]): HTMLElement | null {
        for (const node of path) {
            if (node === this.originalLine) return null;
            if (node instanceof HTMLElement && node.hasAttribute(WORD_ATTR)) return node;
        }
        return null;
    }

    private anchorFor(word: HTMLElement): WordDictAnchor {
        const rect = word.getBoundingClientRect();
        // The word's OWN box top, not its line box top. The difference is the
        // half-leading, and anchoring above it left that strip belonging to
        // neither the word nor the panel — with the overlay click-through, a
        // pointer crossing it slowly hit the video underneath and read as
        // "moved somewhere else".
        return { wordRect: rect, lineTopY: rect.top };
    }

    /**
     * Viewport top/bottom of the LINE BOX the word sits on.
     *
     * Not the word's own rect: an inline span's rect is its em box, which is
     * shorter than the line box it lives in. The missing part is the leading,
     * split evenly above and below — so adding half of it back on each side
     * gives the band the reader perceives as "this line", which is what both
     * callers need (where the panel's bottom edge goes, and where travelling
     * along the sentence stops being travel).
     */
    private wordLineBounds(word: HTMLElement): { top: number; bottom: number } {
        const rect = word.getBoundingClientRect();
        const lineBox = Math.round(this.style.originalSize * this.fontScale()) * LINE_HEIGHT;
        const halfLeading = Math.max(0, (lineBox - rect.height) / 2);
        return { top: rect.top - halfLeading, bottom: rect.bottom + halfLeading };
    }

    private openWordDict(word: HTMLElement): void {
        if (this.activeWord === word || this.pendingWord === word) return;
        this.cancelPendingWord();
        // A panel is already up: swapping words is instant.
        if (this.activeWord) {
            this.showWordDict(word);
            return;
        }
        this.pendingWord = word;
        this.hoverOpenTimer = window.setTimeout(() => {
            this.hoverOpenTimer = null;
            this.pendingWord = null;
            // The cue may have been replaced while the pointer rested (the
            // video was already paused by the user, so ours was a no-op).
            if (this.disposed || !this.hoverDict || !word.isConnected) return;
            this.showWordDict(word);
        }, HOVER_OPEN_DELAY_MS);
    }

    private cancelPendingWord(): void {
        if (this.hoverOpenTimer !== null) {
            clearTimeout(this.hoverOpenTimer);
            this.hoverOpenTimer = null;
        }
        this.pendingWord = null;
    }

    private showWordDict(word: HTMLElement): void {
        this.highlightWord(this.activeWord, false);
        this.activeWord = word;
        this.highlightWord(word, true);
        this.setHandleVisible(false);
        // Hold the video for as long as the panel is up — reading a definition
        // takes longer than the cue is on screen.
        this.pauseFor(PAUSE_HOVER);
        this.dict ??= new WordDictPanel({
            player: this.player,
            onClose: () => this.closeWordDict(),
        });
        this.dict.show(
            word.getAttribute(WORD_ATTR) ?? "",
            this.sourceLang,
            this.dictTargetLang,
            this.anchorFor(word),
        );
    }

    /**
     * `force` skips the derived-card hold below. Reserved for teardown paths
     * (the box being hidden, the feature switched off), where leaving the panel
     * up would strand it over nothing.
     */
    private closeWordDict(force = false): void {
        this.cancelPendingWord();
        if (!this.activeWord && !this.dict?.isOpen()) return;
        // A selection-translate card was spawned FROM this panel. Closing it —
        // and resuming playback — while the user is reading that card would
        // pull the ground out from under it, so the auto-hide rules are held
        // until the card is gone (see reevaluateHover, which re-applies them).
        if (!force && isSelectionPopupOpen()) return;
        this.highlightWord(this.activeWord, false);
        this.activeWord = null;
        this.dict?.hide();
        this.releasePause(PAUSE_HOVER);
        // The grip was suppressed for the panel's sake; the pointer may well
        // still be on the box, where it belongs.
        if (!this.disposed && this.box.matches(":hover")) this.setHandleVisible(true);
    }

    /**
     * Inline, not a class: page CSS cannot reach the box (everything here is
     * inline for that reason), and translucent white reads on every subtitle
     * colour the user can configure, over a background they also control.
     */
    private highlightWord(word: HTMLElement | null, on: boolean): void {
        if (!word) return;
        word.style.backgroundColor = on ? "rgba(255,255,255,0.28)" : "";
        word.style.borderRadius = on ? "3px" : "";
    }
}

/**
 * Split a subtitle line into hoverable word tokens and plain text.
 *
 * The serialization is unchanged — concatenating the nodes reproduces `text`
 * byte for byte — so selecting across tokens still yields the original line,
 * and the selection-translate popup sees exactly what it saw before.
 */
function buildWordNodes(text: string): Node[] {
    const out: Node[] = [];
    let last = 0;
    WORD_SCAN_RE.lastIndex = 0;
    for (let m = WORD_SCAN_RE.exec(text); m !== null; m = WORD_SCAN_RE.exec(text)) {
        // A trailing joiner belongs to the punctuation, not the headword:
        // "well-" at a line break must be looked up as "well".
        const word = m[0].replace(TRAILING_JOINERS_RE, "");
        if (word === "" || !isDictWord(word)) continue;
        if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement("span");
        span.setAttribute(WORD_ATTR, word);
        span.textContent = word;
        out.push(span);
        last = m.index + word.length;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
    return out;
}
