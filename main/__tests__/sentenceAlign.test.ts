import { describe, expect, it } from "vitest";
import { alignSentenceBlocks } from "@/main/dom/sentence";

/**
 * alignSentenceBlocks exists for the AI-translation case: machine translators
 * return one sentence per input sentence (counts match, passthrough), but an
 * AI freely merges or splits — and the hover highlighting used to drop the
 * whole unit on a single count mismatch. These tests pin the alignment
 * behavior and, critically, the lossless-partition invariant: the blocks must
 * concatenate back to exactly the input text, because buildSentenceRanges
 * walks offsets over that concatenation and a dropped segment would shift
 * every range after it.
 */
describe("alignSentenceBlocks", () => {
    it("returns both inputs untouched when the non-blank counts already match", () => {
        const original = ["Hello. ", "How are you?"];
        const translated = ["你好。", "你好吗？"];
        const out = alignSentenceBlocks(original, translated);
        expect(out).not.toBeNull();
        expect(out!.original).toBe(original);
        expect(out!.translated).toBe(translated);
    });

    it("matches counts while concatenating back to the exact input text", () => {
        // Three source sentences, two translations (the model merged the tail).
        const original = ["One two. ", "Three four. ", "Five."];
        const translated = ["一二三四。", "五六。"];
        expect(original.filter(s => s.trim() !== "").length).not.toBe(
            translated.filter(s => s.trim() !== "").length,
        );
        const out = alignSentenceBlocks(original, translated);
        expect(out).not.toBeNull();
        expect(out!.original.length).toBe(out!.translated.length);
        expect(out!.original.join("")).toBe(original.join(""));
        expect(out!.translated.join("")).toBe(translated.join(""));
        // Every block is paintable on both sides — no blank-only block.
        expect(out!.original.every(b => b.trim() !== "")).toBe(true);
        expect(out!.translated.every(b => b.trim() !== "")).toBe(true);
    });

    it("pairs two merged source sentences with their single translation", () => {
        // The model translated the first two sentences as one long one; the
        // proportions here make the block boundary unambiguous.
        const original = ["AAAA. ", "BB. ", "CCCC."];
        const translated = ["甲甲甲甲甲甲甲甲甲甲甲甲。", "乙乙。"];
        const out = alignSentenceBlocks(original, translated);
        expect(out).not.toBeNull();
        expect(out!.original.length).toBe(2);
        expect(out!.translated.length).toBe(2);
        // Block 0 = the two originals that were merged (trailing space and
        // all — losslessness matters more than tidy strings), block 1 = the last.
        expect(out!.original[0]).toBe("AAAA. BB. ");
        expect(out!.original[1]).toBe("CCCC.");
        expect(out!.translated[0]).toBe("甲甲甲甲甲甲甲甲甲甲甲甲。");
        expect(out!.translated[1]).toBe("乙乙。");
    });

    it("pairs a split translation back with its single source sentence", () => {
        const original = ["第一句话挺长。", "第二句。"];
        const translated = ["First sentence. ", "Second half of it. ", "Second sentence."];
        const out = alignSentenceBlocks(original, translated);
        expect(out).not.toBeNull();
        expect(out!.original.length).toBe(out!.translated.length);
        expect(out!.translated.join("")).toBe(translated.join(""));
    });

    it("keeps a leading blank inside the first block instead of dropping it", () => {
        // A dropped leading blank would shift every range in the offset walk.
        const original = ["  ", "Hello.", " World awaits."];
        const translated = ["你好。", "世界在等待。"];
        const out = alignSentenceBlocks(original, translated);
        expect(out).not.toBeNull();
        expect(out!.original.join("")).toBe(original.join(""));
        expect(out!.original[0].startsWith("  ")).toBe(true);
    });

    it("collapses to a single block when one side is a single sentence", () => {
        const original = ["One. ", "Two. ", "Three."];
        const translated = ["一二三。"];
        const out = alignSentenceBlocks(original, translated);
        expect(out).not.toBeNull();
        expect(out!.original).toEqual([original.join("")]);
        expect(out!.translated).toEqual(["一二三。"]);
    });

    it("returns null when either side has no non-blank sentence", () => {
        expect(alignSentenceBlocks(["  ", ""], ["你好。"])).toBeNull();
        expect(alignSentenceBlocks(["你好。"], ["  "])).toBeNull();
        expect(alignSentenceBlocks([], [])).toBeNull();
    });
});
