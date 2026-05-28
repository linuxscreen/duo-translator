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
}

export type SyncDirection = 'upload' | 'download' | 'noop';

export type SyncResult =
    | { ok: true; direction: SyncDirection; remoteMtime?: number; localMtime: number }
    | { ok: false; error: string };
