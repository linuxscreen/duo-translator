// Centralized storage layer backed by `wxt/utils/storage` (chrome.storage.local).
//
// Replaces the three PouchDB-backed classes (ConfigStorage / DomainStorage /
// RuleStorage) that used to live in main/background.ts. The message-handler
// contract in background.ts and the renderer-facing helpers in utils/db.ts
// stay unchanged; only the storage engine swaps.
//
// All keys live in the `local:` storage area with prefixes preserved from the
// PouchDB era so migration is a 1:1 copy:
//   config_<name>   →  config value (any)
//   domain_<host>   →  { strategy?, viewStrategy?, aiWritingDisabled?, aiWritingEnabled? }
//   rule_<host>     →  string[]
//
// Internal book-keeping keys. They carry no data prefix, which is what keeps
// them out of snapshots — `isSnapshotKey` in snapshot.ts is an allow-list over
// the three prefixes above, applied at every snapshot boundary:
//   __migration_v1_done              — set after the one-shot PouchDB → storage migration
//   __sync_meta                      — per-key LWW clocks + tombstones (see SyncMeta)
//   __sync_active_provider           — the "sync method" selector; which provider
//                                      auto-sync targets (syncManager.ts)
//   __sync_gdrive_tokens             — OAuth tokens
//   __sync_gdrive_file_id            — cached Drive fileId
//   __sync_gdrive_needs_reauth       — credentials went stale on THIS device
//   __sync_gdrive_use_browser_auth   — Chrome-only: getAuthToken vs the web flow
//   __sync_webdav_creds              — { baseUrl, username, password, basePath }
//   __sync_webdav_disconnected       — disconnected but keeping the credentials
//   __site_rule_cache                — fetched subscription bodies (re-fetchable)
//   __site_rule_official             — the official subscription package
//   __browser_commands               — this browser's command shortcuts, for content
//   __storage_schema_version         — highest storage migration applied on THIS device

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import {
    CONFIG_KEY,
    configDefault,
    DOMAIN_STRATEGY,
    VIEW_STRATEGY,
} from '@/main/constants';
import { collectionIdentity, indexElements } from './collections';
import { stableStr } from './stableJson';

export const STORAGE_PREFIX = {
    CONFIG: 'config_',
    DOMAIN: 'domain_',
    RULE: 'rule_',
} as const;

// Internal, device-local storage keys. Since `isSnapshotKey` became the gate on
// every snapshot boundary these are excluded by their lack of a data prefix
// anyway; naming them here is belt-and-braces and, more usefully, the one place
// that states which keys are deliberately device-local.
export const INTERNAL_STORAGE_KEYS = [
    '__migration_v1_done',
    '__sync_meta',
    '__sync_local_mtime', // legacy, kept excluded so any stale value never syncs
    '__sync_active_provider',
    '__sync_gdrive_tokens',
    '__sync_gdrive_file_id',
    '__sync_gdrive_needs_reauth',
    '__sync_gdrive_use_browser_auth',
    '__sync_webdav_creds',
    '__sync_webdav_disconnected',
    // Re-fetchable subscription bodies. Hundreds of rules; nothing here that a
    // refresh can't rebuild, so there is no reason to carry it in every sync.
    '__site_rule_cache',
    '__site_rule_official',
    // A mirror of commands.getAll() — a property of this browser, not the account.
    '__browser_commands',
    // How far THIS device's storage has been migrated. Syncing it would let one
    // device declare another one migrated.
    '__storage_schema_version',
] as const;

export type DomainDoc = {
    strategy?: DOMAIN_STRATEGY;
    viewStrategy?: VIEW_STRATEGY;
    aiWritingDisabled?: boolean;
    aiWritingEnabled?: boolean;
    floatBallDisabled?: boolean;
    selectionIconDisabled?: boolean;
    /**
     * "Translate every element on this site": the user's own exclusions — the
     * legacy per-host no-translate areas AND the website rules' include/exclude
     * selectors — stop applying here. Only the hard-coded exclusions (script /
     * style / editable / our own UI) remain.
     */
    translateAllElements?: boolean;
};

export type DomainListItem = { domain: string } & DomainDoc;

