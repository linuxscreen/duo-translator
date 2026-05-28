// Orchestrates push/pull through the active SyncProvider with last-write-wins
// semantics over a single integer mtime.
//
// Local mtime is bumped by configStore on any user-data mutation. Remote
// mtime is whatever the remote snapshot's envelope reports. The newer one
// wins, silently.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { APP_NAME_WITH_SUFFIX, SYNC_PROVIDER_ID } from '@/main/constants';
import {
    buildSnapshot,
    applySnapshot,
    type Snapshot,
} from '@/main/storage/snapshot';
import { getLocalMtime, setLocalMtime } from '@/main/storage/configStore';
import type { SyncProvider, SyncResult } from './types';
import { googleDriveProvider } from './googleDriveProvider';
import { webdavProvider } from './webdavProvider';

const ACTIVE_KEY: StorageItemKey = 'local:__sync_active_provider';

function providerById(id: SYNC_PROVIDER_ID): SyncProvider {
    switch (id) {
        case SYNC_PROVIDER_ID.GDRIVE:
            return googleDriveProvider;
        case SYNC_PROVIDER_ID.WEBDAV:
            return webdavProvider;
    }
}

export async function getActiveProviderId(): Promise<SYNC_PROVIDER_ID | null> {
    return storage.getItem<SYNC_PROVIDER_ID>(ACTIVE_KEY);
}

export async function setActiveProvider(id: SYNC_PROVIDER_ID | null): Promise<void> {
    if (id === null) {
        await storage.removeItem(ACTIVE_KEY);
    } else {
        await storage.setItem(ACTIVE_KEY, id);
    }
}

export async function getActiveProvider(): Promise<SyncProvider | null> {
    const id = await getActiveProviderId();
    if (!id) return null;
    return providerById(id);
}

export function getProviderById(id: SYNC_PROVIDER_ID): SyncProvider {
    return providerById(id);
}

// Single in-flight sync at a time to avoid push/pull racing each other.
let inflight: Promise<SyncResult> | null = null;

export async function syncNow(): Promise<SyncResult> {
    if (inflight) return inflight;
    inflight = (async (): Promise<SyncResult> => {
        try {
            const provider = await getActiveProvider();
            if (!provider) return { ok: false, error: 'No sync provider selected' };
            if (!(await provider.isAuthenticated())) {
                return { ok: false, error: 'Sync provider not authenticated' };
            }

            const localMtime = await getLocalMtime();
            const remote: Snapshot | null = await provider.pull();

            if (!remote) {
                const snap = await buildSnapshot({ includeSecrets: true });
                await provider.push(snap);
                await setLocalMtime(snap.mtime);
                return { ok: true, direction: 'upload', localMtime: snap.mtime };
            }

            if (remote.mtime > localMtime) {
                await applySnapshot(remote, 'replace');
                // After applying remote, align local mtime to remote so we
                // don't immediately treat it as "we're newer" next round.
                await setLocalMtime(remote.mtime);
                return {
                    ok: true,
                    direction: 'download',
                    remoteMtime: remote.mtime,
                    localMtime: remote.mtime,
                };
            }

            if (remote.mtime < localMtime) {
                const snap = await buildSnapshot({ includeSecrets: true });
                // Force our just-built snapshot's mtime to the canonical local mtime
                // so the round-trip is consistent.
                const aligned: Snapshot = { ...snap, mtime: localMtime };
                await provider.push(aligned);
                return { ok: true, direction: 'upload', localMtime };
            }

            return { ok: true, direction: 'noop', remoteMtime: remote.mtime, localMtime };
        } catch (e: any) {
            console.error(APP_NAME_WITH_SUFFIX, 'syncNow failed', e);
            return { ok: false, error: e?.message || String(e) };
        }
    })();
    try {
        return await inflight;
    } finally {
        inflight = null;
    }
}

/**
 * Called from background startup after migration. Fire-and-forget; failures
 * just log. Skips entirely if no provider is configured.
 */
export async function syncOnStartup(): Promise<void> {
    try {
        const provider = await getActiveProvider();
        if (!provider) return;
        if (!(await provider.isAuthenticated())) return;
        const result = await syncNow();
        console.log(APP_NAME_WITH_SUFFIX, 'startup sync:', result);
    } catch (e) {
        console.error(APP_NAME_WITH_SUFFIX, 'startup sync error', e);
    }
}
