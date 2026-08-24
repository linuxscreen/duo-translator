// @vitest-environment jsdom
//
// Tests for main/dom/shadowTraversal.ts — the shadow-piercing replacements for
// the DOM walks the translation pipeline relies on.
//
// jsdom 29 implements attachShadow (open AND closed), getRootNode, composedPath
// and assignedNodes, so structure and traversal are fully testable here. It has
// no layout and no `elementFromPoint`, so `deepElementFromPoint` /
// `deepActiveElement` geometry+focus behaviour belongs to e2e.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    composedTarget,
    deepClosest,
    deepContains,
    deepSelection,
    isShadowRoot,
    parentElementOrHost,
    parentOrHost,
} from "@/main/dom/shadowTraversal";

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** `<div id=outer>` → shadow → `<div id=inner>` → shadow → `<p id=leaf>text` */
function buildNested() {
    document.body.innerHTML = `<section id="light"><div id="outer"></div></section>`;
    const outer = document.getElementById("outer")!;
    const outerRoot = outer.attachShadow({ mode: "open" });
    outerRoot.innerHTML = `<article id="mid"><div id="inner"></div></article>`;
    const inner = outerRoot.getElementById("inner")!;
    const innerRoot = inner.attachShadow({ mode: "open" });
    innerRoot.innerHTML = `<p id="leaf">text</p>`;
    const leaf = innerRoot.getElementById("leaf")!;
    return {
        light: document.getElementById("light")!,
        outer,
        outerRoot,
        mid: outerRoot.getElementById("mid")!,
        inner,
        innerRoot,
        leaf,
        leafText: leaf.firstChild as Text,
    };
}

describe("isShadowRoot", () => {
    it("recognises a root by shape, and rejects plain fragments and elements", () => {
        const host = document.createElement("div");
        const root = host.attachShadow({ mode: "open" });
        expect(isShadowRoot(root)).toBe(true);
        expect(isShadowRoot(document.createDocumentFragment())).toBe(false);
        expect(isShadowRoot(host)).toBe(false);
        expect(isShadowRoot(null)).toBe(false);
    });
});

describe("parentOrHost", () => {
    it("climbs out of a shadow root via its host", () => {
        const { leaf, innerRoot, inner } = buildNested();
        // leaf -> innerRoot (the root itself is a step, marks can live on it)
        expect(parentOrHost(leaf)).toBe(innerRoot);
        expect(parentOrHost(innerRoot)).toBe(inner);
    });

    it("reaches the document across two nested roots", () => {
        const { leafText, light } = buildNested();
        const chain: Node[] = [];
        for (let cur: Node | null = leafText; cur; cur = parentOrHost(cur)) chain.push(cur);
        expect(chain).toContain(light);
        expect(chain).toContain(document.body);
        expect(chain[chain.length - 1]).toBe(document);
    });

    it("behaves like parentNode in the light DOM", () => {
        document.body.innerHTML = "<div><span>x</span></div>";
        const span = document.querySelector("span")!;
        expect(parentOrHost(span)).toBe(span.parentNode);
        expect(parentOrHost(null)).toBeNull();
    });
});

describe("parentElementOrHost", () => {
    it("skips the ShadowRoot and lands on the host element", () => {
        const { leaf, inner, mid, outer } = buildNested();
        expect(parentElementOrHost(leaf)).toBe(inner);
        expect(parentElementOrHost(inner)).toBe(mid);
        expect(parentElementOrHost(mid)).toBe(outer);
    });

    it("returns null above <html>", () => {
        expect(parentElementOrHost(document.documentElement)).toBeNull();
    });
});