/** Fields `domainRepo.clearField` can drop individually. */
export type DomainField = keyof DomainDoc;

const configKey = (name: string): StorageItemKey => `local:${STORAGE_PREFIX.CONFIG}${name}`;
const domainKey = (host: string): StorageItemKey => `local:${STORAGE_PREFIX.DOMAIN}${host}`;
const ruleKey = (host: string): StorageItemKey => `local:${STORAGE_PREFIX.RULE}${host}`;

// Data-key (storage key without the `local:` area prefix) builders. These match
// the keys used in snapshot `data`/`meta`/`tombstones` and in the sync-meta map.
const dataConfigKey = (name: string): string => `${STORAGE_PREFIX.CONFIG}${name}`;
const dataDomainKey = (host: string): string => `${STORAGE_PREFIX.DOMAIN}${host}`;
const dataRuleKey = (host: string): string => `${STORAGE_PREFIX.RULE}${host}`;

// ------------------------------ Sync meta ----------------------------------
//
// Per-key last-write-wins bookkeeping for cloud sync. `clocks[key]` is the
// last-modified time (ms) of a live key; `tombstones[key]` is the deletion
// time of a removed key. Sync merges key-by-key using these, so edits to
// different keys on different devices never clobber each other.

export type ElementSyncMeta = {
    /** Element identity → last-modified clock (ms). */
    clocks: Record<string, number>;
    /** Element identity → deletion clock (ms). */
    tombstones: Record<string, number>;
};

export type SyncMeta = {
    clocks: Record<string, number>;
    tombstones: Record<string, number>;
    /**
     * Element-level clocks for *collection* keys (see storage/collections.ts):
     * keys whose value is an array of independent elements. Nesting the clocks
     * here rather than inside the stored value keeps every reader of
     * AI_PROVIDERS / SITE_RULE_* / rule_<host> untouched — the stored shape is
     * still a plain array.
     */
    elements: Record<string, ElementSyncMeta>;
};

const META_KEY: StorageItemKey = 'local:__sync_meta';

export async function getSyncMeta(): Promise<SyncMeta> {
    const m = await storage.getItem<Partial<SyncMeta>>(META_KEY);
    return {
        clocks: m?.clocks ?? {},
        tombstones: m?.tombstones ?? {},
        elements: m?.elements ?? {},
    };
}

async function saveSyncMeta(m: SyncMeta): Promise<void> {
    await storage.setItem(META_KEY, m);
}

// THE write lock of this store. Every write to a synced key — the value AND its
// clock — goes through it, as does the sync path applying a merge. Two things
// depend on that:
//
//  - The sync-meta is ONE storage item, so each clock update is a
//    read-modify-write. Unserialized, two back-to-back config writes (a color
//    picker persists its color and its preset index that way) read the same old
//    meta and the later save drops the earlier clock; at the next sync the key
//    that lost its clock is overruled by an older remote value while its
//    sibling keeps the new one.
//  - A value and its clock must change as one step. applyMergedToLocal decides
//    "was this key written since the snapshot?" from the clock alone; a value
//    already written whose clock is still pending would be reverted, and the
//    clock that follows would then stamp the REVERTED value as the newest.
//
// All writers run in the background context, so an in-memory queue is enough.
let metaQueue: Promise<unknown> = Promise.resolve();

/**
 * Run `mutate` holding the store's write lock, then persist the sync-meta.
 * `mutate` receives the current meta and either edits it in place or returns a
 * replacement; returning `false` means "nothing changed" and skips the save.
 * It may await — value writes belong INSIDE it, see above — but must not call
 * another function that takes the lock (that would deadlock the queue).
 */
export function updateSyncMeta(
    mutate: (m: SyncMeta) => SyncMeta | void | false | Promise<SyncMeta | void | false>,
): Promise<void> {
    const run = metaQueue.then(async () => {
        const m = await getSyncMeta();
        const next = await mutate(m);
        if (next !== false) await saveSyncMeta(next ?? m);
    });
    // A failed update must not wedge every later one.
    metaQueue = run.catch(() => {});
    return run;
}

