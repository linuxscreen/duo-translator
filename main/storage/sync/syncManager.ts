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

import { APP_NAME_WITH_SUFFIX, CONFIG_KEY, SYNC_PROVIDER_ID } from '@/main/constants';
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

const PROVIDERS: SyncProvider[] = [googleDriveProvider, webdavProvider];

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

export async function getAuthenticatedProviders(): Promise<SyncProvider[]> {
    const out: SyncProvider[] = [];
    for (const p of PROVIDERS) {
        if (await p.isAuthenticated()) out.push(p);
    }
    return out;
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
 * Sync every connected provider sequentially. Fire-and-forget; failures just
 * log. Used by auto-sync (startup / debounce / periodic).
 */
export async function syncAll(reason = 'auto'): Promise<void> {
    try {
        const providers = await getAuthenticatedProviders();
        for (const provider of providers) {
            const result = await withLock(() => runSync(provider));
            console.log(APP_NAME_WITH_SUFFIX, 'sync', reason, provider.id, result);
        }
    } catch (e) {
        console.error(APP_NAME_WITH_SUFFIX, 'sync error', reason, e);
    }
}
