// Permanent cache for dictionary entries, backed by IndexedDB in the
// background service worker.
//
// Deliberately NOT the LRU translation cache next door, for two reasons:
//
//  * Nothing is ever evicted. A dictionary entry is tiny (a headword, a few
//    senses, two sentences) and its value does not decay with age — the whole
//    point is that the second lookup of a word is instant, forever. Even a
//    heavy user's whole vocabulary is a rounding error next to that cache's
//    100 MB translation budget, so competing with it for eviction pressure
//    would be all cost and no benefit.
//  * Entries are re-checked, not expired. A stale entry is still served (the
//    dictionary barely changes, and a blank panel while a network request runs
//    is a worse answer than a three-day-old definition), with a refresh kicked
//    off behind it.
//
// Misses are NOT cached. Recording them would save a request on every
// selection of a proper noun, but with no expiry a negative outlives whatever
// caused it: a provider outage, an anti-bot interstitial or a parser that
// stopped matching a redesigned page each get written down permanently, and
// the panel stays blank long after the cause is fixed. A word with no entry is
// cheap to re-ask for; a wrongly remembered "no entry" is not recoverable
// without wiping the store.

import { APP_NAME_KEBAB_CASE, APP_NAME_WITH_SUFFIX } from "../constants";
import type { DictEntry } from "../dict/types";

const DB_NAME = `${APP_NAME_KEBAB_CASE}-dict-cache`;
const STORE_ENTRIES = "entries";

/** How old an entry may get before the next lookup re-fetches it in the background. */
export const DICT_REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export interface DictCacheRecord {
    key: string;
    /**
     * The entry. Nullable only because older builds did write negatives here;
     * `lookupDict` treats such a row as a miss, so they age out on their own.
     */
    entry: DictEntry | null;
    fetchedAt: number;
}

/**
 * Cache identity. The word is lower-cased because dictionaries are
 * case-insensitive, and the target language is part of the key because the
 * senses and example translations are written in it.
 */
export function dictCacheKey(provider: string, targetLang: string, word: string): string {
    return `${provider}|${targetLang}|${word.trim().toLowerCase()}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (creating the store if this request is the one that creates the DB). */
function openAt(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
                db.createObjectStore(STORE_ENTRIES, { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error(`${DB_NAME} open blocked by another connection`));
    });
}

/**
 * There is deliberately NO version constant.
 *
 * A version number can only ever hurt here. This is a pure cache — one object
 * store, values that are all re-derivable from the network — so there is no
 * schema to migrate, and the one thing a version DOES do is fail: opening at a
 * version LOWER than what is on disk throws `VersionError` and nothing can
 * recover it. That is not hypothetical — bumping the constant to force a wipe
 * and then reverting the bump left every already-upgraded profile with a
 * permanently unopenable cache. A versionless open takes whatever is on disk
 * and creates v1 when there is nothing.
 *
 * The store is still verified after opening, because a versionless open cannot
 * create it on a database that already exists.
 */
async function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = (async () => {
        let db = await openAt();
        if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
            // Pre-existing database without our store: the only way to add one
            // is an upgrade, so step the version by one.
            const next = db.version + 1;
            db.close();
            db = await openAt(next);
        }
        // A database deleted from under us (DevTools, "clear site data") makes
        // every later transaction throw — drop the handle so the next call
        // reopens instead of failing forever.
        db.onclose = () => { dbPromise = null; };
        return db;
    })();
    // A rejected promise must NOT stay memoized. Both callers swallow errors by
    // design, so caching the rejection would turn one transient failure into a
    // cache that is dead for the rest of the worker's life, with nothing on
    // screen and nothing in the log to say so.
    dbPromise.catch((e) => {
        dbPromise = null;
        console.warn(APP_NAME_WITH_SUFFIX, "dictionary cache unavailable:", e);
    });
    return dbPromise;
}

/**
 * Read one record, or null when the word has never been looked up.
 *
 * Never throws: the dictionary is a supplement to the translation, so a broken
 * or blocked IndexedDB degrades to "always a cache miss" rather than taking the
 * lookup down with it.
 */
export async function readDictCache(key: string): Promise<DictCacheRecord | null> {
    try {
        const db = await openDb();
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE_ENTRIES, "readonly");
            const req = tx.objectStore(STORE_ENTRIES).get(key);
            req.onsuccess = () => resolve((req.result as DictCacheRecord) ?? null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

/** Write (or overwrite) one record. Never throws — see `readDictCache`. */
export async function writeDictCache(key: string, entry: DictEntry | null): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE_ENTRIES, "readwrite");
        tx.objectStore(STORE_ENTRIES).put({ key, entry, fetchedAt: Date.now() } satisfies DictCacheRecord);
        await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        });
    } catch {
        /* ignore */
    }
}

/** Drop every cached entry (Options' "clear cache" path may want this later). */
export async function clearDictCache(): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE_ENTRIES, "readwrite");
        tx.objectStore(STORE_ENTRIES).clear();
        await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        });
    } catch {
        /* ignore */
    }
}
