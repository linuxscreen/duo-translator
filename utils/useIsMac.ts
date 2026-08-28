import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// runtime.getPlatformInfo is the extension API for this and is supported on all
// three targets; navigator.platform is deprecated and navigator.userAgentData is
// Chromium-only. It is async, so the result is memoized at module scope — the
// non-Mac labels show for the first paint after a cold load, and re-mounts (tab
// switches within Options) are already resolved.
let platformIsMac: boolean | null = null;
let platformProbe: Promise<void> | null = null;

/**
 * Is this a Mac? Used wherever a modifier key has to be NAMED for the user:
 * macOS prints Control/Option on the keycap and writes shortcuts with symbols,
 * so the same stored value has to be drawn differently there.
 */
export function useIsMac(): boolean {
    const [isMac, setIsMac] = useState(platformIsMac ?? false);
    useEffect(() => {
        if (platformIsMac !== null) return;
        let cancelled = false;
        platformProbe ??= browser.runtime
            .getPlatformInfo()
            .then((info) => {
                platformIsMac = info.os === 'mac';
            })
            .catch(() => {
                // No platform info (unlikely) — fall back to the neutral labels.
                platformIsMac = false;
            });
        void platformProbe.then(() => {
            if (!cancelled) setIsMac(platformIsMac === true);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    return isMac;
}
