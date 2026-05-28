// One-shot copy of PouchDB `userdb` → chrome.storage.local.
//
// Triggered primarily from `chrome.runtime.onInstalled` (reason: 'update') but
// also runs as a safety-net check at background-script startup in case the
// install event was missed (MV3 SW can be killed mid-listener, Chrome has had
// edge-case bugs where onInstalled didn't fire, etc.).
//
// Runs at most once across the lifetime of the install: the `__migration_v1_done`
// storage flag is the source of truth. PouchDB data is *not* deleted in this
// version — kept as a fallback for at least one minor-version cycle. See
// plan §2.1 for the staged removal policy.

import PouchDB from 'pouchdb';
import { storage } from 'wxt/utils/storage';
import { APP_NAME_WITH_SUFFIX } from '@/main/constants';
import { STORAGE_PREFIX } from './configStore';

const FLAG_KEY = 'local:__migration_v1_done' as const;
const POUCH_DB_NAME = 'userdb';

type MigrationFlag = {
    version: 1;
    at: string;
    sourceDocCount: number;
    trigger: 'onInstalled' | 'startup';
};

type Trigger = 'onInstalled' | 'startup';

// Module-level mutex so simultaneous onInstalled + startup tail calls don't
// race. The first invocation owns the promise; subsequent callers await it.
let inflight: Promise<void> | null = null;

export async function migrateFromPouchIfNeeded(opts: { trigger: Trigger }): Promise<void> {
    if (inflight) {
        await inflight;
        return;
    }
    inflight = (async () => {
        try {
            await runMigration(opts.trigger);
        } catch (e) {
            // Swallow & log — the next background wake will retry.
            console.error(APP_NAME_WITH_SUFFIX, 'migrateFromPouchIfNeeded failed', e);
        }
    })();
    try {
        await inflight;
    } finally {
        inflight = null;
    }
}

async function runMigration(trigger: Trigger): Promise<void> {
    const existing = await storage.getItem<MigrationFlag>(FLAG_KEY);
    if (existing && existing.version === 1) {
        return;
    }

    let docs: Array<{ _id: string; [k: string]: unknown }> = [];
    try {
        const db = new PouchDB(POUCH_DB_NAME);
        const res = await db.allDocs({ include_docs: true });
        docs = res.rows
            .map((r: any) => r.doc)
            .filter((d: any) => d && typeof d._id === 'string');
    } catch (e: any) {
        // Database doesn't exist (fresh install) → still a successful no-op
        // migration. The flag-write below makes sure we don't try again.
        console.log(APP_NAME_WITH_SUFFIX, 'PouchDB not present, marking migration complete', e?.message);
    }

    const writes: Array<{ key: `local:${string}`; value: unknown }> = [];

    for (const doc of docs) {
        const id = doc._id;
        if (id.startsWith(STORAGE_PREFIX.CONFIG)) {
            // ConfigStorage docs wrap the actual value in `.value`.
            writes.push({
                key: `local:${id}`,
                value: (doc as any).value,
            });
        } else if (id.startsWith(STORAGE_PREFIX.DOMAIN)) {
            const { _id, _rev, ...rest } = doc as any;
            writes.push({ key: `local:${id}`, value: rest });
        } else if (id.startsWith(STORAGE_PREFIX.RULE)) {
            const rules = (doc as any).rules;
            if (Array.isArray(rules)) {
                writes.push({ key: `local:${id}`, value: rules });
            }
        }
        // Other doc shapes (e.g. _design/*, _local/*) are ignored.
    }

    if (writes.length > 0) {
        await storage.setItems(writes);
    }

    const flag: MigrationFlag = {
        version: 1,
        at: new Date().toISOString(),
        sourceDocCount: writes.length,
        trigger,
    };
    await storage.setItem<MigrationFlag>(FLAG_KEY, flag);

    console.log(
        APP_NAME_WITH_SUFFIX,
        `PouchDB migration done via ${trigger}, migrated ${writes.length} docs`,
    );
}
