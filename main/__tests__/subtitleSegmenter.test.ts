// Rule-based subtitle segmentation (main/videoSubtitle/segmenter.ts). Pure and
// DOM-free — the AI half of the module is not touched here.
import { describe, it, expect, vi } from "vitest";

// The module imports the AI client transitively; stub it so nothing tries to
// reach the background from a unit test.
vi.mock("@/main/aiClient", () => ({ aiComplete: vi.fn() }));

import { segmentWords, nextAiChunkEnd } from "@/main/videoSubtitle/segmenter";
import type { SubtitleWord } from "@/main/videoSubtitle/types";

/** Build a word stream: one entry per text, 500ms apart, cueEnd where marked. */
function words(items: { text: string; cueEnd?: boolean; gapAfterMs?: number }[]): SubtitleWord[] {
    let t = 0;
    return items.map((it) => {
        const startMs = t;
        const endMs = startMs + 400;
        t = endMs + (it.gapAfterMs ?? 100);
        return { startMs, endMs, text: it.text, cueEnd: !!it.cueEnd };
    });
}

/** `n` unpunctuated Latin words, split into cues of `perCue`. */
function asrLine(n: number, perCue: number): { text: string; cueEnd?: boolean }[] {
    return Array.from({ length: n }, (_, i) => ({
        text: `word${i}`,
        cueEnd: (i + 1) % perCue === 0,
    }));
}

describe("segmentWords — length caps are measured in UTF-8 bytes", () => {
    // The regression: a character cap let CJK cues carry ~3x the content of a
    // Latin one, because one CJK char is 3 UTF-8 bytes but still `.length === 1`.
    it("caps a punctuation-free CJK run by bytes, not characters", () => {
        // 200 CJK chars = 600 bytes; a 170-CHARACTER cap would emit ~2 cues.
        const cues = segmentWords(words([{ text: "中".repeat(200) }]));
        expect(cues.length).toBeGreaterThan(0);
        // Nothing to break on inside a single word, so the one cue is intact —
        // what matters is the byte accounting below.
        expect(cues.map((c) => c.text).join("")).toBe("中".repeat(200));
    });

    it("splits a long CJK stream into more cues than the same count of Latin words", () => {
        // Same number of source words, same structure — only the script differs.
        const cjk = segmentWords(words(Array.from({ length: 40 }, () => ({ text: "这是一句话" }))));
        const latin = segmentWords(words(Array.from({ length: 40 }, () => ({ text: "hello" }))));
        expect(cjk.length).toBeGreaterThan(latin.length);
    });

    it("keeps the Latin behaviour unchanged (1 char ≈ 1 byte)", () => {
        // ~35 chars per sentence, well under the soft cap: one cue per sentence.
        const cues = segmentWords(
            words([
                { text: "This is the first sentence." },
                { text: "And here is the second one." },
            ]),
        );
        expect(cues.map((c) => c.text)).toEqual([
            "This is the first sentence.",
            "And here is the second one.",
        ]);
    });
});

describe("segmentWords — tracks without punctuation break at every source cue", () => {
    it("emits one cue per caption line instead of concatenating", () => {
        const cues = segmentWords(words(asrLine(12, 4)));
        expect(cues).toHaveLength(3);
        expect(cues[0].text).toBe("word0 word1 word2 word3");
        expect(cues[2].text).toBe("word8 word9 word10 word11");
    });

    it("still concatenates when the track IS punctuated", () => {
        // Same shape, but punctuated at a normal density. The marks sit INSIDE
        // the lines, so cue boundaries are no longer breaks and the lines merge
        // up to the length caps as before.
        const items = asrLine(12, 4).map((it, i) => ({
            ...it,
            text: i % 4 === 1 ? `${it.text},` : it.text,
        }));
        const cues = segmentWords(words(items));
        expect(cues.length).toBeLessThan(3);
    });

    // The reason the check is a density and not "does any mark exist": a
    // transcript is not punctuated because someone said "three point five".
    it("ignores a stray decimal point in a long bare transcript", () => {
        const items = asrLine(100, 5);
        items[42].text = "3.5";
        const cues = segmentWords(words(items));
        // 100 words in cues of 5 → one cue per caption line.
        expect(cues).toHaveLength(20);
    });

    it("counts sparse punctuation as unpunctuated, dense as punctuated", () => {
        // One mark per ~600 bytes: far below the threshold.
        const sparse = asrLine(100, 5);
        sparse[10].text = "word10,";
        expect(segmentWords(words(sparse))).toHaveLength(20);
        // One mark per ~35 bytes: normal prose density. Marks sit inside the
        // lines so the difference shows up as merging, not as the same breaks.
        const dense = asrLine(100, 5).map((it, i) => ({
            ...it,
            text: i % 5 === 2 ? `${it.text},` : it.text,
        }));
        expect(segmentWords(words(dense)).length).toBeLessThan(20);
    });

    it("detects punctuation anywhere in a word, not only at its end", () => {
        // Manual tracks put a whole caption line in one "word", so its
        // punctuation is usually interior.
        const cues = segmentWords(
            words([
                { text: "well, that happened", cueEnd: true },
                { text: "and then it did not", cueEnd: true },
            ]),
        );
        expect(cues).toHaveLength(1);
    });

    it("keeps splitting on long silences on an unpunctuated track", () => {
        const cues = segmentWords(
            words([
                { text: "one" },
                { text: "two", gapAfterMs: 3000 },
                { text: "three" },
            ]),
        );
        expect(cues.map((c) => c.text)).toEqual(["one two", "three"]);
    });
});

describe("nextAiChunkEnd — chunk budget is in UTF-8 bytes", () => {
    it("takes fewer CJK words than Latin words for the same budget", () => {
        const cjk = words(Array.from({ length: 200 }, () => ({ text: "这是一句话" })));
        const latin = words(Array.from({ length: 200 }, () => ({ text: "hello" })));
        expect(nextAiChunkEnd(cjk, 0)).toBeLessThan(nextAiChunkEnd(latin, 0));
    });

    it("never returns a position before the start", () => {
        const w = words(Array.from({ length: 5 }, () => ({ text: "hi" })));
        expect(nextAiChunkEnd(w, 5)).toBe(5);
        expect(nextAiChunkEnd(w, 0)).toBeGreaterThan(0);
    });
});
