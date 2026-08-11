// Shadow-piercing versions of the DOM walks the pipeline relies on.
//
// Every classic walk in this codebase (`parentElement`, `contains`, `closest`,
// `elementFromPoint`, `event.target`) stops at — or is retargeted by — a shadow
// boundary. These helpers are the drop-in replacements. They are pure DOM and
// import nothing from the rest of the extension, so anything may depend on them
// (in particular main/dom/shadowRoots.ts does, which is why the registry-backed
// `deepQuerySelector*` live over there instead of here).
//
// Open roots only, by construction: `el.shadowRoot` is `null` for a closed one.
// Closed roots are handled upstream by the MAIN-world bridge, which forces them
// open before any of this runs — see entrypoints/shadow-bridge.content.ts.

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
 * The native call is kept as a fast path: it is a C++ tree walk and answers for
 * the overwhelming majority of nodes, which all live in the same tree.
 */
export function deepContains(root: Node, node: Node | null | undefined): boolean {
    if (!node) return false;
    if (root.contains(node)) return true;
    for (let cur: Node | null = node; cur; cur = parentOrHost(cur)) {
        if (cur === root) return true;
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
 * The Selection to use when reading or writing a caret around `node`.
 *
 * `window.getSelection()` retargets its ranges to the shadow HOST, so reading
 * `getRangeAt(0)` back for a contentEditable inside a component yields boundary
 * points outside the editor — and `deleteContents()` / `insertNode()` on that
 * range then edit the wrong part of the page. Chrome exposes a per-root
 * `ShadowRoot.getSelection()` that answers in the root's own coordinates; where
 * it is missing (Firefox, Safari) we fall back, which is no worse than today.
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
