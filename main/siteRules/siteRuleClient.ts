// ---------------------------------------------------------------------------
// Content-side client for website translation rules.
//
// Two steps, because the work splits across contexts:
//   fetchSiteRuleCandidates  ask background which rules match this URL
//   compileCandidates        apply each rule's matchSelectors condition against
//                            the live document, merge the tiers, validate+join
//
// Deliberately free of any import from siteRuleService.ts: the rule corpus, the
// subscription fetch and the URL matching all stay in background.
// ---------------------------------------------------------------------------

import { SITE_RULE_ACTION } from '@/main/constants';
import { sendMessageToBackground } from '@/utils/message';
import { mergeCandidates } from './resolve';
import { compileSiteRules, pageMatchesCondition } from './selectors';
import {
    EMPTY_CANDIDATES,
    type CandidateRule,
    type CompiledSiteRules,
    type SiteRuleCandidates,
} from './types';

/**
 * Which rules match this document's URL.
 *
 * `sendMessageToBackground` resolves `undefined` rather than rejecting when the
 * background is unreachable; an empty candidate set is the right degradation
 * (no include restriction, no extra exclusions), so the page still translates.
 */
export async function fetchSiteRuleCandidates(url: string): Promise<SiteRuleCandidates> {
    try {
        const result: SiteRuleCandidates | undefined = await sendMessageToBackground({
            action: SITE_RULE_ACTION.RESOLVE,
            data: { url },
        });
        return result?.tiers ? result : EMPTY_CANDIDATES;
    } catch {
        return EMPTY_CANDIDATES;
    }
}

/** Any candidate carrying a page-identity condition? Lets callers skip re-probing. */
export function hasConditionalRules(candidates: SiteRuleCandidates): boolean {
    return candidates.tiers.some((tier) => tier.some((rule) => rule.matchSelectors.length > 0));
}

/**
 * Evaluate the conditions against the current DOM and produce the rule set the
 * marking scan consumes.
 *
 * Re-run once per scan cycle when {@link hasConditionalRules}: a condition is a
 * live predicate, not a one-shot gate. Most page-identity markers sit in the
 * server-rendered shell and are already there at document_idle, but an SPA route
 * change rewrites them (Docusaurus swaps its `<html>` classes) and a fully
 * client-rendered app may set them during hydration.
 */
export function compileCandidates(candidates: SiteRuleCandidates): CompiledSiteRules {
    return compileSiteRules(mergeCandidates(candidates, (rule) => pageMatchesCondition(rule.matchSelectors)));
}

/** Candidates whose condition does not hold. Used for the unmatched-rule warning. */
export function unmatchedConditions(candidates: SiteRuleCandidates): CandidateRule[] {
    return candidates.tiers
        .flat()
        .filter((rule) => rule.matchSelectors.length > 0 && !pageMatchesCondition(rule.matchSelectors));
}
