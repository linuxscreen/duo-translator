// @vitest-environment jsdom
//
// Tests for main/dom/sentenceSpan.ts:
//   - splitSentence  (aggregation logic; sentence-splitter is mocked so the
//                     tokenizer's behaviour doesn't leak into the assertions)
//   - wrapTextNode2Span (text-node → <duo-span> wrapping, needs a real DOM)
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("sentence-splitter", () => ({ split: vi.fn() }));

import { splitSentence, wrapTextNode2Span } from "@/main/dom/sentence";
import { split } from "sentence-splitter";

const mockSplit = split as unknown as Mock;

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

/** Collect the direct child text nodes of an element, in order. */
function textNodesOf(el: HTMLElement): Text[] {
    return Array.from(el.childNodes).filter((n): n is Text => n.nodeType === Node.TEXT_NODE);
}

// ---------------------------------------------------------------------------
// splitSentence
// ---------------------------------------------------------------------------
describe("splitSentence", () => {
    it("returns [] for null / empty without invoking the splitter", () => {
        expect(splitSentence(null)).toEqual([]);
        expect(splitSentence("")).toEqual([]);
        expect(mockSplit).not.toHaveBeenCalled();
    });

    it("emits one string per Sentence token", () => {
        mockSplit.mockReturnValue([
            { type: "Sentence", raw: "Hello." },
            { type: "Sentence", raw: "World." },
        ]);
        expect(splitSentence("Hello.World.")).toEqual(["Hello.", "World."]);
    });

    it("attaches inter-sentence whitespace to the following sentence", () => {
        mockSplit.mockReturnValue([
            { type: "Sentence", raw: "A." },
            { type: "WhiteSpace", raw: " " },
            { type: "Sentence", raw: "B." },
        ]);
        expect(splitSentence("A. B.")).toEqual(["A.", " B."]);
    });

    it("drops a trailing non-Sentence remainder (never emitted)", () => {
        mockSplit.mockReturnValue([
            { type: "Sentence", raw: "A." },
            { type: "WhiteSpace", raw: "  " },
        ]);
        expect(splitSentence("A.  ")).toEqual(["A."]);
    });
});

// ---------------------------------------------------------------------------
// wrapTextNode2Span
// ---------------------------------------------------------------------------
describe("wrapTextNode2Span", () => {
    it("wraps a single text node matching a single sentence", () => {
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")!;
        const ignore = new WeakSet<object>();

        const spans = wrapTextNode2Span(textNodesOf(p), ["Hello"], ignore);

        expect(spans).toHaveLength(1);
        expect(spans[0].tagName).toBe("DUO-SPAN");
        expect(spans[0].getAttribute("duo-sequence")).toBe("0");
        expect(spans[0].textContent).toBe("Hello");
        expect(p.querySelector("duo-span")).toBe(spans[0]);
        expect(ignore.has(spans[0])).toBe(true);
    });

    it("splits a text node when a sentence ends mid-node", () => {
        document.body.innerHTML = "<p>Hi there</p>";
        const p = document.body.querySelector("p")!;

        const spans = wrapTextNode2Span(textNodesOf(p), ["Hi ", "there"], new WeakSet());

        expect(spans).toHaveLength(2);
        expect(spans.map((s) => s.getAttribute("duo-sequence"))).toEqual(["0", "1"]);
        expect(spans.map((s) => s.textContent)).toEqual(["Hi ", "there"]);
    });

    it("spans one sentence across multiple text nodes, sharing the sequence", () => {
        // "Hel" lives in <p>, "lo" inside a nested <b> — two separate text nodes.
        document.body.innerHTML = "<p>Hel<b>lo</b></p>";
        const p = document.body.querySelector("p")!;
        const b = p.querySelector("b")!;
        const nodes = [p.firstChild as Text, b.firstChild as Text];

        const spans = wrapTextNode2Span(nodes, ["Hello"], new WeakSet());

        expect(spans).toHaveLength(2);
        expect(spans.every((s) => s.getAttribute("duo-sequence") === "0")).toBe(true);
        expect(spans.map((s) => s.textContent)).toEqual(["Hel", "lo"]);
    });

    it("returns [] for no sentences", () => {
        document.body.innerHTML = "<p>x</p>";
        const p = document.body.querySelector("p")!;
        expect(wrapTextNode2Span(textNodesOf(p), [], new WeakSet())).toEqual([]);
    });
});
