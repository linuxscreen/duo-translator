/**
 * Where a selection VISIBLY ends — the spot the selection pill anchors to.
 *
 * The obvious answer, "the caret at the selection's focus", is wrong in three
 * shapes that all look the same to the user (the pill sits hundreds of px away
 * from the highlight, pointing at nothing):
 *
 * 1. The drag ended over something that contributes no selected text. A button
 *    with `user-select: none` is the common one — the engine refuses to
 *    highlight it and leaves it out of `Selection.toString()`, but the focus
 *    boundary lands inside it all the same, so the caret is measured at the far
 *    side of a flex row. (Observed on Reddit's account-locked banner: the
 *    highlight ends mid-line, the pill lands 1067 px right, under "Reset
 *    Password".)
 * 2. The focus is an ELEMENT boundary (triple click, Ctrl+A, a release in a
 *    container's padding). A collapsed range there has no client rects at all,
 *    so the fallback took the range's last rect IN DOCUMENT ORDER — whatever box
 *    happens to come last, including a right-floated badge, an absolutely
 *    positioned tag, or an off-screen `.sr-only` copy at `left: -9999px` (that
 *    one pinned the pill to the opposite edge of the screen).
 * 3. The selection stops exactly at a soft-wrap boundary. A plain Range has no
 *    affinity, so the caret is reported at the START OF THE NEXT LINE while the
 *    highlight visibly ends at the right edge of the line above.
 *
 * So the anchor is derived from the text the reader can actually see marked:
 * walk in from the focus side and return the first character that is selectable,
 * rendered and in flow. The walk starts at that boundary and stops at its first
 * hit, so an ordinary selection costs one text node and a few characters.
 *
 * Measurement is an ENHANCEMENT: every failure returns null and leaves the
 * caller on its existing caret/last-rect/bounding chain — which is also what
 * happens under jsdom, where there is no layout and every rect is 0x0.
 */

import { isParkedOffDocument } from "@/main/dom/visibility";

/**
 * Walk limits. A selection whose focus side is buried under hundreds of
 * unselectable nodes is pathological; falling back beats scanning the page.
 */
const MAX_NODES = 200;
const MAX_CHARS = 2000;
/** Ancestor climb per candidate, guarding a detached or cyclic tree. */
const MAX_CLIMB = 32;

/**
 * Is this text node's content part of what the reader sees highlighted?
 *
 * Two independent reasons it would not be, both scoped by `stopAt` (the
 * selection's common ancestor) so a selection made ENTIRELY inside such a box
 * still measures itself:
 *
 * - `user-select: none` — the engine neither paints the selection over it nor
 *   reports its text, yet the focus boundary can still land inside it.
 * - Floated — a label pushed to the block's edge is page furniture, not where
 *   the sentence ends; dragging one word too far lands the pointer in it, and
 *   it is never what the reader was selecting.
 *
 * `position: absolute|fixed` is deliberately NOT in that list, though it is the
 * other half of "out of flow". Such a box really is selected and really does
 * hold text the reader can see marked, so pointing the pill at it is at worst
 * surprising, never wrong — and the rule would have to guess which absolutely
 * positioned boxes are decoration. See .dev/selection-icon-repro.html §B2, a
 * deliberate no-fix.
 *
 * Exported for its own unit tests: jsdom can answer this one (it has a cascade
 * for inline styles) while it can never answer the geometry around it.
 */
export function isVisiblySelectedText(node: Text, stopAt: Node): boolean {
    const start = node.parentElement;
    if (!start) return false;
    const stop = stopAt.nodeType === Node.TEXT_NODE ? stopAt.parentElement : stopAt;
    let el: Element | null = start;
    for (let i = 0; el && i < MAX_CLIMB; i++, el = el.parentElement) {
        const style = getComputedStyle(el);
        // `user-select` is inherited, so the first read already answers for the
        // whole chain — but an element may re-declare it below a `none`
        // ancestor, and the climb happens anyway for the float test.
        if (userSelectOf(style) === "none") return false;
        // The box the whole selection lives in is not an "island" within it.
        if (el === stop) break;
        const float = style.cssFloat || style.float;
        if (float && float !== "none") return false;
    }
    return true;
}

/**
 * Can a Range be measured at all? jsdom implements no CSSOM View on Range, so
 * without this probe every unit test would walk the whole selection throwing
 * once per character. Cached: the answer is a property of the engine.
 */
