// In-memory paragraph marks — replaces the old `duo-paragraph` /
// `duo-needs-translate` classes on page elements.
//
// Keeping the marks in content-script memory instead of the DOM means:
//   - a page rewriting className (React re-render, SPA router) can neither
//     wipe nor observe our state;
//   - the marking scan does zero DOM writes, so it never invalidates styles
//     nor triggers MutationObservers (the page's or our own);
//   - a reloaded content script starts from a clean slate (no stale classes).
//
// The store is a module singleton, one per frame (content scripts are
// per-frame), shared by content.ts, ruleMode.ts and lang.ts. Invariants:
//   - needs-translate ⊆ paragraph — the flag lives on the paragraph mark;
//   - a mark is either *pure* (`mixed=false`, the scan never descended past
//     it, so no marks exist beneath it) or *mixed* (`mixed=true`, the element
//     has inline-run translation units AND block-ish children the scan kept
//     descending into — marks may exist under those children, but never under
//     a unit's inline nodes);
//   - translation units never overlap: every text node belongs to at most one
//     unit (a mixed container's units cover only its qualifying inline runs).
//
// Lifecycle: content.ts's MutationObserver calls `cleanupParagraphMarks` for
// removed subtrees; enumeration helpers additionally sweep disconnected
// entries so SPA navigations can't leak detached elements through this Map.
//
// Keys are `UnitContainer`, so a `ShadowRoot` can be marked directly. Element
// identity works the same across trees and `isConnected` is true for a node
// under a connected host, so the store itself needed no change for shadow DOM —
// only the *walks* did (`parentOrHost` / `deepContains` instead of
// `parentElement` / `contains`, neither of which crosses a boundary).
import type { UnitContainer } from "@/main/dom/segments";
import { deepContains, parentOrHost } from "@/main/dom/shadowTraversal";

interface ParagraphMark {
    needsTranslate: boolean;
    mixed: boolean;
}

const marks = new Map<UnitContainer, ParagraphMark>();

/** Mark `el` as a paragraph (container of translation units). */
export function markParagraph(el: UnitContainer, needsTranslate: boolean, mixed = false): void {
    marks.set(el, { needsTranslate, mixed });
}

export function isParagraph(el: Node): boolean {
    return marks.has(el as UnitContainer);
}

/** Whether `el` carries a mixed mark (may have marks nested under it). */
export function isMixedParagraph(el: Node): boolean {
    return marks.get(el as UnitContainer)?.mixed === true;
}

/** Flip the needs-translate flag of an already-marked paragraph (rule mode). */
export function setNeedsTranslate(el: Node, value: boolean): void {
    const mark = marks.get(el as UnitContainer);
    if (mark) mark.needsTranslate = value;
}

/**
 * Nearest marked paragraph, starting at `el` itself (closest() semantics).
 * Climbs through shadow hosts, and can answer with a `ShadowRoot` — a root is a
 * container like any other.
 */
export function closestParagraph(el: Node | null | undefined): UnitContainer | null {
    for (let cur: Node | null = el ?? null; cur; cur = parentOrHost(cur)) {
        if (marks.has(cur as UnitContainer)) return cur as UnitContainer;
    }
    return null;
}

/** Nearest needs-translate paragraph, starting at `el` itself. */
export function closestNeedsTranslate(el: Node | null | undefined): UnitContainer | null {
    for (let cur: Node | null = el ?? null; cur; cur = parentOrHost(cur)) {
        if (marks.get(cur as UnitContainer)?.needsTranslate) return cur as UnitContainer;
    }
    return null;
}

/** All marked paragraphs; sweeps entries the page has since removed. */
export function allParagraphs(): UnitContainer[] {
    const out: UnitContainer[] = [];
    for (const el of marks.keys()) {
        if (!el.isConnected) {
            marks.delete(el);
            continue;
        }
        out.push(el);
    }
    return out;
}

/** All connected paragraphs whose needs-translate flag is on. */
export function needsTranslateParagraphs(): UnitContainer[] {
    return allParagraphs().filter((el) => marks.get(el)!.needsTranslate);
}

/** Marked paragraphs strictly under `root` (querySelectorAll semantics — excludes `root`). */
export function paragraphsUnder(root: Node): UnitContainer[] {
    const out: UnitContainer[] = [];
    for (const el of marks.keys()) {
        if (el !== root && deepContains(root, el)) out.push(el);
    }
    return out;
}

/** Whether any marked paragraph exists strictly under `root`. */
export function anyParagraphUnder(root: Node): boolean {
    for (const el of marks.keys()) {
        if (el !== root && deepContains(root, el)) return true;
    }
    return false;
}

/**
 * Drop marks for `removed` and everything under it. Called from the
 * MutationObserver while the removed subtree is still identifiable.
 */
export function cleanupParagraphMarks(removed: Node): void {
    if (marks.size === 0) return;
    // A *pure* mark cannot contain other marks, so removing one is a
    // single-entry cleanup. A mixed mark (or an unmarked ancestor) may have
    // marks nested beneath it — sweep the subtree. A host whose shadow root
    // holds marks is recorded as mixed for exactly this reason, so the
    // early-return can never strand them.
    const mark = marks.get(removed as UnitContainer);
    if (mark) {
        marks.delete(removed as UnitContainer);
        if (!mark.mixed) return;
    }
    for (const el of marks.keys()) {
        if (deepContains(removed, el)) marks.delete(el);
    }
}

/** Forget every mark (pure restore / global switch off). */
export function clearParagraphMarks(): void {
    marks.clear();
}

// ---------------------------------------------------------------------------
// No-translate marks — replaces the old `duo-no-translate` class.
//
// A per-element "this is a no-translate region root" flag with two writers:
// the marking scan caching a positive user-rule match (`el.matches(rules)`),
// and rule mode toggling a selection. Consumed only via `isNoTranslate` in
// the marking scan (ancestor walk + descent) — never enumerated, so a
// WeakSet suffices: no cleanup wiring, detached elements just get GC'd.
//
// Two sets, because they answer to different switches. The per-domain
// "translate all elements" option turns the USER's exclusions off, and the
// scan then has to ignore every rule-derived mark — but our own inserted UI
// (the video-subtitle overlay) is a hard exclusion that no user option may
// lift, so it is marked as `own` and kept in a set the scan always honors.
// ---------------------------------------------------------------------------

let noTranslateMarks = new WeakSet<Element>();
const ownNoTranslateMarks = new WeakSet<Element>();

export function markNoTranslate(el: Element, options?: { own?: boolean }): void {
    if (options?.own) ownNoTranslateMarks.add(el);
    else noTranslateMarks.add(el);
}

export function unmarkNoTranslate(el: Element): void {
    noTranslateMarks.delete(el);
}

export function isNoTranslate(el: Element): boolean {
    return noTranslateMarks.has(el) || ownNoTranslateMarks.has(el);
}

/** Only the marks the user cannot switch off — see the two-set note above. */
export function isOwnNoTranslate(el: Element): boolean {
    return ownNoTranslateMarks.has(el);
}

/** Forget every no-translate mark (WeakSet has no clear() — reassign). */
export function resetNoTranslateMarks(): void {
    noTranslateMarks = new WeakSet<Element>();
}
