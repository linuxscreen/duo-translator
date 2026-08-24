// Shadow-piercing versions of the DOM walks the pipeline relies on.
//
// Every classic walk in this codebase (`parentElement`, `contains`, `closest`,
// `elementFromPoint`, `event.target`) stops at — or is retargeted by — a shadow
// boundary. These helpers are the drop-in replacements. They are pure DOM and
// import nothing from the rest of the extension, so anything may depend on them
// (in particular main/dom/shadowRoots.ts does, which is why the registry-backed
// `deepQuerySelector*` live over there instead of here).
//
// Open roots only, by construction: `el.shadowRoot` is `null` for a closed one,
// so a closed subtree is simply invisible to all of this. That is deliberate and
// permanent — an author choosing `closed` is saying "stay out", and the widgets
// that do (Turnstile, hCaptcha, Stripe Elements, SSO popups) are exactly the
// ones we should not be translating. See the header of main/dom/shadowRoots.ts.

/** Depth cap for the descent loops: a pathological component can't hang us. */
const MAX_PIERCE_DEPTH = 32;

/**
 * `node instanceof ShadowRoot` by shape rather than by constructor identity.
 * Firefox content scripts see page nodes through Xray wrappers, and this is the
 * same discrimination the rest of the codebase needs for `UnitContainer`, so it
 * is worth having exactly one answer to it.
 */
export function isShadowRoot(node: unknown): node is ShadowRoot {
    return (
        !!node &&
        (node as Node).nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
        (node as ShadowRoot).host != null
    );
}

function isElement(node: unknown): node is Element {
    return !!node && (node as Node).nodeType === Node.ELEMENT_NODE;
}

/**
 * The next node up the *composed* ancestry: a plain `parentNode`, except that a
 * `ShadowRoot` answers with its host instead of `null`.
 *
 * Note a node sitting directly under a root gets the `ShadowRoot` itself here —
 * the hop to the host happens on the following iteration. That is deliberate:
 * marks and translation-unit containers can be roots, so a walk must be able to
 * see them.
 */
export function parentOrHost(node: Node | null | undefined): Node | null {
    if (!node) return null;
    const parent = node.parentNode;
    if (parent) return parent;
    return isShadowRoot(node) ? node.host : null;
}

/**
 * Drop-in for a `.parentElement` walk: skips over the `ShadowRoot` and lands on
 * the host, so the walk keeps climbing out of the component instead of ending.
 */
export function parentElementOrHost(node: Node | null | undefined): HTMLElement | null {
    for (let cur = parentOrHost(node); cur; cur = parentOrHost(cur)) {
        if (isElement(cur)) return cur as HTMLElement;
    }
    return null;
}

/**
 * Shadow-including descendant test — `Node.contains` semantics (inclusive of
 * `root` itself), but crossing host boundaries.
 *
 * Both steps are the native `contains()`; the JS only picks which trees to run
 * it on. A composed descendant that is not a plain one must live inside a
 * shadow tree, so once the first call says no, the only remaining candidates
 * are reached by hopping tree → host — one hop per boundary crossed, none at
 * all on a page with no shadow DOM.
 *
 * This used to fall through to a `parentOrHost` climb instead, and that made it
 * the most expensive function in the extension. The climb runs all the way to
 * the top of the document on every *miss*, and a miss is the answer for nearly
 * every call: the marks sweep asked it once per mark per removed node. In
 * Firefox every step of that climb is an Xray property read (`parentNode` on a
 * page node crosses a compartment, and the terminating `isShadowRoot` probes
 * `.host` on an element that does not have it — the slowest lookup of the
 * lot). Measured on a Zen profile of ui.shadcn.com while typing: 69% of the
 * whole tab thread was inside here, 93% of that in the climb and 1% in the
 * native call it had already made.
 */
export function deepContains(root: Node, node: Node | null | undefined): boolean {
    if (!node) return false;
    if (root.contains(node)) return true;
    // getRootNode() answers with the ShadowRoot for anything inside a shadow
    // tree — and with a ShadowRoot itself, so a root passed as `node` climbs
    // out of its own tree exactly like any of its children would.
    let tree: Node = node.getRootNode();
    for (let depth = 0; depth < MAX_PIERCE_DEPTH; depth++) {
        if (!isShadowRoot(tree)) return false;
        const host = tree.host;
        if (host === root || root.contains(host)) return true;
        tree = host.getRootNode();
    }
    return false;
}

/**
 * `closest()` that keeps going after the current tree runs out: on a miss it
 * hops to the host and retries from there.
 */
export function deepClosest(el: Element | null | undefined, selector: string): Element | null {
    for (let cur: Element | null = el ?? null; cur; cur = parentElementOrHost(cur)) {
        let hit: Element | null = null;
        try {
            hit = cur.closest(selector);
        } catch {
            return null; // invalid selector — same degradation as a miss
        }
        if (hit) return hit;
    }
    return null;
}

/**
 * `document.elementFromPoint` retargets to the shadow *host* for open and closed
 * roots alike, so the pointer never resolves to the element the user is actually
 * over. Descend through each root's own `elementFromPoint` until it stops
 * answering with something new.
 */
