// ---------------------------------------------------------------------------
// Parsing / normalization of a rule package.
//
// Everything that reads a rule package from the outside world goes through here:
// the bundled baseline, a fetched subscription, and a user-supplied import file.
// Downstream code may then assume every `string | string[]` field is a
// `string[]`, every rule has a non-empty unique id, and the schema version is
// one we understand.
//
// Failure policy is per-entry, never per-package: a subscription with one
// broken rule keeps its other 200. The old per-host path did the opposite (one
// bad selector poisoned `rules.join(",")` and silently disabled everything),
// which is precisely the failure mode this feature must not reproduce.
//
// Pure module (no storage/DOM/fetch) — imported by background and by Options.
// ---------------------------------------------------------------------------

import {
    SITE_RULE_SCHEMA_VERSION,
    type SiteRule,
    type SiteRuleBundle,
} from './types';
import { isValidPattern } from './urlMatch';

export type NormalizeResult = {
    bundle: SiteRuleBundle;
    /** Human-readable notes about what was dropped. Surfaced in the console and the UI. */
    warnings: string[];
};

/** Collapse the `string | string[]` file format to `string[]`, dropping blanks. */
export function toArray(value: unknown): string[] {
    if (typeof value === 'string') {
        const s = value.trim();
        return s === '' ? [] : [s];
    }
    if (Array.isArray(value)) {
        return value
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => v !== '');
    }
    return [];
}

/**
 * Normalize one raw rule object.
 *
 * Returns `null` when the entry is unusable (no id). URL patterns that do not
 * compile are dropped individually — the rule survives with its remaining ones,
 * and loses nothing if it had only one (it then matches nothing, which is the
 * safe direction).
 *
 * Selectors are NOT syntax-checked here: that needs `document.querySelector`,
 * which does not exist in the MV3 service worker where this runs. Validation
 * happens where a document exists — the Options editor on save, and
 * compileSiteRules on the content side.
 */
export function normalizeRule(raw: any, warnings: string[]): SiteRule | null {
    if (!raw || typeof raw !== 'object') {
        warnings.push('Skipped a rule entry that is not an object');
        return null;
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id === '') {
        warnings.push('Skipped a rule with no id');
        return null;
    }

    const keepValid = (patterns: string[], field: string) =>
        patterns.filter((p) => {
            if (isValidPattern(p)) return true;
            warnings.push(`Rule "${id}": dropped malformed ${field} pattern "${p}"`);
            return false;
        });

    return {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : id,
        description: typeof raw.description === 'string' ? raw.description : '',
        // Author default; the user's own on/off state is stored separately as a
        // disabled-refKey list, so it survives a subscription refresh.
        enabled: raw.enabled !== false,
        includeUrls: keepValid(toArray(raw.includeUrls), 'includeUrls'),
        excludeUrls: keepValid(toArray(raw.excludeUrls), 'excludeUrls'),
        matchSelectors: toArray(raw.matchSelectors),
        includeSelectors: toArray(raw.includeSelectors),
        excludeSelectors: toArray(raw.excludeSelectors),
        injectCss: toArray(raw.injectCss),
    };
}

/**
 * Normalize a whole package.
 *
 * Throws only for the two conditions that make the payload meaningless: not an
 * object with a `rules` array, or a schema version from the future. Everything
 * else degrades to a warning.
 */
export function normalizeBundle(raw: any): NormalizeResult {
    const warnings: string[] = [];
    if (!raw || typeof raw !== 'object') {
        throw new Error('Not a rule package: expected a JSON object');
    }
    if (!Array.isArray(raw.rules)) {
        throw new Error('Not a rule package: missing "rules" array');
    }
    const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
    if (schemaVersion > SITE_RULE_SCHEMA_VERSION) {
        throw new Error(
            `Rule package schema v${schemaVersion} is newer than supported (v${SITE_RULE_SCHEMA_VERSION}); update the extension`,
        );
    }

    const seen = new Set<string>();
    const rules: SiteRule[] = [];
    for (const entry of raw.rules) {
        const rule = normalizeRule(entry, warnings);
        if (!rule) continue;
        if (seen.has(rule.id)) {
            warnings.push(`Dropped duplicate rule id "${rule.id}"`);
            continue;
        }
        seen.add(rule.id);
        rules.push(rule);
    }

    return {
        bundle: {
            schemaVersion: SITE_RULE_SCHEMA_VERSION,
            name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : '',
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
            rules,
        },
        warnings,
    };
}

/**
 * Compare two packages' `updatedAt`. Used to decide whether a fetched official
 * package supersedes the bundled baseline. An unparseable/absent timestamp
 * sorts oldest, so a package without one never displaces a dated baseline.
 */
export function bundleTime(bundle: SiteRuleBundle | undefined): number {
    if (!bundle?.updatedAt) return 0;
    const t = Date.parse(bundle.updatedAt);
    return Number.isNaN(t) ? 0 : t;
}
