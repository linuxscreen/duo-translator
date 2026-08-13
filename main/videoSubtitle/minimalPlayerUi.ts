import { CONFIG_KEY } from "@/main/constants";
import { watchConfig } from "@/utils/reactiveConfig";
import { bottomControlsInsetPx } from "./playerMetrics";

/**
 * Minimal YouTube player UI — the native control bar appears only while the
 * pointer is inside the bottom band, nothing else reveals it, and in fullscreen
 * the surrounding furniture (title, ⓘ, like cluster, "More videos") stays
 * hidden even then.
 *
 * The approach is to override the RESULT, not to intercept the input.
 * Swallowing the player's `mousemove` was the obvious alternative and is a
 * trap: it works by convincing YouTube the mouse never moved, and `ytp-autohide`
 * also carries `cursor: none` on the player (measured), so the pointer would
 * vanish over the whole picture. It would equally starve the scrubber preview,
 * the volume slider and every control's hover state, all of which are driven by
 * the same event. Here YouTube keeps its own state and behaviour untouched; we
 * only decide whether the chrome is painted.
 *
 * What makes the hit test possible is that an auto-hidden `.ytp-chrome-bottom`
 * keeps its layout box (`display:block`, full height, `pointer-events:auto`;
 * only `opacity` is animated). That is the same fact `bottomControlsInsetPx`
 * relies on, and both features share it so the band and the subtitle's floor can
 * never drift apart.
 *
 * Deliberately no exemptions. Play/pause, seeking and every keyboard shortcut
 * make YouTube reveal the chrome; the `!important` opacity keeps it invisible
 * regardless, which is exactly what the setting promises.
 *
 * Hidden chrome is also made click-through. Invisible-but-clickable is worse
 * than visible: the fullscreen title, the ⓘ button and the Like cluster would
 * still swallow presses aimed at the picture, from targets the user cannot see.
 */

export interface MinimalPlayerUiController {
    destroy(): void;
}

const STYLE_ID = "duo-yt-minimal-ui-style";
/** Set on `<html>` while the band-gated chrome must stay hidden. */
const CONTROLS_HIDDEN_ATTR = "data-duo-yt-controls-hidden";
/**
 * Set on `<html>` while the page is fullscreen (and the feature is on).
 *
 * Our own flag rather than `:fullscreen` or YouTube's `.ytp-fullscreen`: the
 * element YouTube actually puts into fullscreen is an ancestor of the player,
 * not the player, so `#movie_player:fullscreen` would never match — while
 * `document.fullscreenElement !== null` is true whichever element it is.
 */
const FULLSCREEN_ATTR = "data-duo-yt-fullscreen";

/**
 * Chrome that comes back when the pointer reaches the bottom band: the toolbar
 * proper. All of it is one auto-hiding surface driven by one timer, so the top
 * bar travels with the bottom one — leaving the title bar to pop up over the
 * picture would defeat the point of pinning the toolbar down.
 */
const BAND_GATED = [
    ".ytp-chrome-bottom",
    ".ytp-gradient-bottom",
    ".ytp-chrome-top",
    ".ytp-gradient-top",
    // The modern layout moved the floating chrome OUT of `.ytp-chrome-top` and
    // into these four slots of `.ytp-overlays-container`: the fullscreen title
    // (top-left), the ⓘ cards / More / Copy-link buttons (top-right), the
    // suggested-action badges (bottom-left) and the fullscreen like / dislike /
    // comment cluster (bottom-right). Gating `.ytp-chrome-top` alone misses all
    // of them. Windowed only — in fullscreen they are covered unconditionally
    // by FULLSCREEN_GATED below.
    ...overlaySlots(),
];

/**
 * Hidden for the whole time the page is fullscreen — the band brings back the
 * toolbar, never these.
 *
 * The distinction is what the surfaces are FOR. The toolbar is how you drive
 * the player, so it has to be reachable; these are page furniture that YouTube
 * floats over a fullscreen picture (title, ⓘ, like / dislike / comment, the
 * "More videos" grid), and reaching them is not why anyone went fullscreen.
 */
const FULLSCREEN_GATED = [
    ...overlaySlots(),
    // `aria-label="More videos"` — a direct child of the player holding both
    // the bottom-centre pill and the grid of stills it expands into.
    ".ytp-fullscreen-grid",
];

/** The four floating-chrome slots of `.ytp-overlays-container`. */
function overlaySlots(): string[] {
    return [
        ".ytp-overlay-top-left",
        ".ytp-overlay-top-right",
        ".ytp-overlay-bottom-left",
        ".ytp-overlay-bottom-right",
    ];
}

