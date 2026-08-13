/**
 * Geometry of the YouTube player's own chrome, shared by everything that has to
 * reason about where the native controls are: the subtitle overlay (which must
 * stay clear of them) and the chrome gate (which shows them only while the
 * pointer is inside that band).
 *
 * Split out so the two features answer the question with the SAME number. A
 * gate whose band did not line up with the subtitle's floor would show the
 * controls at one edge and reserve space at another.
 */

/** Fallback share of the player height reserved at the bottom if nothing measurable is found. */
const FALLBACK_BOTTOM_INSET_RATIO = 0.09;

/**
 * Height of the player's bottom control band — the strip the subtitle must not
 * cover, so the progress bar stays visible and clickable.
 *
 * Measured rather than hardcoded (it scales with the player), and measured even
 * while the controls are auto-hidden: YouTube keeps their layout boxes and only
 * animates opacity, so the value is stable whether the controls are shown or
 * not. That stability is the point — a floor that changed with control
 * visibility would make the subtitle jump exactly when the user moves the mouse,
 * and it is also what lets the gate hit-test a band it has just made invisible.
 *
 * The progress bar is taken into account separately because it is positioned
 * slightly ABOVE `.ytp-chrome-bottom`'s own top edge.
 */
export function bottomControlsInsetPx(player: HTMLElement): number {
    const playerBottom = player.getBoundingClientRect().bottom;
    let topMost = playerBottom;
    for (const sel of [".ytp-chrome-bottom", ".ytp-progress-bar-container"]) {
        const el = player.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top < topMost) topMost = r.top;
    }
    const measured = playerBottom - topMost;
    return measured > 0 ? measured : Math.round(player.clientHeight * FALLBACK_BOTTOM_INSET_RATIO);
}
