// Persistent LRU cache for translation results, backed by IndexedDB in the
// background service worker.
//
// Why IndexedDB (and not chrome.storage.local): the cache cap is 100 MB, well
// above chrome.storage.local's 10 MB quota, and IndexedDB lives in the
// extension origin (shared across every tab, never colliding with the host
// page's own databases the way a content-script IndexedDB would).
//
// Cache identity is (service, targetLang, sourceText) — `service` is the same
// identifier the translate pipeline uses, i.e. a built-in name
// ('microsoft'|'google'|'deepl') or an AI provider id ('ai:<providerId>'), so
// AI translations are cached per provider. The stored value keeps the
// translated mapped-HTML plus the detected sourceLang/score, so a cache hit
// reconstructs a TranslateResult identical to a fresh API response.

const DB_NAME = 'duo-translator-translation-cache';
const DB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const STORE_META = 'meta';
const META_TOTAL_KEY = 'totalBytes';

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB hard cap
const EVICT_TO_RATIO = 0.9;          // after eviction, keep <= 90% of the cap

export interface CachedTranslation {
    t: string; // translatedMappedHtmlText (with <bN> placeholders)
    s: string; // detected sourceLang
    c: number; // score
}

interface CacheRecord extends CachedTranslation {
    key: string;
    size: number;       // approximate byte cost of this record
    lastAccess: number; // epoch ms — LRU ordering key
}

// ---------------------------------------------------------------------------
// Key hashing
// ---------------------------------------------------------------------------

// cyrb53 — small, fast, low-collision string hash. Returned as hex so keys
// stay short regardless of source-text length (we never store the source
// text, only its hash + the translation).
function cyrb53(str: string, seed = 0): string {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return hash.toString(16);
}

function cacheKey(service: string, targetLang: string, text: string): string {
    // Include service + targetLang verbatim plus length to further shrink the
    // already-tiny collision probability of cyrb53 alone.
    return `${service}${targetLang}${text.length}${cyrb53(text)}`;
}

function approxSize(rec: { key: string; t: string; s: string }): number {
    // UTF-16 ~2 bytes/char + fixed per-record overhead. Only used to enforce
    // the cap, so a rough estimate is fine.
    return (rec.key.length + rec.t.length + rec.s.length) * 2 + 64;
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
                const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'key' });
                store.createIndex('lastAccess', 'lastAccess', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// In-memory mirror of the persisted total. Lazily initialized; eviction
// recomputes it authoritatively, so transient drift self-heals.
let cachedTotal: number | null = null;

async function readPersistedTotal(): Promise<number> {
    const db = await openDb();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).get(META_TOTAL_KEY);
        req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : 0);
        req.onerror = () => resolve(0);
    });
}

async function persistTotal(total: number): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(total, META_TOTAL_KEY);
    await txDone(tx);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Batch-lookup. Returns an array aligned 1:1 with `texts`: a CachedTranslation
 * for a hit, or null for a miss. Hits are "touched" (lastAccess bumped) so the
 * LRU ordering reflects real usage.
 */
export async function getMany(
    service: string,
    targetLang: string,
    texts: string[],
): Promise<(CachedTranslation | null)[]> {
    const out: (CachedTranslation | null)[] = new Array(texts.length).fill(null);
    if (texts.length === 0) return out;
    const db = await openDb();
    const now = Date.now();
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    const store = tx.objectStore(STORE_ENTRIES);
    for (let i = 0; i < texts.length; i++) {
        const key = cacheKey(service, targetLang, texts[i]);
        const req = store.get(key);
        req.onsuccess = () => {
            const rec = req.result as CacheRecord | undefined;
            if (!rec) return;
            out[i] = { t: rec.t, s: rec.s, c: rec.c };
            rec.lastAccess = now;
            store.put(rec); // touch for LRU
        };
        // misses / errors leave out[i] === null
    }
    await txDone(tx);
    return out;
}

/**
 * Batch-store freshly fetched translations. Updates the running size total and
 * triggers LRU eviction when the cap is exceeded.
 */
export async function putMany(
    service: string,
    targetLang: string,
    entries: { text: string; value: CachedTranslation }[],
): Promise<void> {
    if (entries.length === 0) return;
    const db = await openDb();
    const now = Date.now();

    // De-dupe within the batch (keep the last write for a given key).
    const records = new Map<string, CacheRecord>();
    for (const e of entries) {
        const key = cacheKey(service, targetLang, e.text);
        const rec: CacheRecord = {
            key,
            t: e.value.t,
            s: e.value.s,
            c: e.value.c,
            size: 0,
            lastAccess: now,
        };
        rec.size = approxSize(rec);
        records.set(key, rec);
    }

    let delta = 0;
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    const store = tx.objectStore(STORE_ENTRIES);
    for (const rec of records.values()) {
        const getReq = store.get(rec.key);
        getReq.onsuccess = () => {
            const old = getReq.result as CacheRecord | undefined;
            delta += rec.size - (old?.size ?? 0);
            store.put(rec);
        };
        getReq.onerror = () => {
            delta += rec.size;
            store.put(rec);
        };
    }
    await txDone(tx);

    if (cachedTotal === null) cachedTotal = await readPersistedTotal();
    cachedTotal += delta;
    await persistTotal(cachedTotal);

    if (cachedTotal > MAX_BYTES) await evict();
}

/**
 * LRU eviction. Walks newest-first; keeps records until the running kept-size
 * would exceed EVICT_TO_RATIO * cap, then deletes every older record. This
 * doubles as an authoritative recount, so it self-corrects any size drift.
 */
async function evict(): Promise<void> {
    const db = await openDb();
    const limit = MAX_BYTES * EVICT_TO_RATIO;
    let kept = 0;
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    const index = tx.objectStore(STORE_ENTRIES).index('lastAccess');
    const cursorReq = index.openCursor(null, 'prev'); // most-recently-used first
    cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const rec = cursor.value as CacheRecord;
        if (kept + rec.size > limit) {
            cursor.delete();
        } else {
            kept += rec.size;
        }
        cursor.continue();
    };
    await txDone(tx);
    cachedTotal = kept;
    await persistTotal(kept);
}

/** Current approximate cache size in bytes (used for the clear-cache prompt). */
export async function getTotalBytes(): Promise<number> {
    if (cachedTotal === null) cachedTotal = await readPersistedTotal();
    return Math.max(0, cachedTotal);
}

/** Wipe the entire cache. */
export async function clearAll(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([STORE_ENTRIES, STORE_META], 'readwrite');
    tx.objectStore(STORE_ENTRIES).clear();
    tx.objectStore(STORE_META).clear();
    await txDone(tx);
    cachedTotal = 0;
}
