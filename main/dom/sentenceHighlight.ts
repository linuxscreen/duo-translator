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
// Why this is preferred over wrapping each sentence in a <duo-span>, which is
// still the fallback in main/dom/sentence.ts:
//   - wrapping splits and empties the page's own text nodes, so a re-scan sees
//     our own output and can re-translate it, and every restore needs an
//     original-text backup to replay;
//   - a <duo-span> is a real inline box, so a bordered highlight style shifts the
//     surrounding text on hover.
// A highlight pseudo-element never enters the box tree — it is painted as an
// overlay over already-positioned glyphs — so neither applies. The price is that
// only paint-only properties are honored: background-color / color /
// text-decoration / text-shadow work, `border` and anything else that would
// affect layout does not. See buildTranslationCss in main/css.ts.
//
// The API is recent (Firefox only shipped it in 140 / June 2025), hence
// supportsHighlightApi() and the wrapper fallback behind it — content.ts picks
// one strategy per frame and never mixes them.
import { isPointOverRects } from "@/main/dom/unitHit";

/** Highlight registry names; the CSS side selects them via ::highlight(). */
export const HIGHLIGHT_ORIGINAL = "duo-hl-original";
export const HIGHLIGHT_TRANSLATION = "duo-hl-translation";

/**
 * The document's highlight registry, or null where the API is unavailable
 * (older browsers) — in which case content.ts binds the <duo-span> fallback
 * instead, and every function here is inert.
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

/**
 * The two highlights are created ONCE and mutated in place from then on; the
 * registry is only ever written at creation. Every transition — paint, switch
 * sentence, clear — is therefore a change to a registered `Highlight`'s own
 * range set, never a registry swap.
 *
 * That is not a style preference, it is the only shape WebKit repaints.
 * Measured on the real engine with the highlight visibly stuck on screen:
 *
 *   registry.delete(name)                  → pixels stay
 *   registry.set(name, new Highlight())    → pixels stay
 *   registeredHighlight.clear()            → repaints
 *
 * (The stuck state also reports an EMPTY registry from the console, which is
 * what proves our side had already cleared and only the paint survived — and
 * why deactivating the window, i.e. forcing a full repaint, appeared to "fix"
 * it.) So the invalidation hook is on the Highlight object's setlike mutations,
 * not on the registry map. Swapping in a fresh object per paint — which is what
 * this used to do — never invalidates the area the PREVIOUS range covered, so
 * it left stale pixels behind on switch as well as on clear.
 *
 * Rejected alternatives, all of which also un-paint but cost more:
 *   - `CSS.highlights.clear()`: the registry is document-global and we are a
 *     guest in someone else's page — it would wipe highlights the page itself
 *     registered (search, editors).
 *   - keep the ranges, mute `::highlight()` via a class on <html>: mutates the
 *     page's root element and keeps live Ranges pinning page nodes.
 *   - force a repaint by toggling inline `opacity` on the paragraph: writes to
 *     the page's own inline styles, which this codebase avoids on purpose (see
 *     the in-memory paragraph marks), and briefly creates a stacking context.
 *
 * Doing it this way also needs no browser gate: mutating a registered
 * highlight's ranges is the spec'd repaint trigger and works everywhere.
 */
let originalHighlight: Highlight | null = null;
let translationHighlight: Highlight | null = null;

/** Register the pair on first use; null where the API is unavailable. */
function ensureHighlights(): { original: Highlight; translation: Highlight } | null {
    const highlights = registry();
    if (!highlights) return null;
    if (!originalHighlight || !translationHighlight) {
        originalHighlight = new Highlight();
        translationHighlight = new Highlight();
        highlights.set(HIGHLIGHT_ORIGINAL, originalHighlight);
        highlights.set(HIGHLIGHT_TRANSLATION, translationHighlight);
    }
    return { original: originalHighlight, translation: translationHighlight };
}

/** Replace a highlight's contents in place — the repainting mutation. */
function setRange(highlight: Highlight, range: Range | null): void {
    highlight.clear();
    if (range) highlight.add(range);
}

export function showSentenceHighlight(
    owner: object,
    original: Range | null,
    translation: Range | null,
): void {
    const pair = ensureHighlights();
    if (!pair) return;
    activeOwner = owner;
    setRange(pair.original, original);
    setRange(pair.translation, translation);
}

/** Clear the paint, but only if `owner` is the paragraph that set it. */
export function clearSentenceHighlight(owner: object): void {
    if (activeOwner !== owner) return;
    activeOwner = null;
    const pair = ensureHighlights();
    if (!pair) return;
    pair.original.clear();
    pair.translation.clear();
}
