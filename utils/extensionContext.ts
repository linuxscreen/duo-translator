// ---------------------------------------------------------------------------
// "Is our extension still alive from this page's point of view?"
//
// Disabling, updating or reloading the extension does NOT unload the content
// scripts it already injected — there is no API that can, and the extension has
// no code running anywhere at that point to call one. The script keeps
// executing (React trees, observers, listeners are all still live) while Chrome
// tears the extension APIs out from under it: `chrome.runtime` disappears
// entirely, so every `chrome.*` call throws "Extension context invalidated.".
//
// Firefox does not have this problem — it destroys the content-script sandbox
// on unload — but the check below is harmless there.
//
// This module is deliberately dependency-free so the lowest-level helpers
// (utils/theme.ts, utils/reactiveConfig.ts) can use it without a cycle.
// ---------------------------------------------------------------------------

import { browser } from "wxt/browser";

/**
 * True while this page can still call `chrome.*`.
 *
 * `chrome.runtime` itself becomes `undefined` after invalidation (measured, not
 * just `chrome.runtime.id`), so the optional chaining is load-bearing — the
 * usual `chrome.runtime.id` probe would itself throw the error it is supposed
 * to detect. The property read is also wrapped, because a getter on a revoked
 * context can throw rather than return.
 */
export function isExtensionContextValid(): boolean {
    try {
        return !!browser?.runtime?.id;
    } catch {
        return false;
    }
}
