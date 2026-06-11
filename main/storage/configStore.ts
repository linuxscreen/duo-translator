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
    CONFIG_VALUE_TO_KEY,
    DEFAULT_VALUE,
    DOMAIN_STRATEGY,
    VIEW_STRATEGY,
} from '@/main/constants';

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
};

export type DomainListItem = { domain: string } & DomainDoc;

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

export type SyncMeta = {
    clocks: Record<string, number>;
    tombstones: Record<string, number>;
};

const META_KEY: StorageItemKey = 'local:__sync_meta';

export async function getSyncMeta(): Promise<SyncMeta> {
    const m = await storage.getItem<SyncMeta>(META_KEY);
    return m ?? { clocks: {}, tombstones: {} };
}

async function saveSyncMeta(m: SyncMeta): Promise<void> {
    await storage.setItem(META_KEY, m);
}

/** Replace the whole sync-meta — used after a merge applies the merged clocks. */
export async function setSyncMeta(meta: SyncMeta): Promise<void> {
    await saveSyncMeta(meta);
}

/** Mark a data key as live-modified now (and clear any tombstone for it). */
async function touchKey(dataKey: string): Promise<void> {
    const m = await getSyncMeta();
    m.clocks[dataKey] = Date.now();
    delete m.tombstones[dataKey];
    await saveSyncMeta(m);
}

/** Mark a data key as deleted now (and drop its live clock). */
async function tombstoneKey(dataKey: string): Promise<void> {
    const m = await getSyncMeta();
    delete m.clocks[dataKey];
    m.tombstones[dataKey] = Date.now();
    await saveSyncMeta(m);
}

/** Bump clocks for several data keys to now — used after a manual import so the
 *  imported values win on the next sync. */
export async function touchKeys(dataKeys: string[]): Promise<void> {
    if (dataKeys.length === 0) return;
    const m = await getSyncMeta();
    const now = Date.now();
    for (const k of dataKeys) {
        m.clocks[k] = now;
        delete m.tombstones[k];
    }
    await saveSyncMeta(m);
}

function defaultForConfig(name: string): unknown {
    const enumKey = CONFIG_VALUE_TO_KEY[name];
    if (enumKey && enumKey in DEFAULT_VALUE) {
        return (DEFAULT_VALUE as Record<string, unknown>)[enumKey];
    }
    return undefined;
}

// ------------------------------ Config -------------------------------------

export const configRepo = {
    async get(name: string): Promise<unknown> {
        const value = await storage.getItem<unknown>(configKey(name));
        if (value === null || value === undefined) {
            return defaultForConfig(name);
        }
        return value;
    },

    async set(name: string, value: unknown): Promise<void> {
        await storage.setItem(configKey(name), value);
        await touchKey(dataConfigKey(name));
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
    async clearField(
        host: string,
        field: 'strategy' | 'aiWritingDisabled' | 'aiWritingEnabled' | 'viewStrategy' | 'floatBallDisabled',
    ): Promise<void> {
        const doc = await storage.getItem<DomainDoc>(domainKey(host));
        if (!doc) return;
        delete (doc as Record<string, unknown>)[field];
        const empty =
            doc.strategy === undefined &&
            doc.viewStrategy === undefined &&
            doc.aiWritingDisabled === undefined &&
            doc.aiWritingEnabled === undefined &&
            doc.floatBallDisabled === undefined;
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
        existing.push(rule);
        await storage.setItem(ruleKey(host), existing);
        await touchKey(dataRuleKey(host));
    },

    async delete(host: string, rule: string): Promise<void> {
        const existing = await storage.getItem<string[]>(ruleKey(host));
        if (!existing) return;
        const next = existing.filter((r) => r !== rule);
        if (next.length === 0) {
            await storage.removeItem(ruleKey(host));
            await tombstoneKey(dataRuleKey(host));
        } else {
            await storage.setItem(ruleKey(host), next);
            await touchKey(dataRuleKey(host));
        }
    },

    async deleteList(host: string, rules: string[]): Promise<void> {
        const existing = await storage.getItem<string[]>(ruleKey(host));
        if (!existing) return;
        const drop = new Set(rules);
        const next = existing.filter((r) => !drop.has(r));
        if (next.length === 0) {
            await storage.removeItem(ruleKey(host));
            await tombstoneKey(dataRuleKey(host));
        } else {
            await storage.setItem(ruleKey(host), next);
            await touchKey(dataRuleKey(host));
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
