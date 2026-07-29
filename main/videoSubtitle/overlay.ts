import { VIDEO_SUBTITLE_DISPLAY_MODE } from "@/main/constants";
import type { SubtitleCue, VideoSubtitleStyle } from "./types";
import { markNoTranslate } from "../dom/paragraphMarks";
import { t } from "@/main/aiWriting/i18n";

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
 * centered. Selecting text inside the box surfaces a small translate button
 * near the selection.
 */

export interface OverlayCallbacks {
    /** Drag finished — persist the new bottom-offset percentage. */
    onPositionChange(bottomPct: number): void;
    /** User clicked the mini translate button on a text selection. */
    onTranslateSelection(text: string, rect: DOMRect | null): void;
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

/** Side of the square selection mini-button, px. */
const SELECT_BTN_PX = 26;
/**
 * Lucide's "languages" glyph — the 文/A translate mark used by the rest of the
 * UI. Inlined because this surface is deliberately vanilla DOM (see the class
 * doc), so the lucide-react component is not available here. `currentColor`
 * makes it follow the button's own color.
 */
const TRANSLATE_ICON_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>' +
    '<path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>' +
    "</svg>";

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
    private selectBtn: HTMLButtonElement;
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
    private pausedBySelection = false;
    /** A selection drag is in progress (button held down inside the box). */
    private selecting = false;
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
        markNoTranslate(this.box)
        this.box.id = BOX_ID;
        this.originalLine = document.createElement("div");
        this.translationLine = document.createElement("div");
        this.dragHandle = document.createElement("div");
        this.handlePill = document.createElement("div");
        this.dragHandle.appendChild(this.handlePill);
        // A child of the box, so hovering the handle keeps the box "hovered"
        // (mouseleave doesn't fire for descendants) and it travels with the box.
        this.box.appendChild(this.dragHandle);
        this.box.appendChild(this.originalLine);
        this.box.appendChild(this.translationLine);

        this.selectBtn = document.createElement("button");
        this.selectBtn.type = "button";
        this.selectBtn.innerHTML = TRANSLATE_ICON_SVG;
        const translateLabel = t("translate", "Translate");
        this.selectBtn.title = translateLabel;
        this.selectBtn.setAttribute("aria-label", translateLabel);
        this.applyBaseStyles();
        this.applyStyle();

