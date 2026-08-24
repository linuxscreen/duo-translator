// @vitest-environment jsdom
//
// Unit tests for the pure/mixed paragraph-mark model in
// main/dom/paragraphMarks.ts. A *mixed* mark (container with inline-run units
// AND descendant marks under its block children) may nest; a *pure* mark
// never contains other marks.
import { describe, it, expect, beforeEach } from "vitest";
import {
    anyParagraphUnder,
    markParagraph,
    isParagraph,
    isMixedParagraph,
    closestParagraph,
    sweepDetachedParagraphMarks,
    clearParagraphMarks,
    paragraphsUnder,
} from "@/main/dom/paragraphMarks";

beforeEach(() => {
    clearParagraphMarks();
    document.body.innerHTML = "";
});

function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

describe("markParagraph — mixed flag", () => {
    it("defaults to a pure mark when the third argument is omitted", () => {
        const p = el("<p>x</p>");
        markParagraph(p, true);
        expect(isParagraph(p)).toBe(true);
        expect(isMixedParagraph(p)).toBe(false);
    });

    it("records a mixed mark when asked", () => {
        const div = el("<div>x<ul><li>y</li></ul></div>");
        markParagraph(div, true, true);
        expect(isParagraph(div)).toBe(true);
        expect(isMixedParagraph(div)).toBe(true);
    });

    it("isMixedParagraph is false for unmarked elements", () => {
        expect(isMixedParagraph(el("<p>x</p>"))).toBe(false);
    });
});

describe("sweepDetachedParagraphMarks", () => {
    it("drops a removed mark and leaves its still-attached siblings alone", () => {
        const wrap = el("<div><p>a</p><p>b</p></div>");
        const [a, b] = Array.from(wrap.children) as HTMLElement[];
        markParagraph(a, true);
        markParagraph(b, true);
        a.remove();
        sweepDetachedParagraphMarks();
        expect(isParagraph(a)).toBe(false);
        expect(isParagraph(b)).toBe(true);
    });

    // The pure/mixed distinction used to decide whether the cleanup had to look
    // underneath the removed node. isConnected is answered per entry, so
    // nesting no longer enters into it at all.
    it("sweeps marks nested under a removed container, pure or mixed", () => {
        const div = el("<div>intro<ul><li>item</li></ul></div>");
        const li = div.querySelector("li") as HTMLElement;
        markParagraph(div, true, true);
        markParagraph(li, true);
        div.remove();
        sweepDetachedParagraphMarks();
        expect(isParagraph(div)).toBe(false);
        expect(isParagraph(li)).toBe(false);
    });

    it("sweeps marks under a removed ancestor that was never marked itself", () => {
        const wrap = el("<div><section><p>a</p></section></div>");
        const p = wrap.querySelector("p") as HTMLElement;
        markParagraph(p, true);
        (wrap.querySelector("section") as HTMLElement).remove();
        sweepDetachedParagraphMarks();
        expect(isParagraph(p)).toBe(false);
    });

    // The one deliberate behaviour change: the old per-removed-node cleanup ran
    // from the MutationObserver and dropped the mark before the page could put
    // the node back. A sweep asks isConnected, so a reparent keeps its records.
    it("keeps the mark of a node the page removed and re-inserted", () => {
        const wrap = el("<div><p>a</p><aside></aside></div>");
        const p = wrap.querySelector("p") as HTMLElement;
        markParagraph(p, true);
        (wrap.querySelector("aside") as HTMLElement).append(p);
        sweepDetachedParagraphMarks();
        expect(isParagraph(p)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Shadow DOM
// ---------------------------------------------------------------------------
describe("across shadow boundaries", () => {
    /** `<section id=light><div id=host>` + shadow `<p id=leaf>` */
    function build() {
        document.body.innerHTML = "<section id='light'><div id='host'></div></section>";
        const light = document.getElementById("light")!;
        const host = document.getElementById("host")!;
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = "<p id='leaf'>text</p>";
        return { light, host, root, leaf: root.getElementById("leaf")! as HTMLElement };
    }

    it("closestParagraph reaches a light-DOM ancestor from inside a root", () => {
        const { light, leaf } = build();
        markParagraph(light as HTMLElement, true, true);
        expect(closestParagraph(leaf)).toBe(light);
    });

    it("a ShadowRoot can itself be the marked container", () => {
        const { root, leaf } = build();
        markParagraph(root, true);
        expect(isParagraph(root)).toBe(true);
        expect(closestParagraph(leaf)).toBe(root);
    });

    it("paragraphsUnder finds marks inside a host's shadow tree", () => {
        const { host, leaf } = build();
        markParagraph(leaf, true);
        // Native contains cannot see it — that is the defect being fixed.
        expect(host.contains(leaf)).toBe(false);
        expect(paragraphsUnder(host)).toEqual([leaf]);
        expect(anyParagraphUnder(host)).toBe(true);
    });

    it("sweeping a removed host also drops its shadow marks", () => {
        const { host, root, leaf } = build();
        markParagraph(host as HTMLElement, true, true);
        markParagraph(root, true);
        markParagraph(leaf, true);

        host.remove();
        // isConnected is false for a ShadowRoot and everything in it once the
        // host leaves the document — which is what makes the flat sweep able to
        // answer for shadow trees at all.
        sweepDetachedParagraphMarks();

        expect(isParagraph(host)).toBe(false);
        expect(isParagraph(root)).toBe(false);
        expect(isParagraph(leaf)).toBe(false);
    });
});