/**
 * `opacity` for the hiding, because it leaves layout alone: `display:none`
 * would collapse the very boxes this module measures to find the band, and
 * `visibility:hidden` would drop the controls out of hit testing while the
 * pointer is on its way into them. It also hides the whole subtree as one
 * group, which no descendant can opt out of.
 *
 * The `*` in the pointer-events rule is required, not defensive. Each overlay
 * slot already carries `pointer-events: none` so it does not block the video,
 * and its children re-declare `auto` — inheriting `none` from the slot would
 * simply be overridden, leaving an invisible but perfectly clickable Like
 * button sitting over the video.
 */
function rulesFor(attr: string, selectors: string[]): string {
    const scoped = (s: string) => `html[${attr}] #movie_player ${s}`;
    return `
${selectors.map(scoped).join(",\n")} {
    opacity: 0 !important;
}
${selectors.flatMap((s) => [scoped(s), scoped(`${s} *`)]).join(",\n")} {
    pointer-events: none !important;
}
`;
}

const GATE_CSS = rulesFor(CONTROLS_HIDDEN_ATTR, BAND_GATED) + rulesFor(FULLSCREEN_ATTR, FULLSCREEN_GATED);

export function initMinimalPlayerUi(): MinimalPlayerUiController {
    let enabled = false;
    let hidden = false;
    let fullscreen = false;
    let disposed = false;
    let rafId: number | null = null;
    /** Last pointer position, or null when it is not in the document at all. */
    let pointer: { x: number; y: number } | null = null;

    const setStyleInstalled = (install: boolean) => {
        const existing = document.getElementById(STYLE_ID);
        if (!install) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = GATE_CSS;
        document.documentElement.appendChild(style);
    };

    const setHidden = (v: boolean) => {
        if (hidden === v) return;
        hidden = v;
        if (v) document.documentElement.setAttribute(CONTROLS_HIDDEN_ATTR, "");
        else document.documentElement.removeAttribute(CONTROLS_HIDDEN_ATTR);
    };

    /** Drives FULLSCREEN_GATED, which the bottom band deliberately cannot lift. */
    const syncFullscreen = () => {
        const on = enabled && document.fullscreenElement !== null;
        if (on === fullscreen) return;
        fullscreen = on;
        if (on) document.documentElement.setAttribute(FULLSCREEN_ATTR, "");
        else document.documentElement.removeAttribute(FULLSCREEN_ATTR);
    };

    /**
     * Re-measure the band and decide. Run from a rAF so a burst of `mousemove`
     * costs one layout read, and so the read happens at a point in the frame
     * where layout is already clean.
     */
    const evaluate = () => {
        rafId = null;
        if (disposed || !enabled) return;
        const player = document.getElementById("movie_player");
        if (!(player instanceof HTMLElement) || !pointer) {
            setHidden(true);
            return;
        }
        const r = player.getBoundingClientRect();
        const inX = pointer.x >= r.left && pointer.x <= r.right;
        // Measured every time on purpose: the band grows a little once the
        // controls are shown (the progress bar thickens). Growing is the safe
        // direction — it cannot oscillate, it only makes leaving the band
        // slightly stickier than entering it.
        const inY = pointer.y >= r.bottom - bottomControlsInsetPx(player) && pointer.y <= r.bottom;
        setHidden(!(inX && inY));
    };

    const schedule = () => {
        if (rafId !== null || disposed || !enabled) return;
        rafId = requestAnimationFrame(evaluate);
    };

    const onMove = (e: MouseEvent) => {
        if (!enabled) return;
        pointer = { x: e.clientX, y: e.clientY };
        schedule();
    };
    /** Pointer gone from the document — no further mousemove is coming. */
    const onLeave = () => {
        if (!enabled) return;
        pointer = null;
        schedule();
    };
    /**
     * The player's rect moves without the pointer moving: fullscreen, theater
     * mode, window resize. The stored position is still valid, the band is not.
     */
    const onGeometryChange = () => {
        syncFullscreen();
        schedule();
    };

    document.addEventListener("mousemove", onMove, true);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", onGeometryChange);
    document.addEventListener("fullscreenchange", onGeometryChange);

    const stopWatch = watchConfig<boolean>(CONFIG_KEY.YOUTUBE_MINIMAL_PLAYER_UI, (on) => {
        if (disposed || on === enabled) return;
        enabled = on;
        setStyleInstalled(on);
        if (!on) {
            setHidden(false);
            syncFullscreen();
            return;
        }
        // Turning it on hides immediately; the first pointer move settles it.
        // Starting from "shown" would leave the chrome up until the user
        // happened to move, which reads as the setting not having applied.
        setHidden(true);
        syncFullscreen();
        schedule();
    });

    return {
        destroy() {
            disposed = true;
            stopWatch();
            if (rafId !== null) cancelAnimationFrame(rafId);
            document.removeEventListener("mousemove", onMove, true);
            document.documentElement.removeEventListener("mouseleave", onLeave);
            window.removeEventListener("resize", onGeometryChange);
            document.removeEventListener("fullscreenchange", onGeometryChange);
            setStyleInstalled(false);
            setHidden(false);
            enabled = false;
            syncFullscreen();
        },
    };
}
