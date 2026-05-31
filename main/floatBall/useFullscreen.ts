import { useEffect, useState } from "react";

/**
 * Tracks whether an *element* (e.g. a `<video>` or its player container) is
 * currently in the Fullscreen API's fullscreen state.
 *
 * Returns `true` only when some element OTHER than `document.documentElement`
 * is fullscreen — that's the "video player went fullscreen" case where the
 * top-layer element covers the page and the float ball should be hidden.
 *
 * Whole-page fullscreen (a site calling `documentElement.requestFullscreen()`,
 * or the browser's own F11 which doesn't use the Fullscreen API at all) keeps
 * the page — and the ball — visible, so we deliberately do NOT hide for it.
 */
export function useFullscreen(): boolean {
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        const update = () => {
            const el =
                document.fullscreenElement ||
                (document as any).webkitFullscreenElement ||
                null;
            setFullscreen(!!el);
        };
        document.addEventListener("fullscreenchange", update);
        // Safari / older Chromium prefixed event.
        document.addEventListener("webkitfullscreenchange", update);
        update();
        return () => {
            document.removeEventListener("fullscreenchange", update);
            document.removeEventListener("webkitfullscreenchange", update);
        };
    }, []);
    return fullscreen;
}
