// Pure decision logic for whether a page should auto-translate, extracted from
// main/content.ts (was the closure fn `isNeedsTranslate`) so it can be unit
// tested without a live content-script context. The caller passes the current
// switch + strategy + language state explicitly.
import { DOMAIN_STRATEGY, DEFAULT_STRATEGY } from "@/main/constants";

export interface NeedsTranslateInput {
    globalSwitch: boolean;
    domainStrategy?: DOMAIN_STRATEGY | string;
    defaultStrategy?: DEFAULT_STRATEGY | string;
    targetLang: string;
    pageLang: string;
}

/**
 * Resolve whether the page should be translated. Per-domain strategy wins over
 * the global default; when both defer (AUTO), fall back to "translate only when
 * the page language differs from the target".
 */
export function needsTranslate({
    globalSwitch,
    domainStrategy,
    defaultStrategy,
    targetLang,
    pageLang,
}: NeedsTranslateInput): boolean {
    if (!globalSwitch) return false;
    if (domainStrategy === DOMAIN_STRATEGY.NEVER) return false;
    if (domainStrategy === DOMAIN_STRATEGY.ALWAYS) return true;
    if (defaultStrategy === DEFAULT_STRATEGY.NEVER) return false;
    if (defaultStrategy === DEFAULT_STRATEGY.ALWAYS) return true;
    return targetLang !== pageLang;
}
