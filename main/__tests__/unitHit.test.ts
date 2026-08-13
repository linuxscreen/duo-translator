// @vitest-environment jsdom
//
// Unit tests for main/dom/unitHit.ts — resolving "which translation unit is the
// pointer over?" inside a container that holds several units.
//
// Only the DOM-identity half is testable here: jsdom has no layout, so
// getClientRects() is always empty and the geometric fallback is covered by the
// pure rect predicate (isPointOverRects) plus e2e.
import { describe, it, expect, beforeEach } from "vitest";
import { segmentParagraph } from "@/main/dom/segments";
import {
    directChildOf,
    isPointOverRects,
    nodesInRange,
    rangeContains,
    unitRangeOf,
} from "@/main/dom/unitHit";

beforeEach(() => {
    document.body.innerHTML = "";
});

function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

function rect(top: number, bottom: number, left = 0, right = 100): DOMRect {
    return { top, bottom, left, right, width: right - left, height: bottom - top } as DOMRect;
}

describe("directChildOf", () => {
    it("walks up to the node whose parent is the container", () => {
        const div = el("<div>text <span>a <b>deep</b></span></div>");
        const span = div.querySelector("span")!;
        const b = div.querySelector("b")!;
        expect(directChildOf(b, div)).toBe(span);
        expect(directChildOf(b.firstChild!, div)).toBe(span);
        expect(directChildOf(span, div)).toBe(span);
    });

    it("returns null for the container itself and for outside nodes", () => {
        const div = el("<div>text</div>");
        expect(directChildOf(div, div)).toBeNull();
        expect(directChildOf(document.body, div)).toBeNull();
    });
});

describe("unitRangeOf", () => {
    it("captures the exclusive siblings around the unit", () => {
        const div = el("<div>before<p>mid</p>after</div>");
        const [first, second] = segmentParagraph(div).units;
        expect(unitRangeOf(first)).toEqual({ start: null, end: div.querySelector("p") });
        expect(unitRangeOf(second)).toEqual({ start: div.querySelector("p"), end: null });
    });

    it("is a whole-container range for a single-unit container", () => {
        const p = el("<p>Hello <b>world</b></p>");
        const unit = segmentParagraph(p).units[0];
        expect(unitRangeOf(unit)).toEqual({ start: null, end: null });
    });

    it("skips nodes the page already detached at either edge", () => {
        const div = el("<div>a<b>keep</b>c<p>block</p></div>");
        const unit = segmentParagraph(div).units[0];
        const nodes = unit.nodes;
        // Drop the run's first and last nodes: the anchors must be derived from
        // the outermost nodes still attached to the container.
        nodes[0].remove();
        nodes[nodes.length - 1].remove();
        expect(unitRangeOf(unit)).toEqual({ start: null, end: div.querySelector("p") });
    });
});

describe("nodesInRange / rangeContains", () => {
    it("lists the live children between the exclusive anchors", () => {
        const div = el("<div>before<p>mid</p>after</div>");
        const p = div.querySelector("p")!;
        expect(nodesInRange(div, { start: null, end: p })).toEqual([div.firstChild]);
        expect(nodesInRange(div, { start: p, end: null })).toEqual([div.lastChild]);
        expect(nodesInRange(div, { start: null, end: null })).toEqual(Array.from(div.childNodes));
    });

    it("sees nodes inserted into the range after it was captured", () => {
        const div = el("<div>before<p>mid</p>after</div>");
        const p = div.querySelector("p")!;
        const range = { start: null, end: p };
        const translation = document.createElement("span");
        div.insertBefore(translation, p);
        expect(nodesInRange(div, range)).toEqual([div.firstChild, translation]);
        expect(rangeContains(div, range, translation)).toBe(true);
    });

    it("rangeContains is false for a node in a sibling unit", () => {
        const div = el("<div>before<p>mid</p>after</div>");
        const p = div.querySelector("p")!;
        expect(rangeContains(div, { start: null, end: p }, div.lastChild!)).toBe(false);
        expect(rangeContains(div, { start: p, end: null }, div.lastChild!)).toBe(true);
        // The delimiting block itself belongs to neither unit.
        expect(rangeContains(div, { start: null, end: p }, p)).toBe(false);
        expect(rangeContains(div, { start: p, end: null }, p)).toBe(false);
    });

    it("degrades to the whole container when an anchor was detached", () => {
        const div = el("<div>before<p>mid</p>after</div>");
        const p = div.querySelector("p")!;
        const range = { start: null, end: p };
        p.remove();
        expect(nodesInRange(div, range)).toEqual(Array.from(div.childNodes));
    });
});

