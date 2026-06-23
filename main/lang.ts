// Language detection, extracted from main/content.ts. Local detection runs
// through franc (getTextLanguage); detectLanguage samples a page's paragraphs
// and falls back to the Microsoft detect API when the local guess is unknown.
import { franc } from "franc";
import { isTraditionalChinese } from "@/utils/language";
import { iso6393To1Map, excludedTagSet, TRANSLATE_SERVICE } from "@/main/constants";
import { shuffle } from "@/utils/arrays";
import { translationServices } from "@/main/translateService";

const utf8Encoder = new TextEncoder();

/**
 * Detect the language of a text snippet locally via franc, returning an
 * ISO-639-1 code (or "und" when unknown). Mandarin ("cmn") is further resolved
 * to zh-TW / zh-CN by script.
 */
export function getTextLanguage(text: string): string {
    let lang = franc(text, { minLength: 10 });
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
 * Detect the dominant language of a set of paragraph elements. Samples up to
 * ~2000 UTF-8 bytes (from a shuffled order so one section can't dominate),
 * tries franc locally when there's enough text (>500 bytes), and otherwise
 * falls back to the Microsoft detect API. Returns "und" when undeterminable.
 */
export async function detectLanguage(elements: HTMLElement[]): Promise<string> {
    let text = "";
    // Randomly sample elements, capping at ~2000 UTF-8 bytes.
    elements = shuffle(elements);
    let utf8Length = 0;
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        const content = getElementTextContent(element) + "\n";
        text += content;
        utf8Length += utf8Encoder.encode(content).length;
        if (utf8Length > 2000) {
            break;
        }
    }

    let lang = "und";
    if (utf8Length > 500) {
        lang = getTextLanguage(text);
        console.log("detect language by franc: %s, text length: %d", lang, utf8Length);
    }

    if (lang != "und") {
        return lang;
    }
    // Empty / near-empty frame (common for ad & tracking iframes): skip the
    // Microsoft detect round-trip — there's nothing to translate anyway, and
    // firing a network call per junk iframe would be wasteful.
    if (utf8Length === 0) {
        return "und";
    }
    // Fallback: ask the Microsoft translate service to detect the language.
    try {
        lang = (await translationServices.get(TRANSLATE_SERVICE.MICROSOFT)?.detectLanguage?.([text])) || "und";
        console.log("detect language by microsoft translate: %s", lang);
        return lang;
    } catch {
        return "und";
    }
}
