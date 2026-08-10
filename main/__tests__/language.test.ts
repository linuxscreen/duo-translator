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

const { isTraditionalChinese, toSimplified, toTraditional } = await import("@/utils/language");

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

describe("toTraditional", () => {
    // `twp`, not `tw`: the point is that VOCABULARY converts too, not only the
    // characters. With `tw` these come out 軟件 / 鼠標 / 數據庫 — mainland words
    // in Traditional characters, which is not what a zh-TW reader expects, and
    // would also read differently from what Microsoft returns for the same
    // target. These three are the canonical giveaways.
    it("converts Taiwan vocabulary, not just characters", () => {
        expect(toTraditional("计算机软件和鼠标")).toBe("計算機軟體和滑鼠");
        expect(toTraditional("数据库里的信息")).toBe("資料庫裡的資訊");
    });

    it("leaves the <bN> placeholders alone", () => {
        // The tags are ASCII and no dictionary entry contains them, which is
        // what makes it safe to convert the mapped HTML text wholesale.
        expect(toTraditional("Hello <b0>世界</b0>，这是一个测试。"))
            .toBe("Hello <b0>世界</b0>，這是一個測試。");
    });

    it("degrades to per-character conversion when a tag splits a phrase", () => {
        // 软件→軟體 cannot fire here because the phrase is cut in half. The
        // result must still be correct Traditional, just less idiomatic —
        // a missed phrase, never a corrupted string.
        expect(toTraditional("这是<b0>软</b0>件的界面")).toBe("這是<b0>軟</b0>件的介面");
    });

    it("passes non-Chinese text through untouched", () => {
        expect(toTraditional("plain english text")).toBe("plain english text");
        expect(toTraditional("")).toBe("");
    });
});

describe("toSimplified", () => {
    it("converts Traditional to Simplified", () => {
        expect(toSimplified("這是繁體中文的測試")).toBe("这是繁体中文的测试");
    });

    // The fixed-point property is load-bearing: it is what lets the Yandex
    // provider convert every zh-CN result unconditionally, without knowing
    // whether the source was Chinese at all.
    it("is a no-op on text that is already Simplified", () => {
        const simplified = "这是简体中文的测试";
        expect(toSimplified(simplified)).toBe(simplified);
    });

    it("builds its converter at most once", () => {
        converterFactory.mockClear();
        for (let i = 0; i < 50; i++) toSimplified("這是繁體中文");
        expect(converterFactory.mock.calls.length).toBeLessThanOrEqual(1);
    });
});
