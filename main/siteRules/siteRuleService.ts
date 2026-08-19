// ---------------------------------------------------------------------------
// Website translation rules — BACKGROUND ONLY.
//
// Owns the three tiers, the subscription fetch/cache, and the per-URL merge.
// Nothing here may be imported from the content side:
//   - subscription fetch is cross-origin. An MV3 content script gets no
//     cross-origin privileges (Firefox applies the host page's CSP connect-src,
//     Chrome applies page-origin CORS), so the fetch has to live in background —
//     the same reason the translation providers do.
//   - the rule corpus can be hundreds of KB. Shipping it into every frame of
//     every page would be wasteful; background matches and sends back only the
//     merged result, which is a few selectors.
//
// Storage layout (see CONFIG_KEY.SITE_RULE_* in main/constants.ts):
//   config_siteRule*        — user rules, subscription list, on/off state. Cloud-synced.
//   __site_rule_cache       — fetched package bodies, keyed by URL. NOT synced:
//                             no `config_`/`domain_`/`rule_` prefix, and
//                             snapshot.ts gates every boundary on that
//                             allow-list (same trick as __sync_meta).
//                             Re-fetchable data has no business inflating a
//                             Drive/WebDAV snapshot.
//                             This was WRONG for a while — buildSnapshot took
//                             all of storage.local minus a deny-list, so these
//                             hundreds of rule bodies really were uploaded on
//                             every sync while this very comment denied it.
//                             Don't re-derive "it's excluded" from the prefix
//                             alone; check that the path you care about
//                             actually calls isSnapshotKey.
// ---------------------------------------------------------------------------

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { browser } from 'wxt/browser';
import {
    APP_NAME_WITH_SUFFIX,
    CONFIG_KEY,
    SITE_RULE_ACTION,
    SITE_RULE_OFFICIAL_URL,
    SITE_RULE_REFRESH_MINUTES,
} from '@/main/constants';
import { configRepo } from '@/main/storage/configStore';
import { handleAsync } from '@/main/messageBridge';
// ?raw, not a JSON import: the baseline is JSONC (see jsonc.ts), which Vite's
// JSON loader would refuse to parse.
import baselineJsonc from '@/assets/rules/system.jsonc?raw';
import { parseJsonc } from './jsonc';
import { bundleTime, normalizeBundle } from './normalize';
import { selectCandidates } from './resolve';
import {
    EMPTY_CANDIDATES,
    SITE_RULE_SCHEMA_VERSION,
    subSource,
    type RuleGroup,
    type SiteRule,
    type SiteRuleBundle,
    type SiteRuleCandidates,
    type SiteRuleSubscription,
} from './types';

const CACHE_KEY: StorageItemKey = 'local:__site_rule_cache';
/** Fetch metadata for the official package. It has no subscription-list entry. */
const OFFICIAL_META_KEY: StorageItemKey = 'local:__site_rule_official';
const REFRESH_ALARM = 'siteRuleRefresh';
/** Guard against a subscription URL that serves something enormous. */
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

type PackageCache = Record<string, SiteRuleBundle>;

// The bundled baseline, parsed and normalized once at module load. It ships
// with the extension, so a malformed file is a development mistake — but since
// the ?raw import hands us text, that mistake surfaces at runtime, during
// background's initial script evaluation. Throwing there would take the entire
// service worker down (no messaging, no translation at all), so degrade to an
// empty system tier and shout in the console instead.
const BASELINE: SiteRuleBundle = loadBaseline();

function loadBaseline(): SiteRuleBundle {
    try {
        const { bundle, warnings } = normalizeBundle(parseJsonc(baselineJsonc));
        if (warnings.length > 0) {
            console.log(APP_NAME_WITH_SUFFIX, 'bundled site rules:', warnings);
        }
        return bundle;
    } catch (e) {
        console.log(APP_NAME_WITH_SUFFIX, 'bundled site rules failed to parse', e);
        return { schemaVersion: SITE_RULE_SCHEMA_VERSION, name: '', updatedAt: '', rules: [] };
    }
}

// ------------------------------ cache --------------------------------------

async function readCache(): Promise<PackageCache> {
    return (await storage.getItem<PackageCache>(CACHE_KEY)) ?? {};
}

async function writeCache(cache: PackageCache): Promise<void> {
    await storage.setItem(CACHE_KEY, cache);
}

// ------------------------------ tiers --------------------------------------

/**
 * The system tier: the bundled baseline, or the fetched official package when
 * that one is newer.
 *
 * Whole-package replacement rather than an id-level merge — the user sees one
 * "System rules" list either way, and merging two versions of the same package
 * would resurrect rules the maintainer deliberately deleted.
 */
export async function getSystemBundle(): Promise<SiteRuleBundle> {
    const cache = await readCache();
    const fetched = cache[SITE_RULE_OFFICIAL_URL];
    return fetched && bundleTime(fetched) > bundleTime(BASELINE) ? fetched : BASELINE;
}

