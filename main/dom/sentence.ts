// Sentence segmentation + the legacy text-node→<duo-span> wrapping. These back
// the bilingual sentence-level highlighting.
//
// Two painting strategies consume `splitSentence`, picked at runtime by
// `supportsHighlightApi()`:
//   - preferred: main/dom/sentenceHighlight.ts turns the chunks into one live
//     Range per sentence and paints them through the CSS Custom Highlight API,
//     writing nothing to the page;
//   - fallback: `wrapTextNode2Span` below, for browsers without that API
//     (Firefox only shipped it in 140 / June 2025). It wraps each sentence in a
//     <duo-span duo-sequence="i"> so plain class selectors can style it.
// The fallback is the one that mutates page text nodes, which is why the
// container's original text has to be backed up before it runs.

/**
 * Split text into sentence strings. Whitespace between sentences is attached to
 * the following sentence (it accumulates into the next emitted chunk).
 */
export function splitSentence(text: string | null): string[] {
    if (!text) {
        return [];
    }
    const segmenter = new Intl.Segmenter(undefined, {
        granularity: "sentence",
    })

    return Array.from(segmenter.segment(text), x => x.segment)
}

/**
 * Wrap the given text nodes into <duo-span> elements, one run per sentence,
 * tagging each with `duo-sequence="<startSequence + sentence index>"`. Text
 * nodes are consumed greedily; when a sentence ends mid-node the node is
 * split. Every span created is registered in `ignoreMutationElements` so the
 * content script's mutation observer ignores our own DOM writes. Returns the
 * spans in creation order.
 *
 * `startSequence` lets callers wrapping several translation units of the same
 * container keep duo-sequence unique across the container (accumulate by each
 * batch's sentence count) — the highlight handler pairs original/translation
 * spans by that number.
 */
export function wrapTextNode2Span(
    textNodes: Text[],
    sentences: string[],
    ignoreMutationElements: WeakSet<object>,
    startSequence = 0,
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
                    if (text.trim() !== '') {
                        const span = document.createElement("duo-span");
                        ignoreMutationElements.add(span);
                        span.setAttribute("duo-sequence", (startSequence + i).toString());
                        let spanText = document.createTextNode(text);
                        span.appendChild(spanText);
                        textNodes[j]?.parentElement?.insertBefore(span, textNodes[j]);
                        textNodes[j].textContent = "";
                        spans.push(span);
                    }
                    sentence = sentence.slice(text.length);
                    j++;
                } else {
                    break;
                }
            } else {
                if (text.startsWith(sentence)) {
                    textNodes[j].textContent = text.slice(sentence.length);
                    if (sentence.trim() === '') break
                    const span = document.createElement("duo-span");
                    ignoreMutationElements.add(span);
                    span.setAttribute("duo-sequence", (startSequence + i).toString());
                    let spanText = document.createTextNode(sentence);
                    span.appendChild(spanText);
                    textNodes[j].parentElement?.insertBefore(span, textNodes[j]);
                    spans.push(span);
                }
                break;
            }
        }
    }
    return spans;
}
