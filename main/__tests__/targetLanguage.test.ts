// browserTargetLanguage — the single fallback for "user has never picked a
// translate target". Pure, so it runs in the default node environment; the
// browser UI language is stubbed per case.
import { describe, it, expect, afterEach, vi } from "vitest";
import { browserTargetLanguage } from "@/main/constants";

function withUiLanguage(value: string | undefined): void {
    vi.stubGlobal("navigator", value === undefined ? {} : { language: value });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("browserTargetLanguage", () => {
    // Chinese is the whole reason this helper exists: LANGUAGES only has
    // zh-CN / zh-TW, so a bare `zh` base tag matches nothing.
    it.each([
        ["zh", "zh-CN"],
        ["zh-CN", "zh-CN"],
        ["zh-SG", "zh-CN"],
        ["zh-Hans", "zh-CN"],
        ["zh-TW", "zh-TW"],
        ["zh-HK", "zh-TW"],
        ["zh-MO", "zh-TW"],
        ["zh-Hant", "zh-TW"],
    ])("maps %s to %s", (ui, expected) => {
        withUiLanguage(ui);
        expect(browserTargetLanguage()).toBe(expected);
    });

    it("is case-insensitive about the region subtag", () => {
        withUiLanguage("ZH-tw");
        expect(browserTargetLanguage()).toBe("zh-TW");
    });

    it("keeps the base tag for every other language", () => {
        withUiLanguage("en-US");
        expect(browserTargetLanguage()).toBe("en");
        withUiLanguage("pt-BR");
        expect(browserTargetLanguage()).toBe("pt");
        withUiLanguage("fr");
        expect(browserTargetLanguage()).toBe("fr");
    });

    it("falls back to English when the browser reports nothing", () => {
        withUiLanguage(undefined);
        expect(browserTargetLanguage()).toBe("en");
    });
});
