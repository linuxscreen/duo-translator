// Sentence segmentation + text-node→<duo-span> wrapping, extracted from
// main/content.ts. These back the bilingual sentence-level highlighting: each
// sentence's text nodes are wrapped in a <duo-span duo-sequence="i"> so hovering
// one side can highlight the matching sentence on the other.
import { split } from "sentence-splitter";

/**
 * Split text into sentence strings. Whitespace between sentences is attached to
 * the following sentence (it accumulates into the next emitted chunk).
 */
export function splitSentence(text: string | null): string[] {
    if (!text) {
        return [];
    }
    const results = split(text);
    const sentences: string[] = [];
    let sentence = "";
    results.forEach((result) => {
        sentence += result.raw;
        if (result.type == "Sentence") {
            sentences.push(sentence);
            sentence = "";
        }
    });
    return sentences;
}

/**
 * Wrap the given text nodes into <duo-span> elements, one run per sentence,
 * tagging each with `duo-sequence="<sentence index>"`. Text nodes are consumed
 * greedily; when a sentence ends mid-node the node is split. Every span created
 * is registered in `ignoreMutationElements` so the content script's mutation
 * observer ignores our own DOM writes. Returns the spans in creation order.
 */
export function wrapTextNode2Span(
    textNodes: Text[],
    sentences: string[],
    ignoreMutationElements: WeakSet<object>,
): HTMLElement[] {
    let j = 0;
    const spans: HTMLElement[] = [];
    for (let i = 0; i < sentences.length; i++) {
        let sentence = sentences[i];
        while (j < textNodes.length) {
            const text = textNodes[j].textContent;
            if (!text) {
                continue;
            }
            if (sentence.length >= text.length) {
                if (sentence.startsWith(text)) {
                    const span = document.createElement("duo-span");
                    span.setAttribute("duo-sequence", i.toString());
                    textNodes[j]?.parentElement?.insertBefore(span, textNodes[j]);
                    span.appendChild(textNodes[j]);
                    spans.push(span);
                    sentence = sentence.slice(text.length);
                    j++;
                    ignoreMutationElements.add(span);
                } else {
                    break;
                }
            } else {
                if (text.startsWith(sentence)) {
                    textNodes[j].textContent = text.slice(sentence.length);
                    const span = document.createElement("duo-span");
                    span.setAttribute("duo-sequence", i.toString());
                    span.textContent = sentence;
                    textNodes[j].parentElement?.insertBefore(span, textNodes[j]);
                    spans.push(span);
                    ignoreMutationElements.add(span);
                }
                break;
            }
        }
    }
    return spans;
}
