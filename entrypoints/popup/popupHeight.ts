// ---------------------------------------------------------------------------
// The height the popup opens at, remembered from the last time it was open.
//
// A toolbar popup has no intrinsic height: the window is sized to the document,
// so whatever is painted first IS the opening height and every later change to
// the document height moves the window in front of the user. The popup cannot
// paint its real layout on the first frame — the tab's domain, its translate
// status and the enabled services all come from background round trips — so
// there is always a placeholder frame first, and the only question is how tall
// it is.
//
// A hardcoded placeholder answers that with a guess, and the guess is wrong for
// exactly the users who trimmed the popup down (Options › Customization ›
// Extension popup): they get one visible snap on every single open. Leaving the
// placeholder without a height is worse, not better — the document is then a
// few pixels tall, so the window opens as a sliver and jumps UP to full size.
//
// So it is measured instead: the real height goes to localStorage (synchronous,
// unlike chrome.storage, which is the whole point — it has to be readable
// before the first paint) and comes back as the next open's placeholder. Only
// the first open after an install or a layout change can be wrong, and it
// corrects itself that same open.
//
// Same trick, same reason as the resolved-theme mirror in utils/theme.ts.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'duoPopupHeight';

/** Used until a real height has been recorded once (fresh install / cleared storage). */
const FALLBACK_HEIGHT = 480;

// Anything outside this is treated as corrupt rather than clamped: too small
// and the popup opens as a sliver, too tall and it opens padded with dead
// space, and both are worse than one honest guess. 600 is also where Chrome
// caps popup height, so a larger value could never have been measured here.
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 600;

/** The placeholder's height for this open. Read synchronously, before rendering. */
export function cachedPopupHeight(): number {
    try {
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        if (Number.isFinite(stored) && stored >= MIN_HEIGHT && stored <= MAX_HEIGHT) return stored;
    } catch { /* storage unavailable — the fallback is a fine answer */ }
    return FALLBACK_HEIGHT;
}

/**
 * Record the height the popup actually settled at.
 *
 * Called once, on the frame the real layout first lands — deliberately not kept
 * in sync afterwards. Later height changes are the user's own doing (expanding
 * the "other services" panel), and remembering one of those would make the NEXT
 * open start expanded-tall and then shrink, which is the flash this exists to
 * remove.
 */
export function rememberPopupHeight(px: number): void {
    const height = Math.round(px);
    if (!Number.isFinite(height) || height < MIN_HEIGHT || height > MAX_HEIGHT) return;
    try { localStorage.setItem(STORAGE_KEY, String(height)); } catch { /* noop */ }
}
