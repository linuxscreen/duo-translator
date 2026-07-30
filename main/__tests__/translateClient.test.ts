// Unit tests for the non-DOM surface of main/translateClient.ts — the content
// side. Runs in the default `node` environment (WxtVitest sets no DOM).
//
// The provider classes moved to background; their tests are in
// translateService.test.ts (mocking global fetch, so they assert the real
// provider request rather than a proxy envelope). DOM-dependent orchestration
// lives in translateClient.dom.test.ts (jsdom env).
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// --- module mocks (hoisted) ---------------------------------------------------
const { sendStub } = vi.hoisted(() => ({ sendStub: vi.fn() }));
vi.mock("@/utils/message", () => ({
    sendMessageToBackground: sendStub,
    sendMessageToBackgroundOrThrow: sendStub,
}));
vi.mock("@/utils/db", () => ({ getConfig: vi.fn(async () => undefined) }));

import {
    TranslateResult,
    TranslateParams,
    parseIndexedText,
    translateTexts,
    detectTextsLanguage,
} from "@/main/translateClient";
import { ACTION } from "@/main/constants";
import { sendMessageToBackground } from "@/utils/message";

const mockSend = sendMessageToBackground as unknown as Mock;

beforeEach(() => {
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Data classes
// ---------------------------------------------------------------------------
describe("TranslateResult / TranslateParams", () => {
    it("TranslateResult stores the constructor args", () => {
        const r = new TranslateResult("译文", "en", 0.9);
        expect(r.translatedMappedHtmlText).toBe("译文");
        expect(r.sourceLang).toBe("en");
        expect(r.score).toBe(0.9);
        expect(r.rawText).toBe("");
        expect(r.rawTextLength).toBe(0);
    });
    it("TranslateParams stores its fields", () => {
        const p = new TranslateParams("google", "zh-CN", "en");
        expect(p.serviceName).toBe("google");
        expect(p.targetLang).toBe("zh-CN");
        expect(p.sourceLang).toBe("en");
    });
});


describe("parseIndexedText", () => {
    it("returns an empty array for an empty string", () => {
        expect(parseIndexedText("")).toEqual([]);
    });

    it("treats text with no tags as a single index -1 chunk", () => {
        expect(parseIndexedText("hello world")).toEqual([
            { index: -1, text: "hello world" },
        ]);
    });

    it("parses a single indexed tag", () => {
        expect(parseIndexedText("<a i=0>hello</a>")).toEqual([
            { index: 0, text: "hello" },
        ]);
    });

    it("parses multiple consecutive indexed tags", () => {
        expect(parseIndexedText("<a i=0>foo</a><a i=1>bar</a>")).toEqual([
            { index: 0, text: "foo" },
            { index: 1, text: "bar" },
        ]);
    });

    it("captures loose text before, between, and after tags as index -1", () => {
        expect(parseIndexedText("pre<a i=0>foo</a>mid<a i=1>bar</a>post")).toEqual([
            { index: -1, text: "pre" },
            { index: 0, text: "foo" },
            { index: -1, text: "mid" },
            { index: 1, text: "bar" },
            { index: -1, text: "post" },
        ]);
    });

    it("accepts double- and single-quoted index values", () => {
        expect(parseIndexedText('<a i="2">x</a>')).toEqual([{ index: 2, text: "x" }]);
        expect(parseIndexedText("<a i='3'>y</a>")).toEqual([{ index: 3, text: "y" }]);
    });

    it("keeps a negative tag index as-is", () => {
        expect(parseIndexedText("<a i=-1>z</a>")).toEqual([{ index: -1, text: "z" }]);
    });

    it("skips tags with empty content", () => {
        expect(parseIndexedText("<a i=0></a>")).toEqual([]);
        expect(parseIndexedText("before<a i=0></a>")).toEqual([
            { index: -1, text: "before" },
        ]);
    });

    it("ignores additional attributes around the i= attribute", () => {
        expect(parseIndexedText('<a class="duo" i=5 data-x="1">t</a>')).toEqual([
            { index: 5, text: "t" },
        ]);
    });

    it("tolerates whitespace around the equals sign", () => {
        expect(parseIndexedText("<a i = 7 >t</a>")).toEqual([{ index: 7, text: "t" }]);
    });

    it("matches tags case-insensitively", () => {
        expect(parseIndexedText("<A I=0>t</A>")).toEqual([{ index: 0, text: "t" }]);
    });

    it("captures multi-line tag content", () => {
        expect(parseIndexedText("<a i=0>line1\nline2</a>")).toEqual([
            { index: 0, text: "line1\nline2" },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Background bridge
// ---------------------------------------------------------------------------
describe("translateTexts", () => {
    it("sends the service + texts and rebuilds real TranslateResult instances", async () => {
        // Background replies with structured-cloned plain objects.
        mockSend.mockResolvedValue([
            { translatedMappedHtmlText: "你好", sourceLang: "en", score: 1, rawText: "hello" },
        ]);
        const out = await translateTexts("google", ["hello"], "zh-CN");

        expect(out).toHaveLength(1);
        // Must be a real instance, not the bare clone — callers set DOM-bearing
        // fields on these afterwards.
        expect(out![0]).toBeInstanceOf(TranslateResult);
        expect(out![0].translatedMappedHtmlText).toBe("你好");
        expect(out![0].rawText).toBe("hello");

        const [[msg]] = mockSend.mock.calls as any[];
        expect(msg.action).toBe(ACTION.TRANSLATE_TEXTS);
        expect(msg.data).toMatchObject({ service: "google", texts: ["hello"], targetLang: "zh-CN" });
    });

    it("returns [] for empty input without messaging background", async () => {
        expect(await translateTexts("google", [], "zh-CN")).toEqual([]);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("returns undefined when background reports no result", async () => {
        mockSend.mockResolvedValue(null);
        expect(await translateTexts("google", ["x"], "zh-CN")).toBeUndefined();
    });
});

describe("detectTextsLanguage", () => {
    it("returns the detected language", async () => {
        mockSend.mockResolvedValue({ lang: "en" });
        expect(await detectTextsLanguage(["hello"])).toBe("en");
        expect((mockSend.mock.calls[0][0] as any).action).toBe(ACTION.DETECT_LANGUAGE);
    });

    it("returns '' when detection is unavailable", async () => {
        mockSend.mockResolvedValue(undefined);
        expect(await detectTextsLanguage(["hello"])).toBe("");
    });
});