export async function getUserRules(): Promise<SiteRule[]> {
    const raw = await configRepo.getT<unknown[]>(CONFIG_KEY.SITE_RULE_USER);
    if (!Array.isArray(raw)) return [];
    // Stored rules were normalized on write, but a cloud-synced payload from an
    // older/newer device has not been through this build's normalizer.
    return normalizeBundle({ schemaVersion: 1, rules: raw }).bundle.rules;
}

/**
 * The user's subscriptions. The official package is deliberately NOT one of
 * them: it feeds the system tier, is refreshed alongside them, and is presented
 * on the System tab with its own refresh button. Keeping it out of this list
 * means "subscription" has exactly one meaning in the storage, the merge and
 * the UI.
 */
export async function getSubscriptions(): Promise<SiteRuleSubscription[]> {
    const stored = await configRepo.getT<SiteRuleSubscription[]>(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS);
    if (!Array.isArray(stored)) return [];
    return stored.filter((s) => s && typeof s.url === 'string' && s.url !== SITE_RULE_OFFICIAL_URL);
}

async function setSubscriptions(list: SiteRuleSubscription[]): Promise<void> {
    await configRepo.set(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS, list);
}

/** Enabled subscription bundles, in list order. */
function getSubscriptionGroups(
    subscriptions: SiteRuleSubscription[],
    cache: PackageCache,
): RuleGroup[] {
    const groups: RuleGroup[] = [];
    for (const sub of subscriptions) {
        if (!sub.enabled) continue;
        const bundle = cache[sub.url];
        if (bundle) groups.push({ source: subSource(sub.url), rules: bundle.rules });
    }
    return groups;
}

// ------------------------------ resolve ------------------------------------

/**
 * Narrow every tier to the rules whose URL patterns match this page.
 *
 * Stops at URL matching on purpose — `matchSelectors` needs a document, which
 * this service worker does not have, so the condition and the field merge run
 * on the content side (see mergeCandidates).
 *
 * Called once per frame at content start and again when an SPA changes the URL,
 * so it must stay cheap: a few storage reads plus a pure filter. Pattern
 * compilation is memoized inside urlMatch.ts across calls.
 */
export async function resolveForUrl(url: string): Promise<SiteRuleCandidates> {
    if (!url) return EMPTY_CANDIDATES;
    const enabled = await configRepo.getT<boolean>(CONFIG_KEY.SITE_RULE_SWITCH);
    if (!enabled) return EMPTY_CANDIDATES;

    const [systemEnabled, userRules, subscriptions, cache, disabled] = await Promise.all([
        configRepo.getT<boolean>(CONFIG_KEY.SITE_RULE_SYSTEM_ENABLED),
        getUserRules(),
        getSubscriptions(),
        readCache(),
        configRepo.getT<string[]>(CONFIG_KEY.SITE_RULE_DISABLED_IDS),
    ]);

    const systemGroups: RuleGroup[] = systemEnabled
        ? [{ source: 'system', rules: (await getSystemBundle()).rules }]
        : [];

    // Lowest → highest priority. The subscription tier holds several groups.
    return selectCandidates(
        url,
        [systemGroups, getSubscriptionGroups(subscriptions, cache), [{ source: 'user', rules: userRules }]],
        Array.isArray(disabled) ? disabled : [],
    );
}

// ------------------------------ fetching -----------------------------------

/**
 * The record fields a fetch owns. Everything else on a `SiteRuleSubscription`
 * (url / enabled / addedAt) belongs to the user, and a refresh must never write
 * back its own stale copy of those — see refreshSubscriptions.
 */
type FetchOutcome = Pick<SiteRuleSubscription, 'lastFetchAt' | 'name' | 'ruleCount' | 'lastError'>;

/**
 * Fetch and cache one package.
 *
 * On failure the previous cache entry is KEPT and the error is reported back to
 * be recorded on the subscription — a flaky network must not silently drop a
 * user's rules.
 */
async function fetchPackage(url: string): Promise<FetchOutcome> {
    const outcome: FetchOutcome = { lastFetchAt: Date.now() };
    try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > MAX_PACKAGE_BYTES) {
            throw new Error(`Package too large (${Math.round(text.length / 1024)} KB)`);
        }
        // JSONC: a published package is hand-maintained, same as the baseline.
        const { bundle, warnings } = normalizeBundle(parseJsonc(text));
        if (warnings.length > 0) {
            console.log(APP_NAME_WITH_SUFFIX, `site rules from ${url}:`, warnings);
        }
        const cache = await readCache();
        cache[url] = bundle;
        await writeCache(cache);
        outcome.name = bundle.name || undefined;
        outcome.ruleCount = bundle.rules.length;
        outcome.lastError = undefined;
    } catch (e: any) {
        outcome.lastError = e?.message || String(e);
        console.log(APP_NAME_WITH_SUFFIX, `site rule subscription failed: ${url}`, e);
    }
    return outcome;
}

/** The official package is fetched like a subscription but has no list entry. */
async function fetchOfficial(): Promise<SiteRuleSubscription> {
    const meta: SiteRuleSubscription = {
        url: SITE_RULE_OFFICIAL_URL,
        enabled: true,
        addedAt: 0,
        ...(await fetchPackage(SITE_RULE_OFFICIAL_URL)),
    };
    await storage.setItem(OFFICIAL_META_KEY, meta);
    return meta;
}

