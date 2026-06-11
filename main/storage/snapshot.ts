// Build / merge / apply a whole-DB snapshot of `chrome.storage.local`.
//
// Used by:
//  - sync providers (Google Drive, WebDAV) to push/pull a full backup blob
//  - the options-page "Export JSON" / "Import JSON" buttons
//
// Sync uses a per-key last-write-wins (LWW-Map CRDT) model: every user-data key
// carries its own clock (`meta[key]`) and deletions are recorded as tombstones.
// `mergeSnapshots` merges two snapshots key-by-key, so edits to *different* keys
// on different devices never clobber each other — only edits to the *same* key
// conflict, resolved by newest-clock-wins. This replaces the old whole-document
// mtime LWW, which lost data whenever two devices diverged.
//
// Internal book-keeping keys (migration flag, sync metadata, OAuth tokens, etc.)
// and the short-lived Microsoft token are always excluded. API-key keys (AI
// providers + DeepL) are excluded unless the caller asks for includeSecrets.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { APP_NAME_KEBAB_CASE, CONFIG_KEY } from '@/main/constants';
import {
    INTERNAL_STORAGE_KEYS,
    STORAGE_PREFIX,
    getSyncMeta,
    setSyncMeta,
    touchKeys,
} from './configStore';

export type Snapshot = {
    app: string;
    schemaVersion: 2;
    data: Record<string, unknown>;
    /** Per-key last-modified clock (ms) for live keys. */
    meta: Record<string, number>;
    /** Per-key deletion clock (ms) for removed keys. */
    tombstones: Record<string, number>;
};

const SNAPSHOT_APP = APP_NAME_KEBAB_CASE;
const SNAPSHOT_VERSION = 2 as const;

// Tombstones older than this are garbage-collected during merge. Long enough
// that a device offline for ~2 months still propagates its deletions.
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// Keys that should never participate in a snapshot — internal state plus the
// transient Microsoft translator token (refreshed every ~10min, no value in
// syncing).
const ALWAYS_EXCLUDED: string[] = [
    ...INTERNAL_STORAGE_KEYS,
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.MICROSOFT_TOKEN}`,
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.GLOBAL_SWITCH}`,
    // Sync-control prefs are per-device and must not propagate.
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SYNC_INCLUDE_SECRETS}`,
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SYNC_AUTO}`,
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SYNC_INTERVAL_MINUTES}`,
];

const DATA_PREFIXES = [STORAGE_PREFIX.CONFIG, STORAGE_PREFIX.DOMAIN, STORAGE_PREFIX.RULE];

/**
 * Whether a storage key participates in the synced snapshot — i.e. it's a
 * user-data key (config_/domain_/rule_) that isn't on the always-excluded list.
 * Used by the auto-sync watcher to decide if a storage change is sync-worthy.
 */
export function isSnapshotKey(key: string): boolean {
    if (ALWAYS_EXCLUDED.includes(key)) return false;
    return DATA_PREFIXES.some((p) => key.startsWith(p));
}

// The AI providers key holds a secret *field* (apiKey) inside an otherwise
// syncable record (id/name/baseURL/model). It is ALWAYS synced so the records
// propagate; the apiKey is stripped when !includeSecrets and re-attached from
// local state on apply (see applyMergedToLocal), so keys are never transmitted
// nor clobbered.
const AI_PROVIDERS_KEY = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AI_PROVIDERS}`;

