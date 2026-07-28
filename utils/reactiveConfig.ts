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
 * Whether this key has been read from storage yet.
 *
 * `readConfig` cannot distinguish "not hydrated" from "stored as the default",
 * and hydration is async — so a caller that acts on the first read of a
 * disabled switch will briefly behave as if it were enabled (mounting UI that
 * it then has to tear down, which the user sees flash). Callers whose first
 * action is irreversible or visible should wait for this to turn true.
 *
 * The cache entry exists after hydration even when the stored value is absent,
 * so presence — not the value — is the signal.
 */
export function isConfigHydrated(key: CONFIG_KEY): boolean {
    ensureWatching(key);
    return cache.has(key);
}

/**
 * Resolves once every listed key has been read from storage, so the
 * `readConfig` calls that follow return stored values rather than the caller's
 * defaults.
 *
 * The awaitable form of {@link isConfigHydrated}, for call sites that would
 * otherwise have to re-check on a timer: hydration is one-way (a key only ever
 * goes from absent to present in the cache, never back), so waiting once is
 * equivalent to polling — and says what it means.
 */
export function whenConfigHydrated(keys: readonly CONFIG_KEY[]): Promise<void> {
    return Promise.all(keys.map(hydratedOne)).then(() => undefined);
}

function hydratedOne(key: CONFIG_KEY): Promise<void> {
    // Also starts the watch, which is what kicks hydration off in the first place.
    if (isConfigHydrated(key)) return Promise.resolve();
    return new Promise<void>((resolve) => {
        // Safe to reference before assignment: `subscribe` never invokes the
        // callback synchronously — hydration lands in a later microtask.
        let unsubscribe: (() => void) | undefined;
        unsubscribe = subscribe(key, () => {
            if (!cache.has(key)) return;
            unsubscribe?.();
            resolve();
        });
    });
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