describe("isPointOverRects", () => {
    const line1 = rect(10, 30);
    const line2 = rect(40, 60);

    it("is true directly on a line box", () => {
        expect(isPointOverRects(50, 20, [line1, line2])).toBe(true);
        expect(isPointOverRects(50, 45, [line1, line2])).toBe(true);
    });

    it("is true in the leading between two lines", () => {
        expect(isPointOverRects(50, 35, [line1, line2])).toBe(true);
    });

    it("is false above/below the block (outer padding)", () => {
        expect(isPointOverRects(50, 5, [line1, line2])).toBe(false);
        expect(isPointOverRects(50, 70, [line1, line2])).toBe(false);
    });

    it("is false past the end of a short line at that x", () => {
        expect(isPointOverRects(150, 20, [line1, line2])).toBe(false);
    });

    it("is false with no rects at all", () => {
        expect(isPointOverRects(10, 10, [])).toBe(false);
    });

    it("ignores zero-sized rects", () => {
        expect(isPointOverRects(50, 20, [rect(10, 10, 0, 0), line1])).toBe(true);
        expect(isPointOverRects(50, 35, [rect(10, 10, 0, 0)])).toBe(false);
    });
});

describe("with a ShadowRoot container", () => {
    // Pure type widening in the source — these pin that the helpers really do
    // only use the container as "the parent node", so a root works unchanged.
    function root(html: string): ShadowRoot {
        document.body.innerHTML = "<div id='h'></div>";
        const r = document.getElementById("h")!.attachShadow({ mode: "open" });
        r.innerHTML = html;
        return r;
    }

    it("directChildOf resolves a node to the root's own child", () => {
        const r = root("<span><b id='deep'>x</b></span>");
        const deep = r.getElementById("deep")!;
        expect(directChildOf(deep, r)).toBe(r.firstChild);
    });

    it("unitRangeOf / nodesInRange / rangeContains work off the root", () => {
        const r = root("a<hr>b");
        const [first, hr, last] = Array.from(r.childNodes);
        const range = unitRangeOf({ container: r, nodes: [last], wholeElement: false, translated: false });

        expect(range).toEqual({ start: hr, end: null });
        expect(nodesInRange(r, range)).toEqual([last]);
        expect(rangeContains(r, range, last as ChildNode)).toBe(true);
        expect(rangeContains(r, range, first as ChildNode)).toBe(false);
    });
});

describe("the translating indicator is stepped over", () => {
    // The marker is inserted right after the unit it belongs to while the
    // request is in flight. A unit's anchors ARE its identity (a DuoUnitRecord
    // stores them, revalidateUnitTarget matches on them), so they must be the
    // same whether or not a marker happens to be showing — otherwise every
    // anchor captured during a translation would dissolve when it is removed.
    it("unitRangeOf gives the same anchors with and without a marker", () => {
        const div = el("<div>one<br><br>two</div>");
        const before = segmentParagraph(div).units.map(unitRangeOf);

        const marker = document.createElement("duo-loading");
        div.insertBefore(marker, div.childNodes[1]);
        const after = segmentParagraph(div).units.map(unitRangeOf);

        expect(after).toHaveLength(before.length);
        after.forEach((range, i) => {
            expect(range.start).toBe(before[i].start);
            expect(range.end).toBe(before[i].end);
        });
    });

    it("nodesInRange leaves the marker out of the unit's content", () => {
        const div = el("<div>one<br><br>two</div>");
        const marker = document.createElement("duo-loading");
        div.appendChild(marker);
        const units = segmentParagraph(div).units;
        const last = units[units.length - 1];
        expect(nodesInRange(div, unitRangeOf(last))).not.toContain(marker);
    });
});
