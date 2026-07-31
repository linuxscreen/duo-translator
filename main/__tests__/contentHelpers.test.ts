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
import { getCSSRuleString, getHighlightCSSRuleString, buildTranslationCss } from "@/main/css";
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
// getHighlightCSSRuleString
// ---------------------------------------------------------------------------
describe("getHighlightCSSRuleString", () => {
    it("remaps the border styles onto underline + overline", () => {
        // A highlight pseudo-element has no box, so a border can never render;
        // the top and bottom edges are as close as it gets.
        expect(getHighlightCSSRuleString("solidBorder")).toBe(
            "text-decoration: underline overline solid;text-decoration-thickness: 2px;",
        );
        expect(getHighlightCSSRuleString("dottedBorder")).toBe(
            "text-decoration: underline overline dotted;text-decoration-thickness: 2px;",
        );
        expect(getHighlightCSSRuleString("dashedBorder")).toBe(
            "text-decoration: underline overline dashed;text-decoration-thickness: 2px;",
        );
    });

    it("carries the border color over as the decoration color", () => {
        expect(getHighlightCSSRuleString("solidBorder", "red")).toBe(
            "text-decoration: underline overline solid;text-decoration-thickness: 2px;text-decoration-color: red;",
        );
    });

    it("leaves every other style to getCSSRuleString", () => {
        for (const style of ["noneStyleSelect", "underLine", "wavyLine", "dottedLine", "bogus"]) {
            expect(getHighlightCSSRuleString(style, "blue")).toBe(getCSSRuleString(style, "blue"));
        }
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
        const css = buildTranslationCss(base);
        expect(css).not.toContain("::highlight(");
        expect(css).not.toContain("duo-highlight-original");
    });

    it("emits both highlight strategies as separate rules when highlightSwitch is on", () => {
        // Both must be present and separate: content.ts picks one at runtime, and
        // an unsupported selector invalidates only the rule it appears in — so
        // merging them would drop the class rule on the old browsers needing it.
        const css = buildTranslationCss({ ...base, highlightSwitch: true });
        expect(css).toContain("::highlight(duo-hl-original), ::highlight(duo-hl-translation) {");
        expect(css).toContain(".duo-highlight-original, .duo-highlight-translation {");
        expect(css.match(/background-color: #ff0;/g)).toHaveLength(2);
    });

    it("keeps a real border on the translation but remaps it on the highlight", () => {
        // Same style name, two contexts: .duo-translation is a single block
        // element (a border is fine and looks right), the highlight is neither.
        const css = buildTranslationCss({
            ...base,
            borderStyle: "solidBorder",
            highlightStyle: "solidBorder",
            highlightSwitch: true,
        });
        expect(css).toContain(".duo-translation { background-color: #fff; color: #000; border: 2px solid; }");
        expect(css).toContain("text-decoration: underline overline solid;");
        expect(css).not.toContain("duo-highlight-original, .duo-highlight-translation { background-color: #ff0; color: #111; border:");
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