/**
 * Read under the write lock: `read` sees the sync-meta and whatever values it
 * reads from storage as ONE consistent state — never a value whose clock has
 * not landed yet (or the reverse). Same rule as updateSyncMeta: it must not
 * call anything that takes the lock.
 */
export function readConsistent<T>(read: (m: SyncMeta) => Promise<T>): Promise<T> {
    const run = metaQueue.then(async () => read(await getSyncMeta()));
    metaQueue = run.catch(() => {});
    return run;
}

/**
 * The element-meta bucket for a collection key, created on demand.
 *
 * Creation SEEDS every element that already exists with the key's current
 * clock. Without that seed, elements written before element tracking began
 * would be clockless and fall back to the key clock at merge time — so an
 * unrelated edit to a sibling element (which bumps the key clock) would make
 * them look newer than a remote deletion and resurrect it.
 */
function elementMetaFor(m: SyncMeta, dataKey: string, before: unknown): ElementSyncMeta {
    const existing = m.elements[dataKey];
    if (existing) return existing;
    const idOf = collectionIdentity(dataKey);
    const created: ElementSyncMeta = { clocks: {}, tombstones: {} };
    if (idOf) {
        const base = m.clocks[dataKey] ?? 0;
        for (const id of indexElements(before, idOf).byId.keys()) created.clocks[id] = base;
    }
    m.elements[dataKey] = created;
    return created;
}

/**
 * Record element-level events for a collection key from a before/after diff.
 * Only added or *changed* elements get a fresh clock — an untouched sibling
 * keeps its old one, which is exactly what makes "device A adds a provider"
 * stop clobbering "device B deleted a different provider".
 */
function diffElements(m: SyncMeta, dataKey: string, before: unknown, after: unknown, now: number): void {
    const idOf = collectionIdentity(dataKey);
    if (!idOf) return;
    const b = indexElements(before, idOf);
    const a = indexElements(after, idOf);
    const em = elementMetaFor(m, dataKey, before);
    for (const [id, el] of a.byId) {
        const prev = b.byId.get(id);
        if (prev === undefined || stableStr(prev) !== stableStr(el)) em.clocks[id] = now;
        delete em.tombstones[id];
    }
    for (const id of b.byId.keys()) {
        if (a.byId.has(id)) continue;
        delete em.clocks[id];
        em.tombstones[id] = now;
    }
}

/**
 * Mark a data key as live-modified now (and clear any tombstone for it).
 *
 * `change` is only needed for collection keys — pass the value as it was before
 * the write and as it is after, and the element-level clocks are derived from
 * the diff. Callers of non-collection keys pass nothing.
 *
 * Edits `m` in place; the caller holds the write lock (see updateSyncMeta).
 */
function markLive(m: SyncMeta, dataKey: string, change?: { before: unknown; after: unknown }): void {
    const now = Date.now();
    // Before the key clock moves: the seed inside diffElements reads it.
    if (change) diffElements(m, dataKey, change.before, change.after, now);
    m.clocks[dataKey] = now;
    delete m.tombstones[dataKey];
}

/**
 * Mark a data key as deleted now (and drop its live clock).
 *
 * For a collection key, `before` is the value that was removed: every one of
 * its elements gets its own tombstone. The key-level tombstone alone is not
 * enough — it is cleared the moment the key is re-created, and the elements
 * that were deleted with it would then be resurrected by a stale peer.
 */
function markDead(m: SyncMeta, dataKey: string, before?: unknown): void {
    const now = Date.now();
    if (before !== undefined) diffElements(m, dataKey, before, [], now);
    delete m.clocks[dataKey];
    m.tombstones[dataKey] = now;
}

/**
 * The one write path for a synced key: read the current value, decide, write
 * the value and its clock — all under the write lock, so a read-modify-write
 * (`domainRepo.update`, `ruleRepo.add`, …) can't lose a concurrent update and
 * the sync path never sees a value whose clock hasn't landed yet.
 *
 * `decide` returns the next value, `REMOVE` to delete the key (tombstoned), or
 * `KEEP` to leave it untouched. Collection keys get their element-level clocks
 * from the before/after diff automatically.
 */
