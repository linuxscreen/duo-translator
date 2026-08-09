// Traditional-Chinese detection (utils/language.ts).
//
// Two things are pinned here: the detection result itself, and the fact that
// the OpenCC converter is built ONCE. The build compiles OpenCC's dictionaries
// (~1.4 ms) while a conversion costs ~0.001 ms, and this function sits on two
// hot paths — one call per sampled paragraph in detectLanguage, one per
// returned translation in transferLanguageCode. Rebuilding per call is the
// regression this file exists to catch.
import { describe, it, expect, vi, beforeEach } from "vitest";

const converterFactory = vi.hoisted(() => vi.fn());

vi.mock("opencc-js", () => ({
    // Delegate to the real library so the behaviour assertions stay honest;
    // the spy only counts how often a converter gets built.
    Converter: (opts: unknown) => converterFactory(opts),
}));

const actualOpenCC = await vi.importActual<typeof import("opencc-js")>("opencc-js");

beforeEach(() => {
    converterFactory.mockClear();
    converterFactory.mockImplementation((opts: any) => actualOpenCC.Converter(opts));
});

const { isTraditionalChinese } = await import("@/utils/language");

describe("isTraditionalChinese", () => {
    it("detects Traditional Chinese", () => {
        expect(isTraditionalChinese("這是繁體中文的測試")).toBe(true);
    });

    it("rejects Simplified Chinese", () => {
        expect(isTraditionalChinese("这是简体中文的测试")).toBe(false);
    });

    it("treats text with no Chinese characters as not Traditional", () => {
        expect(isTraditionalChinese("plain english text")).toBe(false);
        expect(isTraditionalChinese("")).toBe(false);
    });

    it("builds the converter at most once across many calls", () => {
        // The module may already have built it in an earlier test; what must
        // never happen is a fresh build per call.
        for (let i = 0; i < 50; i++) isTraditionalChinese("這是繁體中文");
        expect(converterFactory.mock.calls.length).toBeLessThanOrEqual(1);
    });
});
