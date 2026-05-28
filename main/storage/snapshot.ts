// Build / apply a whole-DB JSON snapshot of `chrome.storage.local`.
//
// Used by:
//  - sync providers (Google Drive, WebDAV) to push/pull a full backup blob
//  - the options-page "Export JSON" / "Import JSON" buttons
//
// Snapshot envelope is versioned. Internal book-keeping keys (migration flag,
// sync metadata, OAuth tokens, etc.) and the short-lived Microsoft token are
// always excluded. AI provider records are excluded unless the caller asks
// for `includeSecrets: true`.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { CONFIG_KEY } from '@/main/constants';
import { INTERNAL_STORAGE_KEYS, STORAGE_PREFIX } from './configStore';

export type Snapshot = {
    app: 'duo-translator';
    schemaVersion: 1;
    mtime: number;
    data: Record<string, unknown>;
};

const SNAPSHOT_APP = 'duo-translator' as const;
const SNAPSHOT_VERSION = 1 as const;

// Keys that should never participate in a snapshot at all — internal state
// plus the transient Microsoft translator token (refreshed every ~10min, no
// value in syncing).
const ALWAYS_EXCLUDED: string[] = [
    ...INTERNAL_STORAGE_KEYS,
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.MICROSOFT_TOKEN}`,
];

// AI providers contain API keys. Excluded by default; the export UI exposes
// a toggle that flips includeSecrets and brings them along.
const SECRET_KEYS: string[] = [
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AI_PROVIDERS}`,
];

export type BuildOptions = { includeSecrets?: boolean };

export async function buildSnapshot(opts: BuildOptions = {}): Promise<Snapshot> {
    const exclude = [...ALWAYS_EXCLUDED];
    if (!opts.includeSecrets) exclude.push(...SECRET_KEYS);

    const data = await storage.snapshot('local', { excludeKeys: exclude });
    return {
        app: SNAPSHOT_APP,
        schemaVersion: SNAPSHOT_VERSION,
        mtime: Date.now(),
        data,
    };
}

export type ApplyMode = 'replace' | 'merge';

export function isValidSnapshot(value: unknown): value is Snapshot {
    if (!value || typeof value !== 'object') return false;
    const s = value as Partial<Snapshot>;
    return (
        s.app === SNAPSHOT_APP &&
        s.schemaVersion === SNAPSHOT_VERSION &&
        typeof s.mtime === 'number' &&
        !!s.data &&
        typeof s.data === 'object'
    );
}

/**
 * Apply a snapshot to chrome.storage.local.
 *
 *  - replace: drop all current user data (config_/domain_/rule_) and write
 *    the snapshot. Internal book-keeping keys are preserved.
 *  - merge:   write the snapshot's entries on top of current state without
 *    removing keys that aren't in the snapshot.
 *
 * NOTE: WXT's `storage.restoreSnapshot` is actually a merge, so for replace
 * mode we manually compute the diff and remove keys ourselves.
 */
export async function applySnapshot(snap: Snapshot, mode: ApplyMode): Promise<void> {
    if (!isValidSnapshot(snap)) {
        throw new Error('Invalid snapshot envelope');
    }

    // Filter out anything that looks internal — defensive in case a tampered
    // snapshot tries to inject sync tokens or migration flags.
    const cleanData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(snap.data)) {
        if (ALWAYS_EXCLUDED.includes(k)) continue;
        cleanData[k] = v;
    }

    if (mode === 'replace') {
        const current = await storage.snapshot('local');
        const toRemove: StorageItemKey[] = [];
        for (const k of Object.keys(current)) {
            if (ALWAYS_EXCLUDED.includes(k)) continue;
            if (!(k in cleanData)) {
                toRemove.push(`local:${k}`);
            }
        }
        if (toRemove.length > 0) {
            await storage.removeItems(toRemove);
        }
    }

    if (Object.keys(cleanData).length > 0) {
        await storage.setItems(
            Object.entries(cleanData).map(([k, value]) => ({
                key: `local:${k}` as StorageItemKey,
                value,
            })),
        );
    }
}

/**
 * Strip API keys from an export blob without losing the rest of the provider
 * record (id, name, baseURL, model, etc.). Used when the user exports without
 * the "include AI keys" toggle.
 */
export function redactSecrets(snap: Snapshot): Snapshot {
    const providersKey = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AI_PROVIDERS}`;
    const data = { ...snap.data };
    const providers = data[providersKey];
    if (Array.isArray(providers)) {
        data[providersKey] = providers.map((p: any) => ({
            ...p,
            apiKey: '',
        }));
    }
    return { ...snap, data };
}
