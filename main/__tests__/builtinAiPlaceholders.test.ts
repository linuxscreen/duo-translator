import { describe, expect, it } from "vitest";
import {
    hasPlaceholders,
    placeholderSignature,
    placeholdersPreserved,
    sameLanguage,
    stripPlaceholders,
    toModelLang,
} from "@/main/builtinAi/placeholders";

// The built-in AI model is a plain-text translator: the synthetic `<bN>` tags
// the pipeline wraps inline children in are just tokens it may drop, merge or
// renumber. These checks are what decides whether a translation can be written
// back structurally or has to degrade to flat text.

describe("placeholder round-trip verification", () => {
    const input = "Hello <b0>world</b0>, see <b1>this link</b1>.";

    it("accepts an intact round-trip", () => {
        const output = "你好<b0>世界</b0>，请看<b1>这个链接</b1>。";
        expect(placeholdersPreserved(input, output)).toBe(true);
    });

    it("accepts tags reordered by the translation", () => {
        // Clause order legitimately changes between languages; what matters is
        // that the same multiset of tags survives, not their sequence.
        const output = "<b1>この링크</b1>を見て、<b0>世界</b0>よこんにちは。";
        expect(placeholdersPreserved(input, output)).toBe(true);
    });

    it("rejects a dropped tag", () => {
        const output = "你好世界，请看<b1>这个链接</b1>。";
        expect(placeholdersPreserved(input, output)).toBe(false);
    });

    it("rejects a renumbered tag", () => {
        const output = "你好<b0>世界</b0>，请看<b2>这个链接</b2>。";
        expect(placeholdersPreserved(input, output)).toBe(false);
    });

    it("rejects an unbalanced tag even when the count matches", () => {
        // Same number of tags, but a closing tag became an opening one — the
        // write-back walks the structure, so this would misplace text.
        const output = "你好<b0>世界<b0>，请看<b1>这个链接</b1>。";
        expect(placeholdersPreserved(input, output)).toBe(false);
    });

    it("treats two texts with no placeholders as preserved", () => {
        expect(placeholdersPreserved("Hello world.", "你好世界。")).toBe(true);
    });

    it("distinguishes multi-digit indices", () => {
        expect(placeholderSignature("<b1>a</b1><b12>b</b12>")).not.toBe(
            placeholderSignature("<b1>a</b1><b2>b</b2>"),
        );
    });
});

describe("hasPlaceholders", () => {
    it("detects presence and absence", () => {
        expect(hasPlaceholders("plain text")).toBe(false);
        expect(hasPlaceholders("a <b3>b</b3>")).toBe(true);
    });

    it("is not affected by a previous call (no sticky lastIndex leak)", () => {
        // The module-level regex is /g; a `test()` that leaves lastIndex set
        // would make every other call answer wrongly.
        const text = "a <b0>b</b0>";
        expect(hasPlaceholders(text)).toBe(true);
        expect(hasPlaceholders(text)).toBe(true);
    });
});

describe("stripPlaceholders", () => {
    it("leaves only the readable text", () => {
        expect(stripPlaceholders("Hello <b0>world</b0>, see <b11>link</b11>.")).toBe(
            "Hello world, see link.",
        );
    });

    it("leaves real markup alone", () => {
        // Only the synthetic <bN> form is ours. A literal <b> or <br> in the
        // text is not a placeholder and must survive untouched.
        expect(stripPlaceholders("a <b>bold</b> and <br> break")).toBe("a <b>bold</b> and <br> break");
    });
});

describe("toModelLang", () => {
    it("maps the config Chinese tags to script subtags", () => {
        expect(toModelLang("zh-CN")).toBe("zh-Hans");
        expect(toModelLang("zh-TW")).toBe("zh-Hant");
    });

    it("passes other tags through untouched", () => {
        expect(toModelLang("en")).toBe("en");
        expect(toModelLang("pt-BR")).toBe("pt-BR");
    });
});

describe("sameLanguage", () => {
    it("ignores region subtags", () => {
        expect(sameLanguage("en", "en-US")).toBe(true);
        expect(sameLanguage("pt-BR", "pt")).toBe(true);
    });

    it("never collapses the two Chinese scripts", () => {
        // Simplified → Traditional is a real translation the user asked for.
        // A naive "compare the part before the dash" check would skip it.
        expect(sameLanguage("zh-Hans", "zh-Hant")).toBe(false);
        expect(sameLanguage("zh-CN", "zh-TW")).toBe(false);
    });

    it("unifies the aliases each source uses for the same Chinese script", () => {
        // Config says zh-CN, the detector answers zh, the translator wants zh-Hans.
        expect(sameLanguage("zh", "zh-Hans")).toBe(true);
        expect(sameLanguage("zh-CN", "zh-Hans")).toBe(true);
        expect(sameLanguage("zh-TW", "zh-Hant")).toBe(true);
        expect(sameLanguage("zh-HK", "zh-Hant")).toBe(true);
    });

    it("separates different languages", () => {
        expect(sameLanguage("en", "de")).toBe(false);
        expect(sameLanguage("ja", "zh-Hans")).toBe(false);
    });

    it("treats an empty tag as not matching", () => {
        expect(sameLanguage("", "en")).toBe(false);
    });
});
