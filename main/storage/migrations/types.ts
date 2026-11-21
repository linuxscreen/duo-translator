// Types of the storage migration framework. The design, and the alternatives
// that were turned down, are in .ai/plans/storage-schema-migrations.md.

import type { SyncedKeyWriter } from '../configStore';

/**
 * What a migration is allowed to touch.
 *
 * Deliberately narrow: no `storage`, no `configRepo`, no clock. A migration
 * that could reach those could stamp a synced write with the current time (see
 * `migrationWriter` for why that is the one thing it must never do) or call
 * back into the store's write lock, which is not re-entrant.
 */
export interface MigrationContext extends SyncedKeyWriter {
    /** Device-local keys (no `config_` / `domain_` / `rule_` prefix). No clocks. */
    local: {
        get<T>(key: string): Promise<T | null>;
        set(key: string, value: unknown): Promise<void>;
        remove(key: string): Promise<void>;
    };
}

export interface Migration {
    /**
     * Position in the chain: a positive integer, strictly increasing down the
     * registry. Never reused, never reordered, never removed once released —
     * devices record the highest version they have applied.
     */
    version: number;
    /** For logs. */
    name: string;
    /**
     * The fixed clock (ms since the Unix epoch) of every synced write this
     * migration makes, on every device. Use the day the change was merged, or
     * any moment before the first release that carries it: too early is
     * harmless, while too late overrules real edits made in between.
     *
     * A deletion it records is dated at the epoch too, and is exempt from the
     * 60-day tombstone GC for exactly that reason (keepTombstone in
     * snapshot.ts): dated that far back, it would otherwise expire on the
     * devices that upgrade late, and a peer still on an older build would
     * bring the deleted value back.
     */
    epoch: number;
    /**
     * Must make sense on empty storage (a fresh install runs the whole chain
     * — usually that means writing nothing) and be safe to run twice (a run can
     * be cut short and repeated).
     *
     * Once released, never edit it: devices that already ran it will not run
     * it again. Correct a mistake with a new migration.
     */
    run(ctx: MigrationContext): Promise<void>;
}
