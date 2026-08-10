// ---------------------------------------------------------------------------
// `<bN>` placeholder helpers + language-code mapping for the built-in AI
// provider. Pure functions, no browser API — unit-tested in
// main/__tests__/builtinAiPlaceholders.test.ts.
//
// Why this exists: the translation pipeline hands providers
// `pre.mappedHtmlText` (main/translateClient.ts `getElementPreProcessResult`),
// where every inline child of a paragraph has been replaced by a synthetic
// `<b0>…<b1>` tag so the translator cannot mangle real markup:
//
//     Hello <b0>world</b0>, see <b1>this link</b1>.
//
// Microsoft and DeepL parse HTML natively and hand the tags back intact. The
// on-device model does not: it is a plain-text translation model, so the tags
// are just tokens it may drop, merge or renumber. Losing them silently is the
// bad outcome — the write-back would then scatter text into the wrong inline
// elements, or leave a literal "<b0>" visible in the page. So the caller
// verifies the round-trip and degrades deliberately instead.
// ---------------------------------------------------------------------------

/** Matches an opening or closing synthetic placeholder tag: `<b12>`, `</b12>`. */
const PLACEHOLDER_RE = /<\/?b\d+>/g;

/**
 * Order-insensitive fingerprint of the placeholders in `text`.
 *
 * Sorted rather than sequential on purpose: a translation legitimately reorders
 * clauses ("the red <b0>car</b0>" → "<b0>車</b0>は赤い"), which moves the tags
 * around without losing any. What must not change is the *multiset* — every tag
 * still present exactly once — because that is what the write-back walks.
 */
export function placeholderSignature(text: string): string {
    const tags = text.match(PLACEHOLDER_RE);
    if (!tags) return "";
    return tags.slice().sort().join("");
}

/** True when `output` still carries exactly the placeholders `input` had. */
export function placeholdersPreserved(input: string, output: string): boolean {
    return placeholderSignature(input) === placeholderSignature(output);
}

/** True when `text` contains at least one placeholder worth verifying. */
export function hasPlaceholders(text: string): boolean {
    PLACEHOLDER_RE.lastIndex = 0;
    return PLACEHOLDER_RE.test(text);
}

/**
 * Drop every placeholder, leaving the readable text. Used both to build the
 * plain-text retry and to clean a language-detection sample (the tags are
 * ASCII noise that would skew a short sample toward English).
 */
export function stripPlaceholders(text: string): string {
    return text.replace(PLACEHOLDER_RE, "");
}

// ---------------------------------------------------------------------------
// Language codes
// ---------------------------------------------------------------------------

/**
 * Config stores Chinese as `zh-CN` / `zh-TW`; the built-in model wants the
 * BCP-47 *script* subtags. Verified against the live API: `Translator
 * .availability({sourceLanguage:'en', targetLanguage:'zh-Hans'})` answers
 * normally, while `zh-CN` is a region tag the model does not enumerate.
 *
 * The inverse direction (model code → config code) is the existing
 * `transferLanguageCode` in main/translateService.ts — don't add a second one.
 */
export function toModelLang(lang: string): string {
    if (lang === "zh-CN") return "zh-Hans";
    if (lang === "zh-TW") return "zh-Hant";
    return lang;
}

/**
 * Collapse the Chinese tags the three sources disagree on into one of two
 * script forms. Config says `zh-CN`/`zh-TW`, the detector answers `zh`/`zh-Hant`,
 * and the translator wants `zh-Hans`/`zh-Hant`.
 */
function normalizeLang(lang: string): string {
    const l = lang.toLowerCase();
    if (l === "zh" || l === "zh-cn" || l === "zh-hans" || l === "zh-sg") return "zh-hans";
    if (l === "zh-tw" || l === "zh-hk" || l === "zh-mo" || l === "zh-hant") return "zh-hant";
    return l;
}

/**
 * Compare two language tags for "is this batch already in the target language"
 * purposes. Region subtags are noise here (`en` vs `en-US`), but **Chinese
 * scripts are not**: Simplified → Traditional is a real translation the user
 * asked for, so `zh-Hans` and `zh-Hant` must never compare equal — which a
 * naive "compare the part before the dash" check would get exactly backwards.
 */
export function sameLanguage(a: string, b: string): boolean {
    if (!a || !b) return false;
    const na = normalizeLang(a);
    const nb = normalizeLang(b);
    if (na === nb) return true;
    // Past this point a difference in the base tag is decisive, and any pair
    // involving Chinese has already been fully normalized above — so two
    // different zh-* forms are genuinely different targets.
    if (na.startsWith("zh-") || nb.startsWith("zh-")) return false;
    return na.split("-")[0] === nb.split("-")[0];
}
