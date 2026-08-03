// ---------------------------------------------------------------------------
// The three-tier merge. Pure — this is the piece worth pinning with unit tests,
// because the merge rule differs per field and the differences are not
// intuitive.
//
//   priority: user > subscription > system
//
//   excludeSelectors  union of all tiers
//                     More exclusion is the safe direction, and a user adding
//                     one region should not throw away a subscription's work.
//
//   injectCss         concatenated system → subscription → user
//                     Equal specificity means the later declaration wins, so
//                     concatenation order *is* the override mechanism.
//
//   includeSelectors  ONLY the highest-priority tier that has any; lower tiers
//                     are ignored entirely.
//                     This is the non-obvious one. Union would be wrong: include
//                     narrows the translated area, so unioning lets a *lower*
//                     priority rule widen it again and override the higher
//                     rule's intent. "Translate only <article>" must not be
//                     undone by a system rule that says "translate #main".
//
// The work is split in two because the two halves run in different contexts:
//
//   selectCandidates  URL patterns + enabled + user-disabled.   BACKGROUND
//   mergeCandidates   the field merge above, gated by matchSelectors. CONTENT
//
// `matchSelectors` needs a document to evaluate, and an MV3 service worker has
// none — hence the split rather than one resolve in background.
// ---------------------------------------------------------------------------

import { ruleMatchesUrl } from './urlMatch';
import {
    refKey,
    type CandidateRule,
    type ResolvedSiteRules,
    type RuleGroup,
    type SiteRuleCandidates,
} from './types';

export type { RuleGroup } from './types';

/**
 * Narrow every tier down to the rules that apply to this URL and are switched
 * on, and strip them to the fields content needs.
 *
 * @param tiers ordered LOWEST → HIGHEST priority, i.e. `[[system], subs, [user]]`.
 * @param disabled refKeys the user switched off.
 */
export function selectCandidates(
    url: string,
    tiers: RuleGroup[][],
    disabled: Iterable<string> = [],
): SiteRuleCandidates {
    const off = disabled instanceof Set ? disabled : new Set(disabled);
    return {
        tiers: tiers.map((tier) => {
            const out: CandidateRule[] = [];
            for (const group of tier) {
                for (const rule of group.rules) {
                    if (!rule.enabled) continue;
                    const key = refKey(group.source, rule.id);
                    if (off.has(key)) continue;
                    if (!ruleMatchesUrl(url, rule.includeUrls, rule.excludeUrls)) continue;
                    out.push({
                        key,
                        matchSelectors: rule.matchSelectors,
                        includeSelectors: rule.includeSelectors,
                        excludeSelectors: rule.excludeSelectors,
                        injectCss: rule.injectCss,
                    });
                }
            }
            return out;
        }),
    };
}

/**
 * Merge the candidate tiers into one rule set.
 *
 * @param applies decides whether a candidate's `matchSelectors` condition holds.
 *                Content passes a DOM prober; background and unit tests pass
 *                nothing and every candidate applies.
 */
export function mergeCandidates(
    candidates: SiteRuleCandidates,
    applies: (rule: CandidateRule) => boolean = () => true,
): ResolvedSiteRules {
    const tiers = candidates.tiers;
    const excludeSelectors: string[] = [];
    const seenExclude = new Set<string>();
    const cssChunks: string[] = [];
    const matchedIds: string[] = [];
    // Per-tier include lists, same index as `tiers`; picked over at the end.
    const includePerTier: string[][] = tiers.map(() => []);

    tiers.forEach((tier, tierIndex) => {
        for (const rule of tier) {
            if (!applies(rule)) continue;

            matchedIds.push(rule.key);
            for (const selector of rule.excludeSelectors) {
                if (seenExclude.has(selector)) continue;
                seenExclude.add(selector);
                excludeSelectors.push(selector);
            }
            for (const selector of rule.includeSelectors) {
                if (!includePerTier[tierIndex].includes(selector)) {
                    includePerTier[tierIndex].push(selector);
                }
            }
            cssChunks.push(...rule.injectCss);
        }
    });

    // Highest priority tier that contributed any include selector wins outright.
    let includeSelectors: string[] = [];
    for (let i = includePerTier.length - 1; i >= 0; i--) {
        if (includePerTier[i].length > 0) {
            includeSelectors = includePerTier[i];
            break;
        }
    }

    return {
        includeSelectors,
        excludeSelectors,
        injectCss: cssChunks.join('\n'),
        matchedIds,
    };
}

/** Both halves at once. The shape the merge semantics are tested through. */
export function resolveRules(
    url: string,
    tiers: RuleGroup[][],
    disabled: Iterable<string> = [],
    applies?: (rule: CandidateRule) => boolean,
): ResolvedSiteRules {
    return mergeCandidates(selectCandidates(url, tiers, disabled), applies);
}
