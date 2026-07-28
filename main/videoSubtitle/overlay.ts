import { VIDEO_SUBTITLE_DISPLAY_MODE } from "@/main/constants";
import type { SubtitleCue, VideoSubtitleStyle } from "./types";
import { markNoTranslate } from "../dom/paragraphMarks";

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
        this.selectBtn.textContent = "译";
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
            width: "26px",
            height: "26px",
            borderRadius: "6px",
            border: "none",
            background: "#1f1f1f",
            color: "#fff",
            fontSize: "13px",
            lineHeight: "26px",
            textAlign: "center",
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

    /** When on, selecting subtitle text pauses playback (opt-in setting). */
    setPauseOnSelect(v: boolean): void {
        this.pauseOnSelect = v;
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
        this.originalLine.textContent = showOriginal ? cue.text : "";
        this.originalLine.style.display = showOriginal ? "" : "none";
        this.translationLine.textContent = cue.translated ?? "";
        this.translationLine.style.display = cue.translated ? "" : "none";
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

    private bindSelection(): void {
        const onMouseUp = () => {
            // Let the click finish first — the selection is final after mouseup.
            setTimeout(() => {
                if (this.disposed || this.dragging) return;
                const sel = window.getSelection();
                const text = sel?.toString().trim() ?? "";
                if (!sel || text === "" || sel.rangeCount === 0) {
                    this.hideSelectButton();
                    return;
                }
                const anchor = sel.anchorNode;
                if (!anchor || !this.box.contains(anchor)) {
                    this.hideSelectButton();
                    return;
                }
                if (this.pauseOnSelect) {
                    const video = this.player.querySelector("video");
                    if (video && !video.paused) video.pause();
                }
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                const playerRect = this.player.getBoundingClientRect();
                // Position just above the selection, clamped inside the player.
                const btnW = 26;
                let left = rect.left + rect.width / 2 - playerRect.left - btnW / 2;
                left = Math.max(4, Math.min(left, playerRect.width - btnW - 4));
                let top = rect.top - playerRect.top - btnW - 6;
                if (top < 4) top = rect.bottom - playerRect.top + 6;
                this.selectBtn.style.left = `${left}px`;
                this.selectBtn.style.top = `${top}px`;
                this.selectBtn.style.display = "";
            }, 0);
        };
        const onDocMouseDown = (e: MouseEvent) => {
            if (e.target === this.selectBtn) return;
            this.hideSelectButton();
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
        this.selectBtn.addEventListener("click", onBtnClick);
        this.selectBtn.addEventListener("mousedown", onBtnMouseDown);
        this.disposers.push(() => {
            this.box.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("mousedown", onDocMouseDown, true);
            this.selectBtn.removeEventListener("click", onBtnClick);
            this.selectBtn.removeEventListener("mousedown", onBtnMouseDown);
        });
    }
}
