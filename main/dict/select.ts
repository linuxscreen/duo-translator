// Dictionary lookup — "is this a word, who do we ask, and whose answer wins".
//
// Pure predicates, shared by the content side (which decides whether to ask at
// all) and by the unit tests. No I/O.

import type { DictEntry, DictProvider } from "./types";

/**
 * Longest selection still treated as a word. Well past any real headword
 * ("antidisestablishmentarianism" is 28), short enough that a stray selection
 * of a long unbroken token — a URL, a base64 blob, a code identifier — does not
 * turn into a dictionary request.
 */
const MAX_WORD_LENGTH = 40;

/**
 * A single Latin-script word, optionally hyphenated or with an apostrophe
 * ("well-being", "don't", "café", "naïve").
 *
 * Latin script only, on purpose. The dictionary providers are word-oriented:
 * for Chinese and Japanese, "the selection is one word" is a segmentation
 * question with no answer available here, and the ordinary translation already
 * covers those selections well.
 */
const WORD_RE = /^\p{Script=Latin}[\p{Script=Latin}\p{M}'’-]*$/u;

/** The one target language Bing's dictionary is asked for. */
const MICROSOFT_TARGET = "zh-CN";

/**
 * Whether `text` should get a dictionary lookup alongside its translation.
 *
 * Trailing punctuation is NOT tolerated — a selection is either a bare word or
 * it is prose, and accepting "word." would also accept the first sentence of a
 * paragraph the user meant to translate whole.
 */
export function isDictWord(text: string): boolean {
    const word = text.trim();
    if (word.length === 0 || word.length > MAX_WORD_LENGTH) return false;
    return WORD_RE.test(word);
}

/**
 * Which providers to ask, given only the target language.
 *
 * Note what is NOT decided here: the source language. It cannot be — a single
 * word carries almost no signal, and the obvious shortcuts are wrong in ways
 * that matter. Guessing "English" from the word being ASCII sends every French
 * "important", "table" or "message" to Bing, which cheerfully answers with the
 * English entry; a statistical detector on one word is close to a coin flip.
 *
 * So both providers are queried CONCURRENTLY and the choice is made afterwards
 * by `chooseDictEntry`, once the responses (and the translation running beside
 * them) have said what the language actually is. The extra request costs
 * nothing in latency, and only happens for the one target where Bing is a
 * candidate at all.
 */
export function dictProvidersFor(targetLang: string): DictProvider[] {
    // Google is the universal provider: every source language, every target.
    // Bing is worth asking only for →Simplified Chinese, where it alone has
    // IPA for both accents, human recordings and bilingual example sentences.
    return targetLang === MICROSOFT_TARGET ? ["microsoft", "google"] : ["google"];
}

/** "en-US" / "EN" → "en"; anything falsy → "". */
function baseLang(lang: string | undefined | null): string {
    return (lang || "").toLowerCase().split("-")[0];
}

/**
 * Pick the answer to show, now that the source language is known.
 *
 * `detectedSourceLang` is what the translation running alongside reported.
 * Google's own reply carries a detected language too and is preferred, because
 * it arrives in the same tick as the entries themselves — using the
 * translation's would mean rendering one provider and swapping to the other a
 * moment later.
 *
 * Falling through to the other provider when the preferred one came back empty
 * is deliberate: a word Bing has never heard of is still worth showing Google's
 * entry for, and vice versa.
 */
export function chooseDictEntry(
    entries: Partial<Record<DictProvider, DictEntry | null>>,
    detectedSourceLang: string | undefined,
    targetLang: string,
): DictEntry | null {
    const google = entries.google ?? null;
    const microsoft = entries.microsoft ?? null;
    const source = baseLang(google?.sourceLang) || baseLang(detectedSourceLang);
    if (source === "en" && targetLang === MICROSOFT_TARGET && microsoft) return microsoft;
    return google ?? microsoft;
}