describe("deepContains", () => {
    it("crosses host boundaries where native contains does not", () => {
        const { outer, leaf, light } = buildNested();
        expect(outer.contains(leaf)).toBe(false); // the defect being fixed
        expect(deepContains(outer, leaf)).toBe(true);
        expect(deepContains(light, leaf)).toBe(true);
        expect(deepContains(document.body, leaf)).toBe(true);
    });

    it("keeps Node.contains inclusive semantics and rejects outsiders", () => {
        const { outer, leaf } = buildNested();
        expect(deepContains(leaf, leaf)).toBe(true);
        expect(deepContains(leaf, outer)).toBe(false);
        expect(deepContains(outer, null)).toBe(false);
    });

    // The hop is `node.getRootNode() -> host`, and a ShadowRoot's own root node
    // is itself — so a root passed as `node` has to climb out of its tree just
    // like any of its children. Marks and unit containers can BE roots, so this
    // is a live shape, not a curiosity.
    it("answers for a ShadowRoot passed as the node", () => {
        const { outer, outerRoot, innerRoot, light } = buildNested();
        expect(deepContains(outer, outerRoot)).toBe(true);
        expect(deepContains(light, innerRoot)).toBe(true);
        expect(deepContains(outerRoot, outerRoot)).toBe(true);
        expect(deepContains(innerRoot, outerRoot)).toBe(false);
    });

    // A detached node's root is the top of its own fragment, never a
    // ShadowRoot, so the hop loop must terminate on the first check instead of
    // climbing anywhere.
    it("rejects a detached node without walking", () => {
        const { light, leaf } = buildNested();
        const orphan = document.createElement("p");
        expect(deepContains(light, orphan)).toBe(false);
        expect(deepContains(orphan, leaf)).toBe(false);
        // ...but a detached subtree still contains its own children.
        const child = document.createElement("span");
        orphan.append(child);
        expect(deepContains(orphan, child)).toBe(true);
    });
});

describe("deepClosest", () => {
    it("finds an ancestor outside the element's own shadow tree", () => {
        const { leaf, light } = buildNested();
        expect(leaf.closest("#light")).toBeNull(); // the defect being fixed
        expect(deepClosest(leaf, "#light")).toBe(light);
    });

    it("still prefers the nearest match inside the current tree", () => {
        const { leaf, mid } = buildNested();
        expect(deepClosest(leaf, "p")).toBe(leaf);
        expect(deepClosest(leaf, "article")).toBe(mid);
    });

    it("returns null on no match and on an invalid selector", () => {
        const { leaf } = buildNested();
        expect(deepClosest(leaf, "#nope")).toBeNull();
        expect(deepClosest(leaf, ":::bad")).toBeNull();
        expect(deepClosest(null, "p")).toBeNull();
    });
});

describe("composedTarget", () => {
    it("returns the real inner node, not the retargeted host", () => {
        const { leaf, outer } = buildNested();
        let fromTarget: EventTarget | null = null;
        let fromComposed: Element | null = null;
        document.addEventListener(
            "click",
            (e) => {
                fromTarget = e.target;
                fromComposed = composedTarget(e);
            },
            { once: true },
        );
        leaf.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
        expect(fromTarget).toBe(outer); // retargeted — the defect being fixed
        expect(fromComposed).toBe(leaf);
    });

    it("falls back to e.target when composedPath is unavailable", () => {
        document.body.innerHTML = "<div id='a'></div>";
        const a = document.getElementById("a")!;
        const e = { target: a } as unknown as Event;
        expect(composedTarget(e)).toBe(a);
    });
});

// ---------------------------------------------------------------------------
// deepSelection
//
// jsdom has neither Chrome's shadow adjustment nor `ShadowRoot.getSelection`,
// so both are simulated: a stub `window.getSelection` returning the ADJUSTED
// position Chrome would report (the host's parent, at the host's index), and a
// stub `getSelection` on each root answering in its own scope. That is exactly
// the shape the descent has to unwind, and it is not observable any other way
// without a real engine.
// ---------------------------------------------------------------------------

/** Minimal stand-in — deepSelection only reads these three members. */
function fakeSelection(anchorNode: Node | null, anchorOffset = 0, rangeCount = 1): Selection {
    return { anchorNode, anchorOffset, rangeCount } as unknown as Selection;
}