async function getOfficialMeta(): Promise<SiteRuleSubscription | null> {
    return await storage.getItem<SiteRuleSubscription>(OFFICIAL_META_KEY);
}

/**
 * Refresh one subscription, or the official package plus every enabled
 * subscription when `url` is omitted. Returns the updated subscription list so
 * the caller can re-render.
 *
 * This is a read-modify-write over a list the user edits from Options, with a
 * NETWORK ROUND TRIP in the middle — so the list it started from is routinely
 * stale by the time it writes. It must therefore re-read and write back only
 * the fields a fetch owns; blindly persisting the snapshot it began with erases
 * whatever happened meanwhile.
 *
 * That is not hypothetical: "add a subscription" fires the config write and
 * this refresh as two concurrent background messages, and adding a per-element
 * bookkeeping read to configRepo.set (cloud-sync collection merging) was enough
 * to let this handler's read slip in front of the add — the row appeared and
 * then vanished, because this function wrote the pre-add list back over it. The
 * caller now awaits the save (that is what makes the new URL actually get
 * fetched), and this merge is what keeps any such interleaving from losing
 * data — the 24h alarm can fire mid-edit too.
 */
export async function refreshSubscriptions(url?: string): Promise<SiteRuleSubscription[]> {
    if (url === SITE_RULE_OFFICIAL_URL) {
        await fetchOfficial();
        return getSubscriptions();
    }
    if (!url) await fetchOfficial();

    const outcomes = new Map<string, FetchOutcome>();
    for (const sub of await getSubscriptions()) {
        const wanted = url ? sub.url === url : sub.enabled;
        if (wanted) outcomes.set(sub.url, await fetchPackage(sub.url));
    }

    const next = (await getSubscriptions()).map((sub) => {
        const outcome = outcomes.get(sub.url);
        return outcome ? { ...sub, ...outcome } : sub;
    });
    await setSubscriptions(next);
    return next;
}

/**
 * Register the periodic refresh. Must be called from background's first
 * synchronous turn like every other listener — an MV3 service worker (and, more
 * strictly, a Firefox event page) only wakes for listeners registered during
 * initial script evaluation.
 */
export function registerSiteRuleAlarms(): void {
    browser.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== REFRESH_ALARM) return;
        void refreshSubscriptions();
    });
    void browser.alarms.create(REFRESH_ALARM, {
        periodInMinutes: SITE_RULE_REFRESH_MINUTES,
        delayInMinutes: 1,
    });
}

// ------------------------------ overview -----------------------------------

/** Everything the Options rules page renders, in one round trip. */
export type SiteRuleOverview = {
    switchOn: boolean;
    systemEnabled: boolean;
    system: SiteRuleBundle;
    /** Whether the system tier is the fetched official package or the bundled baseline. */
    systemFromSubscription: boolean;
    /** Last fetch of the official package: timestamp + error, `null` before the first attempt. */
    official: SiteRuleSubscription | null;
    user: SiteRule[];
    subscriptions: SiteRuleSubscription[];
    /** Cached package per subscription URL — the "browse" panel reads from here. */
    packages: PackageCache;
    disabledIds: string[];
    officialUrl: string;
};

export async function getOverview(): Promise<SiteRuleOverview> {
    const [switchOn, systemEnabled, user, subscriptions, packages, disabledIds, official] = await Promise.all([
        configRepo.getT<boolean>(CONFIG_KEY.SITE_RULE_SWITCH),
        configRepo.getT<boolean>(CONFIG_KEY.SITE_RULE_SYSTEM_ENABLED),
        getUserRules(),
        getSubscriptions(),
        readCache(),
        configRepo.getT<string[]>(CONFIG_KEY.SITE_RULE_DISABLED_IDS),
        getOfficialMeta(),
    ]);
    const system = await getSystemBundle();
    return {
        switchOn,
        systemEnabled,
        system,
        systemFromSubscription: system !== BASELINE,
        official,
        user,
        subscriptions,
        packages,
        disabledIds: Array.isArray(disabledIds) ? disabledIds : [],
        officialUrl: SITE_RULE_OFFICIAL_URL,
    };
}

// ------------------------------ handlers -----------------------------------

type MessageHandler = (message: any, sendResponse: (r: any) => void) => boolean | void;

/** Site-rule actions handled in background, keyed by SITE_RULE_ACTION. Consumed by background.ts. */
export const siteRuleMessageHandlers: Record<string, MessageHandler> = {
    [SITE_RULE_ACTION.RESOLVE]: (message, sendResponse) =>
        handleAsync('Resolve site rules', sendResponse, () => resolveForUrl(message?.data?.url ?? '')),

    [SITE_RULE_ACTION.OVERVIEW]: (_message, sendResponse) =>
        handleAsync('Site rule overview', sendResponse, () => getOverview()),

    [SITE_RULE_ACTION.SUBSCRIPTION_REFRESH]: (message, sendResponse) =>
        handleAsync('Refresh site rule subscription', sendResponse, () =>
            refreshSubscriptions(message?.data?.url),
        ),
};
