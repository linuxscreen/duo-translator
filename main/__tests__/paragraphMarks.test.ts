// @vitest-environment jsdom
//
// Unit tests for the pure/mixed paragraph-mark model in
// main/dom/paragraphMarks.ts. A *mixed* mark (container with inline-run units
// AND descendant marks under its block children) may nest; a *pure* mark
// never contains other marks.
import { describe, it, expect, beforeEach } from "vitest";
import {
    markParagraph,
    isParagraph,
    isMixedParagraph,
    cleanupParagraphMarks,
    clearParagraphMarks,
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

describe("cleanupParagraphMarks — nesting-aware", () => {
    it("removing a pure mark leaves sibling marks intact", () => {
        const wrap = el("<div><p>a</p><p>b</p></div>");
        const [a, b] = Array.from(wrap.children) as HTMLElement[];
        markParagraph(a, true);
        markParagraph(b, true);
        cleanupParagraphMarks(a);
        expect(isParagraph(a)).toBe(false);
        expect(isParagraph(b)).toBe(true);
    });

    it("removing a mixed mark also sweeps marks nested under it", () => {
        const div = el("<div>intro<ul><li>item</li></ul></div>");
        const li = div.querySelector("li") as HTMLElement;
        markParagraph(div, true, true);
        markParagraph(li, true);
        cleanupParagraphMarks(div);
        expect(isParagraph(div)).toBe(false);
        expect(isParagraph(li)).toBe(false);
    });

    it("removing an unmarked ancestor still sweeps marks under it", () => {
        const wrap = el("<div><section><p>a</p></section></div>");
        const p = wrap.querySelector("p") as HTMLElement;
        markParagraph(p, true);
        cleanupParagraphMarks(wrap.querySelector("section") as HTMLElement);
        expect(isParagraph(p)).toBe(false);
    });
});
