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
// per-frame), shared by content.ts, ruleMode.ts and lang.ts. Invariant:
// needs-translate ⊆ paragraph — the flag lives on the paragraph mark.
//
// Lifecycle: content.ts's MutationObserver calls `cleanupParagraphMarks` for
// removed subtrees; enumeration helpers additionally sweep disconnected
// entries so SPA navigations can't leak detached elements through this Map.

interface ParagraphMark {
    needsTranslate: boolean;
}

const marks = new Map<HTMLElement, ParagraphMark>();

/** Mark `el` as a paragraph (translation unit). */
export function markParagraph(el: HTMLElement, needsTranslate: boolean): void {
    marks.set(el, { needsTranslate });
}

export function isParagraph(el: Element): boolean {
    return marks.has(el as HTMLElement);
}

/** Flip the needs-translate flag of an already-marked paragraph (rule mode). */
export function setNeedsTranslate(el: Element, value: boolean): void {
    const mark = marks.get(el as HTMLElement);
    if (mark) mark.needsTranslate = value;
}

/** Nearest marked paragraph, starting at `el` itself (closest() semantics). */
export function closestParagraph(el: Element | null | undefined): HTMLElement | null {
    for (let cur = el; cur; cur = cur.parentElement) {
        if (marks.has(cur as HTMLElement)) return cur as HTMLElement;
    }
    return null;
}

/** Nearest needs-translate paragraph, starting at `el` itself. */
export function closestNeedsTranslate(el: Element | null | undefined): HTMLElement | null {
    for (let cur = el; cur; cur = cur.parentElement) {
        if (marks.get(cur as HTMLElement)?.needsTranslate) return cur as HTMLElement;
    }
    return null;
}

/** All marked paragraphs; sweeps entries the page has since removed. */
export function allParagraphs(): HTMLElement[] {
    const out: HTMLElement[] = [];
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
export function needsTranslateParagraphs(): HTMLElement[] {
    return allParagraphs().filter((el) => marks.get(el)!.needsTranslate);
}

/** Marked paragraphs strictly under `root` (querySelectorAll semantics — excludes `root`). */
export function paragraphsUnder(root: Element): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const el of marks.keys()) {
        if (el !== root && root.contains(el)) out.push(el);
    }
    return out;
}

/** Whether any marked paragraph exists strictly under `root`. */
export function anyParagraphUnder(root: Element): boolean {
    for (const el of marks.keys()) {
        if (el !== root && root.contains(el)) return true;
    }
    return false;
}

/**
 * Drop marks for `removed` and everything under it. Called from the
 * MutationObserver while the removed subtree is still identifiable.
 */
export function cleanupParagraphMarks(removed: HTMLElement): void {
    if (marks.size === 0) return;
    // Paragraph marks never nest (marking stops descending at a paragraph),
    // so a removed paragraph is a single-entry cleanup.
    if (marks.delete(removed)) return;
    for (const el of marks.keys()) {
        if (removed.contains(el)) marks.delete(el);
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
// ---------------------------------------------------------------------------

let noTranslateMarks = new WeakSet<Element>();

export function markNoTranslate(el: Element): void {
    noTranslateMarks.add(el);
}

export function unmarkNoTranslate(el: Element): void {
    noTranslateMarks.delete(el);
}

export function isNoTranslate(el: Element): boolean {
    return noTranslateMarks.has(el);
}

/** Forget every no-translate mark (WeakSet has no clear() — reassign). */
export function resetNoTranslateMarks(): void {
    noTranslateMarks = new WeakSet<Element>();
}
