// Runs storage migrations: each one once per device, in version order.
//
// Split from index.ts (the registry) so tests can drive it with their own list.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { APP_NAME_WITH_SUFFIX } from '@/main/constants';
import { isSyncedDataKey, migrationWriter, updateSyncMeta, type SyncMeta } from '../configStore';
import type { Migration, MigrationContext } from './types';

// Device-local on purpose (listed in INTERNAL_STORAGE_KEYS). Not to be confused
// with the sync snapshot's `schemaVersion`, which describes the envelope.
const VERSION_KEY: StorageItemKey = 'local:__storage_schema_version';

const localKey = (key: string): StorageItemKey => {
    if (isSyncedDataKey(key)) {
        throw new Error(`migration: "${key}" is a synced key — use the clocked writers, not ctx.local`);
    }
    return `local:${key}`;
};

const local: MigrationContext['local'] = {
    get: <T>(key: string) => storage.getItem<T>(localKey(key)),
    set: (key, value) => storage.setItem(localKey(key), value),
    remove: (key) => storage.removeItem(localKey(key)),
};

function contextFor(m: SyncMeta, epoch: number): { ctx: MigrationContext; changed: () => boolean } {
    const writer = migrationWriter(m, epoch);
    return {
        ctx: {
            get: writer.get,
            setIfOlder: writer.setIfOlder,
            removeIfOlder: writer.removeIfOlder,
            addElement: writer.addElement,
            removeElement: writer.removeElement,
            local,
        },
        changed: () => writer.changed,
    };
}

async function appliedVersion(): Promise<number> {
    const raw = await storage.getItem<unknown>(VERSION_KEY);
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

async function execute(migrations: readonly Migration[]): Promise<void> {
    try {
        // A stored version above everything we know (the user went back to an
        // older build) simply matches nothing below, and is left as it is.
        const applied = await appliedVersion();
        for (const migration of migrations) {
            if (migration.version <= applied) continue;
            const label = `storage migration ${migration.version} (${migration.name})`;

            // One lock acquisition per migration: its value writes and their
            // clocks land as one step, like every other write to a synced key.
            const outcome: { failed: boolean; error?: unknown } = { failed: false };
            await updateSyncMeta(async (m) => {
                const { ctx, changed } = contextFor(m, migration.epoch);
                try {
                    await migration.run(ctx);
                } catch (error) {
                    outcome.failed = true;
                    outcome.error = error;
                }
                // Saved even after a failure: whatever the migration wrote
                // before throwing must keep its clock. A value left without
                // one would be dated by the key's older clock at the next sync.
                return changed() ? undefined : false;
            });
            if (outcome.failed) {
                // Later migrations may build on this one, so the chain stops.
                console.error(APP_NAME_WITH_SUFFIX, `${label} failed; it will be retried`, outcome.error);
                return;
            }

            // Only now, with the sync-meta saved. Cut short between the two,
            // the migration runs again next time — and finds nothing older
            // than its epoch left to write.
            await storage.setItem(VERSION_KEY, migration.version);
            console.log(APP_NAME_WITH_SUFFIX, `${label} applied`);
        }
    } catch (e) {
        // Storage itself failed. Never let that take the caller down with it:
        // both callers (background start, sync) have more to do.
        console.error(APP_NAME_WITH_SUFFIX, 'storage migrations could not run; they will be retried', e);
    }
}

// The background start and a sync can both ask at once; the first call owns
// the run and the other one waits for it.
let inflight: Promise<void> | null = null;

/**
 * Apply every migration in `migrations` this device has not applied yet.
 * Never rejects. Once everything is applied, a call costs one storage read.
 */
export function runMigrationList(migrations: readonly Migration[]): Promise<void> {
    if (!inflight) {
        inflight = execute(migrations).finally(() => {
            inflight = null;
        });
    }
    return inflight;
}
