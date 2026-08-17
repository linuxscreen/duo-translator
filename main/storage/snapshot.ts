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
// COLLECTION KEYS recurse one level deeper. A key whose value is an array of
// independent elements (AI providers, site rules, subscriptions, the two string
// sets, rule_<host>) was resolved whole by the per-key rule, so device A adding
// a provider and device B adding another kept only one of them. Those keys are
// listed in storage/collections.ts with an element-identity function, and the
// SAME resolver (`resolveLWW`) then runs per element. Element clocks travel in
// the snapshot's optional `elements` section and live locally in
// `__sync_meta.elements`; the stored config value stays a plain array, so no
// reader of those keys is affected.
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
    type ElementSyncMeta,
} from './configStore';
import { collectionIdentity, indexElements, type ElementIdentity } from './collections';
import { stableStr } from './stableJson';

export type Snapshot = {
    app: string;
    schemaVersion: 2;
    data: Record<string, unknown>;
    /** Per-key last-modified clock (ms) for live keys. */
    meta: Record<string, number>;
    /** Per-key deletion clock (ms) for removed keys. */
    tombstones: Record<string, number>;
    /**
     * Element-level clocks for collection keys. OPTIONAL on purpose — this is
     * why `schemaVersion` stays 2 rather than going to 3 as the design sketch
     * proposed. A client that predates element merging validates the envelope
     * on `schemaVersion === 2` and would treat a v3 file as invalid, and an
     * invalid remote is treated as *missing*, which makes that client push its
     * own snapshot over the top — silent whole-remote data loss. An extra
     * optional field is ignored by those clients instead: they merge key-wise
     * as before and push back a snapshot without it, which the fallback in
     * `mergeCollectionKey` handles (union, no deletions).
     */
    elements?: Record<string, ElementSyncMeta>;
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
    `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AUTO_SYNC_CONFIG_SWITCH}`,
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

    // Element clocks for every collection key this snapshot carries. Elements
    // that predate element tracking (written before the upgrade) are seeded
    // with the key clock here rather than being left clockless, so the merge
    // never has to fall back and every live element in a snapshot has a clock.
    const elements: Record<string, ElementSyncMeta> = {};
    for (const [k, v] of Object.entries(data)) {
        const idOf = collectionIdentity(k);
        if (!idOf || !Array.isArray(v)) continue;
        const known = syncMeta.elements[k];
        const base = meta[k] ?? 0;
        const clocks: Record<string, number> = {};
        for (const id of indexElements(v, idOf).byId.keys()) {
            clocks[id] = known?.clocks[id] ?? base;
        }
        elements[k] = { clocks, tombstones: { ...(known?.tombstones ?? {}) } };
    }
    // Deleted collection keys keep only their element tombstones — those still
    // have to propagate so a stale peer's copy does not come back.
    for (const [k, em] of Object.entries(syncMeta.elements)) {
        if (k in elements || exclude.has(k)) continue;
        if (Object.keys(em.tombstones).length === 0) continue;
        elements[k] = { clocks: {}, tombstones: { ...em.tombstones } };
    }

    return { app: SNAPSHOT_APP, schemaVersion: SNAPSHOT_VERSION, data, meta, tombstones, elements };
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

function elementsOf(s: Snapshot): Record<string, ElementSyncMeta> {
    return s.elements ?? {};
}

function samePayload(a: Snapshot, b: Snapshot): boolean {
    return (
        stableStr(a.data) === stableStr(b.data) &&
        stableStr(a.meta) === stableStr(b.meta) &&
        stableStr(tombsOf(a)) === stableStr(tombsOf(b)) &&
        stableStr(elementsOf(a)) === stableStr(elementsOf(b))
    );
}

type Ev = { ts: number; kind: 'live' | 'dead'; value?: unknown };

/**
 * The one conflict resolver, used at BOTH levels (whole key, and single element
 * inside a collection key). Newest clock wins; on a tie a live value beats a
 * tombstone, and two live values tie-break on deterministic serialization so
 * every device converges on the same winner.
 */
function resolveLWW(evs: Ev[]): Ev | undefined {
    if (evs.length === 0) return undefined;
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
    return win;
}

type MergeSink = {
    data: Record<string, unknown>;
    meta: Record<string, number>;
    tombstones: Record<string, number>;
    elements: Record<string, ElementSyncMeta>;
};

/** Whole-key resolution — the original per-key LWW, unchanged. */
function mergeWholeKey(
    key: string,
    local: Snapshot,
    lTomb: Record<string, number>,
    remote: Snapshot,
    rTomb: Record<string, number>,
    now: number,
    out: MergeSink,
): void {
    const evs: Ev[] = [];
    if (key in local.data) evs.push({ ts: local.meta[key] ?? 0, kind: 'live', value: local.data[key] });
    if (key in lTomb) evs.push({ ts: lTomb[key], kind: 'dead' });
    if (key in remote.data) evs.push({ ts: remote.meta[key] ?? 0, kind: 'live', value: remote.data[key] });
    if (key in rTomb) evs.push({ ts: rTomb[key], kind: 'dead' });

    const win = resolveLWW(evs);
    if (!win) return;
    if (win.kind === 'live') {
        out.data[key] = win.value;
        out.meta[key] = win.ts;
    } else if (now - win.ts <= TOMBSTONE_TTL_MS) {
        out.tombstones[key] = win.ts;
    }
}

/**
 * Element-level resolution for a collection key: the same LWW recursed one
 * level down, over the union of element identities on both sides.
 *
 * Two things worth knowing before changing this:
 *
 *  - A KEY-LEVEL tombstone acts as a death event for *every* element of that
 *    side. "The whole key was deleted at T" means every element alive at T died
 *    then; anything with a newer clock was created afterwards and survives.
 *
 *  - MIXED VERSIONS: if either side carries no element metadata for this key
 *    (an older client merged and pushed the snapshot back, dropping the
 *    section), deletions are skipped entirely and the result is the union. A
 *    deletion that comes back once is a far better failure than a record that
 *    silently disappears.
 *
 * The result is ordered by element identity. It has to be a pure function of
 * the merged SET — `sortDeep` keeps array order significant, so two devices
 * settling on different orders would each see the other's value as changed and
 * push back and forth forever. The cost is that a user-arranged provider order
 * is not preserved across a sync; an explicit order field is the follow-up if
 * anyone asks for it.
 */
function mergeCollectionKey(
    key: string,
    idOf: ElementIdentity,
    local: Snapshot,
    lTomb: Record<string, number>,
    remote: Snapshot,
    rTomb: Record<string, number>,
    now: number,
    out: MergeSink,
): void {
    const lEm = elementsOf(local)[key];
    const rEm = elementsOf(remote)[key];
    const allowDeletes = !!lEm && !!rEm;

    const lIdx = indexElements(local.data[key], idOf);
    const rIdx = indexElements(remote.data[key], idOf);
    const lKeyClock = local.meta[key] ?? 0;
    const rKeyClock = remote.meta[key] ?? 0;
    const lKeyTomb = lTomb[key] ?? 0;
    const rKeyTomb = rTomb[key] ?? 0;

    const ids = new Set<string>([
        ...lIdx.byId.keys(),
        ...rIdx.byId.keys(),
        ...Object.keys(lEm?.tombstones ?? {}),
        ...Object.keys(rEm?.tombstones ?? {}),
    ]);

    const live: { id: string; value: unknown; ts: number }[] = [];
    const deaths: Record<string, number> = {};

    for (const id of ids) {
        const evs: Ev[] = [];
        if (lIdx.byId.has(id)) {
            evs.push({ ts: lEm?.clocks[id] ?? lKeyClock, kind: 'live', value: lIdx.byId.get(id) });
        }
        if (rIdx.byId.has(id)) {
            evs.push({ ts: rEm?.clocks[id] ?? rKeyClock, kind: 'live', value: rIdx.byId.get(id) });
        }
        if (allowDeletes) {
            const lDead = Math.max(lEm?.tombstones[id] ?? 0, lKeyTomb);
            if (lDead > 0) evs.push({ ts: lDead, kind: 'dead' });
            const rDead = Math.max(rEm?.tombstones[id] ?? 0, rKeyTomb);
            if (rDead > 0) evs.push({ ts: rDead, kind: 'dead' });
        }
        const win = resolveLWW(evs);
        if (!win) continue;
        if (win.kind === 'live') live.push({ id, value: win.value, ts: win.ts });
        else if (now - win.ts <= TOMBSTONE_TTL_MS) deaths[id] = win.ts;
    }

    if (!allowDeletes) {
        // Deletions were not applied above, but they must still be carried
        // forward — otherwise this merge would erase our own deletion record
        // and the element could never be removed on the other device either.
        //
        // A tombstone kept next to a live element is not a contradiction: the
        // element only survived because the peer could not vouch for its
        // clocks. Once both sides carry element metadata (which this very push
        // gives them) the normal resolution runs and the newer tombstone wins.
        // Net effect is the documented transition cost — a deletion may come
        // back for exactly one round.
        for (const em of [lEm, rEm]) {
            for (const [id, ts] of Object.entries(em?.tombstones ?? {})) {
                if (now - ts > TOMBSTONE_TTL_MS) continue;
                deaths[id] = Math.max(deaths[id] ?? 0, ts);
            }
        }
    }

    // Elements with no usable identity (corrupt records) cannot be merged;
    // they ride along with whichever side wins the key as a whole, rather than
    // being dropped on the floor.
    const anonEvs: Ev[] = [];
    if (key in local.data) anonEvs.push({ ts: lKeyClock, kind: 'live', value: lIdx.anonymous });
    if (lKeyTomb > 0) anonEvs.push({ ts: lKeyTomb, kind: 'dead' });
    if (key in remote.data) anonEvs.push({ ts: rKeyClock, kind: 'live', value: rIdx.anonymous });
    if (rKeyTomb > 0) anonEvs.push({ ts: rKeyTomb, kind: 'dead' });
    const anonWin = resolveLWW(anonEvs);
    const anonymous = anonWin?.kind === 'live' ? (anonWin.value as unknown[]) : [];

    live.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const value = [...live.map((e) => e.value), ...anonymous];

    // Does the key itself still exist? Only matters when the merge came out
    // empty: an emptied-but-alive array (`[]`) and a deleted key are different
    // states, and `anonWin` already resolves exactly that question.
    if (value.length > 0 || anonWin?.kind === 'live') {
        out.data[key] = value;
        out.meta[key] = Math.max(lKeyClock, rKeyClock);
    } else {
        if (anonWin && now - anonWin.ts <= TOMBSTONE_TTL_MS) out.tombstones[key] = anonWin.ts;
        // Nothing left to say about this key — an empty element section here
        // would differ from what buildSnapshot produces next time, so every
        // future merge would report a change that isn't one.
        if (!(key in out.tombstones) && Object.keys(deaths).length === 0) return;
    }
    out.elements[key] = {
        clocks: Object.fromEntries(live.map((e) => [e.id, e.ts])),
        tombstones: deaths,
    };
}

/**
 * Merge two snapshots with per-key last-write-wins, recursing into per-element
 * last-write-wins for collection keys (see mergeCollectionKey).
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
        // A collection key can be gone from data and tombstones on both sides
        // and still owe the other device its element tombstones.
        ...Object.keys(elementsOf(local)),
        ...Object.keys(elementsOf(remote)),
    ]);

    const out: MergeSink = { data: {}, meta: {}, tombstones: {}, elements: {} };

    for (const key of keys) {
        const idOf = collectionIdentity(key);
        // A collection key whose value is not an array on some side is corrupt
        // or from a format we don't know; fall back to whole-key LWW so it is
        // at least resolved deterministically.
        const mergeable =
            idOf !== null &&
            (!(key in local.data) || Array.isArray(local.data[key])) &&
            (!(key in remote.data) || Array.isArray(remote.data[key]));
        if (mergeable) mergeCollectionKey(key, idOf!, local, lTomb, remote, rTomb, now, out);
        else mergeWholeKey(key, local, lTomb, remote, rTomb, now, out);
    }

    const merged: Snapshot = {
        app: SNAPSHOT_APP,
        schemaVersion: SNAPSHOT_VERSION,
        data: out.data,
        meta: out.meta,
        tombstones: out.tombstones,
        elements: out.elements,
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
    // Same rule one level down. A collection key the merge DID cover but for
    // which it produced no element section (it fell back to whole-key LWW)
    // must NOT keep the old element clocks — they describe a value that just
    // got replaced. buildSnapshot re-seeds it from the key clock next time.
    const elements: Record<string, ElementSyncMeta> = { ...elementsOf(merged) };
    for (const [k, em] of Object.entries(prev.elements)) {
        if (k in elements || k in merged.data || k in merged.tombstones) continue;
        elements[k] = em;
    }
    await setSyncMeta({ clocks, tombstones, elements });
}

/**
 * Union two collection values for the import path: the file's elements win on
 * identity, local-only elements are kept. Import is documented as merge-only —
 * "nothing is deleted" — which at key level it already was, but a collection
 * key silently broke the promise by replacing the whole array.
 *
 * Elements with no usable identity fall back to their serialization as the
 * identity, which is exactly the dedupe rule that makes sense here (import has
 * no clocks to reason with, so "same bytes ⇒ same element" is all there is).
 */
function unionForImport(incoming: unknown[], localValue: unknown, idOf: ElementIdentity): unknown[] {
    if (!Array.isArray(localValue)) return incoming;
    const identify = (el: unknown) => idOf(el) ?? stableStr(el);
    const seen = new Set(incoming.map(identify));
    const out = [...incoming];
    for (const el of localValue) {
        if (seen.has(identify(el))) continue;
        seen.add(identify(el));
        out.push(el);
    }
    return out;
}

/**
 * Apply an imported backup file. Import is "the file wins per key, local-only
 * keys are kept, nothing is deleted" — the imported values are clocked to now so
 * they propagate on the next sync. (A backup restore should override current
 * settings, regardless of the file's own clocks.)
 *
 * Secrets are the one thing the file does NOT get to overwrite with nothing.
 * The export button redacts by default (the "include API keys" toggle starts
 * off), so a typical backup carries `apiKey: ''` on every provider record and
 * an empty string for the pure-secret keys — writing that verbatim would wipe
 * the keys this device still holds. Same hazard applyMergedToLocal guards
 * against on the sync path, same fix: re-attach local keys, and skip a
 * pure-secret key whose incoming value is empty. A backup exported WITH secrets
 * still overwrites, because then the incoming values are real.
 *
 * Collection keys are unioned element-by-element (see unionForImport) rather
 * than overwritten, so importing a backup taken before you added a provider no
 * longer deletes that provider.
 */
export async function applyImportedSnapshot(snap: Snapshot): Promise<void> {
    if (!isValidSnapshot(snap)) {
        throw new Error('Invalid snapshot envelope');
    }
    const current = await storage.snapshot('local');
    const sets: { key: StorageItemKey; value: unknown }[] = [];
    const touched: string[] = [];
    for (const [k, rawValue] of Object.entries(snap.data)) {
        if (ALWAYS_EXCLUDED.includes(k)) continue;
        // Redacted pure secret: keep whatever this device has, and leave its
        // clock alone — nothing changed locally, so there is nothing to push.
        if (PURE_SECRET_KEYS.includes(k) && !rawValue) continue;
        let v = k === AI_PROVIDERS_KEY ? reattachApiKeys(rawValue, current[k]) : rawValue;
        const idOf = collectionIdentity(k);
        if (idOf && Array.isArray(v)) v = unionForImport(v, current[k], idOf);
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
