import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy-to-clipboard with transient "Copied" feedback — the standard pattern
 * for a button that flips its label after a successful copy and reverts after
 * a short delay.
 *
 * Returns `[copied, copy]`:
 *   - `copied` is `true` for `duration` ms after a successful write.
 *   - `copy(text)` writes to the clipboard, then starts/extends the timer.
 *
 * The pending timer is cleared on unmount (no setState-after-unmount) and on
 * every re-click, so rapid clicks keep extending the window cleanly instead of
 * reverting early.
 */
export function useCopyFeedback(duration = 1500): [boolean, (text: string) => void] {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
    }, []);

    const copy = useCallback((text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => {
                setCopied(false);
                timerRef.current = null;
            }, duration);
        }).catch(() => { /* clipboard blocked — leave label unchanged */ });
    }, [duration]);

    return [copied, copy];
}