const REMOVE = Symbol('remove');
const KEEP = Symbol('keep');
function writeKey<T>(
    itemKey: StorageItemKey,
    dataKey: string,
    decide: (current: T | null) => T | typeof REMOVE | typeof KEEP,
): Promise<void> {
    return updateSyncMeta(async (m) => {
        const before = await storage.getItem<T>(itemKey);
        const next = decide(before);
        if (next === KEEP) return false;
        const isCollection = collectionIdentity(dataKey) !== null;
        if (next === REMOVE) {
            await storage.removeItem(itemKey);
            markDead(m, dataKey, isCollection ? before ?? undefined : undefined);
        } else {
            await storage.setItem(itemKey, next);
            markLive(m, dataKey, isCollection ? { before, after: next } : undefined);
        }
    });
}

/** Bump clocks for several data keys to now — used by a manual import so the
 *  imported values win on the next sync. Collection keys additionally get a
 *  fresh clock on every element they now hold (`stored[k]`, the value the
 *  import just wrote), so the imported elements propagate individually.
 *
 *  Edits `m` in place; the caller holds the write lock and has written the
 *  values inside it. */
export function markKeysLive(m: SyncMeta, dataKeys: string[], stored: Record<string, unknown>): void {
    const now = Date.now();
    for (const k of dataKeys) {
        const idOf = collectionIdentity(k);
        if (idOf) {
            const em = elementMetaFor(m, k, stored[k]);
            for (const id of indexElements(stored[k], idOf).byId.keys()) {
                em.clocks[id] = now;
                delete em.tombstones[id];
            }
        }
        m.clocks[k] = now;
        delete m.tombstones[k];
    }
}

// ------------------------------ Migrations ---------------------------------

const hasDataPrefix = (key: string): boolean =>
    Object.values(STORAGE_PREFIX).some((prefix) => key.startsWith(prefix));

/** Whether `key` (no `local:` area prefix) is a synced data key. */
export function isSyncedDataKey(key: string): boolean {
    return hasDataPrefix(key);
}

/**
 * Clocked writes to synced keys, as handed to a storage migration
 * (main/storage/migrations).
 *
 * Every write returns whether the migration's decision now stands on this
 * device: `false` means the user has decided since, and nothing was touched.
 * `true` does not imply the value changed — a value that already was what the
 * migration wants is still claimed with the migration's clock.
 */
export type SyncedKeyWriter = {
    /** The stored value of a synced key — no default applied. */
    get<T>(dataKey: string): Promise<T | null>;
    /** Set a whole (non-collection) key. */
    setIfOlder(dataKey: string, value: unknown): Promise<boolean>;
    /** Delete a whole (non-collection) key. */
    removeIfOlder(dataKey: string): Promise<boolean>;
    /**
     * Add one element to a collection key (or replace the one with its id).
     * With nothing stored the list becomes `[element]` — which REPLACES the
     * key's default, so check `get()` first when the default should stand.
     */
    addElement(dataKey: string, element: unknown): Promise<boolean>;
    /**
     * Remove one element from a collection key, by element identity. With
     * nothing stored there is no list to remove from, and nothing is recorded.
     */
    removeElement(dataKey: string, id: string): Promise<boolean>;
};

/**
 * The writer a storage migration uses for synced keys.
 *
 * A migration runs once on EVERY device, at whatever moment that device happens
 * to upgrade — and the user may have edited the same key on another device in
 * between. Stamping the write with the current time would make the last device
 * to upgrade overrule that edit. So a migration's write is an LWW event with a
 * FIXED clock, the `epoch` its author declared, on every device alike:
 *
 *  - across devices, any real edit made after the release is newer than the
 *    epoch and wins the merge, whichever device syncs first;
 *  - locally, the same rule decides whether the write lands at all: only where
 *    what is stored is OLDER than the epoch (or has no history). That is also
 *    what makes a re-run a no-op — after the first run the clock IS the epoch.
 *
 * A collection element is judged by its own history, not the key's: a user who
 * toggled an unrelated element last week has said nothing about this one.
 *
 * The event is recorded even when the value already is what the migration
 * wants. Skipping that looks like a free optimization and is not: the value and
 * the sync-meta are two storage items, so a run can die having written the
 * first only — and the repeat run, finding the value in place, would leave it
 * dated by a clock older than a peer's stale copy.
 *
 * `m` is the sync-meta of the enclosing `updateSyncMeta` call and is edited in
 * place; `changed` tells the caller whether it needs saving.
 */
