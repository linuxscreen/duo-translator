// Storage migrations: one-off changes to data already stored on a device.
//
// Before adding one, check that the change cannot be expressed without writing
// anything — a new DEFAULT_VALUE, or a reader that accepts both shapes. Renaming
// a synced key or changing the shape of its value is NOT a migration: older
// clients keep syncing the old shape long after this device has migrated.
// See .ai/plans/storage-schema-migrations.md.
//
// To add one: a new file `NNN-what-it-does.ts`, appended to MIGRATIONS with the
// next version number.

import { disableBaiduByDefault } from './001-disable-baidu-by-default';
import { runMigrationList } from './runner';
import type { Migration } from './types';

export type { Migration, MigrationContext } from './types';

/** Append only. Released entries are never edited, reordered or removed. */
export const MIGRATIONS: readonly Migration[] = [
    disableBaiduByDefault,
];

/**
 * Every migration's epoch. A tombstone dated at one of them was written by a
 * migration and is exempt from the merge's tombstone GC (keepTombstone in
 * snapshot.ts) — which is one more reason a released entry is never edited:
 * moving its epoch would orphan the tombstones dated at the old one.
 */
export const MIGRATION_EPOCHS: ReadonlySet<number> = new Set(MIGRATIONS.map((m) => m.epoch));

/** Apply the migrations this device has not applied yet. Never rejects. */
export function runMigrations(): Promise<void> {
    return runMigrationList(MIGRATIONS);
}
