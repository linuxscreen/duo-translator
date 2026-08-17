// Per-paragraph "do not translate these languages" filter — the content-side
// orchestration. The pure comparison half is main/noTranslateLanguage.ts.
//
// A page translation is a batch of logical paragraphs, and the language of ONE
// paragraph is a different question from the language of the page: a Chinese
// article quoting three English paragraphs is a Chinese page, and it is exactly
// those three paragraphs the user wants translated (or, with `en` on the list,
// exactly the rest that they do not). So the decision is taken per unit, in two
// passes:
//
//  1. LOCAL (franc). Free, no round trip. Only trusted on a paragraph long
//     enough to vote — see LOCAL_DETECT_MIN_BYTES.
//  2. PROVIDER, for everything the local pass could not name. Which provider
//     depends on who is translating:
//       - Google / Microsoft / DeepL report a source language for EACH text in
//         the batch, so nothing extra is sent: the translation goes out as
//         usual and its own answer decides whether the result is used.
//       - Yandex (one language per batch), the AI providers and built-in AI
//         (none at all) cannot answer, so a Microsoft detect runs CONCURRENTLY
//         with the translation and the results are dropped afterwards.
//
// Both provider paths therefore spend the request and discard the answer. That
// is deliberate: the alternative is a blocking detect round-trip in front of
// every batch, which would slow down every page for every user — including the
// ones who never configured the feature. franc is what keeps the waste small,
// since a paragraph long enough to be worth a request is usually also long
// enough for franc to name.
//
// "We could not tell" always means TRANSLATE IT. Detection failing must never
// silently swallow content.
import { TRANSLATE_SERVICE } from "@/main/constants";
import { getTextLanguage } from "@/main/lang";
import { isNoTranslateLanguage } from "@/main/noTranslateLanguage";
import { utf8Length } from "@/utils/text";

/**
 * Below this much text, franc's answer is not trusted and the paragraph is
 * handed to the provider pass instead.
 *
 * Well under the 500-byte bar `detectLanguage` uses for a whole page, because
 * this is one paragraph and there is no second chance to accumulate more — and
 * a wrong answer here is bounded (one paragraph is left untranslated) where a
 * wrong page verdict decides the whole document. Non-Latin scripts are named
 * from far less than this; Latin ones are what the floor is for.
 */
const LOCAL_DETECT_MIN_BYTES = 200;

/**
 * Frame-local memo of text → detected language, so a paragraph that survived
 * one scan is not re-detected (and, on the provider path, not re-REQUESTED) on
 * every subsequent one.
 *
 * This is load-bearing, not an optimisation: a filtered-out unit leaves no
 * bookkeeping behind — `planUnit` has nothing to find — so every re-scan plans
 * it as "translate" again. Without the memo a page whose body is all in a
 * no-translate language would re-send it on every mutation.
 *
 * Stores the LANGUAGE, not the verdict, so editing the configured list takes
 * effect against the cache instead of being frozen into it.
 */
const detectedLanguageCache = new Map<string, string>();
const DETECTED_CACHE_MAX = 1000;

function rememberLanguage(text: string, lang: string) {
    if (!lang) return;
    // Plain FIFO eviction: paragraph text is bulky and the access pattern here
    // is "the same page, over and over", which a true LRU would not improve.
    if (detectedLanguageCache.size >= DETECTED_CACHE_MAX) {
        const oldest = detectedLanguageCache.keys().next().value;
        if (oldest !== undefined) detectedLanguageCache.delete(oldest);
    }
    detectedLanguageCache.set(text, lang);
}

/** Test seam / teardown. */
export function resetDetectedLanguageCache() {
    detectedLanguageCache.clear();
}

/**
 * Does this translator report a source language for every text in a batch?
 *
 * Google (`data[1][i]`), Microsoft (`detectedLanguage`) and DeepL
 * (`detected_source_language`) do. Yandex reports ONE language for the whole
 * chunk and built-in AI one for the whole batch — using either as a
 * per-paragraph verdict would let one long paragraph decide for its neighbours
 * — and the AI providers report none at all (`sourceLang` is `""`).
 */
export function reportsPerTextSourceLang(service: string): boolean {
    return service === TRANSLATE_SERVICE.GOOGLE
        || service === TRANSLATE_SERVICE.MICROSOFT
        || service === TRANSLATE_SERVICE.DEEPL;
}

/**
 * True for the translators that need the concurrent Microsoft detect — Yandex,
 * built-in AI, every `ai:<id>` provider, and anything added later.
 *
 * Defined as the complement rather than as its own list on purpose: a new
 * provider that forgets to opt in gets the extra detect (a wasted request) and
 * still filters correctly, where the other default would silently stop
 * filtering with nothing on screen to say so.
 */
export function needsCompanionDetect(service: string): boolean {
    return !reportsPerTextSourceLang(service);
}

export interface LocalLanguagePartition<T> {
    /** Named locally and on the list — never leaves this frame. */
    excluded: T[];
    /** Everything still to translate, in input order. */
    keep: T[];
    /**
     * Subset of `keep` whose language is still unknown: the only ones the
     * provider pass has anything to say about. Paragraphs franc already cleared
     * are not re-judged by the provider — one verdict per paragraph.
     */
    undetermined: T[];
}

/**
 * Pass 1. Splits `items` using franc + the memo, without any network call.
 *
 * `textOf` is supplied by the caller because the source of a unit's text
 * differs by view strategy; this module never touches the DOM.
 */
export function partitionByLocalLanguage<T>(
    items: T[],
    textOf: (item: T) => string,
    set: Set<string>,
): LocalLanguagePartition<T> {
    const excluded: T[] = [];
    const keep: T[] = [];
    const undetermined: T[] = [];
    for (const item of items) {
        const text = textOf(item).trim();
        let lang = detectedLanguageCache.get(text);
        if (lang === undefined) {
            // Short text is not handed to franc at all — its answer there is a
            // coin flip, and a wrong one drops a paragraph the user wanted.
            lang = utf8Length(text) >= LOCAL_DETECT_MIN_BYTES ? getTextLanguage(text) : "";
            if (lang === "und") lang = "";
            rememberLanguage(text, lang);
        }
        if (isNoTranslateLanguage(lang, set)) {
            excluded.push(item);
            continue;
        }
        keep.push(item);
        if (!lang) undetermined.push(item);
    }
    return { excluded, keep, undetermined };
}

/**
 * Pass 2, for one already-translated item: record what the provider said about
 * it and answer whether its result must be discarded.
 *
 * Returns false for an empty/unknown language, so a provider that declines to
 * answer behaves exactly like one that was never asked.
 */
export function rejectByDetectedLanguage(
    text: string,
    lang: string | undefined,
    set: Set<string>,
): boolean {
    if (!lang) return false;
    rememberLanguage(text.trim(), lang);
    return isNoTranslateLanguage(lang, set);
}