export function migrationWriter(m: SyncMeta, epoch: number): SyncedKeyWriter & { readonly changed: boolean } {
    if (!Number.isFinite(epoch) || epoch <= 0) throw new Error(`migration: invalid epoch ${epoch}`);
    let changed = false;

    const itemKey = (dataKey: string): StorageItemKey => {
        if (!hasDataPrefix(dataKey)) throw new Error(`migration: "${dataKey}" is not a synced key`);
        return `local:${dataKey}`;
    };
    const identityOf = (dataKey: string) => {
        const idOf = collectionIdentity(dataKey);
        if (!idOf) throw new Error(`migration: "${dataKey}" is not a collection key`);
        return idOf;
    };
    const rejectCollection = (dataKey: string) => {
        if (collectionIdentity(dataKey)) {
            throw new Error(`migration: "${dataKey}" is a collection key — use addElement / removeElement`);
        }
    };
    const keyHistory = (dataKey: string): number =>
        Math.max(m.clocks[dataKey] ?? 0, m.tombstones[dataKey] ?? 0);
    // Mirrors mergeCollectionKey: an element without a clock of its own takes
    // the key's, and a key-level tombstone is a death of every element.
    const elementHistory = (dataKey: string, id: string, present: boolean): number => {
        const em = m.elements[dataKey];
        const live = present ? em?.clocks[id] ?? m.clocks[dataKey] ?? 0 : 0;
        const dead = Math.max(em?.tombstones[id] ?? 0, m.tombstones[dataKey] ?? 0);
        return Math.max(live, dead);
    };
    // Never moves the key clock backwards: it also dates the key's OTHER
    // elements wherever a peer carries no element clocks.
    const keyTouched = (dataKey: string) => {
        m.clocks[dataKey] = Math.max(m.clocks[dataKey] ?? 0, epoch);
        delete m.tombstones[dataKey];
        changed = true;
    };

    return {
        get changed() {
            return changed;
        },

        async get<T>(dataKey: string): Promise<T | null> {
            return await storage.getItem<T>(itemKey(dataKey));
        },

        async setIfOlder(dataKey, value) {
            const key = itemKey(dataKey);
            rejectCollection(dataKey);
            if (value === null || value === undefined) {
                throw new Error(`migration: no value for "${dataKey}" — use removeIfOlder to delete a key`);
            }
            if (keyHistory(dataKey) >= epoch) return false;
            const before = await storage.getItem<unknown>(key);
            if (before === null || stableStr(before) !== stableStr(value)) await storage.setItem(key, value);
            m.clocks[dataKey] = epoch;
            delete m.tombstones[dataKey];
            changed = true;
            return true;
        },

        async removeIfOlder(dataKey) {
            const key = itemKey(dataKey);
            rejectCollection(dataKey);
            if (keyHistory(dataKey) >= epoch) return false;
            if ((await storage.getItem<unknown>(key)) !== null) await storage.removeItem(key);
            delete m.clocks[dataKey];
            m.tombstones[dataKey] = epoch;
            changed = true;
            return true;
        },

        async addElement(dataKey, element) {
            const key = itemKey(dataKey);
            const idOf = identityOf(dataKey);
            const id = idOf(element);
            if (id === null) throw new Error(`migration: element without an identity for "${dataKey}"`);
            const before = await storage.getItem<unknown>(key);
            // A corrupt (non-array) value is not ours to repair here.
            if (before !== null && !Array.isArray(before)) return false;
            const list: unknown[] = before ?? [];
            const stored = indexElements(list, idOf).byId;
            const present = stored.has(id);
            if (elementHistory(dataKey, id, present) >= epoch) return false;
            if (!present) {
                await storage.setItem(key, [...list, element]);
            } else if (stableStr(stored.get(id)) !== stableStr(element)) {
                await storage.setItem(key, list.map((el) => (idOf(el) === id ? element : el)));
            }
            // Before the key clock moves: creating the bucket dates the
            // elements already there by the key's CURRENT clock.
            const em = elementMetaFor(m, dataKey, before);
            em.clocks[id] = epoch;
            delete em.tombstones[id];
            keyTouched(dataKey);
            return true;
        },

        async removeElement(dataKey, id) {
            const key = itemKey(dataKey);
            const idOf = identityOf(dataKey);
            const before = await storage.getItem<unknown>(key);
            if (!Array.isArray(before)) return false;
            const present = indexElements(before, idOf).byId.has(id);
            if (elementHistory(dataKey, id, present) >= epoch) return false;
            if (present) await storage.setItem(key, before.filter((el) => idOf(el) !== id));
            const em = elementMetaFor(m, dataKey, before);
            delete em.clocks[id];
            em.tombstones[id] = epoch;
            keyTouched(dataKey);
            return true;
        },
    };
}

