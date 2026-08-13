// @vitest-environment jsdom
//
// SRT generation for the subtitle download (main/videoSubtitle/download.ts).
// Pure formatting; the job that drives it lives in the controller. jsdom only
// for `stripHtml`, which parses provider markup with DOMParser.
import { describe, it, expect } from "vitest";

import { buildSrt, srtTimestamp, stripHtml, subtitleFileName } from "@/main/videoSubtitle/download";
import type { SubtitleCue } from "@/main/videoSubtitle/types";

const cue = (startMs: number, endMs: number, text: string, translated?: string): SubtitleCue =>
    ({ startMs, endMs, text, translated });

describe("srtTimestamp", () => {
    it("formats hours, minutes, seconds and milliseconds", () => {
        expect(srtTimestamp(0)).toBe("00:00:00,000");
        expect(srtTimestamp(1234)).toBe("00:00:01,234");
        expect(srtTimestamp(3_723_045)).toBe("01:02:03,045");
    });

    it("clamps negatives — a cue can never start before the video", () => {
        expect(srtTimestamp(-500)).toBe("00:00:00,000");
    });
});

describe("stripHtml", () => {
    it("keeps plain text byte-identical", () => {
        expect(stripHtml("Hello, world")).toBe("Hello, world");
    });

    it("removes the inline tags a provider may return", () => {
        expect(stripHtml("<b>你好</b>，世界")).toBe("你好，世界");
        expect(stripHtml("a &amp; b")).toBe("a & b");
    });
});

describe("buildSrt", () => {
    const cues = [cue(0, 1500, "Hello", "你好"), cue(1500, 3000, "World", "世界")];

    it("writes both lines for a bilingual file, original first", () => {
        expect(buildSrt(cues, "bilingual")).toBe(
            "1\n00:00:00,000 --> 00:00:01,500\nHello\n你好\n\n" +
            "2\n00:00:01,500 --> 00:00:03,000\nWorld\n世界\n",
        );
    });

    it("writes one line for the single-language files", () => {
        expect(buildSrt(cues, "original")).toContain("\nHello\n");
        expect(buildSrt(cues, "original")).not.toContain("你好");
        expect(buildSrt(cues, "translation")).toContain("\n你好\n");
        expect(buildSrt(cues, "translation")).not.toContain("Hello");
    });

    it("falls back to the original when there is no translation", () => {
        // Same-language tracks are never translated; a blank file would just
        // look broken.
        const out = buildSrt([cue(0, 1000, "Hello")], "translation");
        expect(out).toContain("\nHello\n");
    });

    it("renumbers around dropped empty cues so the index stays contiguous", () => {
        const out = buildSrt([cue(0, 1000, "  "), cue(1000, 2000, "Hi")], "original");
        expect(out.startsWith("1\n00:00:01,000")).toBe(true);
    });
});

describe("subtitleFileName", () => {
    it("carries the target language except on original-only files", () => {
        expect(subtitleFileName("Talk", "bilingual", "zh-CN", "id")).toBe("Talk.zh-CN.bilingual.srt");
        expect(subtitleFileName("Talk", "original", "zh-CN", "id")).toBe("Talk.original.srt");
    });

    it("strips path separators and collapses whitespace, keeping hyphens", () => {
        expect(subtitleFileName(" a/b:c  d-e ", "original", "en", "id")).toBe("a b c d-e.original.srt");
    });

    it("falls back to the video id when the title is unusable", () => {
        expect(subtitleFileName("///", "original", "en", "abc123")).toBe("abc123.original.srt");
    });
});
