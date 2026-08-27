// json3 timedtext parsing (main/videoSubtitle/youtube.ts). Pure and DOM-free.
//
// The point of this file is that a `seg` is not a word. Three seg shapes reach
// us — ASR (one word per seg), manual (one cue per seg) and broadcast closed
// captions (TWO CHARACTERS per seg) — and words are recovered by splitting on
// whitespace, never by trusting seg boundaries.
import { describe, it, expect } from "vitest";

import { parseJson3 } from "@/main/videoSubtitle/youtube";
import { joinWords } from "@/main/videoSubtitle/segmenter";

describe("parseJson3 — broadcast closed captions (CEA-608 byte pairs)", () => {
    // Verbatim from the "English - CC1" track of a live YouTube feed
    // (gamescom Opening Night Live). CEA-608 carries exactly two characters
    // per control byte pair and paints one pair per video frame, hence the
    // 33/34ms offsets. The real word boundaries survive ONLY as the spaces
    // inside the segs ("d ", " y", "n ").
    const CC1_EVENT = {
        tStartMs: 1700331,
        segs: [
            { utf8: "an" },
            { utf8: "d ", tOffsetMs: 34 },
            { utf8: "as", tOffsetMs: 67 },
            { utf8: " y", tOffsetMs: 100 },
            { utf8: "ou", tOffsetMs: 134 },
            { utf8: " c", tOffsetMs: 167 },
            { utf8: "an", tOffsetMs: 200 },
            { utf8: " s", tOffsetMs: 1669 },
            { utf8: "ee", tOffsetMs: 1702 },
            { utf8: " i", tOffsetMs: 1735 },
            { utf8: "n ", tOffsetMs: 1769 },
            { utf8: "th", tOffsetMs: 1802 },
            { utf8: "e", tOffsetMs: 1835 },
        ],
    };

    it("regroups 2-character segs into whole words", () => {
        const words = parseJson3({ events: [CC1_EVENT] });
        expect(words.map((w) => w.text)).toEqual(["and", "as", "you", "can", "see", "in", "the"]);
    });

    it("round-trips through joinWords to the original sentence", () => {
        // The regression this file exists for: trimming each seg and letting
        // joinWords put a space between every one of them rendered
        // "an d as y ou c an s ee i n th e" on screen.
        const words = parseJson3({ events: [CC1_EVENT] });
        expect(joinWords(words)).toBe("and as you can see in the");
        expect(joinWords(words)).toBe(CC1_EVENT.segs.map((s) => s.utf8).join(""));
    });

    it("times a merged word from its first seg to its last", () => {
        const words = parseJson3({ events: [CC1_EVENT] });
        // "and" = "an" (offset 0) + "d " (offset 34, running to the next at 67).
        expect(words[0]).toMatchObject({ text: "and", startMs: 1700331, endMs: 1700331 + 67 });
        // "you" = " y" (offset 100) + "ou" (offset 134, running to 167).
        expect(words[2]).toMatchObject({ text: "you", startMs: 1700331 + 100, endMs: 1700331 + 167 });
    });

    it("marks only the last word of the event as a cue end", () => {
        const words = parseJson3({ events: [CC1_EVENT] });
        expect(words.filter((w) => w.cueEnd).map((w) => w.text)).toEqual(["the"]);
    });
});

describe("parseJson3 — ASR tracks are unchanged", () => {
    // One seg per word, each carrying its own leading space.
    const ASR_EVENT = {
        tStartMs: 5000,
        dDurMs: 3000,
        segs: [
            { utf8: "you're" },
            { utf8: " about", tOffsetMs: 500 },
            { utf8: " to", tOffsetMs: 900 },
            { utf8: " immediately", tOffsetMs: 1200 },
        ],
    };

    it("keeps one word per seg with its own timing", () => {
        const words = parseJson3({ events: [ASR_EVENT] });
        expect(words.map((w) => w.text)).toEqual(["you're", "about", "to", "immediately"]);
        expect(words.map((w) => w.startMs)).toEqual([5000, 5500, 5900, 6200]);
        // The last word runs to the event's own end (no following offset).
        expect(words.map((w) => w.endMs)).toEqual([5500, 5900, 6200, 8000]);
    });

    it("skips aAppend events, which re-emit the previous window", () => {
        const words = parseJson3({ events: [ASR_EVENT, { ...ASR_EVENT, aAppend: 1 }] });
        expect(words).toHaveLength(4);
    });
});

describe("parseJson3 — manual tracks (one seg per cue)", () => {
    it("splits a cue into words and marks the cue end once", () => {
        const words = parseJson3({
            events: [{ tStartMs: 0, dDurMs: 2000, segs: [{ utf8: "hello there\nworld" }] }],
        });
        // A newline is a line wrap inside one cue — a word boundary like a space.
        expect(words.map((w) => w.text)).toEqual(["hello", "there", "world"]);
        expect(words.filter((w) => w.cueEnd).map((w) => w.text)).toEqual(["world"]);
        expect(joinWords(words)).toBe("hello there world");
    });

    it("still marks a cue end when the event's last seg is whitespace only", () => {
        // `cueEnd: i === segs.length - 1` used to land on a seg that was then
        // dropped as blank, leaving the whole event with no break candidate.
        const words = parseJson3({
            events: [{ tStartMs: 0, dDurMs: 2000, segs: [{ utf8: "done" }, { utf8: "  \n " }] }],
        });
        expect(words.map((w) => w.text)).toEqual(["done"]);
        expect(words[0].cueEnd).toBe(true);
    });

    it("pads zero-duration words to the next word's start", () => {
        const words = parseJson3({
            events: [
                { tStartMs: 0, segs: [{ utf8: "first" }] },
                { tStartMs: 1500, segs: [{ utf8: "second" }] },
            ],
        });
        expect(words.map((w) => [w.startMs, w.endMs])).toEqual([
            [0, 1500],
            [1500, 1500 + 4000],
        ]);
    });
});
