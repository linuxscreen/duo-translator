// Language detection, extracted from main/content.ts. Local detection runs
// through franc (getTextLanguage); detectLanguage samples a page's paragraphs
// and falls back to the Microsoft detect API when the local guess is unknown.
import { franc } from "franc";
import { isTraditionalChinese } from "@/utils/language";
import { iso6393To1Map, excludedTagSet, TRANSLATE_SERVICE } from "@/main/constants";
import { shuffle } from "@/utils/arrays";
import { detectTextsLanguage } from "@/main/translateClient";
import { allParagraphs } from "@/main/dom/paragraphMarks";

const utf8Encoder = new TextEncoder();

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
export function getElementTextContent(element: HTMLElement): string {
    let text = "";
    function traverse(node: Node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent?.trim() || "";
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (excludedTagSet.has(node.nodeName.toLowerCase())) {
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
export async function detectLanguage(elements?: HTMLElement[]): Promise<string> {
    let lang = "und";
    if (elements === undefined) {
        elements = allParagraphs();
    }

    // Randomly sample elements
    elements = shuffle(elements);
    let conditionElements: { text: string, len: number }[] = []
    let totalLen = 0
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        let content = getElementTextContent(element);
        let len = utf8Encoder.encode(content).length
        if (len <= 30) continue
        // console.log("detectLanguage ", content)
        conditionElements.push({ text: content, len })
        totalLen += len
        if (totalLen >= 2000) break
    }
    let langScoreMap: Map<string, number> = new Map()
    let maxLangScore = 0
    let maxLang = "und"
    if (totalLen >= 500) {
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

    let needsDetectTexts: string[] = [];
    if (totalLen >= 500) {
        needsDetectTexts = conditionElements.map((item) => item.text)
    } else {
        let utf8Length = 0;
        for (let index = 0; index < elements.length; index++) {
            const element = elements[index];
            let t = getElementTextContent(element)
            if (t.length === 0) continue
            needsDetectTexts.push(t)
            utf8Length += utf8Encoder.encode(t).length;
            if (utf8Length >= 2000) {
                break;
            }
        }
    }

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
