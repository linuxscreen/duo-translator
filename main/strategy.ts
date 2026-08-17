// Pure decision logic for whether a page should auto-translate, extracted from
// main/content.ts (was the closure fn `isNeedsTranslate`) so it can be unit
// tested without a live content-script context. The caller passes the current
// switch + strategy + language state explicitly.
import { DOMAIN_STRATEGY, DEFAULT_STRATEGY } from "@/main/constants";
import { isNoTranslateLanguage } from "@/main/noTranslateLanguage";

export interface NeedsTranslateInput {
    globalSwitch: boolean;
    domainStrategy?: DOMAIN_STRATEGY | string;
    defaultStrategy?: DEFAULT_STRATEGY | string;
    targetLang: string;
    pageLang: string;
    /**
     * Configured no-translate languages, already normalized
     * (buildNoTranslateLanguageSet). Consulted ONLY on the AUTO path — a
     * strategy of ALWAYS is the user pointing at this site by name, and it
     * outranks a global list they set once. (The per-PARAGRAPH filter still
     * runs on such a page; only this whole-page decision is bypassed.)
     */
    noTranslateLanguages?: Set<string>;
}

/**
 * Resolve whether the page should be translated. Per-domain strategy wins over
 * the global default; when both defer (AUTO), fall back to "translate only when
 * the page language differs from the target — and is not one the user asked us
 * to leave alone".
 */
export function needsTranslate({
    globalSwitch,
    domainStrategy,
    defaultStrategy,
    targetLang,
    pageLang,
    noTranslateLanguages,
}: NeedsTranslateInput): boolean {
    if (!globalSwitch) return false;
    if (domainStrategy === DOMAIN_STRATEGY.NEVER) return false;
    if (domainStrategy === DOMAIN_STRATEGY.ALWAYS) return true;
    if (defaultStrategy === DEFAULT_STRATEGY.NEVER) return false;
    if (defaultStrategy === DEFAULT_STRATEGY.ALWAYS) return true;
    if (noTranslateLanguages && isNoTranslateLanguage(pageLang, noTranslateLanguages)) return false;
    return targetLang !== pageLang;
}