let measurable: boolean | null = null;
function rangeMeasurable(): boolean {
    if (measurable === null) {
        try {
            measurable = typeof document.createRange().getBoundingClientRect === "function";
        } catch {
            measurable = false;
        }
    }
    return measurable;
}

function userSelectOf(style: CSSStyleDeclaration): string {
    const prefixed = (style as unknown as { webkitUserSelect?: string }).webkitUserSelect;
    return style.userSelect || prefixed || "";
}

/**
 * Zero-width rect at the visible edge of `range` on the side the drag ended.
 *
 * `backward` is the drag direction: the edge wanted is the range's END for a
 * forward drag and its START for a backward one — the moving end either way,
 * which is the property the caret path existed to provide and this keeps.
 */
export function visibleSelectionEdge(range: Range, backward: boolean): DOMRect | null {
    if (!rangeMeasurable()) return null;
    const root = range.commonAncestorContainer;
    const walkerRoot = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
    if (!walkerRoot) return null;
    const atEnd = !backward;

    let walker: TreeWalker;
    try {
        walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT);
        walker.currentNode = boundaryNode(range, atEnd);
    } catch {
        return null;
    }

    const { scrollX, scrollY } = window;
    const budget = { left: MAX_CHARS };
    let node: Node | null = walker.currentNode;
    for (let seen = 0; node && seen < MAX_NODES; seen++) {
        // The walk moves monotonically towards the far boundary, so the first
        // node outside the range means the range is exhausted.
        if (!intersects(range, node)) break;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node as Text;
            const from = text === range.startContainer ? range.startOffset : 0;
            const to = text === range.endContainer ? range.endOffset : text.data.length;
            if (to > from && isVisiblySelectedText(text, root)) {
                const edge = edgeCharRect(text, from, to, atEnd, budget, scrollX, scrollY);
                if (edge) return edge;
                if (budget.left <= 0) return null;
            }
        }
        // The filter is SHOW_TEXT, so every further step is a text node.
        node = atEnd ? walker.previousNode() : walker.nextNode();
    }
    return null;
}

/** `intersectsNode` throws on a detached node in some engines. */
function intersects(range: Range, node: Node): boolean {
    try {
        return range.intersectsNode(node);
    } catch {
        return true;
    }
}

/** Deepest node at one of the range's boundaries, as a place to start walking. */
function boundaryNode(range: Range, atEnd: boolean): Node {
    const container = atEnd ? range.endContainer : range.startContainer;
    const offset = atEnd ? range.endOffset : range.startOffset;
    if (container.nodeType === Node.TEXT_NODE) return container;
    const kids = container.childNodes;
    if (!atEnd) return kids[offset] ?? container;
    const prev = offset > 0 ? kids[offset - 1] : null;
    if (!prev) return container;
    let last: Node = prev;
    for (let i = 0; last.lastChild && i < MAX_CLIMB; i++) last = last.lastChild;
    return last;
}

/**
 * Rect of the outermost rendered, non-blank character in `[from, to)`.
 *
 * Blank characters are skipped because a trailing space is where the drag ended
 * but not where the highlight visibly stops; rects that are empty
 * (`display: none`) or parked off the document (`.sr-only`) are skipped for the
 * same reason the pill must not point at them.
 */
function edgeCharRect(
    text: Text,
    from: number,
    to: number,
    atEnd: boolean,
    budget: { left: number },
    scrollX: number,
    scrollY: number,
): DOMRect | null {
    const probe = document.createRange();
    for (let n = 0; n < to - from && budget.left > 0; n++) {
        budget.left--;
        const i = atEnd ? to - 1 - n : from + n;
        if (/\s/.test(text.data[i])) continue;
        let rect: DOMRect;
        try {
            probe.setStart(text, i);
            probe.setEnd(text, i + 1);
            rect = probe.getBoundingClientRect();
        } catch {
            return null;
        }
        // A rendered character always has height; zero means `display: none` or
        // an engine that cannot measure this node. Height alone also keeps the
        // caller's "no geometry" gate from mistaking the answer for empty.
        if (rect.height === 0) continue;
        if (isParkedOffDocument(rect, scrollX, scrollY)) continue;
        const x = atEnd ? rect.right : rect.left;
        return new DOMRect(x, rect.top, 0, rect.height);
    }
    return null;
}
