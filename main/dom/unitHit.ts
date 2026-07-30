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
import type { TranslationUnit, UnitRange } from "@/main/dom/segments";

/**
 * The ancestor-or-self of `node` whose parent is `container`, i.e. the container
 * child that owns `node`. Null when `node` is the container itself or lives
 * outside it.
 */
export function directChildOf(node: Node | null, container: HTMLElement): ChildNode | null {
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
        start: first?.previousSibling ?? null,
        end: last?.nextSibling ?? null,
    };
}

/**
 * Live children of `container` inside `range`. An anchor the page has since
 * detached is ignored (degrading to that container edge) — the same tolerance
 * the SINGLE write-back applies.
 */
export function nodesInRange(container: HTMLElement, range: UnitRange): ChildNode[] {
    const start = range.start?.parentNode === container ? range.start : null;
    const end = range.end?.parentNode === container ? range.end : null;
    const out: ChildNode[] = [];
    let node = start ? start.nextSibling : container.firstChild;
    while (node && node !== end) {
        out.push(node);
        node = node.nextSibling;
    }
    return out;
}

/** Whether `child` (a direct child of `container`) lies inside `range`. */
export function rangeContains(
    container: HTMLElement,
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
    container: HTMLElement,
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
