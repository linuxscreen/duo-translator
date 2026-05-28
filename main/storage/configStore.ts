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
//   __sync_local_mtime        — mtime updated after every config/domain/rule mutation
//   __sync_active_provider    — 'gdrive' | 'webdav' | null
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
    '__sync_local_mtime',
    '__sync_active_provider',
    '__sync_gdrive_tokens',
    '__sync_gdrive_file_id',
    '__sync_webdav_creds',
] as const;

export type DomainDoc = {
    strategy?: DOMAIN_STRATEGY;
    viewStrategy?: VIEW_STRATEGY;
    aiWritingDisabled?: boolean;
    aiWritingEnabled?: boolean;
};

export type DomainListItem = { domain: string } & DomainDoc;

const configKey = (name: string): StorageItemKey => `local:${STORAGE_PREFIX.CONFIG}${name}`;
const domainKey = (host: string): StorageItemKey => `local:${STORAGE_PREFIX.DOMAIN}${host}`;
const ruleKey = (host: string): StorageItemKey => `local:${STORAGE_PREFIX.RULE}${host}`;

const MTIME_KEY: StorageItemKey = 'local:__sync_local_mtime';

/** Bump the local mtime; called after any user-data mutation so syncManager LWW can compare. */
async function bumpMtime(): Promise<void> {
    await storage.setItem<number>(MTIME_KEY, Date.now());
}

export async function getLocalMtime(): Promise<number> {
    return (await storage.getItem<number>(MTIME_KEY)) ?? 0;
}

export async function setLocalMtime(mtime: number): Promise<void> {
    await storage.setItem<number>(MTIME_KEY, mtime);
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
        await bumpMtime();
    },
};

// ------------------------------ Domain -------------------------------------

export const domainRepo = {
    async get(host: string): Promise<DomainDoc | null> {
        return await storage.getItem<DomainDoc>(domainKey(host));
    },

    async set(host: string, doc: DomainDoc): Promise<void> {
        await storage.setItem(domainKey(host), doc);
        await bumpMtime();
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
        await storage.setItem(domainKey(host), next);
        await bumpMtime();
    },

    async delete(host: string): Promise<void> {
        await storage.removeItem(domainKey(host));
        await bumpMtime();
    },

    /**
     * Drop a single field. When the doc becomes empty, remove it entirely —
     * keeps the storage tidy (mirrors original DomainStorage.clearField).
     */
    async clearField(
        host: string,
        field: 'strategy' | 'aiWritingDisabled' | 'aiWritingEnabled' | 'viewStrategy',
    ): Promise<void> {
        const doc = await storage.getItem<DomainDoc>(domainKey(host));
        if (!doc) return;
        delete (doc as Record<string, unknown>)[field];
        const empty =
            doc.strategy === undefined &&
            doc.viewStrategy === undefined &&
            doc.aiWritingDisabled === undefined &&
            doc.aiWritingEnabled === undefined;
        if (empty) {
            await storage.removeItem(domainKey(host));
        } else {
            await storage.setItem(domainKey(host), doc);
        }
        await bumpMtime();
    },

    async list(filter?: {
        strategy?: DOMAIN_STRATEGY;
        aiWritingDisabled?: boolean;
        aiWritingEnabled?: boolean;
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
            });
        }
        if (filter?.strategy) items = items.filter((it) => it.strategy === filter.strategy);
        if (filter?.aiWritingDisabled !== undefined) {
            items = items.filter((it) => !!it.aiWritingDisabled === filter.aiWritingDisabled);
        }
        if (filter?.aiWritingEnabled !== undefined) {
            items = items.filter((it) => !!it.aiWritingEnabled === filter.aiWritingEnabled);
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
        await bumpMtime();
    },

    async delete(host: string, rule: string): Promise<void> {
        const existing = await storage.getItem<string[]>(ruleKey(host));
        if (!existing) return;
        const next = existing.filter((r) => r !== rule);
        if (next.length === 0) {
            await storage.removeItem(ruleKey(host));
        } else {
            await storage.setItem(ruleKey(host), next);
        }
        await bumpMtime();
    },

    async deleteList(host: string, rules: string[]): Promise<void> {
        const existing = await storage.getItem<string[]>(ruleKey(host));
        if (!existing) return;
        const drop = new Set(rules);
        const next = existing.filter((r) => !drop.has(r));
        if (next.length === 0) {
            await storage.removeItem(ruleKey(host));
        } else {
            await storage.setItem(ruleKey(host), next);
        }
        await bumpMtime();
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
