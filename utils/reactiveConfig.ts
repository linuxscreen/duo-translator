import { useSyncExternalStore } from "react";
import { storage, type StorageItemKey } from "wxt/utils/storage";
import type { CONFIG_KEY } from "@/main/constants";

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
    void storage.getItem(sk).then((v) => {
        cache.set(key, v ?? undefined);
        notify(key);
    });
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
 * Imperative cached read for non-React call sites (event handlers, plain
 * helpers). Returns `defaultValue` until the key has hydrated; starts watching
 * the key so subsequent reads are fresh.
 */
export function readConfig<T>(key: CONFIG_KEY, defaultValue: T): T {
    ensureWatching(key);
    const v = cache.get(key);
    return v === undefined ? defaultValue : (v as T);
}

/**
 * Reactive config value. Re-renders the calling component whenever the key is
 * written from ANY context (Options, popup, background, this frame).
 *
 * For object/array values pass a stable `defaultValue` (a module-level
 * constant) so the pre-hydration snapshot stays referentially stable.
 */
export function useConfig<T>(key: CONFIG_KEY, defaultValue: T): T {
    const value = useSyncExternalStore(
        (cb) => subscribe(key, cb),
        () => cache.get(key) as T | undefined,
    );
    return value === undefined ? defaultValue : value;
}
