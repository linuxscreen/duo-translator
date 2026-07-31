// Bilingual sentence highlighting without touching the page's DOM.
//
// A sentence is addressed as a *character range* over the concatenated text of a
// translation unit, not as a wrapper element. That mapping is exact and free:
// `getTextNodesAndText*` returns `text` as the byte-for-byte concatenation of the
// `textNodes` it collected, and `splitSentence` partitions that same string
// losslessly — so a prefix sum over each side yields (sentence index) → (text
// node, offset). One live `Range` per sentence then serves both jobs: painting,
// through the CSS Custom Highlight API, and pointer hit-testing, through its
// client rects (one per line fragment, which is exactly what isPointOverRects
// wants).
//
// Why not wrap each sentence in a <duo-span>, as this used to:
//   - wrapping splits and empties the page's own text nodes, so a re-scan sees
//     our own output and can re-translate it (a real regression), and every
//     restore needs an original-text backup to replay;
//   - a <duo-span> is a real inline box, so a bordered highlight style shifts the
//     surrounding text on hover.
// A highlight pseudo-element never enters the box tree — it is painted as an
// overlay over already-positioned glyphs — so neither applies. The price is that
// only paint-only properties are honored: background-color / color /
// text-decoration / text-shadow work, `border` and anything else that would
// affect layout does not. See buildTranslationCss in main/css.ts.
import { isPointOverRects } from "@/main/dom/unitHit";

/** Highlight registry names; the CSS side selects them via ::highlight(). */
export const HIGHLIGHT_ORIGINAL = "duo-hl-original";
export const HIGHLIGHT_TRANSLATION = "duo-hl-translation";

/**
 * The document's highlight registry, or null where the API is unavailable
 * (older browsers). Callers degrade by skipping bilingual highlighting
 * altogether — there is no wrapper-based fallback any more.
 */
function registry(): HighlightRegistry | null {
    if (typeof CSS === "undefined" || typeof Highlight !== "function") return null;
    return CSS.highlights ?? null;
}

export function supportsHighlightApi(): boolean {
    return registry() !== null;
}

/**
 * One live Range per *non-blank* sentence, in order.
 *
 * `sentences` must be the segmentation of `textNodes`' concatenated text.
 * Blank segments (trailing whitespace the segmenter emits as its own chunk)
 * produce no range, so the returned array is indexed by non-blank sentence
 * order — which is the same count both callers gate on, making the two sides
 * index-aligned.
 *
 * Ranges are live: they follow the page's own DOM edits and collapse instead of
 * pointing at stale positions, which is the failure mode the caller's
 * bookkeeping already handles.
 */
export function buildSentenceRanges(textNodes: Text[], sentences: string[]): Range[] {
    if (textNodes.length === 0 || sentences.length === 0) return [];

    // nodeStarts[i] = global offset at which textNodes[i] begins.
    const nodeStarts: number[] = new Array(textNodes.length + 1);
    nodeStarts[0] = 0;
    for (let i = 0; i < textNodes.length; i++) {
        nodeStarts[i + 1] = nodeStarts[i] + textNodes[i].length;
    }
    const total = nodeStarts[textNodes.length];

    // Linear scans: a unit holds a handful of text nodes, so an index is not
    // worth the extra state. Offsets are clamped so a segmentation that does not
    // sum to `total` (defensive — Intl.Segmenter is lossless) still yields a
    // valid range rather than throwing mid-paragraph.
    const locateStart = (offset: number): [Text, number] => {
        const at = Math.max(0, Math.min(offset, total));
        for (let i = 0; i < textNodes.length; i++) {
            if (at < nodeStarts[i + 1]) return [textNodes[i], at - nodeStarts[i]];
        }
        const last = textNodes.length - 1;
        return [textNodes[last], textNodes[last].length];
    };
    // An end boundary belongs to the node holding the character *before* it, so
    // a sentence never ends at offset 0 of the next node (which would make its
    // last line fragment disappear from getClientRects).
    const locateEnd = (offset: number): [Text, number] => {
        const at = Math.max(0, Math.min(offset, total));
        for (let i = 0; i < textNodes.length; i++) {
            if (at > nodeStarts[i] && at <= nodeStarts[i + 1]) {
                return [textNodes[i], at - nodeStarts[i]];
            }
        }
        return [textNodes[0], 0];
    };

    const ranges: Range[] = [];
    let cursor = 0;
    for (const sentence of sentences) {
        const start = cursor;
        cursor += sentence.length;
        if (sentence.trim() === "") continue;
        const range = document.createRange();
        const [startNode, startOffset] = locateStart(start);
        const [endNode, endOffset] = locateEnd(cursor);
        try {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
        } catch {
            // Nodes detached between collection and here — skip this sentence
            // rather than losing the whole paragraph's highlighting.
            continue;
        }
        ranges.push(range);
    }
    return ranges;
}

/** Is the pointer over the text this range covers? */
export function isPointOverRange(x: number, y: number, range: Range): boolean {
    return isPointOverRects(x, y, Array.from(range.getClientRects()));
}

// The registry is document-global while the bindings are per paragraph, so the
// paint is tracked with its owner: a paragraph may only clear a highlight it
// still owns. Without this, leaving an outer paragraph after entering a nested
// one would wipe the nested one's highlight.
let activeOwner: object | null = null;

export function showSentenceHighlight(
    owner: object,
    original: Range | null,
    translation: Range | null,
): void {
    const highlights = registry();
    if (!highlights) return;
    activeOwner = owner;
    if (original) highlights.set(HIGHLIGHT_ORIGINAL, new Highlight(original));
    else highlights.delete(HIGHLIGHT_ORIGINAL);
    if (translation) highlights.set(HIGHLIGHT_TRANSLATION, new Highlight(translation));
    else highlights.delete(HIGHLIGHT_TRANSLATION);
}

/** Clear the paint, but only if `owner` is the paragraph that set it. */
export function clearSentenceHighlight(owner: object): void {
    if (activeOwner !== owner) return;
    const highlights = registry();
    activeOwner = null;
    if (!highlights) return;
    highlights.delete(HIGHLIGHT_ORIGINAL);
    highlights.delete(HIGHLIGHT_TRANSLATION);
}
