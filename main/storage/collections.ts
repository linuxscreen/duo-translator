// Registry of "collection" storage keys — keys whose value is an ARRAY of
// independent elements rather than one atomic value.
//
// Why this exists: the sync CRDT in snapshot.ts is a per-*key* LWW map, so a
// key holding an array was resolved whole. Device A adding an AI provider and
// device B adding another meant the later write's array replaced the earlier
// one entirely — one of the two providers just vanished. Import had the same
// shape of bug, and worse: it is documented as "merge-only, nothing deleted",
// yet a backup without the local providers wiped them.
//
// The fix is to give each collection key an ELEMENT IDENTITY function, so the
// same LWW algorithm can recurse one level down and merge element-by-element.
// Adding a new collection key is one line in this file — nothing else needs to
// know.
//
// Two constraints the registry shape comes from (see the plan in
// .ai/plans/sync-collection-element-level-merge.md):
//   - identity is NOT always `e.id`: subscriptions are identified by `url`
//     (the type has no id), and string collections are their own identity;
//   - `rule_<host>` is a dynamic key, so prefix matching is required.
//
// The element clocks themselves are NOT stored inside the value — they live in
// `__sync_meta.elements` (see configStore). The stored config keeps its plain
// array shape, so every reader of AI_PROVIDERS / SITE_RULE_* is untouched.

import { CONFIG_KEY } from '@/main/constants';
import { STORAGE_PREFIX } from './configStore';

/**
 * Stable identity of one element within a collection value.
 * Returns `null` for elements that carry no usable identity (corrupt records) —
 * those are excluded from element-level merging rather than being allowed to
 * poison the whole key. See `indexElements`.
 */
export type ElementIdentity = (el: unknown) => string | null;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Identity taken from a string field of an object element. */
const byField = (field: string): ElementIdentity => (el) =>
    el && typeof el === 'object' ? str((el as Record<string, unknown>)[field]) : null;

/** Identity of a plain-string element is the string itself (these are sets). */
const bySelf: ElementIdentity = (el) => str(el);

const cfg = (name: string) => `${STORAGE_PREFIX.CONFIG}${name}`;

// The registry is built lazily: this module imports STORAGE_PREFIX from
// configStore while configStore imports this module back, so reading that
// binding at module-evaluation time would hit the TDZ. Building on first use
// happens after both modules are fully initialized.
let EXACT: Record<string, ElementIdentity> | null = null;
let PREFIX: [string, ElementIdentity][] = [];

function ensureRegistry(): Record<string, ElementIdentity> {
    if (EXACT) return EXACT;
    EXACT = {
        [cfg(CONFIG_KEY.AI_PROVIDERS)]: byField('id'),
        [cfg(CONFIG_KEY.SITE_RULE_USER)]: byField('id'),
        // SiteRuleSubscription has no `id` field — the URL is its identity.
        [cfg(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS)]: byField('url'),
        // Already refKey strings (`<source>#<id>`).
        [cfg(CONFIG_KEY.SITE_RULE_DISABLED_IDS)]: bySelf,
        [cfg(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES)]: bySelf,
        [cfg(CONFIG_KEY.NO_TRANSLATE_LANGUAGES)]: bySelf,
        // Custom gesture definitions and their action bindings — both plain
        // arrays of `{id, ...}` records, so two devices each adding one keeps
        // both instead of the later write replacing the array wholesale.
        [cfg(CONFIG_KEY.CUSTOM_SHORTCUT_LIST)]: byField('id'),
        [cfg(CONFIG_KEY.CUSTOM_SHORTCUT_BINDINGS)]: byField('id'),
    };
    PREFIX = [
        // rule_<host> — per-domain no-translate CSS selectors (string[]).
        [STORAGE_PREFIX.RULE, bySelf],
    ];
    return EXACT;
}

/**
 * The element-identity function for a data key (storage key without the
 * `local:` area prefix), or `null` when the key is not a collection.
 */
export function collectionIdentity(dataKey: string): ElementIdentity | null {
    const exact = ensureRegistry();
    const hit = exact[dataKey];
    if (hit) return hit;
    for (const [prefix, idOf] of PREFIX) {
        if (dataKey.startsWith(prefix)) return idOf;
    }
    return null;
}

export function isCollectionKey(dataKey: string): boolean {
    return collectionIdentity(dataKey) !== null;
}

export type ElementIndex = {
    /** Identified elements, first occurrence wins on a duplicate id. */
    byId: Map<string, unknown>;
    /** Elements whose identity is null — carried along by whole-key LWW. */
    anonymous: unknown[];
};

/** Index a stored collection value by element identity. Non-arrays index empty. */
export function indexElements(value: unknown, idOf: ElementIdentity): ElementIndex {
    if (!Array.isArray(value)) return { byId: new Map(), anonymous: [] };
    const byId = new Map<string, unknown>();
    const anonymous: unknown[] = [];
    for (const el of value) {
        const id = idOf(el);
        if (id === null) anonymous.push(el);
        else if (!byId.has(id)) byId.set(id, el);
    }
    return { byId, anonymous };
}
