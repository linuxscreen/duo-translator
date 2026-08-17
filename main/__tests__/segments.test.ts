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
    isSegmentBoundary,
    isMergeableInline,
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

    it("inline-only run with >= 2 element nodes becomes ONE unit; blocks still descend", () => {
        const div = el("<div><span>a</span><span>b</span><ul><li>c</li></ul></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual(Array.from(div.querySelectorAll("span")));
        expect(scan.descendChildren).toEqual([div.querySelector("ul")]);
    });
});

describe("segmentParagraph — run qualification (text anywhere inside the run)", () => {
    it("a lone inline wrapper is unwrapped: descend instead of making a unit", () => {
        const div = el("<div><span>a b</span></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual([div.querySelector("span")]);
    });

    it("a lone inline wrapper is unwrapped even with surrounding whitespace/comments", () => {
        const div = el("<div>  <span>a b</span><!-- c --> </div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual([div.querySelector("span")]);
    });

    it("keeps the whole run — including the whitespace between inline elements", () => {
        const div = el("<div><b>a</b> <i>b</i></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual(Array.from(div.childNodes));
        expect(scan.units[0].wholeElement).toBe(true);
    });

    it("text inside excluded tags does not qualify a run", () => {
        const div = el("<div><code>foo()</code><code>bar()</code></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual(Array.from(div.querySelectorAll("code")));
    });

    it("text inside editable elements does not qualify a run", () => {
        // <textarea> rather than contentEditable: jsdom does not implement
        // `isContentEditable`, so only the instanceof branch of isEditable is
        // observable here.
        const div = el("<div><textarea>x</textarea><textarea>y</textarea></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual(Array.from(div.querySelectorAll("textarea")));
    });

    it("a run of inline elements holding no text at all is not a unit", () => {
        const div = el('<div><span> </span><i></i><img src="x"></div>');
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual([
            div.querySelector("span"),
            div.querySelector("i"),
            div.querySelector("img"),
        ]);
    });

    it("qualifies on text nested deeper inside the run's inline elements", () => {
        const div = el("<div><span><b>deep</b></span><span><i>text</i></span></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual(Array.from(div.childNodes));
    });

    it("merges a run of branching but all-inline, all-text elements", () => {
        const div = el("<div><a><span>a</span><span>b</span></a><a>c<span>d</span></a></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual(Array.from(div.childNodes));
    });

    it("does NOT merge a run holding an element with a nested block", () => {
        const div = el("<div><span>lead </span><a><span>a</span><div>b</div></a></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual([
            div.querySelector("span"),
            div.querySelector("a"),
        ]);
    });

    it("does NOT merge a run holding an inline-block element", () => {
        const div = el(
            '<div><span>lead </span><span style="display:inline-block">chip</span></div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual(Array.from(div.querySelectorAll(":scope > span")));
    });

    it("does NOT merge a run holding an <img> — a leaf that is not text", () => {
        const div = el('<div><span>Hello </span><img src="x"><span>world</span></div>');
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual([
            div.querySelector("span"),
            div.querySelector("img"),
            div.querySelector("span:last-of-type"),
        ]);
    });

    it("does NOT merge a run holding a text-less inline wrapper", () => {
        const div = el("<div><span>Hello </span><i></i><span>world</span></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
    });

    it("comments between run elements do not disqualify the merge", () => {
        const div = el("<div><span>Hello </span><!-- react --><span>world</span></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual(Array.from(div.childNodes));
    });

    it("a direct text node still carries the whole run, however rich its elements", () => {
        // Criterion 1 is untouched by the merge gate: this is one sentence, and
        // its serialization (and cache key) must stay byte-identical.
        const p = el("<p>Use <a>the <b>new</b> API</a> now</p>");
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("a highlight-wrapped unit stays one translated unit and is not descended into", () => {
        // What the DOM looks like after DOUBLE + sentence wrapping: the original
        // text nodes are emptied and their content lives in <duo-span>s.
        const div = el(
            '<div><duo-span duo-sequence="0">Hello world.</duo-span>' +
            '<span class="duo-divide">&nbsp;</span>' +
            '<span class="duo-translation">你好世界。</span></div>'
        );
        div.insertBefore(document.createTextNode(""), div.firstChild);
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].translated).toBe(true);
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("stays one translated unit when the duo-spans sit inside an inline child", () => {
        // Wrapping happens at each text node's own parent, so a paragraph like
        // `<div><b>One. Two.</b></div>` ends up with its spans nested in the <b>
        // — the lone-wrapper unwrap must not descend into it either.
        const div = el(
            '<div><b><duo-span duo-sequence="0">One.</duo-span>' +
            '<duo-span duo-sequence="1">Two.</duo-span></b>' +
            '<br class="duo-divide"><span class="duo-translation">一。二。</span></div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].translated).toBe(true);
        expect(scan.units[0].nodes).toEqual([div.querySelector("b")]);
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("CSS-blockified spans are still separate units, never merged into one run", () => {
        const div = el(
            '<div><span style="display:block">a</span><span style="display:block">b</span></div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toEqual(Array.from(div.querySelectorAll("span")));
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
    });

    it("a container whose only unit is translated has nothing left to do", () => {
        const div = el(
            '<div>one<br class="duo-divide"><span class="duo-translation">一</span></div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].translated).toBe(true);
    });
});

describe("segmentParagraph — the translating indicator is invisible", () => {
    // A <duo-loading> marker is inserted next to the unit it belongs to WHILE
    // that unit is being translated, so a re-scan during the request must land
    // on exactly the same segmentation it would have without one — including
    // the whole-element path, which is what keeps the translation-cache key of
    // a plain paragraph stable.
    it("does not split a run, join a unit or cost the whole-element path", () => {
        const p = el("<p>Hello <b>world</b><duo-loading></duo-loading></p>");
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.units[0].nodes.some((n) => (n as HTMLElement).tagName === "DUO-LOADING")).toBe(false);
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("mid-container marker does not cut the run in two", () => {
        const div = el("<div>one <duo-loading></duo-loading>two</div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toHaveLength(2);
    });

    it("a marker alone is not a unit and is not descended into", () => {
        const div = el("<div><duo-loading><span>x</span></duo-loading></div>");
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(0);
        expect(scan.descendChildren).toHaveLength(0);
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

    // display:contents generates no box at all, so the element itself is
    // neither block nor inline — what renders is its children.
    it("display:contents defers to what its children render as", () => {
        expect(isBlockBoundary(el('<div style="display:contents"><p>x</p></div>'))).toBe(true);
        expect(isBlockBoundary(el('<span style="display:contents">text only</span>'))).toBe(false);
        expect(isBlockBoundary(el('<span style="display:contents"><b>inline</b></span>'))).toBe(false);
        // CSS-blockified child: the tag set could never see this one.
        expect(
            isBlockBoundary(el('<span style="display:contents"><span style="display:block">x</span></span>'))
        ).toBe(true);
        // Chained transparent wrappers resolve through to the real box.
        expect(
            isBlockBoundary(el('<div style="display:contents"><div style="display:contents"><p>x</p></div></div>'))
        ).toBe(true);
        // Children that render nothing are not boxes either.
        expect(
            isBlockBoundary(el('<span style="display:contents"><div style="display:none">x</div></span>'))
        ).toBe(false);
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

describe("isMergeableInline — all-inline subtree, every leaf a non-blank text node", () => {
    it("accepts a plain inline element holding text", () => {
        expect(isMergeableInline(el("<span>text</span>"))).toBe(true);
        expect(isMergeableInline(el("<a>text</a>"))).toBe(true);
    });

    it("accepts nested and branching inline subtrees", () => {
        expect(isMergeableInline(el("<b><i><span>text</span></i></b>"))).toBe(true);
        expect(isMergeableInline(el("<a><span>a</span></a>"))).toBe(true);
        expect(isMergeableInline(el("<a>b<span>a</span></a>"))).toBe(true);
        expect(isMergeableInline(el("<a><span>a</span><span>b</span></a>"))).toBe(true);
    });

    it("skips blank text nodes and comments", () => {
        expect(isMergeableInline(el("<span> <b>text</b> </span>"))).toBe(true);
        expect(isMergeableInline(el("<span><!-- react --><b>text</b></span>"))).toBe(true);
    });

    it("rejects a subtree holding a non-inline box", () => {
        expect(isMergeableInline(el("<a><span>a</span><div>b</div></a>"))).toBe(false);
        expect(isMergeableInline(el("<a><p>text</p></a>"))).toBe(false);
        expect(
            isMergeableInline(el('<span><span style="display:inline-block">text</span></span>'))
        ).toBe(false);
        expect(isMergeableInline(el('<span style="display:block">text</span>'))).toBe(false);
        expect(isMergeableInline(el('<span style="display:contents">text</span>'))).toBe(false);
    });

    it("rejects a subtree whose leaf is not a text node", () => {
        expect(isMergeableInline(el('<a><span>a</span><img src="x"></a>'))).toBe(false);
        expect(isMergeableInline(el("<a>text<i></i></a>"))).toBe(false);
        expect(isMergeableInline(el("<a>text<br></a>"))).toBe(false);
    });

    it("rejects an element with nothing to translate", () => {
        expect(isMergeableInline(el("<span> </span>"))).toBe(false);
        expect(isMergeableInline(el("<span></span>"))).toBe(false);
    });

    it("rejects excluded tags and editable subtrees even when they hold text", () => {
        expect(isMergeableInline(el("<code>foo()</code>"))).toBe(false);
        expect(isMergeableInline(el("<span><code>foo()</code></span>"))).toBe(false);
        expect(isMergeableInline(el("<span><textarea>x</textarea></span>"))).toBe(false);
    });

    it("falls back to the static tag set for detached elements", () => {
        const span = document.createElement("span");
        span.textContent = "text";
        expect(isMergeableInline(span)).toBe(true);
        const div = document.createElement("div");
        div.textContent = "text";
        expect(isMergeableInline(div)).toBe(false);
    });
});

describe("isSegmentBoundary — tag-level probe gated by a computed-style recheck", () => {
    it("is true for an element that is itself a block box", () => {
        expect(isSegmentBoundary(el("<p>x</p>"))).toBe(true);
        expect(isSegmentBoundary(el('<span style="display:block">x</span>'))).toBe(true);
    });

    it("is false for a plain inline element with no block-tagged descendant", () => {
        expect(isSegmentBoundary(el("<span>x <b>y</b></span>"))).toBe(false);
    });

    it("is true for an inline element wrapping a real block descendant", () => {
        expect(isSegmentBoundary(el("<span>x <div>block</div></span>"))).toBe(true);
    });

    it("is FALSE when every block-tagged descendant is CSS-inlined", () => {
        // The tag-level probe hits the inner <div>, but it renders inline, so
        // the span is inline content — splitting here would cut a sentence.
        const span = el('<span>x <div style="display:inline">chip</div> y</span>');
        expect(isSegmentBoundary(span)).toBe(false);
    });

    it("checks every candidate, not a capped sample", () => {
        const chips = Array.from({ length: 12 }, () => '<div style="display:inline">c</div>').join("");
        const span = el(`<span>${chips}<p>real block</p></span>`);
        expect(isSegmentBoundary(span)).toBe(true);
    });

    it("ignores block descendants inside non-rendering / opaque subtrees", () => {
        const span = el("<span>x</span>");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const inner = document.createElement("div");
        inner.textContent = "in svg";
        svg.appendChild(inner);
        span.appendChild(svg);
        expect(span.querySelector("div")).toBe(inner); // the tag probe does hit it
        expect(isSegmentBoundary(span)).toBe(false);
    });

    it("falls back to the static tag set for detached elements", () => {
        const span = document.createElement("span");
        span.appendChild(document.createElement("div"));
        expect(isSegmentBoundary(span)).toBe(true);
        expect(isSegmentBoundary(document.createElement("span"))).toBe(false);
    });

    it("a transparent display:contents wrapper splits the run like its children do", () => {
        const div = el(
            '<div>intro <span style="display:contents"><span style="display:block">Block</span></span> tail</div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(2);
        expect(scan.descendChildren).toEqual([div.querySelector("span")]);
    });

    it("a transparent display:contents wrapper of inline content stays in the run", () => {
        const div = el('<div>intro <span style="display:contents"><b>mid</b></span> tail</div>');
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("a run is not split by an inline wrapper whose blocks are all CSS-inlined", () => {
        const div = el(
            '<div>before <span>mid <div style="display:inline">chip</div></span> after</div>'
        );
        const scan = segmentParagraph(div);
        expect(scan.units).toHaveLength(1);
        expect(scan.descendChildren).toHaveLength(0);
    });
});

describe("atomic inline-level elements are boundaries", () => {
    // A <button> renders as an atomic box carrying a label that has nothing to
    // do with the surrounding sentence. Merging it into the run makes it share
    // the paragraph's fate: it is never translated on its own, and in DOUBLE it
    // gets cloned into the translation (duplicate id, inert copy).
    it("a trailing button leaves the run and becomes its own container", () => {
        const p = el("<p>This paragraph has an action.<button>Copy</button></p>");
        const scan = segmentParagraph(p);
        expect(scan.descendChildren).toEqual([p.querySelector("button")]);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual([p.firstChild]);
    });

    it("a detached button is still atomic — the tag list carries it", () => {
        // No computed style available, so the display allowlist cannot answer.
        const detached = document.createElement("button");
        detached.textContent = "Copy";
        expect(isSegmentBoundary(detached)).toBe(true);
    });

    it("splits the sentence when the button sits mid-run — the accepted cost", () => {
        // Documented trade-off, not an oversight: distinguishing "trailing" from
        // "mid-sentence" was evaluated and rejected as not worth the machinery.
        // Inline links are <a> (display:inline) and are unaffected.
        const p = el("<p>Click <button>here</button> to continue.</p>");
        const scan = segmentParagraph(p);
        expect(scan.descendChildren).toEqual([p.querySelector("button")]);
        expect(scan.units).toHaveLength(2);
    });

    it("a text-free inline-block icon stays in the run", () => {
        // The `hasTranslatableText` term of the predicate. Icon components are
        // everywhere mid-sentence; pulling one out would cut the sentence in
        // half for no gain — it has nothing to translate.
        const p = el('<p>Press the <i style="display:inline-block"></i> button.</p>');
        const scan = segmentParagraph(p);
        expect(scan.descendChildren).toEqual([]);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
    });

    it("an excluded tag stays in the run even when it is an atomic box", () => {
        const p = el('<p>Run <code style="display:inline-block">npm i</code> first.</p>');
        expect(segmentParagraph(p).descendChildren).toEqual([]);
        expect(segmentParagraph(p).units).toHaveLength(1);
    });

    it("editable controls stay in the run — the scan skips them anyway", () => {
        // An enabled <select>/<textarea> is never translated (markParagraphElement
        // bails on isEditable), so making it a boundary would only remove its
        // text from the sentence without gaining anything.
        expect(segmentParagraph(el("<p>Type <textarea>draft</textarea> here.</p>")).descendChildren).toEqual([]);
        expect(segmentParagraph(el("<p>Pick <select><option>one</option></select> now.</p>")).descendChildren).toEqual([]);
    });

    it("display:contents and display:none wrappers are not atomic", () => {
        // `display:contents` generates no box of its own — isBlockBoundary
        // already answers for what its children render as. `display:none` is a
        // collapsed region, not an atomic box.
        const p = el(
            '<p>a <span style="display:contents">b</span> c ' +
            '<span style="display:none">hidden</span> d</p>'
        );
        const scan = segmentParagraph(p);
        expect(scan.descendChildren).toEqual([]);
        expect(scan.units).toHaveLength(1);
    });

    it("isSegmentBoundary is the single predicate that answers for atomics", () => {
        const p = el('<p><button>Copy</button><i style="display:inline-block"></i><a href="#">link</a></p>');
        expect(isSegmentBoundary(p.querySelector("button")!)).toBe(true);
        expect(isSegmentBoundary(p.querySelector("i")!)).toBe(false);
        expect(isSegmentBoundary(p.querySelector("a")!)).toBe(false);
    });
});
