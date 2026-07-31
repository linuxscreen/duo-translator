// @vitest-environment jsdom
//
// Tests for main/dom/sentenceHighlight.ts — the sentence → Range mapping that
// replaced the <duo-span> wrapping. Only the mapping is covered here: painting
// (CSS.highlights) and hit-testing (getClientRects) need a real layout engine,
// so they are e2e's job. What matters is that a range covers exactly its
// sentence's characters, wherever the text-node boundaries happen to fall — and
// that the DOM is left untouched.
import { describe, it, expect, beforeEach } from "vitest";

import { buildSentenceRanges } from "@/main/dom/sentenceHighlight";

beforeEach(() => {
    document.body.innerHTML = "";
});

/** All text nodes of the subtree, in document order. */
function textNodesOf(root: Node): Text[] {
    const out: Text[] = [];
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) out.push(node as Text);
        node.childNodes.forEach(walk);
    };
    walk(root);
    return out;
}

describe("buildSentenceRanges", () => {
    it("splits one text node into per-sentence ranges without touching the DOM", () => {
        document.body.innerHTML = "<p>Hello world. Nice to meet you.</p>";
        const p = document.body.querySelector("p")!;
        const before = p.innerHTML;

        const ranges = buildSentenceRanges(textNodesOf(p), ["Hello world. ", "Nice to meet you."]);

        expect(ranges.map((r) => r.toString())).toEqual(["Hello world. ", "Nice to meet you."]);
        // The whole point: the page's markup is exactly as it was.
        expect(p.innerHTML).toBe(before);
        expect(p.childNodes).toHaveLength(1);
    });

    it("spans a sentence across text nodes separated by an inline element", () => {
        document.body.innerHTML = "<p>Hel<b>lo</b> there. Bye.</p>";
        const p = document.body.querySelector("p")!;

        const ranges = buildSentenceRanges(textNodesOf(p), ["Hello there. ", "Bye."]);

        expect(ranges).toHaveLength(2);
        expect(ranges[0].startContainer).toBe(p.firstChild);
        expect(ranges[0].startOffset).toBe(0);
        expect(ranges[0].toString()).toBe("Hello there. ");
        expect(ranges[1].toString()).toBe("Bye.");
    });

    it("ends a sentence in the node holding its last character, not at offset 0 of the next", () => {
        // "One." fills the first text node exactly; the boundary must stay there
        // so the sentence's final line fragment still has rects to hit-test.
        document.body.innerHTML = "<p>One.<b> Two.</b></p>";
        const p = document.body.querySelector("p")!;
        const nodes = textNodesOf(p);

        const ranges = buildSentenceRanges(nodes, ["One.", " Two."]);

        expect(ranges[0].endContainer).toBe(nodes[0]);
        expect(ranges[0].endOffset).toBe(4);
        expect(ranges[0].toString()).toBe("One.");
        expect(ranges[1].toString()).toBe(" Two.");
    });

    it("emits no range for blank segments, so both sides stay index-aligned", () => {
        document.body.innerHTML = "<p>A. B.  </p>";
        const p = document.body.querySelector("p")!;

        // The segmenter can emit a trailing whitespace-only chunk.
        const ranges = buildSentenceRanges(textNodesOf(p), ["A. ", "B.", "  "]);

        expect(ranges.map((r) => r.toString())).toEqual(["A. ", "B."]);
    });

    it("clamps a segmentation that overruns the text instead of throwing", () => {
        document.body.innerHTML = "<p>Short.</p>";
        const p = document.body.querySelector("p")!;

        const ranges = buildSentenceRanges(textNodesOf(p), ["Short.", " trailing text that is not there"]);

        expect(ranges[0].toString()).toBe("Short.");
        expect(ranges[1].toString()).toBe("");
    });

    it("returns [] when there is no text or no sentence", () => {
        document.body.innerHTML = "<p>x</p>";
        const p = document.body.querySelector("p")!;
        expect(buildSentenceRanges(textNodesOf(p), [])).toEqual([]);
        expect(buildSentenceRanges([], ["x"])).toEqual([]);
    });
});
