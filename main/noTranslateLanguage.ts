// "Do not translate these languages" — the pure half, shared by the three
// consumers (page-level auto-translate decision, the per-paragraph filter in
// main/content.ts, the YouTube caption track in main/videoSubtitle/).
//
// Everything here compares NORMALIZED tags (normalizeLanguageTag), because the
// codes being compared come from four different origins that do not agree on
// spelling: the config list uses LANGUAGES values (`zh-CN`, `pt`), franc
// answers ISO-639-3 mapped back to -1, the providers answer their own dialect
// of BCP-47 (`zh-Hans`, `pt-BR`), and a caption track carries whatever YouTube
// stored (`en-US`). Raw string equality gets all four of those wrong.
import { normalizeLanguageTag } from "@/main/constants";

/**
 * Compile the configured list into a comparison set. Empty set means the
 * feature is off — every caller short-circuits on `size === 0`, which is what
 * keeps this free for the users who never configure it.
 */
export function buildNoTranslateLanguageSet(list: unknown): Set<string> {
    const set = new Set<string>();
    if (!Array.isArray(list)) return set;
    for (const item of list) {
        if (typeof item !== "string") continue;
        const tag = normalizeLanguageTag(item);
        if (tag) set.add(tag);
    }
    return set;
}

/**
 * Is `lang` one the user asked us to leave alone?
 *
 * An unknown/empty language is NOT a match: every caller treats "we could not
 * tell" as "translate it". The filter exists to skip text the user can already
 * read, and skipping text on a guess we never made would be a silent data loss.
 */
export function isNoTranslateLanguage(lang: string | undefined | null, set: Set<string>): boolean {
    if (set.size === 0) return false;
    const tag = normalizeLanguageTag(lang);
    return tag !== "" && set.has(tag);
}