const defaultForConfig = configDefault;

// ------------------------------ Config -------------------------------------

export const configRepo = {
    async get(name: string): Promise<unknown> {
        const value = await storage.getItem<unknown>(configKey(name));
        if (value === null || value === undefined) {
            return defaultForConfig(name);
        }
        return value;
    },
    async getT<T>(name: string) : Promise<T> {
        const value = await storage.getItem<T>(configKey(name))
        if (value === null) {
            return defaultForConfig(name) as T;
        }
        return value
    },
    async set(name: string, value: unknown): Promise<void> {
        await writeKey<unknown>(configKey(name), dataConfigKey(name), () => value);
    },
};

// ------------------------------ Domain -------------------------------------

export const domainRepo = {
    async get(host: string): Promise<DomainDoc | null> {
        return await storage.getItem<DomainDoc>(domainKey(host));
    },

    async set(host: string, doc: DomainDoc): Promise<void> {
        await writeKey<DomainDoc>(domainKey(host), dataDomainKey(host), () => doc);
    },

    /**
     * Merge non-undefined fields onto the existing doc. Equivalent to
     * the old DomainStorage.update which only overwrites defined fields.
     */
    async update(host: string, patch: DomainDoc): Promise<void> {
        await writeKey<DomainDoc>(domainKey(host), dataDomainKey(host), (existing) => {
            const next: DomainDoc = { ...(existing ?? {}) };
            if (patch.strategy !== undefined) next.strategy = patch.strategy;
            if (patch.viewStrategy !== undefined) next.viewStrategy = patch.viewStrategy;
            if (patch.aiWritingDisabled !== undefined) next.aiWritingDisabled = patch.aiWritingDisabled;
            if (patch.aiWritingEnabled !== undefined) next.aiWritingEnabled = patch.aiWritingEnabled;
            if (patch.floatBallDisabled !== undefined) next.floatBallDisabled = patch.floatBallDisabled;
            if (patch.selectionIconDisabled !== undefined) next.selectionIconDisabled = patch.selectionIconDisabled;
            if (patch.translateAllElements !== undefined) next.translateAllElements = patch.translateAllElements;
            return next;
        });
    },

    async delete(host: string): Promise<void> {
        await writeKey<DomainDoc>(domainKey(host), dataDomainKey(host), () => REMOVE);
    },

    /**
     * Drop a single field. When the doc becomes empty, remove it entirely —
     * keeps the storage tidy (mirrors original DomainStorage.clearField).
     */
    async clearField(host: string, field: DomainField): Promise<void> {
        await writeKey<DomainDoc>(domainKey(host), dataDomainKey(host), (doc) => {
            if (!doc) return KEEP;
            delete (doc as Record<string, unknown>)[field];
            const empty =
                doc.strategy === undefined &&
                doc.viewStrategy === undefined &&
                doc.aiWritingDisabled === undefined &&
                doc.aiWritingEnabled === undefined &&
                doc.floatBallDisabled === undefined &&
                doc.selectionIconDisabled === undefined &&
                doc.translateAllElements === undefined;
            return empty ? REMOVE : doc;
        });
    },

    async list(filter?: {
        strategy?: DOMAIN_STRATEGY;
        aiWritingDisabled?: boolean;
        aiWritingEnabled?: boolean;
        floatBallDisabled?: boolean;
        selectionIconDisabled?: boolean;
        translateAllElements?: boolean;
    }): Promise<DomainListItem[]> {
        const all = await storage.snapshot('local');
        let items: DomainListItem[] = [];
        for (const [k, v] of Object.entries(all)) {
            if (!k.startsWith(STORAGE_PREFIX.DOMAIN)) continue;
            if (!v || typeof v !== 'object') continue;
            const doc = v as DomainDoc;
            items.push({
                domain: k.slice(STORAGE_PREFIX.DOMAIN.length),
                strategy: doc.strategy,
                viewStrategy: doc.viewStrategy,
                aiWritingDisabled: doc.aiWritingDisabled,
                aiWritingEnabled: doc.aiWritingEnabled,
                floatBallDisabled: doc.floatBallDisabled,
                selectionIconDisabled: doc.selectionIconDisabled,
                translateAllElements: doc.translateAllElements,
            });
        }
        if (filter?.strategy) items = items.filter((it) => it.strategy === filter.strategy);
        if (filter?.aiWritingDisabled !== undefined) {
            items = items.filter((it) => !!it.aiWritingDisabled === filter.aiWritingDisabled);
        }
        if (filter?.aiWritingEnabled !== undefined) {
            items = items.filter((it) => !!it.aiWritingEnabled === filter.aiWritingEnabled);
        }
        if (filter?.floatBallDisabled !== undefined) {
            items = items.filter((it) => !!it.floatBallDisabled === filter.floatBallDisabled);
        }
        if (filter?.selectionIconDisabled !== undefined) {
            items = items.filter((it) => !!it.selectionIconDisabled === filter.selectionIconDisabled);
        }
        if (filter?.translateAllElements !== undefined) {
            items = items.filter((it) => !!it.translateAllElements === filter.translateAllElements);
        }
        return items;
    },
};