function stubWindowSelection(sel: Selection | null): void {
    vi.spyOn(window, "getSelection").mockReturnValue(sel);
}

function stubRootSelection(root: ShadowRoot, sel: Selection | null): void {
    (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection = () => sel;
}

describe("deepSelection", () => {
    it("returns the window selection untouched for a light-DOM selection", () => {
        const { light } = buildNested();
        const sel = fakeSelection(light.firstChild ?? light, 99);
        stubWindowSelection(sel);
        expect(deepSelection()).toBe(sel);
    });

    it("descends through every nesting level to the root that owns the selection", () => {
        const { light, mid, innerRoot, outerRoot, leafText } = buildNested();
        // What Chrome reports from the document's scope: collapsed onto #outer.
        stubWindowSelection(fakeSelection(light, 0));
        stubRootSelection(outerRoot, fakeSelection(mid, 0));
        const real = fakeSelection(leafText, 2);
        stubRootSelection(innerRoot, real);
        expect(deepSelection()).toBe(real);
    });

    it("keeps the window selection when the root does not actually own it", () => {
        // The child under the anchor is a host by coincidence — the page
        // selection sits next to a component, not inside it. The root still
        // answers (getSelection is scoped, not filtered), with a position it
        // cannot express.
        const { light, outerRoot } = buildNested();
        const sel = fakeSelection(light, 0);
        stubWindowSelection(sel);
        stubRootSelection(outerRoot, fakeSelection(light, 0));
        expect(deepSelection()).toBe(sel);
    });

    it("falls back to the window selection where the scoped accessor is missing", () => {
        // Firefox: no ShadowRoot.getSelection, but its window selection already
        // carries the real shadow nodes, so the fallback is the right answer.
        const { light } = buildNested();
        const sel = fakeSelection(light, 0);
        stubWindowSelection(sel);
        expect(deepSelection()).toBe(sel);
    });

    it("survives a throwing or empty scoped accessor", () => {
        const { light, outerRoot, innerRoot, mid } = buildNested();
        const sel = fakeSelection(light, 0);
        stubWindowSelection(sel);
        (outerRoot as ShadowRoot & { getSelection?: () => Selection | null }).getSelection = () => {
            throw new Error("boom");
        };
        expect(deepSelection()).toBe(sel);

        stubRootSelection(outerRoot, fakeSelection(mid, 0, 0)); // rangeCount 0
        stubRootSelection(innerRoot, fakeSelection(null));
        expect(deepSelection()).toBe(sel);
    });

    it("returns null when there is no selection at all", () => {
        stubWindowSelection(null);
        expect(deepSelection()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// deepSelection — the standard `Selection.getComposedRanges` path
//
// This is the ONLY path outside Chrome: `ShadowRoot.getSelection` is a
// Chrome-only extension, so on Safari/Firefox everything below is what makes a
// selection inside a shadow tree visible at all. jsdom has neither API, so the
// engine side is stubbed — but faithfully: `expressIn` implements the spec's
// retargeting (a root that was NOT passed in collapses onto its host), which is
// precisely the behaviour the descent has to unwind.
// ---------------------------------------------------------------------------

/** Where a boundary point lands once roots outside `roots` are retargeted. */
function expressIn(node: Node, offset: number, roots: ShadowRoot[]): [Node, number] {
    let n = node;
    let o = offset;
    for (let i = 0; i < 32; i++) {
        const root = n.getRootNode();
        if (!isShadowRoot(root) || roots.includes(root as ShadowRoot)) return [n, o];
        const host = (root as ShadowRoot).host;
        const parent = host.parentNode!;
        o = Array.prototype.indexOf.call(parent.childNodes, host);
        n = parent;
    }
    return [n, o];
}

interface ComposedStubOpts {
    /** Refuse the spec's options-dict form, like the engines that shipped the
     *  variadic shape first. */
    variadicOnly?: boolean;
    direction?: string;
}

function selectionWithComposedRanges(
    start: [Node, number],
    end: [Node, number],
    opts: ComposedStubOpts = {},
): Selection {
    const [adjNode, adjOffset] = expressIn(start[0], start[1], []);
    const getComposedRanges = (...args: unknown[]): StaticRange[] => {
        let roots: ShadowRoot[] = [];
        const first = args[0];
        if (Array.isArray((first as { shadowRoots?: ShadowRoot[] })?.shadowRoots)) {
            if (opts.variadicOnly) throw new TypeError("expects shadow roots");
            roots = (first as { shadowRoots: ShadowRoot[] }).shadowRoots;
        } else {
            roots = args.filter(isShadowRoot) as ShadowRoot[];
        }
        const [sc, so] = expressIn(start[0], start[1], roots);
        const [ec, eo] = expressIn(end[0], end[1], roots);
        return [{
            startContainer: sc,
            startOffset: so,
            endContainer: ec,
            endOffset: eo,
            collapsed: sc === ec && so === eo,
        } as StaticRange];
    };
    return {
        anchorNode: adjNode,
        anchorOffset: adjOffset,
        focusNode: adjNode,
        focusOffset: adjOffset,
        rangeCount: 1,
        direction: opts.direction,
        getComposedRanges,
    } as unknown as Selection;
}

describe("deepSelection — getComposedRanges fallback", () => {
    it("reaches a nested root's own text node with no ShadowRoot.getSelection anywhere", () => {
        const { leafText } = buildNested();
        stubWindowSelection(selectionWithComposedRanges([leafText, 0], [leafText, 4]));
        const sel = deepSelection()!;
        // Two levels down: the roots list has to name BOTH or the answer stays
        // retargeted at the outer host.
        expect(sel.anchorNode).toBe(leafText);
        expect(sel.anchorOffset).toBe(0);
        expect(sel.focusNode).toBe(leafText);
        expect(sel.focusOffset).toBe(4);
        expect(sel.toString()).toBe("text");
        expect(sel.rangeCount).toBe(1);
        expect(sel.getRangeAt(0).startContainer).toBe(leafText);
    });

    it("retries with the variadic call shape when the options dict is refused", () => {
        const { leafText } = buildNested();
        stubWindowSelection(
            selectionWithComposedRanges([leafText, 0], [leafText, 4], { variadicOnly: true }),
        );
        expect(deepSelection()!.anchorNode).toBe(leafText);
    });

    it("swaps the ends for a backward drag so the pill anchors where it finished", () => {
        const { leafText } = buildNested();
        stubWindowSelection(
            selectionWithComposedRanges([leafText, 1], [leafText, 3], { direction: "backward" }),
        );
        const sel = deepSelection()!;
        expect(sel.anchorOffset).toBe(3);
        expect(sel.focusOffset).toBe(1);
    });

    it("keeps the window selection when the child under the anchor is a host by coincidence", () => {
        // The selection sits in the light DOM next to the component, so the
        // composed answer is the same position it started from.
        const { light } = buildNested();
        const sel = selectionWithComposedRanges([light, 0], [light, 1]);
        stubWindowSelection(sel);
        expect(deepSelection()).toBe(sel);
    });

    it("keeps the window selection for a selection that escapes the root", () => {
        // Start inside the component, end in the page: no single tree holds both
        // ends, so a Range cannot express it.
        const { light, leafText } = buildNested();
        const sel = selectionWithComposedRanges([leafText, 0], [light, 1]);
        stubWindowSelection(sel);
        expect(deepSelection()).toBe(sel);
    });

    it("prefers ShadowRoot.getSelection where it exists (Chrome keeps the live object)", () => {
        const { outerRoot, innerRoot, mid, leafText } = buildNested();
        const sel = selectionWithComposedRanges([leafText, 0], [leafText, 4]);
        stubWindowSelection(sel);
        stubRootSelection(outerRoot, fakeSelection(mid, 0));
        const real = fakeSelection(leafText, 2);
        stubRootSelection(innerRoot, real);
        expect(deepSelection()).toBe(real);
    });
});
