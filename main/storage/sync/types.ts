// Sync provider contract. The orchestration (LWW comparison, mtime tracking,
// active-provider selection) lives in syncManager.ts; providers only need to
// answer "am I configured?", "let me connect", "give me the remote snapshot",
// "take this local snapshot".

import type { Snapshot } from '@/main/storage/snapshot';
import type { SYNC_PROVIDER_ID } from '@/main/constants';

export interface SyncProvider {
    readonly id: SYNC_PROVIDER_ID;

    /** Has this provider been configured + credentials still valid (best effort)? */
    isAuthenticated(): Promise<boolean>;

    /** Trigger the provider-specific connect flow (OAuth, credential entry, etc.). */
    authenticate(input?: unknown): Promise<void>;

    /** Forget credentials and any cached remote handles. */
    disconnect(): Promise<void>;

    /** Read the remote snapshot. Returns null if the remote has no snapshot yet. */
    pull(): Promise<Snapshot | null>;

    /** Upload `snap` to the remote, overwriting any existing snapshot. */
    push(snap: Snapshot): Promise<void>;

    /** Short human-readable label (account email, baseURL, etc.) for the UI. */
    describe(): Promise<string | null>;

    /**
     * Optional: still configured, but this device can no longer obtain
     * credentials without the user (an OAuth session that can't be renewed
     * silently). Distinct from `isAuthenticated() === false`, which means "never
     * connected / disconnected". Providers that can't go stale may omit it.
     *
     * Purely device-local — never enters the sync snapshot.
     */
    needsReauth?(): Promise<boolean>;

    /**
     * Metadata about the remote backup file for the "manage backups" UI.
     * Optional — providers that can't cheaply report it may omit it.
     * Returns null when no remote backup exists yet.
     */
    getRemoteInfo?(): Promise<RemoteBackupInfo | null>;

    /** Delete the remote backup file. Optional, paired with getRemoteInfo. */
    deleteRemote?(): Promise<void>;
}

/** Metadata describing the remote backup file shown in the manage-backups UI. */
export type RemoteBackupInfo = {
    /** Remote file name. */
    name: string;
    /** Size in bytes, or null when the provider can't report it. */
    size: number | null;
    /** Last-modified time as epoch ms, or null when unknown. */
    modifiedTime: number | null;
};

// upload = remote updated, download = local updated, merge = both updated,
// noop = already in sync.
export type SyncDirection = 'upload' | 'download' | 'merge' | 'noop';

export type SyncResult =
    | { ok: true; direction: SyncDirection }
    | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Transient failures
//
// Some sync failures are expected to clear themselves on the next scheduled
// attempt — a silent OAuth renewal whose hidden navigation didn't load, an
// offline moment. They still fail this round, but nothing is broken and nobody
// has to act, so they must not be logged at error level: an error entry in
// chrome://extensions reads as "your extension is broken" and is exactly the
// kind of false alarm that trains people to ignore the list.
//
// The flag is a property on the Error rather than a subclass because these
// errors cross `sendMessage` to Options, where the prototype is gone anyway.
// ---------------------------------------------------------------------------

const TRANSIENT_FLAG = '__duoTransientSync';

/** Tag `e` as "will retry on its own"; returns it so it can be thrown inline. */
export function markTransient<E extends Error>(e: E): E {
    (e as unknown as Record<string, boolean>)[TRANSIENT_FLAG] = true;
    return e;
}

export function isTransientSyncError(e: unknown): boolean {
    return !!(e && typeof e === 'object' && (e as Record<string, unknown>)[TRANSIENT_FLAG]);
}
