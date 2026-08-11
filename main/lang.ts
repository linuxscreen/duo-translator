// Language detection, extracted from main/content.ts. Local detection runs
// through franc (getTextLanguage); detectLanguage samples a page's paragraphs
// and falls back to the Microsoft detect API when the local guess is unknown.
// The sample only counts text the reader can see (main/dom/visibility.ts) —
// scoring is byte-weighted, so one offscreen SEO block would otherwise decide
// the page language on its own.
import { franc } from "franc";
import { isTraditionalChinese } from "@/utils/language";
import { iso6393To1Map, excludedTagSet, TRANSLATE_SERVICE } from "@/main/constants";
import { shuffle } from "@/utils/arrays";
import { detectTextsLanguage } from "@/main/translateClient";
import { allParagraphs } from "@/main/dom/paragraphMarks";
import { utf8Length } from "@/utils/text";
import { isVisibleForDetect } from "@/main/dom/visibility";
import type { UnitContainer } from "@/main/dom/segments";
import { isShadowRoot } from "@/main/dom/shadowTraversal";
import { isInOwnUi } from "@/main/dom/shadowRoots";

/** Stop growing a sample once it carries this many UTF-8 bytes. */
const SAMPLE_BUDGET_BYTES = 2000;
/** Below this, an element's text is too short to vote on its own. */
const MIN_SAMPLE_BYTES = 30;
/** Below this much sampled text, local franc is not trusted — ask the provider. */
const MIN_LOCAL_DETECT_BYTES = 500;
/**
 * Give up looking for visible text after this many text-bearing elements. Only
 * reached by a page whose sampled paragraphs are hidden all the way down; the
 * shuffle makes that a representative verdict long before the limit.
 */
const HIDDEN_SCAN_LIMIT = 200;

interface Sample {
    text: string;
    len: number;
}

/**
 * One side of the sample (visible text, or the hidden fail-open pool).
 *
 * Two lists are filled in a single pass because detection needs two different
 * views of the same elements: `long` (only elements that carry enough text to
 * vote) drives the local franc pass, and `any` (every non-empty element) is what
 * gets shipped to the provider when there was not enough text for franc.
 */
class SampleBucket {
    long: Sample[] = [];
    longLen = 0;
    any: Sample[] = [];
    anyLen = 0;

    add(text: string, len: number) {
        if (this.anyLen < SAMPLE_BUDGET_BYTES) {
            this.any.push({ text, len });
            this.anyLen += len;
        }
        if (len > MIN_SAMPLE_BYTES && this.longLen < SAMPLE_BUDGET_BYTES) {
            this.long.push({ text, len });
            this.longLen += len;
        }
    }

    /** `any` is a superset of `long`, so this is reached exactly when `long` fills up. */
    get full(): boolean {
        return this.longLen >= SAMPLE_BUDGET_BYTES && this.anyLen >= SAMPLE_BUDGET_BYTES;
    }
}

/**
 * Detect the language of a text snippet locally via franc, returning an
 * ISO-639-1 code (or "und" when unknown). Mandarin ("cmn") is further resolved
 * to zh-TW / zh-CN by script.
 */
export function getTextLanguage(text: string): string {
    let lang = franc(text, { minLength: 5 });
    if (lang == "cmn") {
        lang = isTraditionalChinese(text) ? "zh-TW" : "zh-CN";
    } else {
        lang = iso6393To1Map.get(lang) || "und";
    }
    return lang;
}

/**
 * Concatenate the rendered text of an element, skipping excluded tags
 * (script/style/svg/…). Text nodes are trimmed and joined directly.
 */
export function getElementTextContent(element: UnitContainer): string {
    let text = "";
    function traverse(node: Node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent?.trim() || "";
        } else if (node.nodeType === Node.ELEMENT_NODE || isShadowRoot(node)) {
            if (excludedTagSet.has(node.nodeName.toLowerCase())) {
                return;
            }
            // Our own UI lives in shadow roots and is written in the *interface*
            // language, so sampling it would actively corrupt the page-language
            // vote. Nothing else stops it: our hosts are plain <div>s.
            if (isInOwnUi(node)) {
                return;
            }
            for (const child of node.childNodes) {
                traverse(child);
            }
        }
    }
    traverse(element);
    return text;
}

/**
 * Detect the dominant language of a set of paragraph elements.
 */
export async function detectLanguage(elements?: UnitContainer[]): Promise<string> {
    let lang = "und";
    const pool: UnitContainer[] = elements === undefined ? allParagraphs() : elements;

    // Randomly sample elements
    const candidates = shuffle(pool);

    // Text the reader can actually see votes; text that is hidden (SEO blocks
    // parked offscreen, .sr-only copies, collapsed panels) only goes into a
    // fail-open pool that is used when NOTHING visible could be sampled — see
    // main/dom/visibility.ts. Those elements stay marked and translatable; this
    // is a detection-only filter.
    const visible = new SampleBucket()
    const hidden = new SampleBucket()
    let probed = 0
    for (let index = 0; index < candidates.length; index++) {
        const element = candidates[index];
        let content = getElementTextContent(element);
        let len = utf8Length(content)
        if (len === 0) continue
        // The visibility probe reads layout, so it sits behind the text check:
        // only elements that can actually enter the sample pay for it.
        const bucket = isVisibleForDetect(element) ? visible : hidden
        bucket.add(content, len)
        probed++
        if (visible.full) break
        // Bound the scan on a page that is hidden all the way down. It counts
        // probes, NOT bytes: one oversized hidden block landing first in the
        // shuffle must never end the search for visible text.
        if (visible.any.length === 0 && probed >= HIDDEN_SCAN_LIMIT) break
    }
    // Fail open on the whole page: a frame that was never laid out reports every
    // element as boxless, and returning "und" there would be worse than voting
    // with hidden text.
    const sample = visible.any.length > 0 ? visible : hidden

    let conditionElements = sample.long
    let totalLen = sample.longLen
    let langScoreMap: Map<string, number> = new Map()
    let maxLangScore = 0
    let maxLang = "und"
    if (totalLen >= MIN_LOCAL_DETECT_BYTES) {
        conditionElements.forEach(element => {
            let lang = getTextLanguage(element.text)
            let score = (langScoreMap.get(lang) || 0) + element.len
            langScoreMap.set(lang, score)
            if (score > maxLangScore) {
                maxLangScore = score
                maxLang = lang
            }
        })
        if (maxLang != "und" && maxLangScore / totalLen >= 0.6) {
            console.log("detect language by franc: %s, divide: %f", maxLang, maxLangScore / totalLen);
            return maxLang
        }
    }

    // Not enough long-form text for a trustworthy local guess (or franc had no
    // clear winner): hand the sample to the provider. Below the local threshold
    // the short elements are worth sending too, hence the second list.
    const needsDetectTexts = (totalLen >= MIN_LOCAL_DETECT_BYTES ? conditionElements : sample.any)
        .map((item) => item.text);

    if (needsDetectTexts.length === 0) {
        return "und"
    }

    // Fallback: ask the Microsoft translate service to detect the language.
    try {
        lang = (await detectTextsLanguage(needsDetectTexts)) || "und";
        console.log("detect language by microsoft translate: %s", lang);
        return lang;
    } catch {
        return "und";
    }
}