export function deepElementFromPoint(x: number, y: number): Element | null {
    let el = document.elementFromPoint(x, y);
    for (let depth = 0; depth < MAX_PIERCE_DEPTH; depth++) {
        const root = (el as HTMLElement | null)?.shadowRoot;
        if (!root) break;
        const inner = root.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
    }
    return el;
}

/**
 * `document.activeElement` is the host when focus is inside a component; each
 * root tracks its own `activeElement`, so descend to the real one.
 */
export function deepActiveElement(): Element | null {
    let el: Element | null = document.activeElement;
    for (let depth = 0; depth < MAX_PIERCE_DEPTH; depth++) {
        const inner = (el as HTMLElement | null)?.shadowRoot?.activeElement;
        if (!inner || inner === el) break;
        el = inner;
    }
    return el;
}

/**
 * The read-only slice of `Selection` this codebase consumes.
 *
 * A real `Selection` satisfies it structurally, so the Chrome path below still
 * hands back the live object. The standard fallback cannot: `getComposedRanges`
 * answers with `StaticRange`s, never with a `Selection`, so that path returns a
 * view built over them. Callers must not reach past these members — anything
 * that MUTATES the selection has to keep using `selectionForNode`.
 */
export interface DeepSelection {
    readonly anchorNode: Node | null;
    readonly anchorOffset: number;
    readonly focusNode: Node | null;
    readonly focusOffset: number;
    readonly rangeCount: number;
    getRangeAt(index: number): Range;
    toString(): string;
}

interface BoundaryProbe {
    anchorNode: Node | null;
    anchorOffset: number;
}

type SelectionExtras = {
    getComposedRanges?: (...args: unknown[]) => StaticRange[] | undefined;
    direction?: string;
};

/**
 * The selection, read from inside the shadow tree it actually lives in.
 *
 * `window.getSelection()` shadow-adjusts its positions to the DOCUMENT's tree
 * scope: a selection made inside a component reports both of its ends as (the
 * host's parent, the host's index) — a collapsed range that measures nothing.
 * `toString()` still returns the right text, which is what makes this failure so
 * quiet: everything textual works and only the geometry is wrong. Both symptoms
 * come from that single empty rect — the selection icon has nothing to point at
 * so it never appears, and the translate card reads "no measurable rect" as "no
 * anchor" and places itself dead centre.
 *
 * TWO ways down, tried in that order:
 *
 * 1. `ShadowRoot.getSelection()` — non-standard and **Chrome-only** (Firefox and
 *    Safari have never shipped it).
 * 2. `Selection.getComposedRanges({shadowRoots})` — the standardized answer
 *    (Safari 17+, Chrome 137+, Firefox 142+), which is what makes any of this
 *    work outside Chrome at all. Relying on (1) alone meant that on Safari and
 *    Firefox the pill never appeared for a selection inside ANY shadow tree —
 *    a page's own components as much as our selection-translate card, so
 *    looking a word up from inside a result was a dead end there.
 *
 * Both descend from the adjusted anchor, one hop per nesting level, deliberately
 * NOT a sweep over every known root — a component-heavy page has hundreds and
 * this runs on every `selectionchange`. The descent is also what supplies the
 * `shadowRoots` list (2) needs: a root that is not passed in stays retargeted to
 * its host, so the list has to name every level down to the one that owns the
 * position, and finding them from the DOM keeps this file free of any registry
 * import (see the header).
 *
 * Falls back to the window selection unchanged for plain light DOM, for browsers
 * with neither accessor, and for a selection that spans a shadow boundary, where
 * no single root owns both ends.
 */
export function deepSelection(): DeepSelection | null {
    const sel = window.getSelection();
    if (!sel) return null;
    const scoped = descendScoped(sel);
    if (scoped !== sel) return scoped;
    return descendComposed(sel) ?? sel;
}

/** The shadow root an adjusted position points *at*, if any. */
function hostRootAt(pos: BoundaryProbe): ShadowRoot | null {
    const host = pos.anchorNode?.childNodes?.[pos.anchorOffset];
    return (host as HTMLElement | undefined)?.shadowRoot ?? null;
}

function descendScoped(sel: Selection): Selection {
    let cur = sel;
    for (let depth = 0; depth < MAX_PIERCE_DEPTH; depth++) {
        const root = hostRootAt(cur);
        if (!root) break;
        const scoped = scopedSelectionOf(root);
        // `getSelection()` is scoped, not filtered: a root that does not hold
        // the selection still answers, with positions it cannot express. Only
        // an answer that lands inside the root is a real descent — anything
        // else means the child under the anchor was a host by coincidence.
        if (!scoped || !deepContains(root, scoped.anchorNode)) break;
        cur = scoped;
    }
    return cur;
}

function scopedSelectionOf(root: ShadowRoot): Selection | null {
    const get = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
    if (typeof get !== "function") return null;
    try {
        const sel = get.call(root);
        return sel && sel.rangeCount > 0 ? sel : null;
    } catch {
        return null;
    }
}

