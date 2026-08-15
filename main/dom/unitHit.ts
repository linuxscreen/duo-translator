// Locating a translation unit — by DOM identity or by where the pointer is.
//
// Units are derived data recomputed from the live DOM, so they have no object
// identity to hold on to. What *is* stable is a unit's `UnitRange`: the pair of
// exclusive sibling anchors around it (see segments.ts). Everything here works
// in those terms, which is why the same helpers serve both an untranslated unit
// (identified by its node list) and an already-translated one (identified by the
// range recorded when its translation was inserted).
//
// Two ways to answer "which unit is the pointer over?", in order:
//   1. DOM identity — the hit element resolves to one of the container's direct
//      children, which belongs to exactly one unit. Exact and cheap.
//   2. Geometry — `document.elementFromPoint` returns the *container* whenever
//      the pointer is over a bare text node of it, which is precisely the
//      multi-unit case (`text<br><br>text`). Then the unit has to be found from
//      its line boxes.
import type { TranslationUnit, UnitContainer, UnitRange } from "@/main/dom/segments";
import { isTranslateIndicator } from "@/main/dom/predicates";

/**
 * The next/previous sibling the pipeline cares about, stepping over our own
 * translating indicators.
 *
 * An indicator is inserted right after the unit it belongs to, so without this
 * a unit's anchors would differ depending on whether one happened to be showing
 * — and the anchors ARE the unit's identity (they are what a DuoUnitRecord
 * stores and what revalidateUnitTarget matches on). An anchor that dissolves
 * when the spinner is removed would silently degrade every later write-back and
 * restore to whole-container behavior.
 */
export function siblingSkippingIndicators(node: ChildNode | null, dir: "next" | "prev"): ChildNode | null {
    let cur = node;
    while (cur && isTranslateIndicator(cur)) {
        cur = dir === "next" ? cur.nextSibling : cur.previousSibling;
    }
    return cur;
}

/**
 * The ancestor-or-self of `node` whose parent is `container`, i.e. the container
 * child that owns `node`. Null when `node` is the container itself or lives
 * outside it.
 */
export function directChildOf(node: Node | null, container: UnitContainer): ChildNode | null {
    let cur: Node | null = node;
    while (cur && cur !== container) {
        if (cur.parentNode === container) return cur as ChildNode;
        cur = cur.parentNode;
    }
    return null;
}

/**
 * The unit's exclusive boundary anchors. Derived from the outermost nodes still
 * attached to the container so a partially detached run still yields anchors
 * that bracket what remains of it.
 */
export function unitRangeOf(unit: TranslationUnit): UnitRange {
    const container = unit.container;
    let first: ChildNode | null = null;
    let last: ChildNode | null = null;
    for (const node of unit.nodes) {
        if (node.parentNode !== container) continue;
        if (!first) first = node;
        last = node;
    }
    return {
        start: siblingSkippingIndicators(first?.previousSibling ?? null, "prev"),
        end: siblingSkippingIndicators(last?.nextSibling ?? null, "next"),
    };
}

/**
 * Live children of `container` inside `range`. An anchor the page has since
 * detached is ignored (degrading to that container edge) — the same tolerance
 * the SINGLE write-back applies.
 */
export function nodesInRange(container: UnitContainer, range: UnitRange): ChildNode[] {
    const start = range.start?.parentNode === container ? range.start : null;
    const end = range.end?.parentNode === container ? range.end : null;
    const out: ChildNode[] = [];
    let node = start ? start.nextSibling : container.firstChild;
    while (node && node !== end) {
        // Our own indicator is never part of the unit's content: including it
        // would put its box into the pointer hit-test rects and into the
        // duo-span sweep on restore.
        if (!isTranslateIndicator(node)) out.push(node);
        node = node.nextSibling;
    }
    return out;
}

/**
 * Whether `node` still belongs to `unit` — itself, or a descendant of one of
 * the unit's nodes. Used to decide that a SINGLE-view translation still covers
 * this run after the page has inserted unrelated siblings (a click-action
 * button, a portal host, …) around it.
 *
 * A detached node never counts: the page has replaced that text, so the old
 * translation no longer applies.
 */
export function unitContainsNode(unit: TranslationUnit, node: Node): boolean {
    if (!node.isConnected) return false;
    if (unit.wholeElement) {
        return node === unit.container || unit.container.contains(node);
    }
    for (const child of unit.nodes) {
        if (child === node) return true;
        if (child.nodeType === Node.ELEMENT_NODE && (child as Element).contains(node)) {
            return true;
        }
    }
    return false;
}

