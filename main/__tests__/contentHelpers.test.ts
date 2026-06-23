// Unit tests for the pure helpers extracted from main/content.ts:
//   - main/strategy.ts          (needsTranslate)
//   - main/css/translationCss.ts (getCSSRuleString / buildTranslationCss)
//   - main/lang/detect.ts        (getTextLanguage)
// All DOM-free, so they run in the default node environment.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// effectiveFontColor does a contrast calc; stub it to identity so the CSS
// builder output is deterministic and we test *its* assembly logic, not colors.
vi.mock("@/utils/color", () => ({
    effectiveFontColor: (_bg: string, font: string) => font,
}));
vi.mock("franc", () => ({ franc: vi.fn() }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));

import { needsTranslate } from "@/main/strategy";
import { getCSSRuleString, buildTranslationCss } from "@/main/css";
import { getTextLanguage } from "@/main/lang";
import { DOMAIN_STRATEGY, DEFAULT_STRATEGY } from "@/main/constants";
import { franc } from "franc";
import { isTraditionalChinese } from "@/utils/language";

const mockFranc = franc as unknown as Mock;
const mockTrad = isTraditionalChinese as unknown as Mock;

// ---------------------------------------------------------------------------
// needsTranslate
// ---------------------------------------------------------------------------
describe("needsTranslate", () => {
    const base = {
        globalSwitch: true,
        domainStrategy: DOMAIN_STRATEGY.AUTO,
        defaultStrategy: DEFAULT_STRATEGY.AUTO,
        targetLang: "zh-CN",
        pageLang: "en",
    };

    it("is false when the global switch is off, regardless of strategy", () => {
        expect(needsTranslate({ ...base, globalSwitch: false, domainStrategy: DOMAIN_STRATEGY.ALWAYS })).toBe(false);
    });

    it("honors the per-domain strategy over the default", () => {
        expect(needsTranslate({ ...base, domainStrategy: DOMAIN_STRATEGY.NEVER, defaultStrategy: DEFAULT_STRATEGY.ALWAYS })).toBe(false);
        expect(needsTranslate({ ...base, domainStrategy: DOMAIN_STRATEGY.ALWAYS, defaultStrategy: DEFAULT_STRATEGY.NEVER })).toBe(true);
    });

    it("falls back to the default strategy when the domain is AUTO", () => {
        expect(needsTranslate({ ...base, defaultStrategy: DEFAULT_STRATEGY.NEVER })).toBe(false);
        expect(needsTranslate({ ...base, defaultStrategy: DEFAULT_STRATEGY.ALWAYS })).toBe(true);
    });

    it("when both AUTO, translates only if target != page language", () => {
        expect(needsTranslate({ ...base, targetLang: "zh-CN", pageLang: "en" })).toBe(true);
        expect(needsTranslate({ ...base, targetLang: "en", pageLang: "en" })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getCSSRuleString
// ---------------------------------------------------------------------------
describe("getCSSRuleString", () => {
    it("maps border styles", () => {
        expect(getCSSRuleString("noneStyleSelect")).toBe("border: none;");
        expect(getCSSRuleString("solidBorder")).toBe("border: 2px solid;");
        expect(getCSSRuleString("dottedBorder")).toBe("border: 2px dotted;");
        expect(getCSSRuleString("dashedBorder")).toBe("border: 2px dashed;");
    });

    it("maps underline styles and adds the underline offset", () => {
        expect(getCSSRuleString("underLine")).toBe("text-decoration: underline;text-underline-offset: 4px;");
        expect(getCSSRuleString("wavyLine")).toBe("text-decoration: wavy underline;text-underline-offset: 4px;");
        expect(getCSSRuleString("doubleLine")).toBe("text-decoration: underline double;text-underline-offset: 4px;");
    });

    it("applies color to border-color for borders", () => {
        expect(getCSSRuleString("solidBorder", "red")).toBe("border: 2px solid;border-color: red;");
    });

    it("applies color to text-decoration-color for underlines", () => {
        expect(getCSSRuleString("underLine", "blue")).toBe(
            "text-decoration: underline;text-decoration-color: blue;text-underline-offset: 4px;",
        );
    });

    it("returns empty string for an unknown style", () => {
        expect(getCSSRuleString("bogus")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// buildTranslationCss
// ---------------------------------------------------------------------------
describe("buildTranslationCss", () => {
    const base = {
        bgColor: "#fff",
        fontColor: "#000",
        borderStyle: "noneStyleSelect",
        borderColor: "",
        highlightBg: "#ff0",
        highlightFontColor: "#111",
        highlightStyle: "underLine",
        highlightBorderColor: "",
        highlightSwitch: false,
    };

    it("emits a .duo-translation block from the translation options", () => {
        const css = buildTranslationCss(base);
        expect(css).toContain(".duo-translation {");
        expect(css).toContain("background-color: #fff;");
        expect(css).toContain("color: #000;");
        expect(css).toContain("border: none;");
    });

    it("omits the highlight block when highlightSwitch is off", () => {
        expect(buildTranslationCss(base)).not.toContain("duo-highlight-original");
    });

    it("emits the unified highlight block when highlightSwitch is on", () => {
        const css = buildTranslationCss({ ...base, highlightSwitch: true });
        expect(css).toContain(".duo-highlight-original, .duo-highlight-translation {");
        expect(css).toContain("background-color: #ff0;");
    });

    it("returns empty string when there is nothing to style", () => {
        const css = buildTranslationCss({
            ...base,
            bgColor: "",
            fontColor: "",
            borderStyle: "bogus",
            highlightSwitch: false,
        });
        expect(css).toBe("");
    });
});

// ---------------------------------------------------------------------------
// getTextLanguage
// ---------------------------------------------------------------------------
describe("getTextLanguage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTrad.mockReturnValue(false);
    });

    it("maps an ISO-639-3 code to ISO-639-1 via the table", () => {
        mockFranc.mockReturnValue("eng");
        expect(getTextLanguage("hello world")).toBe("en");
    });

    it("resolves Mandarin to simplified / traditional by script", () => {
        mockFranc.mockReturnValue("cmn");
        mockTrad.mockReturnValue(false);
        expect(getTextLanguage("简体内容")).toBe("zh-CN");
        mockTrad.mockReturnValue(true);
        expect(getTextLanguage("繁體內容")).toBe("zh-TW");
    });

    it("returns 'und' for an unmapped code", () => {
        mockFranc.mockReturnValue("zzz");
        expect(getTextLanguage("???")).toBe("und");
    });
});
