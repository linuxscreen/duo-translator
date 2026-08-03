// ---------------------------------------------------------------------------
// Selector validation + joining. Runs where a document exists (content script,
// Options page) — NOT in the service worker.
//
// Why this is a separate step from normalization: `el.matches(a, b, c)` throws
// for the whole string if any one selector is malformed, and the marking scan
// catches that exception and moves on — so one typo in one subscription rule
// silently disables every rule on the page. That bug is live today in the
// legacy per-host path (main/content.ts, `el.matches(rules.join(","))`). Here we
// validate each selector once, drop the bad ones, and join what is left.
// ---------------------------------------------------------------------------

import { APP_NAME_WITH_SUFFIX } from '@/main/constants';
import {
    EMPTY_COMPILED,
    type CompiledSiteRules,
    type ResolvedSiteRules,
} from './types';

/**
 * Keep the selectors the engine actually accepts, and join them.
 *
 * `document.querySelector` is the cheapest way to ask the engine "is this valid
 * syntax?" — it throws SyntaxError on a malformed selector and otherwise returns
 * a node or null, which we discard.
 */
export function compileSelectorList(selectors: string[], label: string): string {
    const valid: string[] = [];
    for (const selector of selectors) {
        try {
            document.querySelector(selector);
            valid.push(selector);
        } catch {
            console.warn(APP_NAME_WITH_SUFFIX, `ignoring malformed ${label} selector:`, selector);
        }
    }
    return valid.join(',');
}

/**
 * Does this rule's page-identity condition hold right now?
 *
 * Empty condition = unconditional. Otherwise at least one selector must match
 * something in the document.
 *
 * Fails CLOSED on a malformed selector (skip it, warn): a condition we could not
 * evaluate has not been shown to hold, and quietly applying the rule anyway
 * would be the more damaging guess — an unapplied rule under-excludes, an
 * unconditionally applied one can strip translation from the wrong pages. User
 * rules cannot reach here malformed (the Options editor validates on save); a
 * subscription can.
 */
export function pageMatchesCondition(matchSelectors: string[]): boolean {
    if (matchSelectors.length === 0) return true;
    for (const selector of matchSelectors) {
        try {
            if (document.querySelector(selector)) return true;
        } catch {
            console.warn(APP_NAME_WITH_SUFFIX, 'ignoring malformed matchSelectors entry:', selector);
        }
    }
    return false;
}

/** Validate + join both selector lists of a resolved rule set. */
export function compileSiteRules(resolved: ResolvedSiteRules | undefined): CompiledSiteRules {
    if (!resolved) return EMPTY_COMPILED;
    return {
        includeSelector: compileSelectorList(resolved.includeSelectors, 'include'),
        excludeSelector: compileSelectorList(resolved.excludeSelectors, 'exclude'),
        injectCss: resolved.injectCss ?? '',
        matchedIds: resolved.matchedIds ?? [],
    };
}
