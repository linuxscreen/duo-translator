// ---------------------------------------------------------------------------
// Website translation rules — shared data model.
//
// NOTE ON NAMING: the word "rule" was already taken in this repo by the
// per-host no-translate selector list (`rule_<host>`, `ruleRepo`, ruleMode.ts,
// DB_ACTION.RULE_*). That system is untouched and keeps its name. Everything in
// this feature is namespaced `siteRule` — do not merge the two namespaces.
//
// This module is imported by BOTH background and content, so it must stay pure
// data + pure functions (no fetch, no storage, no DOM).
// ---------------------------------------------------------------------------

/** Which tier a rule came from. Subscriptions are keyed by their URL. */
export type RuleSource = 'system' | 'user' | `sub:${string}`;

/**
 * Stable identity of one rule across tiers.
 *
 * `id` is only unique *within a bundle* — two subscription authors will happily
 * both ship `github`. The disable list therefore stores `refKey` strings, not
 * bare ids.
 */
export function refKey(source: RuleSource, id: string): string {
    return `${source}#${id}`;
}

/** The subscription source tag for a subscription URL. */
export function subSource(url: string): RuleSource {
    return `sub:${url}`;
}

/**
 * One rule, after normalization: every `string | string[]` field from the file
 * format has been collapsed to `string[]`. Nothing downstream ever sees the
 * union — see normalizeBundle.
 */
export type SiteRule = {
    id: string;
    /** List label. Falls back to the id when the author omitted it. */
    name: string;
    description: string;
    /** The author's default. The user's own on/off state lives separately. */
    enabled: boolean;
    /** URL patterns this rule applies to. Empty means "never matches". */
    includeUrls: string[];
    /** URL patterns that veto a match, even if includeUrls hit. */
    excludeUrls: string[];
    /**
     * Page-identity condition: the rule only applies when at least one of these
     * CSS selectors matches something in the document. Empty = unconditional.
     *
     * Meant for markers in the server-rendered shell — `<html>`/`<body>` classes
     * (`html.docs-doc-page`, `body.ns-0.action-view`, `body.single-post`),
     * `<meta>` tags (`meta[name="generator"][content^="VitePress"]`,
     * `meta[name="route-pattern"][content$="/issues(.:format)"]`) — NOT content
     * elements. The shell is present when the content script runs at
     * document_idle even on client-rendered apps; `.article-body` may not be.
     */
    matchSelectors: string[];
    /** CSS selectors delimiting the ONLY regions to translate. Empty = whole page. */
    includeSelectors: string[];
    /** CSS selectors for regions never to translate. */
    excludeSelectors: string[];
    /** CSS injected into the page while it is translated. */
    injectCss: string[];
};

/** A rule package: the subscription file format, the export format, and the bundled baseline. */
export type SiteRuleBundle = {
    schemaVersion: number;
    name: string;
    /** ISO timestamp. Used to decide whether a fetched official package supersedes the bundled baseline. */
    updatedAt: string;
    rules: SiteRule[];
};

/** Bump when the file format changes incompatibly. Older files are rejected. */
export const SITE_RULE_SCHEMA_VERSION = 1;

/** One entry of the user's subscription list (stored in config, synced). */
export type SiteRuleSubscription = {
    url: string;
    /** Package name from the last successful fetch; falls back to the URL in the UI. */
    name?: string;
    enabled: boolean;
    addedAt: number;
    lastFetchAt?: number;
    /** Message from the last failed fetch. Cleared on success; the old cache is kept. */
    lastError?: string;
    ruleCount?: number;
};

/** One source's rules. Several groups share a tier (all subscriptions do). */
export type RuleGroup = {
    source: RuleSource;
    rules: SiteRule[];
};

/**
 * A URL-matched rule reduced to what content actually needs.
 *
 * `name` / `description` / the URL patterns are dropped: they are Options-only,
 * and this payload crosses into every frame of every page.
 */
export type CandidateRule = {
    /** refKey — identity for the unmatched-condition warning and for debugging. */
    key: string;
    matchSelectors: string[];
    includeSelectors: string[];
    excludeSelectors: string[];
    injectCss: string[];
};

/**
 * Wire payload of SITE_RULE_ACTION.RESOLVE: the rules whose URL patterns match,
 * grouped by tier, LOWEST → HIGHEST priority.
 *
 * Background stops at URL matching because `matchSelectors` needs a document,
 * which an MV3 service worker does not have. Content applies the condition and
 * runs the field merge (mergeCandidates) — a ~60-line pure function over a
 * handful of rules, not the whole corpus.
 */
export type SiteRuleCandidates = {
    tiers: CandidateRule[][];
};

export const EMPTY_CANDIDATES: SiteRuleCandidates = { tiers: [] };

/** What the field merge produces, before selector validation/joining. */
export type ResolvedSiteRules = {
    /** Merged include selectors. Empty = no restriction, translate the whole page. */
    includeSelectors: string[];
    /** Merged exclude selectors. */
    excludeSelectors: string[];
    /** Concatenated `injectCss`, system → subscription → user (later wins). */
    injectCss: string;
    /** refKeys of the rules that contributed. Used in the include-miss warning. */
    matchedIds: string[];
};

export const EMPTY_RESOLVED: ResolvedSiteRules = {
    includeSelectors: [],
    excludeSelectors: [],
    injectCss: '',
    matchedIds: [],
};

/**
 * The content-side form: selector lists validated and joined once per resolve.
 *
 * Two reasons the join does NOT happen in background. (1) The marking scan calls
 * `el.matches()` on every visited element and the legacy per-host path re-ran
 * `rules.join(",")` inside that loop — joining once per resolve is the fix.
 * (2) Validation needs `document.querySelector`, which does not exist in an MV3
 * service worker; a single malformed selector inside a joined string makes
 * `el.matches()` throw for the *whole* string, silently disabling every rule.
 * So background merges, content validates + joins. See compileSiteRules.
 */
export type CompiledSiteRules = {
    /** Joined include selectors, or '' when unrestricted. */
    includeSelector: string;
    /** Joined exclude selectors, or ''. */
    excludeSelector: string;
    injectCss: string;
    matchedIds: string[];
};

export const EMPTY_COMPILED: CompiledSiteRules = {
    includeSelector: '',
    excludeSelector: '',
    injectCss: '',
    matchedIds: [],
};