/**
 * DOUBLE bookkeeping: the inserted translation is still in the tree AND the
 * unit still owns the content node we hung it off. Structural inserts that
 * sit *between* the run and `.duo-translation` make `unit.translated` flip
 * to false (the marker is no longer adjacent), but this still recognizes
 * the original run so it is not sent to the provider a second time.
 */
export function duoRecordCoversUnit(
    unit: TranslationUnit,
    record: { translation: Node; anchor: ChildNode | null },
): boolean {
    return record.translation.isConnected
        && !!record.anchor
        && record.anchor.isConnected
        && unit.nodes.includes(record.anchor);
}

/**
 * SINGLE bookkeeping: any of the result's written-back text nodes still
 * lives inside this unit. New units (a fresh run after `<br><br>`) do not
 * share those nodes and so are not covered.
 */
export function singleResultCoversUnit(
    unit: TranslationUnit,
    result: { replacedTextNodes?: Array<Node | null | undefined>; textNodes?: Array<Node | null | undefined> },
): boolean {
    const texts = result.replacedTextNodes ?? result.textNodes;
    if (!texts) return false;
    for (const text of texts) {
        if (text && unitContainsNode(unit, text)) return true;
    }
    return false;
}

/** Whether `child` (a direct child of `container`) lies inside `range`. */
export function rangeContains(
    container: UnitContainer,
    range: UnitRange,
    child: ChildNode,
): boolean {
    if (child.parentNode !== container) return false;
    if (child === range.start || child === range.end) return false;
    return nodesInRange(container, range).includes(child);
}

/**
 * Client rects of an ordered, contiguous run of sibling nodes — one per line
 * fragment, which is what the pointer test needs.
 */
export function rectsOfNodes(nodes: ChildNode[]): DOMRect[] {
    if (nodes.length === 0) return [];
    const range = document.createRange();
    try {
        range.setStartBefore(nodes[0]);
        range.setEndAfter(nodes[nodes.length - 1]);
    } catch {
        return [];
    }
    return Array.from(range.getClientRects());
}

/**
 * Is the pointer over the text these rects describe — counting the glyphs
 * themselves and the blank gaps *between* lines (line-height leading, <br>,
 * wrapped lines), but not the outer padding nor the empty space past the end of
 * a short line?
 *
 * Each rect is one line fragment. The pointer counts as "on text" when it is
 * either directly on a fragment, or in a vertical gap that has a fragment both
 * above AND below it at the same x — outer padding only ever has a fragment on
 * one side, so it is correctly rejected.
 */
export function isPointOverRects(x: number, y: number, rects: DOMRect[]): boolean {
    const sized = rects.filter((r) => r.width > 0 && r.height > 0);
    const overX = sized.filter((r) => x >= r.left && x <= r.right);
    if (overX.length === 0) return false;
    if (overX.some((r) => y >= r.top && y <= r.bottom)) return true;
    const hasAbove = overX.some((r) => r.bottom <= y);
    const hasBelow = overX.some((r) => r.top >= y);
    return hasAbove && hasBelow;
}

/** Is the pointer over the text of this run of sibling nodes? */
export function isPointOverNodes(x: number, y: number, nodes: ChildNode[]): boolean {
    return isPointOverRects(x, y, rectsOfNodes(nodes));
}

/**
 * Resolve which candidate the pointer is over. `candidates` are the container's
 * units/translated records, each reduced to the nodes it spans; the first match
 * wins, so pass them in document order.
 *
 * `hit` is what elementFromPoint returned. When it resolves to a direct child of
 * the container the answer is exact; when it is the container itself the line
 * boxes decide. Returns -1 when nothing matches — callers then fall back to
 * whole-container behavior instead of silently doing nothing.
 */
export function resolveCandidateAtPoint(
    container: UnitContainer,
    candidates: ChildNode[][],
    hit: Node | null,
    x: number,
    y: number,
): number {
    const child = directChildOf(hit, container);
    if (child) {
        const index = candidates.findIndex((nodes) => nodes.includes(child));
        if (index >= 0) return index;
    }
    return candidates.findIndex((nodes) => isPointOverNodes(x, y, nodes));
}