// ------------------------------ Rules --------------------------------------

export const ruleRepo = {
    async list(host: string): Promise<string[]> {
        return (await storage.getItem<string[]>(ruleKey(host))) ?? [];
    },

    async add(host: string, rule: string): Promise<void> {
        await writeKey<string[]>(ruleKey(host), dataRuleKey(host), (existing) =>
            // Not a push: the pre-write value has to survive for the element diff.
            existing?.includes(rule) ? KEEP : [...(existing ?? []), rule],
        );
    },

    async delete(host: string, rule: string): Promise<void> {
        await this.deleteList(host, [rule]);
    },

    async deleteList(host: string, rules: string[]): Promise<void> {
        const drop = new Set(rules);
        await writeKey<string[]>(ruleKey(host), dataRuleKey(host), (existing) => {
            if (!existing) return KEEP;
            const next = existing.filter((r) => !drop.has(r));
            return next.length === 0 ? REMOVE : next;
        });
    },

    /** Original RuleStorage.search returned PouchDB doc objects ({ _id, rules }).
     *  Callers expect `_id` to be the prefixed key. We mirror that shape so the
     *  message-handler response stays identical for any consumer that still
     *  pokes at the raw structure. */
    async search(domainFilter?: string): Promise<Array<{ _id: string; rules: string[] }>> {
        const all = await storage.snapshot('local');
        const out: Array<{ _id: string; rules: string[] }> = [];
        for (const [k, v] of Object.entries(all)) {
            if (!k.startsWith(STORAGE_PREFIX.RULE)) continue;
            if (!Array.isArray(v)) continue;
            if (domainFilter && !k.includes(domainFilter)) continue;
            out.push({ _id: k, rules: v as string[] });
        }
        return out;
    },

    async getAll(): Promise<Array<{ _id: string; rules: string[] }>> {
        return this.search();
    },
};

// ------------------------------ Helpers ------------------------------------

/**
 * Strict CONFIG_KEY accessor — kept for code that prefers the enum.
 * Renderer code should keep using utils/db.ts (message bridge).
 */
export async function getConfigItem(key: CONFIG_KEY): Promise<unknown> {
    return configRepo.get(key);
}

export async function setConfigItem(key: CONFIG_KEY, value: unknown): Promise<void> {
    return configRepo.set(key, value);
}
