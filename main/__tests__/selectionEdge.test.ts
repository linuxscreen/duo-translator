// @vitest-environment jsdom
//
import { describe, expect, it } from "vitest";
import { isVisiblySelectedText, visibleSelectionEdge } from "@/main/dom/selectionEdge";

/**
 * jsdom has no layout — every rect is 0x0 — so the geometry half of this module
 * is e2e/manual territory (.dev/selection-icon-repro.html). What IS testable
 * here is the filter that decides which text counts as "visibly selected", and
 * that the whole thing degrades to null instead of throwing when it cannot
 * measure anything.
 */

function mount(html: string): HTMLElement {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
}

const textIn = (el: Element): Text => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node) throw new Error("no text node in " + el.outerHTML);
    return node as Text;
};

describe("isVisiblySelectedText", () => {
    it("keeps ordinary in-flow text", () => {
        const host = mount(`<p>plain sentence</p>`);
        expect(isVisiblySelectedText(textIn(host), host)).toBe(true);
    });

    it("rejects text the engine refuses to select", () => {
        const host = mount(`<p>text<button style="user-select:none">Reset Password</button></p>`);
        const btn = host.querySelector("button")!;
        expect(isVisiblySelectedText(textIn(btn), host)).toBe(false);
    });

    it("rejects text under a user-select:none ancestor", () => {
        const host = mount(`<div style="user-select:none"><span><b>deep</b></span></div>`);
        expect(isVisiblySelectedText(textIn(host), host)).toBe(false);
    });

    it("rejects a floated island inside the selection", () => {
        const host = mount(`<p>other<span id="fl" style="float:right">SPONSORED</span></p>`);
        expect(isVisiblySelectedText(textIn(host.querySelector("#fl")!), host)).toBe(false);
    });

    it("keeps a floated box that CONTAINS the whole selection", () => {
        // A selection made entirely inside a pull quote still has to be
        // measurable — the rule is about islands within a selection, not about
        // where the selection as a whole lives.
        const host = mount(`<aside id="quote" style="float:right">pulled text</aside>`);
        const quote = host.querySelector("#quote")!;
        expect(isVisiblySelectedText(textIn(quote), quote)).toBe(true);
        // ...and the text node itself being the common ancestor works the same.
        expect(isVisiblySelectedText(textIn(quote), textIn(quote))).toBe(true);
    });

    it("keeps absolutely positioned text — a deliberate no-fix, see §B2", () => {
        // It really is selected and really is visible, so the pill pointing at
        // it is surprising at worst. Pinned so the rule is not "tidied" into
        // symmetry with the float one.
        const host = mount(`<p>sentence<span id="abs" style="position:absolute">NEW</span></p>`);
        expect(isVisiblySelectedText(textIn(host.querySelector("#abs")!), host)).toBe(true);
    });

    it("rejects a detached text node rather than throwing", () => {
        const orphan = document.createTextNode("nowhere");
        expect(isVisiblySelectedText(orphan, document.body)).toBe(false);
    });
});

describe("visibleSelectionEdge", () => {
    it("returns null when nothing can be measured, in both directions", () => {
        const host = mount(`<p>a sentence to select</p>`);
        const range = document.createRange();
        range.selectNodeContents(host.querySelector("p")!);
        // jsdom: every rect is 0x0, so this is the degrade-to-null path.
        expect(visibleSelectionEdge(range, false)).toBeNull();
        expect(visibleSelectionEdge(range, true)).toBeNull();
    });

    it("survives a collapsed range and an element-boundary range", () => {
        const host = mount(`<div><p>one</p><p>two</p></div>`);
        const collapsed = document.createRange();
        collapsed.setStart(textIn(host), 1);
        collapsed.collapse(true);
        expect(visibleSelectionEdge(collapsed, false)).toBeNull();

        const boundary = document.createRange();
        const div = host.firstElementChild!;
        boundary.setStart(div, 0);
        boundary.setEnd(div, div.childNodes.length);
        expect(visibleSelectionEdge(boundary, false)).toBeNull();
    });

    it("survives a detached range", () => {
        const orphan = document.createElement("p");
        orphan.textContent = "detached";
        const range = document.createRange();
        range.selectNodeContents(orphan);
        expect(visibleSelectionEdge(range, false)).toBeNull();
    });
});
