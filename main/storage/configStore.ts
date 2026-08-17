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
// Internal book-keeping keys (filtered out of snapshots, see snapshot.ts):
//   __migration_v1_done       — set after the one-shot PouchDB → storage migration
//   __sync_meta               — per-key LWW clocks + tombstones (see SyncMeta)
//   __sync_active_provider    — legacy single-provider selector (no longer written)
//   __sync_gdrive_tokens      — OAuth tokens
//   __sync_gdrive_file_id     — cached Drive fileId
//   __sync_webdav_creds       — { baseUrl, username, password, basePath }

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

export const INTERNAL_STORAGE_KEYS = [
    '__migration_v1_done',
    '__sync_meta',
    '__sync_local_mtime', // legacy, kept excluded so any stale value never syncs
    '__sync_active_provider',
    '__sync_gdrive_tokens',
    '__sync_gdrive_file_id',
    '__sync_webdav_creds',
    '__sync_webdav_disconnected',
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

/** Replace the whole sync-meta — used after a merge applies the merged clocks. */
export async function setSyncMeta(meta: SyncMeta): Promise<void> {
    await saveSyncMeta(meta);
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
 */
async function touchKey(dataKey: string, change?: { before: unknown; after: unknown }): Promise<void> {
    const m = await getSyncMeta();
    const now = Date.now();
    // Before the key clock moves: the seed inside diffElements reads it.
    if (change) diffElements(m, dataKey, change.before, change.after, now);
    m.clocks[dataKey] = now;
    delete m.tombstones[dataKey];
    await saveSyncMeta(m);
}

/**
 * Mark a data key as deleted now (and drop its live clock).
 *
 * For a collection key, `before` is the value that was removed: every one of
 * its elements gets its own tombstone. The key-level tombstone alone is not
 * enough — it is cleared the moment the key is re-created, and the elements
 * that were deleted with it would then be resurrected by a stale peer.
 */
async function tombstoneKey(dataKey: string, before?: unknown): Promise<void> {
    const m = await getSyncMeta();
    const now = Date.now();
    if (before !== undefined) diffElements(m, dataKey, before, [], now);
    delete m.clocks[dataKey];
    m.tombstones[dataKey] = now;
    await saveSyncMeta(m);
}

/** Bump clocks for several data keys to now — used after a manual import so the
 *  imported values win on the next sync. Collection keys additionally get a
 *  fresh clock on every element they currently hold (read back from storage,
 *  since the import writes the merged value before calling this), so the
 *  imported elements propagate individually. */
export async function touchKeys(dataKeys: string[]): Promise<void> {
    if (dataKeys.length === 0) return;
    const m = await getSyncMeta();
    const now = Date.now();
    const collections = dataKeys.filter((k) => collectionIdentity(k) !== null);
    const stored = collections.length > 0 ? await storage.snapshot('local') : {};
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
    await saveSyncMeta(m);
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
        const dataKey = dataConfigKey(name);
        // Collection keys need the previous value to derive element-level
        // clocks; every other key skips the extra read.
        const isCollection = collectionIdentity(dataKey) !== null;
        const before = isCollection ? await storage.getItem<unknown>(configKey(name)) : undefined;
        await storage.setItem(configKey(name), value);
        await touchKey(dataKey, isCollection ? { before, after: value } : undefined);
    },
};

// ------------------------------ Domain -------------------------------------

export const domainRepo = {
    async get(host: string): Promise<DomainDoc | null> {
        return await storage.getItem<DomainDoc>(domainKey(host));
    },

    async set(host: string, doc: DomainDoc): Promise<void> {
        await storage.setItem(domainKey(host), doc);
        await touchKey(dataDomainKey(host));
    },

    /**
     * Merge non-undefined fields onto the existing doc. Equivalent to
     * the old DomainStorage.update which only overwrites defined fields.
     */
    async update(host: string, patch: DomainDoc): Promise<void> {
        const existing = (await storage.getItem<DomainDoc>(domainKey(host))) ?? {};
        const next: DomainDoc = { ...existing };
        if (patch.strategy !== undefined) next.strategy = patch.strategy;
        if (patch.viewStrategy !== undefined) next.viewStrategy = patch.viewStrategy;
        if (patch.aiWritingDisabled !== undefined) next.aiWritingDisabled = patch.aiWritingDisabled;
        if (patch.aiWritingEnabled !== undefined) next.aiWritingEnabled = patch.aiWritingEnabled;
        if (patch.floatBallDisabled !== undefined) next.floatBallDisabled = patch.floatBallDisabled;
        if (patch.selectionIconDisabled !== undefined) next.selectionIconDisabled = patch.selectionIconDisabled;
        if (patch.translateAllElements !== undefined) next.translateAllElements = patch.translateAllElements;
        await storage.setItem(domainKey(host), next);
        await touchKey(dataDomainKey(host));
    },

    async delete(host: string): Promise<void> {
        await storage.removeItem(domainKey(host));
        await tombstoneKey(dataDomainKey(host));
    },

    /**
     * Drop a single field. When the doc becomes empty, remove it entirely —
     * keeps the storage tidy (mirrors original DomainStorage.clearField).
     */
    async clearField(host: string, field: DomainField): Promise<void> {
        const doc = await storage.getItem<DomainDoc>(domainKey(host));
        if (!doc) return;
        delete (doc as Record<string, unknown>)[field];
        const empty =
            doc.strategy === undefined &&
            doc.viewStrategy === undefined &&
            doc.aiWritingDisabled === undefined &&
            doc.aiWritingEnabled === undefined &&
            doc.floatBallDisabled === undefined &&
            doc.selectionIconDisabled === undefined &&
            doc.translateAllElements === undefined;
        if (empty) {
            await storage.removeItem(domainKey(host));
            await tombstoneKey(dataDomainKey(host));
        } else {
            await storage.setItem(domainKey(host), doc);
            await touchKey(dataDomainKey(host));
        }
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
        const existing = (await storage.getItem<string[]>(ruleKey(host))) ?? [];
        if (existing.includes(rule)) return;
        // Not a push: the pre-write value has to survive for the element diff.
        const next = [...existing, rule];
        await storage.setItem(ruleKey(host), next);
        await touchKey(dataRuleKey(host), { before: existing, after: next });
    },

    async delete(host: string, rule: string): Promise<void> {
        const existing = await storage.getItem<string[]>(ruleKey(host));
        if (!existing) return;
        const next = existing.filter((r) => r !== rule);
        if (next.length === 0) {
            await storage.removeItem(ruleKey(host));
            await tombstoneKey(dataRuleKey(host), existing);
        } else {
            await storage.setItem(ruleKey(host), next);
            await touchKey(dataRuleKey(host), { before: existing, after: next });
        }
    },

    async deleteList(host: string, rules: string[]): Promise<void> {
        const existing = await storage.getItem<string[]>(ruleKey(host));
        if (!existing) return;
        const drop = new Set(rules);
        const next = existing.filter((r) => !drop.has(r));
        if (next.length === 0) {
            await storage.removeItem(ruleKey(host));
            await tombstoneKey(dataRuleKey(host), existing);
        } else {
            await storage.setItem(ruleKey(host), next);
            await touchKey(dataRuleKey(host), { before: existing, after: next });
        }
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
