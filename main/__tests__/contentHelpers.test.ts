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
import { styleColorFields } from "@/utils/translationStyle";
import {
    DOMAIN_STRATEGY,
    DEFAULT_STRATEGY,
    STYLE_BLUR,
    STYLE_DIM,
    STYLE_NONE,
    STYLE_QUOTE,
    TRANSLATION_STYLE_GROUPS,
} from "@/main/constants";
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
            "text-decoration: underline overline solid;text-decoration-thickness: 1px;",
        );
        expect(getHighlightCSSRuleString("dottedBorder")).toBe(
            "text-decoration: underline overline dotted;text-decoration-thickness: 1px;",
        );
        expect(getHighlightCSSRuleString("dashedBorder")).toBe(
            "text-decoration: underline overline dashed;text-decoration-thickness: 1px;",
        );
    });

    it("carries the border color over as the decoration color", () => {
        expect(getHighlightCSSRuleString("solidBorder", "red")).toBe(
            "text-decoration: underline overline solid;text-decoration-thickness: 1px;text-decoration-color: red;",
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
        quoteBorderColor: "#df5f47",
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

    it("drops the background for the enhance styles", () => {
        // dim/blur attenuate the paragraph as a whole; a background fill would
        // defeat that, so it is not applied — and Options does not offer it
        // (both sides ask styleColorFields).
        const dim = buildTranslationCss({ ...base, borderStyle: "dimText" });
        expect(dim).not.toContain("background-color");
        expect(dim).toContain("opacity: 0.6;");

        const blur = buildTranslationCss({ ...base, borderStyle: "blurText" });
        expect(blur).not.toContain("background-color");
        expect(blur).toContain("filter: blur(4px);");
    });

    it("gives only blur a hover rule — dim is a permanent de-emphasis", () => {
        expect(buildTranslationCss({ ...base, borderStyle: "blurText" })).toContain(
            ".duo-translation:hover { filter: none; }",
        );
        expect(buildTranslationCss({ ...base, borderStyle: "dimText" })).not.toContain(":hover");
    });

    it("scopes the quote bar to translations that got their own line", () => {
        // A translation appended inline (span divide, i.e. short enough to skip
        // the <br>) must keep its colors but not grow a bar mid-sentence.
        const css = buildTranslationCss({ ...base, borderStyle: "quoteBar" });
        expect(css).toContain(".duo-translation { color: #000; }");
        expect(css).toContain("br.duo-divide + .duo-translation {");
        expect(css).toContain("border-left: 3px solid #df5f47;");
        // inline-block, so the bar runs down every line of a wrapped translation
        // rather than marking the first line fragment only.
        expect(css).toContain("display: inline-block;");
        expect(css).toContain("padding-left: 0.6em;");
        expect(css).not.toContain(":hover");
    });

    it("colors the quote bar from its own key, falling back to currentColor", () => {
        // borderColor is deliberately ignored here: the bar has its own config
        // key so switching styles never carries one color over to the other.
        const css = buildTranslationCss({
            ...base,
            borderStyle: "quoteBar",
            borderColor: "#f00",
            quoteBorderColor: "#00f",
        });
        expect(css).toContain("border-left: 3px solid #00f;");
        expect(css).not.toContain("#f00");

        const unset = buildTranslationCss({ ...base, borderStyle: "quoteBar", quoteBorderColor: "" });
        expect(unset).toContain("border-left: 3px solid currentColor;");
    });
});

// ---------------------------------------------------------------------------
// styleColorFields — the contract Options renders from and main/css.ts gates on
// ---------------------------------------------------------------------------
describe("styleColorFields", () => {
    it("leads with the border color for the styles that are about an edge", () => {
        for (const style of ["solidBorder", "dashedBorder", "underLine", "wavyLine"]) {
            expect(styleColorFields(style)).toEqual(["border", "bg", "font"]);
        }
    });

    it("keeps background + font for none", () => {
        expect(styleColorFields(STYLE_NONE)).toEqual(["bg", "font"]);
        // Unwritten config reads as "", which must behave as none rather than
        // falling through to the border default.
        expect(styleColorFields("")).toEqual(["bg", "font"]);
    });

    it("offers only what each enhance style can use", () => {
        expect(styleColorFields(STYLE_DIM)).toEqual(["font"]);
        expect(styleColorFields(STYLE_BLUR)).toEqual(["font"]);
        expect(styleColorFields(STYLE_QUOTE)).toEqual(["font", "quoteBorder"]);
    });
});

describe("TRANSLATION_STYLE_GROUPS", () => {
    it("puts the enhance group directly after none", () => {
        expect(TRANSLATION_STYLE_GROUPS[0].options[0].value).toBe(STYLE_NONE);
        expect(TRANSLATION_STYLE_GROUPS[1].groupTitle).toBe("enhance");
        expect(TRANSLATION_STYLE_GROUPS[1].options.map((o) => o.value)).toEqual([
            STYLE_DIM,
            STYLE_QUOTE,
            STYLE_BLUR,
        ]);
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