// Pure-secret keys: the whole value is the secret, there is nothing to sync
// without it. Fully excluded unless includeSecrets.
const PURE_SECRET_KEYS: string[] = [
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.DEEPL_API_KEY}`,
];

export type BuildOptions = { includeSecrets?: boolean };

/** Strip apiKey from each AI provider record (used when not syncing secrets). */
function stripApiKeys(providers: unknown): unknown {
    if (!Array.isArray(providers)) return providers;
    return providers.map((p: any) => ({ ...p, apiKey: '' }));
}

// ----------------------------- serialization -------------------------------

/** Deterministic stringify (object keys sorted; array order preserved) for
 *  value equality checks and tie-breaking. */
function sortDeep(v: any): any {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
        const out: Record<string, any> = {};
        for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
        return out;
    }
    return v;
}

function stableStr(v: unknown): string {
    return JSON.stringify(sortDeep(v));
}

// ------------------------------- build -------------------------------------

export async function buildSnapshot(opts: BuildOptions = {}): Promise<Snapshot> {
    const exclude = new Set<string>(ALWAYS_EXCLUDED);
    if (!opts.includeSecrets) for (const k of PURE_SECRET_KEYS) exclude.add(k);

    const raw = await storage.snapshot('local', { excludeKeys: [...exclude] });
    const syncMeta = await getSyncMeta();

    const data: Record<string, unknown> = {};
    const meta: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
        // Sync provider records but strip the apiKey field when not syncing
        // secrets — the records still propagate across devices.
        data[k] = !opts.includeSecrets && k === AI_PROVIDERS_KEY ? stripApiKeys(v) : v;
        meta[k] = syncMeta.clocks[k] ?? 0;
    }

    const tombstones: Record<string, number> = {};
    for (const [k, ts] of Object.entries(syncMeta.tombstones)) {
        if (exclude.has(k)) continue;
        tombstones[k] = ts;
    }

    return { app: SNAPSHOT_APP, schemaVersion: SNAPSHOT_VERSION, data, meta, tombstones };
}

export function isValidSnapshot(value: unknown): value is Snapshot {
    if (!value || typeof value !== 'object') return false;
    const s = value as Partial<Snapshot>;
    return (
        s.app === SNAPSHOT_APP &&
        s.schemaVersion === SNAPSHOT_VERSION &&
        !!s.data &&
        typeof s.data === 'object' &&
        !!s.meta &&
        typeof s.meta === 'object'
    );
}

// ------------------------------- merge -------------------------------------

export type MergeResult = {
    merged: Snapshot;
    /** Local storage needs updating to match the merge. */
    localChanged: boolean;
    /** Remote needs the merged snapshot pushed back. */
    remoteChanged: boolean;
};

function tombsOf(s: Snapshot): Record<string, number> {
    return s.tombstones ?? {};
}

function samePayload(a: Snapshot, b: Snapshot): boolean {
    return (
        stableStr(a.data) === stableStr(b.data) &&
        stableStr(a.meta) === stableStr(b.meta) &&
        stableStr(tombsOf(a)) === stableStr(tombsOf(b))
    );
}

/**
 * Merge two snapshots with per-key last-write-wins. For every key, the candidate
 * events (local-live, local-dead, remote-live, remote-dead) are compared by
 * clock; the newest wins. Ties: a live value beats a tombstone; two live values
 * tie-break on deterministic serialization so all devices converge identically.
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot): MergeResult {
    const now = Date.now();
    const lTomb = tombsOf(local);
    const rTomb = tombsOf(remote);

    const keys = new Set<string>([
        ...Object.keys(local.data),
        ...Object.keys(remote.data),
        ...Object.keys(lTomb),
        ...Object.keys(rTomb),
    ]);

    const data: Record<string, unknown> = {};
    const meta: Record<string, number> = {};
    const tombstones: Record<string, number> = {};

    type Ev = { ts: number; kind: 'live' | 'dead'; value?: unknown };

    for (const key of keys) {
        const evs: Ev[] = [];
        if (key in local.data) evs.push({ ts: local.meta[key] ?? 0, kind: 'live', value: local.data[key] });
        if (key in lTomb) evs.push({ ts: lTomb[key], kind: 'dead' });
        if (key in remote.data) evs.push({ ts: remote.meta[key] ?? 0, kind: 'live', value: remote.data[key] });
        if (key in rTomb) evs.push({ ts: rTomb[key], kind: 'dead' });
        if (evs.length === 0) continue;

        let win = evs[0];
        for (let i = 1; i < evs.length; i++) {
            const e = evs[i];
            if (e.ts > win.ts) {
                win = e;
            } else if (e.ts === win.ts) {
                if (e.kind !== win.kind) {
                    // live beats dead on a tie
                    if (win.kind === 'dead') win = e;
                } else if (e.kind === 'live' && stableStr(e.value) > stableStr(win.value)) {
                    win = e;
                }
            }
        }

        if (win.kind === 'live') {
            data[key] = win.value;
            meta[key] = win.ts;
        } else if (now - win.ts <= TOMBSTONE_TTL_MS) {
            tombstones[key] = win.ts;
        }
    }

    const merged: Snapshot = {
        app: SNAPSHOT_APP,
        schemaVersion: SNAPSHOT_VERSION,
        data,
        meta,
        tombstones,
    };
    return {
        merged,
        localChanged: !samePayload(merged, local),
        remoteChanged: !samePayload(merged, remote),
    };
}

// ------------------------------- apply -------------------------------------

/**
 * Re-attach this device's local apiKeys onto incoming AI provider records.
 * The synced value never carries an apiKey unless secret-sync is on, so for any
 * record whose incoming apiKey is empty we keep the local key (matched by id).
 * This lets provider records sync while each device's keys stay on-device.
 */
function reattachApiKeys(incoming: unknown, local: unknown): unknown {
    if (!Array.isArray(incoming)) return incoming;
    const byId = new Map<string, string>();
    if (Array.isArray(local)) {
        for (const p of local as any[]) {
            if (p && typeof p.id === 'string' && p.apiKey) byId.set(p.id, p.apiKey);
        }
    }
    return incoming.map((p: any) =>
        p && !p.apiKey && byId.has(p.id) ? { ...p, apiKey: byId.get(p.id) } : p,
    );
}

/**
 * Apply a merged snapshot to local storage: write changed values, remove
 * tombstoned keys, and persist the merged clocks as the new local sync-meta.
 *
 * Pure-secret keys excluded from the snapshot (e.g. the DeepL key when
 * secret-sync is off) are never in `merged`, so they're left untouched and their
 * local clocks preserved. The AI providers key is always present but its apiKeys
 * are re-attached from local state so on-device keys are never lost.
 */
export async function applyMergedToLocal(merged: Snapshot): Promise<void> {
    const current = await storage.snapshot('local');
    const sets: { key: StorageItemKey; value: unknown }[] = [];
    const removes: StorageItemKey[] = [];

    for (const [k, rawValue] of Object.entries(merged.data)) {
        if (ALWAYS_EXCLUDED.includes(k)) continue;
        const v = k === AI_PROVIDERS_KEY ? reattachApiKeys(rawValue, current[k]) : rawValue;
        if (!(k in current) || stableStr(current[k]) !== stableStr(v)) {
            sets.push({ key: `local:${k}` as StorageItemKey, value: v });
        }
    }
    for (const k of Object.keys(merged.tombstones)) {
        if (ALWAYS_EXCLUDED.includes(k)) continue;
        if (k in current) removes.push(`local:${k}` as StorageItemKey);
    }

    if (removes.length > 0) await storage.removeItems(removes);
    if (sets.length > 0) await storage.setItems(sets);

    // Merge clocks: start from merged, then preserve any local-only clocks for
    // keys the snapshot didn't cover (excluded secrets when not syncing them).
    const prev = await getSyncMeta();
    const clocks: Record<string, number> = { ...merged.meta };
    const tombstones: Record<string, number> = { ...merged.tombstones };
    for (const [k, ts] of Object.entries(prev.clocks)) {
        if (!(k in clocks) && !(k in tombstones)) clocks[k] = ts;
    }
    for (const [k, ts] of Object.entries(prev.tombstones)) {
        if (!(k in clocks) && !(k in tombstones)) tombstones[k] = ts;
    }
    await setSyncMeta({ clocks, tombstones });
}

/**
 * Apply an imported backup file. Import is "the file wins per key, local-only
 * keys are kept, nothing is deleted" — the imported values are clocked to now so
 * they propagate on the next sync. (A backup restore should override current
 * settings, regardless of the file's own clocks.)
 */
export async function applyImportedSnapshot(snap: Snapshot): Promise<void> {
    if (!isValidSnapshot(snap)) {
        throw new Error('Invalid snapshot envelope');
    }
    const sets: { key: StorageItemKey; value: unknown }[] = [];
    const touched: string[] = [];
    for (const [k, v] of Object.entries(snap.data)) {
        if (ALWAYS_EXCLUDED.includes(k)) continue;
        sets.push({ key: `local:${k}` as StorageItemKey, value: v });
        touched.push(k);
    }
    if (sets.length > 0) await storage.setItems(sets);
    await touchKeys(touched);
}

/**
 * Strip API keys from an export blob without losing the rest of the provider
 * record (id, name, baseURL, model, etc.). Used when the user exports without
 * the "include API keys" toggle.
 */
export function redactSecrets(snap: Snapshot): Snapshot {
    const providersKey = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AI_PROVIDERS}`;
    const deeplKey = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.DEEPL_API_KEY}`;
    const data = { ...snap.data };
    const providers = data[providersKey];
    if (Array.isArray(providers)) {
        data[providersKey] = providers.map((p: any) => ({
            ...p,
            apiKey: '',
        }));
    }
    if (deeplKey in data) {
        data[deeplKey] = '';
    }
    return { ...snap, data };
}
