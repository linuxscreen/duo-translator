import { useSyncExternalStore } from "react";
import { storage, type StorageItemKey } from "wxt/utils/storage";
import { configDefault, type CONFIG_KEY } from "@/main/constants";

/**
 * Generic reactive view over `chrome.storage.local` config keys.
 *
 * Why this exists: config is written through the background (`setConfig` →
 * `configRepo`), but every other context only reads it once at mount and never
 * learns about later edits — so changing a setting in Options doesn't update an
 * open page (floating dot, popup, etc.) until reload. `chrome.storage`'s change
 * event fires in EVERY context (content scripts included) on any write, with no
 * cooperation from the writer, so `storage.watch` is the most robust transport:
 * it can't be missed (unlike a hand-broadcast `runtime` message) and needs no
 * per-key wiring at the write sites.
 *
 * This module is deliberately config-agnostic — it works for any `CONFIG_KEY`,
 * not just the AI-writing ones — so popup / options / content can adopt it too.
 *
 * Keys live in the `local:` area under the `config_` prefix, matching
 * `configStore.ts` (`local:config_<name>`). Reads here go straight to storage
 * (no background round-trip); writes still go through `setConfig` so cloud-sync
 * bookkeeping (`touchKey`) stays intact, and the resulting change event feeds
 * back through `watch` to refresh every reader.
 */

const CONFIG_AREA_PREFIX = "local:config_";
const storageKey = (key: CONFIG_KEY): StorageItemKey =>
    `${CONFIG_AREA_PREFIX}${key}` as StorageItemKey;

// Latest known value per key. Absent from the map = "not hydrated yet" and the
// snapshot is `undefined`; once hydrated/changed the stored reference is
// authoritative and stable (so `useSyncExternalStore` won't loop).
const cache = new Map<string, unknown>();
// First read from storage, per key. Kept so `readConfig` can await it instead
// of handing back the caller's default before the value has landed.
const hydration = new Map<string, Promise<void>>();
const subscribers = new Map<string, Set<() => void>>();
// One live `storage.watch` unwatcher per key. Kept for the page lifetime even
// when subscriber count hits zero — config keys are few and long-lived, and
// re-watching on every mount/unmount would needlessly drop the warm cache.
const watching = new Set<string>();

function notify(key: string) {
    subscribers.get(key)?.forEach((cb) => cb());
}

function ensureWatching(key: CONFIG_KEY) {
    if (watching.has(key)) return;
    watching.add(key);
    const sk = storageKey(key);
    // One-shot hydration.
    hydration.set(key, storage.getItem(sk).then((v) => {
        cache.set(key, v ?? undefined);
        notify(key);
    }));
    // React to every future write from any context.
    storage.watch(sk, (newValue) => {
        cache.set(key, newValue ?? undefined);
        notify(key);
    });
}

function subscribe(key: CONFIG_KEY, cb: () => void): () => void {
    let set = subscribers.get(key);
    if (!set) {
        set = new Set();
        subscribers.set(key, set);
    }
    set.add(cb);
    ensureWatching(key);
    return () => {
        set!.delete(cb);
    };
}

/**
 * Imperative read for non-React call sites (event handlers, plain helpers).
 * Always resolves to the STORED value, falling back to the key's shipped
 * default from `DEFAULT_VALUE` (via {@link configDefault}) when it has never
 * been written — the same resolution `configRepo` uses, so a given key reads
 * identically through either path. Keys with no DEFAULT_VALUE entry read as
 * `undefined`, which for them is a meaningful "user has not chosen".
 *
 * Async on purpose. The first read of a key has to go to `chrome.storage`,
 * which is async, and a synchronous version could only paper over that by
 * returning the default — indistinguishable, to the caller, from a stored value
 * that happens to equal it. That silent wrong answer cost this codebase five
 * separate bugs (a saved subtitle position lost on reload, a menu check-mark
 * inverted, a disabled feature's button flashing on screen, a whole video
 * segmented with the wrong setting). Awaiting is cheap: only the first read per
 * key actually waits on storage, later ones resolve from the cache on a
 * microtask, and every write from any context refreshes it through `watch`.
 */
export async function readConfig<T>(key: CONFIG_KEY): Promise<T> {
    ensureWatching(key);
    if (!cache.has(key)) await hydration.get(key);
    const v = cache.get(key);
    return (v === undefined ? configDefault(key) : v) as T;
}

/**
 * Reactive config value. Re-renders the calling component whenever the key is
 * written from ANY context (Options, popup, background, this frame).
 *
 * Defaults resolve exactly as in {@link readConfig} — from `DEFAULT_VALUE`, not
 * from the call site. Besides keeping the two readers in agreement, this fixes
 * the referential-stability trap the old `defaultValue` parameter had: an
 * inline `[]` was a fresh array every render, so the pre-hydration snapshot
 * churned and `useSyncExternalStore` could loop. `DEFAULT_VALUE`'s entries are
 * module-level constants, so the snapshot is stable by construction.
 *
 * Unlike `readConfig` this cannot await, so it DOES return the default until
 * hydration lands (inherent to a synchronous React store) and re-renders with
 * the stored value when it arrives. Anything that must not act on a provisional
 * value belongs in `readConfig`, not here.
 */
export function useConfig<T>(key: CONFIG_KEY): T {
    const value = useSyncExternalStore(
        (cb) => subscribe(key, cb),
        () => cache.get(key) as T | undefined,
    );
    return (value === undefined ? configDefault(key) : value) as T;
}
