// @vitest-environment jsdom
//
// Segmentation across shadow boundaries — main/dom/segments.ts.
//
// jsdom limits that shape these tests: stylesheets INSIDE a shadow root do not
// cascade into getComputedStyle (only inline styles and UA defaults resolve),
// and there is no layout at all. So `display` is driven through inline styles
// and tag defaults; CSS-blockification inside a root belongs to e2e.
import { describe, it, expect, beforeEach } from "vitest";
import {
    isBlockBoundary,
    isMergeableInline,
    isSegmentBoundary,
    segmentParagraph,
} from "@/main/dom/segments";
import { hasTranslatableText } from "@/main/dom/textNodes";
import { attachOwnShadow, resetShadowRoots } from "@/main/dom/shadowRoots";

beforeEach(() => {
    resetShadowRoots();
    document.body.innerHTML = "";
});

/** Give `el` a page-owned shadow root containing `html`. */
function shadow(el: Element, html: string): ShadowRoot {
    const root = el.attachShadow({ mode: "open" });
    root.innerHTML = html;
    return root;
}

function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

// ---------------------------------------------------------------------------
// hasTranslatableText over a root
// ---------------------------------------------------------------------------
describe("hasTranslatableText", () => {
    it("accepts a ShadowRoot (a DocumentFragment) as its argument", () => {
        const host = el("<div></div>");
        const root = shadow(host, "<p>Shadow paragraph.</p>");
        expect(hasTranslatableText(root)).toBe(true);
    });

    it("is false for a root with no text of its own", () => {
        const host = el("<div></div>");
        expect(hasTranslatableText(shadow(host, "<style>p{color:red}</style><slot></slot>"))).toBe(false);
    });

    it("sees text a nested component renders", () => {
        const host = el("<div></div>");
        const root = shadow(host, "<x-inner></x-inner>");
        shadow(root.querySelector("x-inner")!, "<span>Nested text.</span>");
        expect(hasTranslatableText(root)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Boundary classification
// ---------------------------------------------------------------------------
describe("shadow hosts as segment boundaries", () => {
    it("a text-bearing host is a boundary and lands in descendChildren", () => {
        const wrap = el("<div>Intro <x-card></x-card></div>");
        shadow(wrap.querySelector("x-card")!, "<p>Card body text.</p>");

        expect(isSegmentBoundary(wrap.querySelector("x-card") as HTMLElement)).toBe(true);
        const scan = segmentParagraph(wrap);
        expect(scan.descendChildren).toEqual([wrap.querySelector("x-card")]);
    });

    it("an inline icon component stays part of the sentence (byte-compat pin)", () => {
        // The regression this guards: treating "the root has text" as the gate
        // would make an icon a boundary — `★` is text — cutting
        // "Click … to continue." into two units, translating each half alone,
        // injecting a translation inside the icon, and changing the
        // whole-element serialization the translation cache is keyed on.
        const p = el("<p>Click <x-icon></x-icon> to continue.</p>");
        shadow(p.querySelector("x-icon")!, "<span>★</span>");

        expect(isSegmentBoundary(p.querySelector("x-icon") as HTMLElement)).toBe(false);
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.units[0].nodes).toEqual(Array.from(p.childNodes));
        expect(scan.descendChildren).toEqual([]);
    });

    it("a pure <slot> wrapper contributes nothing — its light child is the unit", () => {
        // The slotted <p> renders through the slot but LIVES in the light DOM,
        // so it is translated exactly once, in its light-DOM home, with no code
        // of our own. Nothing must be emitted for the shadow side.
        const wrap = el("<my-wrap><p>Slotted paragraph.</p></my-wrap>");
        shadow(wrap, "<slot></slot>");

        const scan = segmentParagraph(wrap);
        expect(scan.units).toEqual([]);
        expect(scan.descendChildren).toEqual([wrap.querySelector("p")]);
    });

    it("our own UI host is never a translatable shadow host", () => {
        // The registry hides it, so the scan can neither descend into it nor
        // treat it as page structure.
        const wrap = el("<div>text <span id='ui'></span></div>");
        const ui = wrap.querySelector("#ui") as HTMLElement;
        attachOwnShadow(ui).innerHTML = "<div><button>Translate</button></div>";

        expect(isSegmentBoundary(ui)).toBe(false);
        expect(segmentParagraph(wrap).descendChildren).toEqual([]);
    });

    it("a text-bearing host is never merged into a run", () => {
        const wrap = el("<div><x-a></x-a><x-b></x-b></div>");
        const a = wrap.querySelector("x-a") as HTMLElement;
        shadow(a, "<span>Component text.</span>");

        expect(isMergeableInline(a)).toBe(false);
    });

    it("an empty host is still rejected from merging, as before", () => {
        const wrap = el("<div><x-icon></x-icon></div>");
        const icon = wrap.querySelector("x-icon") as HTMLElement;
        expect(isMergeableInline(icon)).toBe(false);
    });
});

describe("isBlockBoundary with display:contents", () => {
    it("answers for the SHADOW children of a transparent host", () => {
        // The host generates no box, so what renders in its place is its root's
        // content — not `el.children`, which is empty here.
        const host = el('<div style="display:contents"></div>');
        shadow(host, "<div>block content</div>");
        expect(isBlockBoundary(host)).toBe(true);
    });

    it("stays non-block when the shadow content is inline", () => {
        const host = el('<div style="display:contents"></div>');
        shadow(host, "<span>inline content</span>");
        expect(isBlockBoundary(host)).toBe(false);
    });

    it("a <slot> answers for its ASSIGNED nodes, not its fallback", () => {
        const wrap = el("<my-wrap><p>assigned block</p></my-wrap>");
        const root = shadow(wrap, "<slot><span>fallback inline</span></slot>");
        const slot = root.querySelector("slot") as HTMLElement;
        expect(isBlockBoundary(slot)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// A ShadowRoot as a first-class container
// ---------------------------------------------------------------------------
describe("segmentParagraph over a ShadowRoot", () => {
    it("splits the root's own children into units", () => {
        const host = el("<div></div>");
        const root = shadow(host, "before<p>mid</p>after");

        const scan = segmentParagraph(root);
        expect(scan.units).toHaveLength(2);
        expect(scan.units[0].container).toBe(root);
        expect(scan.units[0].nodes).toEqual([root.firstChild]);
        expect(scan.descendChildren).toEqual([root.querySelector("p")]);
    });

    it("takes the whole-element path for a single plain run", () => {
        const host = el("<div></div>");
        const root = shadow(host, "Just one sentence.");

        const scan = segmentParagraph(root);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.units[0].nodes).toEqual(Array.from(root.childNodes));
    });

    it("merges a run of inline children directly under the root into ONE unit", () => {
        const host = el("<div></div>");
        const root = shadow(host, "<span>Hello </span><span>world</span>");

        const scan = segmentParagraph(root);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].nodes).toEqual(Array.from(root.childNodes));
        expect(scan.descendChildren).toEqual([]);
    });

    it("reports an untranslated unit, and stops once a translation is adjacent", () => {
        const host = el("<div></div>");
        const root = shadow(host, "Some text.");
        expect(segmentParagraph(root).units[0].translated).toBe(false);

        const translation = document.createElement("div");
        translation.className = "duo-translation";
        root.appendChild(translation);
        expect(segmentParagraph(root).units[0].translated).toBe(true);
    });
});
