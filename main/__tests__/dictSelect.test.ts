import { describe, expect, it } from "vitest";
import { chooseDictEntry, dictProvidersFor, isDictWord } from "@/main/dict/select";
import type { DictEntry } from "@/main/dict/types";

describe("isDictWord", () => {
    it("accepts a bare Latin-script word", () => {
        for (const w of ["tool", "Tools", "well-being", "don't", "don’t", "café", "naïve", "über"]) {
            expect(isDictWord(w), w).toBe(true);
        }
    });

    it("trims before deciding", () => {
        expect(isDictWord("  tool \n")).toBe(true);
    });

    it("rejects anything that is not a single word", () => {
        for (const s of ["", "   ", "two words", "tool.", "tool,", "(tool)", "3", "v2", "a b"]) {
            expect(isDictWord(s), JSON.stringify(s)).toBe(false);
        }
    });

    it("rejects CJK, which the providers cannot answer as headwords", () => {
        for (const s of ["工具", "こんにちは", "도구", "工具箱"]) {
            expect(isDictWord(s), s).toBe(false);
        }
    });

    it("rejects a long unbroken token — a URL or an id is not a word", () => {
        expect(isDictWord("a".repeat(41))).toBe(false);
        expect(isDictWord("a".repeat(40))).toBe(true);
    });
});

describe("dictProvidersFor", () => {
    it("asks Bing as well only for Simplified Chinese, its one target", () => {
        expect(dictProvidersFor("zh-CN")).toEqual(["microsoft", "google"]);
    });

    it("asks Google alone everywhere else", () => {
        for (const lang of ["en", "en-US", "ja", "fr", "de", "zh-TW"]) {
            expect(dictProvidersFor(lang), lang).toEqual(["google"]);
        }
    });
});

describe("chooseDictEntry", () => {
    const entry = (provider: "microsoft" | "google", sourceLang?: string): DictEntry => ({
        provider,
        word: "w",
        query: "w",
        sourceLang,
        phonetics: [],
        definitions: [{ pos: "", senses: ["s"] }],
        examples: [],
    });

    it("prefers Bing for an English word into Simplified Chinese", () => {
        const chosen = chooseDictEntry(
            { microsoft: entry("microsoft"), google: entry("google", "en") },
            "en",
            "zh-CN",
        );
        expect(chosen!.provider).toBe("microsoft");
    });

    it("keeps Google when the source turns out not to be English", () => {
        // The case the old ASCII heuristic got wrong: a French word spelled
        // with plain ASCII would have been routed to Bing's English entry.
        const chosen = chooseDictEntry(
            { microsoft: entry("microsoft"), google: entry("google", "fr") },
            "fr",
            "zh-CN",
        );
        expect(chosen!.provider).toBe("google");
    });

    it("trusts Google's detected language over the translation's", () => {
        // Google's arrives in the same tick as the entries, so using it avoids
        // rendering one provider and swapping to the other a moment later.
        const chosen = chooseDictEntry(
            { microsoft: entry("microsoft"), google: entry("google", "fr") },
            "en",
            "zh-CN",
        );
        expect(chosen!.provider).toBe("google");
    });

    it("falls back to the translation's detection when Google answered nothing", () => {
        const chosen = chooseDictEntry({ microsoft: entry("microsoft"), google: null }, "en", "zh-CN");
        expect(chosen!.provider).toBe("microsoft");
    });

    it("normalizes language variants", () => {
        const chosen = chooseDictEntry(
            { microsoft: entry("microsoft"), google: entry("google", "en-GB") },
            undefined,
            "zh-CN",
        );
        expect(chosen!.provider).toBe("microsoft");
    });

    it("shows whichever provider answered when the preferred one is empty", () => {
        // A word Bing has never heard of still deserves Google's entry.
        expect(chooseDictEntry({ microsoft: null, google: entry("google", "en") }, "en", "zh-CN")!.provider)
            .toBe("google");
        expect(chooseDictEntry({ microsoft: entry("microsoft"), google: null }, undefined, "zh-CN")!.provider)
            .toBe("microsoft");
        expect(chooseDictEntry({ microsoft: null, google: null }, "en", "zh-CN")).toBeNull();
    });
});
