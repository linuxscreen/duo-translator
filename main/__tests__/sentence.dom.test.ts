// @vitest-environment jsdom
//
// Tests for main/dom/sentence.ts — splitSentence (aggregation logic;
// sentence-splitter is mocked so the tokenizer's behaviour doesn't leak into the
// assertions). The sentence→Range mapping that consumes this output lives in
// main/__tests__/sentenceHighlight.test.ts.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("sentence-splitter", () => ({ split: vi.fn() }));

import { splitSentence } from "@/main/dom/sentence";
import { split } from "sentence-splitter";

const mockSplit = split as unknown as Mock;

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

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
        expect(splitSentence("Hello. World.")).toEqual(["Hello. ", "World."]);
    });

    it("attaches inter-sentence whitespace to the following sentence", () => {
        mockSplit.mockReturnValue([
            { type: "Sentence", raw: "A." },
            { type: "WhiteSpace", raw: " " },
            { type: "Sentence", raw: "B." },
        ]);
        expect(splitSentence("A. B.")).toEqual(["A. ", "B."]);
    });

    it("drops a trailing non-Sentence remainder (never emitted)", () => {
        mockSplit.mockReturnValue([
            { type: "Sentence", raw: "A." },
            { type: "WhiteSpace", raw: "  " },
        ]);
        expect(splitSentence("A.  ")).toEqual(["A.  "]);
    });
});
