// @vitest-environment jsdom
//
// Unit tests for main/dom/segments.ts — the logical-paragraph segmentation
// that turns a container's direct children into TranslationUnits (maximal
// runs of inline content) delimited by block-level children and runs of
// >= SEGMENT_BR_SPLIT_MIN consecutive <br>s.
import { describe, it, expect, beforeEach } from "vitest";
import {
    segmentParagraph,
    isBlockBoundary,
    hasUntranslatedUnit,
} from "@/main/dom/segments";

beforeEach(() => {
    document.body.innerHTML = "";
});

/** Parse a fragment and return its first element child (connected to body). */
function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

describe("segmentParagraph — legacy whole-element compatibility", () => {
    it("plain paragraph → single wholeElement unit covering all childNodes", () => {
        const p = el("<p>Hello <b>world</b></p>");
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.descendChildren).toHaveLength(0);
        const unit = scan.units[0];
        expect(unit.wholeElement).toBe(true);
        expect(unit.translated).toBe(false);
        expect(unit.container).toBe(p);
        expect(unit.nodes).toEqual(Array.from(p.childNodes));
    });

    it("single <br> does not split — still one wholeElement unit", () => {
        const p = el("<p>line one<br>line two</p>");
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.units[0].nodes).toEqual(Array.from(p.childNodes));
    });

    it("comments stay in the run and do not qualify it by themselves", () => {
        const p = el("<p>text<!-- note --></p>");
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        const only = el("<p><!-- note --></p>");
        expect(segmentParagraph(only).units).toHaveLength(0);
    });
});

describe("segmentParagraph — block children split units", () => {
    it("div with leading text + <ul> → one unit (text) and descend into ul", () => {
        const div = el("<div>intro text<ul><li>a</li></ul></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(false);
        expect(scan.units[0].nodes).toEqual([div.firstChild]);
        expect(scan.descendChildren).toEqual([div.querySelector("ul")]);
    });

    it("text runs before and after a block child become two units", () => {
        const div = el("<div>before<p>mid</p>after</div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        expect(scan.units[0].nodes).toEqual([div.firstChild]);
        expect(scan.units[1].nodes).toEqual([div.lastChild]);
        expect(scan.descendChildren).toEqual([div.querySelector("p")]);
    });

    it("whitespace-only run between blocks is dropped, blocks descend", () => {
        const div = el("<div><ul><li>a</li></ul>   <p>b</p></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual([
            div.querySelector("ul"),
            div.querySelector("p"),
        ]);
    });

    it("inline element wrapping a block descendant acts as a boundary", () => {
        const div = el("<div>text<span><div>inner</div></span></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual([div.firstChild]);
        expect(scan.descendChildren).toEqual([div.querySelector("span")]);
    });

    it("inline-only run without direct text does not become a unit; descends into its elements", () => {
        const div = el("<div><span>a</span><span>b</span><ul><li>c</li></ul></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        const spans = Array.from(div.querySelectorAll("span"));
        expect(scan.descendChildren).toEqual([...spans, div.querySelector("ul")]);
    });
});

describe("segmentParagraph — <br> runs", () => {
    it("two consecutive <br>s split; the brs belong to no unit", () => {
        const div = el("<div>first para<br><br>second para</div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        expect(scan.units[0].wholeElement).toBe(false);
        expect(scan.units[0].nodes).toEqual([div.firstChild]);
        expect(scan.units[1].nodes).toEqual([div.lastChild]);
        for (const unit of scan.units) {
            for (const node of unit.nodes) {
                expect(node.nodeName).not.toBe("BR");
            }
        }
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("whitespace between the two <br>s still splits", () => {
        const div = el("<div>first<br> <br>second</div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        expect(scan.units[0].nodes).toEqual([div.firstChild]);
        expect(scan.units[1].nodes).toEqual([div.lastChild]);
    });

    it("a single <br> between texts stays inside the unit", () => {
        const div = el("<div>first<br>still first<br><br>second</div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        // First unit keeps its inner soft-break <br>.
        expect(scan.units[0].nodes.map((n) => n.nodeName)).toEqual(["#text", "BR", "#text"]);
        expect(scan.units[1].nodes).toEqual([div.lastChild]);
    });
});

describe("segmentParagraph — our own duo nodes on rescan", () => {
    it("a unit followed by .duo-divide + .duo-translation is reported translated, markers excluded", () => {
        const div = el(
            '<div>hello world<br class="duo-divide"><span class="duo-translation">你好世界</span></div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        const unit = scan.units[0];
        expect(unit.translated).toBe(true);
        expect(unit.wholeElement).toBe(false);
        expect(unit.nodes).toEqual([div.firstChild]);
    });

    it("mixed container: only the translated unit is flagged", () => {
        const div = el(
            '<div>one<br class="duo-divide"><span class="duo-translation">一</span><br><br>two</div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        expect(scan.units[0].translated).toBe(true);
        expect(scan.units[1].translated).toBe(false);
        expect(hasUntranslatedUnit(div)).toBe(true);
    });

    it("hasUntranslatedUnit is false when every unit is translated", () => {
        const div = el(
            '<div>one<br class="duo-divide"><span class="duo-translation">一</span></div>'
        );
        expect(hasUntranslatedUnit(div)).toBe(false);
    });
});

describe("isBlockBoundary — computed style first, static tag set fallback", () => {
    it("uses computed display for connected elements (CSS overrides tags)", () => {
        const inlineDiv = el('<div style="display:inline">x</div>');
        expect(isBlockBoundary(inlineDiv)).toBe(false);
        const blockSpan = el('<span style="display:block">x</span>');
        expect(isBlockBoundary(blockSpan)).toBe(true);
    });

    it("falls back to the static tag set for detached elements", () => {
        expect(isBlockBoundary(document.createElement("div"))).toBe(true);
        expect(isBlockBoundary(document.createElement("li"))).toBe(true);
        expect(isBlockBoundary(document.createElement("span"))).toBe(false);
        expect(isBlockBoundary(document.createElement("b"))).toBe(false);
    });

    it("CSS-inlined div inside a text container does not split the run", () => {
        const div = el('<div>before <div style="display:inline">chip</div> after</div>');
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
    });

    it("CSS-blockified span splits the run", () => {
        const div = el('<div>before<span style="display:block">block</span>after</div>');
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        expect(scan.descendChildren).toEqual([div.querySelector("span")]);
    });
});
