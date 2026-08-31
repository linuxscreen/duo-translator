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

function nonBlankIndices(sentences: string[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < sentences.length; i++) {
        if (sentences[i].trim() !== "") out.push(i);
    }
    return out;
}

/** Proportion-of-total-text interval of each indexed sentence, in [0, 1]. */
function proportionIntervals(list: string[], idx: number[]): { start: number; end: number }[] {
    const offs: number[] = new Array(list.length + 1);
    offs[0] = 0;
    for (let i = 0; i < list.length; i++) offs[i + 1] = offs[i] + list[i].length;
    const total = offs[list.length] || 1;
    return idx.map(i => ({ start: offs[i] / total, end: (offs[i] + list[i].length) / total }));
}

export interface AlignedSentenceBlocks {
    original: string[];
    translated: string[];
}

/**
 * Re-segment two sentence lists whose non-blank counts DIFFER into aligned
 * blocks with equal counts on both sides, so the hover pairing — which pairs
 * by index — still has something to pair.
 *
 * Machine translators keep sentence structure, so both sides usually match and
 * the inputs are returned untouched. An AI provider freely merges two short
 * sentences into one or splits a long one in two, and one mismatched count
 * used to cost the whole unit its highlighting (the old gate was strict
 * equality). Blocks are anchored on the side with FEWER sentences: every
 * sentence of the longer side joins the anchor its character span overlaps
 * the most (monotonically, so blocks stay consecutive), and each block is the
 * contiguous array span from the previous block's end — interior blanks
 * travel inside the block that absorbed them.
 *
 * Both returned arrays are therefore lossless partitions of their input's
 * concatenated text (join(blocks) === join(sentences)), which is the invariant
 * buildSentenceRanges' offset walk and wrapTextNode2Span's node consumption
 * both rely on. Returns null when either side has no non-blank sentence.
 */
export function alignSentenceBlocks(original: string[], translated: string[]): AlignedSentenceBlocks | null {
    const oIdx = nonBlankIndices(original);
    const tIdx = nonBlankIndices(translated);
    if (oIdx.length === 0 || tIdx.length === 0) return null;
    if (oIdx.length === tIdx.length) return { original, translated };

    const flip = oIdx.length > tIdx.length;
    const anchorList = flip ? translated : original;
    const anchorIdx = flip ? tIdx : oIdx;
    const otherList = flip ? original : translated;
    const otherIdx = flip ? oIdx : tIdx;

    const anchorIv = proportionIntervals(anchorList, anchorIdx);
    const otherIv = proportionIntervals(otherList, otherIdx);

    // Longest-overlap assignment with a monotonicity floor: sentence b may
    // only join anchor >= the anchor of sentence b-1, so each anchor's member
    // set is a consecutive run and the blocks tile both arrays without
    // overlapping. Paragraphs carry a handful of sentences, so a plain scan
    // per sentence is clearer than any clever two-pointer.
    const assignedTo: number[][] = Array.from({ length: anchorIdx.length }, () => [] as number[]);
    let minAnchor = 0;
    for (let b = 0; b < otherIdx.length; b++) {
        let best = minAnchor;
        let bestOverlap = -1;
        for (let i = minAnchor; i < anchorIv.length; i++) {
            const overlap =
                Math.min(otherIv[b].end, anchorIv[i].end) - Math.max(otherIv[b].start, anchorIv[i].start);
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                best = i;
            }
        }
        assignedTo[best].push(otherIdx[b]);
        minAnchor = best;
    }

    // Block spans. `pending*` holds where the previous block ended + 1: an
    // anchor nobody landed on folds into the NEXT block (its span starts
    // earlier instead), and the leading blanks before the first member ride
    // along inside the first block — a dropped or unaligned segment would
    // shift the offset walk downstream.
    type Span = { aStart: number; aEnd: number; bStart: number; bEnd: number };
    const spans: Span[] = [];
    let pendingAStart = 0;
    let pendingBStart = 0;
    for (let i = 0; i < anchorIdx.length; i++) {
        const members = assignedTo[i];
        if (members.length === 0) continue;
        spans.push({
            aStart: pendingAStart,
            aEnd: anchorIdx[i],
            bStart: pendingBStart,
            bEnd: members[members.length - 1],
        });
        pendingAStart = anchorIdx[i] + 1;
        pendingBStart = members[members.length - 1] + 1;
    }
    if (spans.length === 0) return null;
    // Whatever is left (trailing blanks, tail anchors nobody reached) joins
    // the last block so the partition covers both arrays completely.
    const last = spans[spans.length - 1];
    last.aEnd = anchorList.length - 1;
    last.bEnd = otherList.length - 1;

    const joinSpan = (list: string[], s: number, e: number) => list.slice(s, e + 1).join("");
    const anchorBlocks = spans.map(sp => joinSpan(anchorList, sp.aStart, sp.aEnd));
    const otherBlocks = spans.map(sp => joinSpan(otherList, sp.bStart, sp.bEnd));
    return flip
        ? { original: otherBlocks, translated: anchorBlocks }
        : { original: anchorBlocks, translated: otherBlocks };
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
                // Advance past the empty node — a bare `continue` kept j
                // pinned and spun forever if an empty text node ever reached
                // this loop.
                j++;
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
                        // parentNode, not parentElement: a text node sitting
                        // directly under a ShadowRoot has no parent *element*,
                        // and the insert would be silently skipped — the
                        // sentence would lose its span and the highlight pairing
                        // would go out of step with the other side.
                        textNodes[j]?.parentNode?.insertBefore(span, textNodes[j]);
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
                    textNodes[j].parentNode?.insertBefore(span, textNodes[j]);
                    spans.push(span);
                }
                break;
            }
        }
    }
    return spans;
}