function descendComposed(sel: Selection): DeepSelection | null {
    if (typeof (sel as Selection & SelectionExtras).getComposedRanges !== "function") return null;
    const roots: ShadowRoot[] = [];
    let pos: BoundaryProbe = { anchorNode: sel.anchorNode, anchorOffset: sel.anchorOffset };
    let composed: StaticRange | null = null;
    for (let depth = 0; depth < MAX_PIERCE_DEPTH; depth++) {
        const root = hostRootAt(pos);
        if (!root) break;
        roots.push(root);
        const next = composedRangeIn(sel, roots);
        if (!next) break;
        composed = next;
        pos = { anchorNode: next.startContainer, anchorOffset: next.startOffset };
    }
    return composed ? viewOfComposed(sel, composed) : null;
}

/**
 * The composed range, expressed inside the deepest of `roots` — or null when the
 * answer is still retargeted, which covers both "this engine ignored the
 * argument" and the "host by coincidence" case the scoped path guards against.
 */
function composedRangeIn(sel: Selection, roots: ShadowRoot[]): StaticRange | null {
    const fn = (sel as Selection & SelectionExtras).getComposedRanges;
    if (typeof fn !== "function") return null;
    const deepest = roots[roots.length - 1];
    // Two call shapes are in the wild: the spec's options dict, and the variadic
    // form WebKit shipped first. An engine that only knows the other one ignores
    // the argument entirely and answers with the retargeted position, which the
    // containment test below rejects — so trying both is safe, not a guess.
    const shapes: unknown[][] = [[{ shadowRoots: roots }], roots];
    for (const args of shapes) {
        try {
            const range = fn.apply(sel, args)?.[0];
            if (range && deepContains(deepest, range.startContainer)) return range;
        } catch {
            // Wrong shape for this engine — try the other one.
        }
    }
    return null;
}

function viewOfComposed(sel: Selection, sr: StaticRange): DeepSelection | null {
    // A range cannot hold boundary points from two different trees, and a
    // selection that escapes the root is exactly the case the doc comment sends
    // back to the window selection.
    if (sr.startContainer.getRootNode() !== sr.endContainer.getRootNode()) return null;
    const range = document.createRange();
    try {
        range.setStart(sr.startContainer, sr.startOffset);
        range.setEnd(sr.endContainer, sr.endOffset);
    } catch {
        return null;
    }
    // `getComposedRanges` answers in DOCUMENT order, dropping which end the drag
    // finished on — and that end is what the selection pill anchors to.
    // `Selection.direction` puts it back; it ships alongside getComposedRanges
    // everywhere (Safari 17 / Firefox 126 / Chrome 137), and where it is missing
    // the forward assumption costs a backward drag nothing but the pill's
    // place-at-the-caret refinement.
    const backward = (sel as Selection & SelectionExtras).direction === "backward";
    const text = range.toString();
    return {
        anchorNode: backward ? sr.endContainer : sr.startContainer,
        anchorOffset: backward ? sr.endOffset : sr.startOffset,
        focusNode: backward ? sr.startContainer : sr.endContainer,
        focusOffset: backward ? sr.startOffset : sr.endOffset,
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => text,
    };
}

/**
 * The Selection to use when reading or writing a caret around `node`.
 *
 * `window.getSelection()` retargets its ranges to the shadow HOST, so reading
 * `getRangeAt(0)` back for a contentEditable inside a component yields boundary
 * points outside the editor — and `deleteContents()` / `insertNode()` on that
 * range then edit the wrong part of the page. Chrome exposes a per-root
 * `ShadowRoot.getSelection()` that answers in the root's own coordinates; where
 * it is missing (Firefox, Safari) we fall back, which is no worse than today.
 *
 * NOT the same fix as {@link deepSelection}'s: `getComposedRanges` reads, it
 * does not write. Callers here go on to MUTATE the selection (`removeAllRanges`
 * / `addRange`, `deleteContents`), and a `StaticRange` gives no way to do that,
 * so this stays a read-the-live-object path. Worth revisiting only with a
 * caret-writing API that crosses roots.
 */
export function selectionForNode(node: Node | null | undefined): Selection | null {
    const root = node?.getRootNode?.();
    if (isShadowRoot(root)) {
        const scoped = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
        if (typeof scoped === "function") {
            try {
                const sel = scoped.call(root);
                if (sel) return sel;
            } catch {
                // Fall through.
            }
        }
    }
    return window.getSelection();
}

/**
 * The real event target. `e.target` is retargeted to the host for any listener
 * bound outside the root, which is every delegated listener we have;
 * `composedPath()[0]` is the node actually hit.
 */
export function composedTarget(e: Event): Element | null {
    let first: unknown = null;
    if (typeof e.composedPath === "function") {
        first = e.composedPath()[0];
    }
    if (first == null) first = e.target;
    if (isElement(first)) return first;
    // Text nodes are not event targets today, but a caller asking for "the
    // element under this event" is better served by the parent than by null.
    const parent = (first as Node | null)?.parentElement;
    return parent ?? null;
}