        player.appendChild(this.box);
        player.appendChild(this.selectBtn);
        this.bindDrag();
        this.bindSelection();
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
            lineHeight: "1.35",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily:
                '"YouTube Noto", Roboto, "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
        } as Partial<CSSStyleDeclaration>);
        for (const line of [this.originalLine, this.translationLine]) {
            Object.assign(line.style, {
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

        Object.assign(this.selectBtn.style, {
            position: "absolute",
            display: "none",
            // Must sit above the box itself (see the box's zIndex), or the
            // button is hidden behind the subtitle it belongs to.
            zIndex: "1000",
            width: `${SELECT_BTN_PX}px`,
            height: `${SELECT_BTN_PX}px`,
            borderRadius: "6px",
            border: "none",
            background: "#1f1f1f",
            color: "#fff",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            padding: "0",
        } as Partial<CSSStyleDeclaration>);
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
        if (!v) this.resumePlayback();
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
        if (this.currentCue === null && this.box.style.display === "none") return;
        this.currentCue = null;
        this.renderedText = null;
        this.renderedTranslated = null;
        this.box.style.display = "none";
        this.hideSelectButton();
    }

    destroy(): void {
        this.disposed = true;
        if (this.handleHideTimer !== null) {
            clearTimeout(this.handleHideTimer);
            this.handleHideTimer = null;
        }
        this.disposers.forEach((d) => d());
        this.disposers = [];
        // Never leave the video stuck on a pause whose owner just went away
        // (feature switched off, player replaced on SPA navigation…).
        this.resumePlayback();
        this.box.remove();
        this.selectBtn.remove();
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
     * Replace one line's text, dropping any selection that covered it. Returns
     * true if the selection was dropped.
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
    private writeLine(el: HTMLElement, text: string): boolean {
        if (el.textContent === text) return false;
        let cleared = false;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.getRangeAt(0).intersectsNode(el)) {
            sel.removeAllRanges();
            cleared = true;
        }
        el.textContent = text;
        return cleared;
    }

    private render(force: boolean): void {
        const cue = this.currentCue;
        if (!cue) return;
        if (!force && cue.text === this.renderedText && cue.translated === this.renderedTranslated) return;
        this.renderedText = cue.text;
        this.renderedTranslated = cue.translated;
        // Refresh scaled font sizes — cheap, and covers player resizes.
        this.applyStyle();
        const bilingual = this.mode === VIDEO_SUBTITLE_DISPLAY_MODE.BILINGUAL;
        const showOriginal = bilingual || !cue.translated;
        const clearedOriginal = this.writeLine(this.originalLine, showOriginal ? cue.text : "");
        this.originalLine.style.display = showOriginal ? "" : "none";
        const clearedTranslation = this.writeLine(this.translationLine, cue.translated ?? "");
        this.translationLine.style.display = cue.translated ? "" : "none";
        // The mini button acts on the selection, so it goes when the selection
        // does — otherwise it survived onto every following subtitle line,
        // pointing at text that was long gone.
        if (clearedOriginal || clearedTranslation) this.hideSelectButton();
        this.box.style.display = "";
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
        this.dragHandle.style.opacity = visible ? "1" : "0";
        this.dragHandle.style.pointerEvents = visible ? "auto" : "none";
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
    // Selection mini-button
    // ------------------------------------------------------------------

    private hideSelectButton(): void {
        this.selectBtn.style.display = "none";
    }

    /** True while a non-empty selection lives inside the subtitle box. */
    private hasSelectionInBox(): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        if ((sel.toString().trim()) === "") return false;
        const anchor = sel.anchorNode;
        return !!anchor && this.box.contains(anchor);
    }

    private pausePlayback(): void {
        const video = this.player.querySelector("video");
        // Already paused by the user — leave it alone, and remember that the
        // pause is not ours so we never "resume" into a state they chose.
        if (!video || video.paused) return;
        video.pause();
        this.pausedBySelection = true;
    }

    /** Undo our own pause, if that is still what is holding the video. */
    private resumePlayback(): void {
        if (!this.pausedBySelection) return;
        this.pausedBySelection = false;
        const video = this.player.querySelector("video");
        // Not paused any more means the user restarted it themselves; nothing
        // to undo. `play()` rejects if the element is torn down mid-call.
        if (video && video.paused) void video.play().catch(() => { });
    }

    private bindSelection(): void {
        const onMouseUp = () => {
            // Let the click finish first — the selection is final after mouseup.
            setTimeout(() => {
                if (this.disposed || this.dragging) return;
                const sel = window.getSelection();
                if (!this.hasSelectionInBox() || !sel) {
                    this.hideSelectButton();
                    this.resumePlayback();
                    return;
                }
                if (this.pauseOnSelect) this.pausePlayback();
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                const playerRect = this.player.getBoundingClientRect();
                // Position just above the selection, clamped inside the player.
                const btnW = SELECT_BTN_PX;
                let left = rect.left + rect.width / 2 - playerRect.left - btnW / 2;
                left = Math.max(4, Math.min(left, playerRect.width - btnW - 4));
                let top = rect.top - playerRect.top - btnW - 6;
                if (top < 4) top = rect.bottom - playerRect.top + 6;
                this.selectBtn.style.left = `${left}px`;
                this.selectBtn.style.top = `${top}px`;
                // "flex", not "" — the icon is centered by the flex box, and an
                // empty string would fall back to the button's own `inline-block`.
                this.selectBtn.style.display = "flex";
            }, 0);
        };
        const onDocMouseDown = (e: MouseEvent) => {
            if (e.target === this.selectBtn) return;
            this.hideSelectButton();
            // A press inside the box starts a new selection drag: hold off the
            // resume until it ends, or the video would stutter back to life for
            // the length of the drag (`selectionchange` collapses the old
            // selection the moment the drag begins).
            this.selecting = this.box.contains(e.target as Node);
        };
        const onDocMouseUp = () => {
            if (!this.selecting) return;
            this.selecting = false;
            // The drag may have ended on empty space — settle after the
            // selection is final (same reason as onMouseUp's timeout).
            setTimeout(() => {
                if (this.disposed) return;
                if (!this.hasSelectionInBox()) this.resumePlayback();
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
            this.hideSelectButton();
            this.resumePlayback();
        };
        const onBtnClick = (e: MouseEvent) => {
            e.stopPropagation();
            const sel = window.getSelection();
            const text = sel?.toString().trim() ?? "";
            let rect: DOMRect | null = null;
            try {
                if (sel && sel.rangeCount > 0) rect = sel.getRangeAt(0).getBoundingClientRect();
            } catch { /* detached range */ }
            this.hideSelectButton();
            if (text !== "") this.callbacks.onTranslateSelection(text, rect);
        };
        // The button must swallow mousedown so the player doesn't treat it as
        // a click on the video (pause) and the selection isn't cleared before
        // our click handler reads it.
        const onBtnMouseDown = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };
        this.box.addEventListener("mouseup", onMouseUp);
        document.addEventListener("mousedown", onDocMouseDown, true);
        document.addEventListener("mouseup", onDocMouseUp, true);
        document.addEventListener("selectionchange", onSelectionChange);
        this.selectBtn.addEventListener("click", onBtnClick);
        this.selectBtn.addEventListener("mousedown", onBtnMouseDown);
        this.disposers.push(() => {
            this.box.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("mousedown", onDocMouseDown, true);
            document.removeEventListener("mouseup", onDocMouseUp, true);
            document.removeEventListener("selectionchange", onSelectionChange);
            this.selectBtn.removeEventListener("click", onBtnClick);
            this.selectBtn.removeEventListener("mousedown", onBtnMouseDown);
        });
    }
}
