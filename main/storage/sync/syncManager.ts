// Orchestrates push/pull through every authenticated SyncProvider with
// last-write-wins semantics over a single integer mtime.
//
// Multiple providers can be connected at once; each keeps its own credentials.
// `syncNow(id)` syncs one provider, `syncOnStartup` syncs all connected ones.
//
// Local mtime is bumped by configStore on any user-data mutation. Remote
// mtime is whatever the remote snapshot's envelope reports. The newer one
// wins, silently. A global lock serializes all syncs so the shared local
// mtime can't be raced when several providers sync back-to-back.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { APP_NAME_WITH_SUFFIX, CONFIG_KEY, IS_SAFARI, SYNC_PROVIDER_ID } from '@/main/constants';
import {
    buildSnapshot,
    mergeSnapshots,
    applyMergedToLocal,
    type Snapshot,
} from '@/main/storage/snapshot';
import { getConfigItem } from '@/main/storage/configStore';
import type { SyncProvider, SyncResult, SyncDirection } from './types';
import { googleDriveProvider } from './googleDriveProvider';
import { webdavProvider } from './webdavProvider';

// Google Drive is absent from the Safari build entirely — not disabled, absent.
// It has no working credential path there (see IS_SAFARI), and a provider that
// can only ever fail is worse than one that isn't offered.
const PROVIDERS: SyncProvider[] = IS_SAFARI
    ? [webdavProvider]
    : [googleDriveProvider, webdavProvider];

function providerById(id: SYNC_PROVIDER_ID): SyncProvider {
    switch (id) {
        case SYNC_PROVIDER_ID.GDRIVE:
            return googleDriveProvider;
        case SYNC_PROVIDER_ID.WEBDAV:
            return webdavProvider;
    }
}

export function getProviderById(id: SYNC_PROVIDER_ID): SyncProvider {
    return providerById(id);
}

export function getAllProviders(): SyncProvider[] {
    return PROVIDERS;
}

// Which provider sync actually targets. Device-local on purpose, and NOT a
// CONFIG_KEY: putting it in the synced snapshot is a bootstrap trap — a device
// with no WebDAV credentials would be handed "sync to WebDAV", stop syncing, and
// therefore never receive the correction. "Where does THIS browser sync" is a
// property of the browser, like the two gdrive keys next door.
const ACTIVE_PROVIDER_KEY: StorageItemKey = 'local:__sync_active_provider';

/**
 * The one sync target. Only ever one — two connected remotes are well-defined
 * under the per-key CRDT (they converge), but "which one restores me?" then has
 * no answer, and that question is the whole point of the setting.
 */
export async function getActiveProviderId(): Promise<SYNC_PROVIDER_ID> {
    // Not just a default — the only possible answer on Safari, including for a
    // profile that synced its way here holding `gdrive` from another device.
    if (IS_SAFARI) return SYNC_PROVIDER_ID.WEBDAV;

    const stored = await storage.getItem<SYNC_PROVIDER_ID>(ACTIVE_PROVIDER_KEY);
    if (stored === SYNC_PROVIDER_ID.GDRIVE || stored === SYNC_PROVIDER_ID.WEBDAV) return stored;

    // Never chosen — i.e. an install that predates this setting. One that is
    // already syncing to WebDAV must keep syncing to WebDAV; defaulting it to
    // Drive would silently strand its data on a remote nobody talks to any more.
    const resolved = (await webdavProvider.isAuthenticated())
        ? SYNC_PROVIDER_ID.WEBDAV
        : SYNC_PROVIDER_ID.GDRIVE;
    // Persist the resolution so it can't flip later: derived-on-every-read would
    // silently move the target the moment the user disconnects WebDAV.
    await setActiveProviderId(resolved);
    return resolved;
}

export async function setActiveProviderId(id: SYNC_PROVIDER_ID): Promise<void> {
    await storage.setItem(ACTIVE_PROVIDER_KEY, id);
}

// Global lock: only one sync runs at a time (any provider) so the local
// sync-meta is never read/written concurrently. Each caller still gets its own
// result back.
let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
}

async function shouldSyncSecrets(): Promise<boolean> {
    return !!(await getConfigItem(CONFIG_KEY.SYNC_INCLUDE_SECRETS));
}

// Per-provider per-key LWW merge. Runs under the global lock.
//
//   pull remote → merge(local, remote) → apply locally + push merged
//
// Because the merge is key-by-key with tombstones, adding one key on device B
// never wipes device A's other keys: B's unchanged keys carry older clocks and
// lose to A's newer ones, while the union keeps everything.
async function runSync(provider: SyncProvider): Promise<SyncResult> {
    try {
        if (!(await provider.isAuthenticated())) {
            return { ok: false, error: 'Sync provider not authenticated' };
        }

        const includeSecrets = await shouldSyncSecrets();
        const local = await buildSnapshot({ includeSecrets });
        const remote: Snapshot | null = await provider.pull();

        if (!remote) {
            await provider.push(local);
            return { ok: true, direction: 'upload' };
        }

        const { merged, localChanged, remoteChanged } = mergeSnapshots(local, remote);
        if (localChanged) await applyMergedToLocal(merged);
        if (remoteChanged) await provider.push(merged);

        const direction: SyncDirection =
            localChanged && remoteChanged
                ? 'merge'
                : remoteChanged
                    ? 'upload'
                    : localChanged
                        ? 'download'
                        : 'noop';
        return { ok: true, direction };
    } catch (e: any) {
        console.error(APP_NAME_WITH_SUFFIX, 'syncNow failed', provider.id, e);
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function syncNow(id: SYNC_PROVIDER_ID): Promise<SyncResult> {
    const provider = providerById(id);
    return withLock(() => runSync(provider));
}

/**
 * Sync the active provider. Fire-and-forget; failures just log. Used by
 * auto-sync (startup / debounce / periodic).
 *
 * This is where "one sync target" is enforced. A provider the user switched away
 * from keeps its credentials — so switching back costs one click rather than a
 * fresh setup — it simply stops being synced to.
 */
export async function syncAll(reason = 'auto'): Promise<void> {
    try {
        const provider = providerById(await getActiveProviderId());
        if (!(await provider.isAuthenticated())) return;
        const result = await withLock(() => runSync(provider));
        console.log(APP_NAME_WITH_SUFFIX, 'sync', reason, provider.id, result);
    } catch (e) {
        console.error(APP_NAME_WITH_SUFFIX, 'sync error', reason, e);
    }
}
