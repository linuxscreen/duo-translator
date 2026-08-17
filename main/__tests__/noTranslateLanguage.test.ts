// Unit tests for the "do not translate these languages" logic:
//   - main/noTranslateLanguage.ts       (tag comparison, shared by all three consumers)
//   - main/noTranslateLanguageFilter.ts (the per-paragraph passes + the memo)
//   - main/strategy.ts                  (the page-level AUTO decision)
// All DOM-free, so they run in the default node environment.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("franc", () => ({ franc: vi.fn() }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));

import { franc } from "franc";
import { buildNoTranslateLanguageSet, isNoTranslateLanguage } from "@/main/noTranslateLanguage";
import {
    needsCompanionDetect,
    partitionByLocalLanguage,
    rejectByDetectedLanguage,
    reportsPerTextSourceLang,
    resetDetectedLanguageCache,
} from "@/main/noTranslateLanguageFilter";
import { needsTranslate } from "@/main/strategy";
import { AI_PREFIX, DEFAULT_STRATEGY, DOMAIN_STRATEGY, TRANSLATE_SERVICE } from "@/main/constants";

const mockFranc = franc as unknown as Mock;

/** Long enough to clear LOCAL_DETECT_MIN_BYTES (200 UTF-8 bytes). */
const longText = (seed: string) => seed.repeat(Math.ceil(240 / seed.length));

beforeEach(() => {
    mockFranc.mockReset();
    resetDetectedLanguageCache();
});

// ---------------------------------------------------------------------------
// buildNoTranslateLanguageSet / isNoTranslateLanguage
// ---------------------------------------------------------------------------
describe("buildNoTranslateLanguageSet", () => {
    it("returns an empty set for anything that is not a list of strings", () => {
        expect(buildNoTranslateLanguageSet(undefined).size).toBe(0);
        expect(buildNoTranslateLanguageSet(null).size).toBe(0);
        expect(buildNoTranslateLanguageSet("en").size).toBe(0);
        expect(buildNoTranslateLanguageSet([1, {}, null]).size).toBe(0);
    });

    it("normalizes the configured tags", () => {
        const set = buildNoTranslateLanguageSet(["en", "pt", "zh-TW"]);
        expect([...set].sort()).toEqual(["en", "pt", "zh-TW"]);
    });
});

describe("isNoTranslateLanguage", () => {
    const set = buildNoTranslateLanguageSet(["en", "zh-CN"]);

    it("compares NORMALIZED tags, so provider dialects still match", () => {
        expect(isNoTranslateLanguage("en-US", set)).toBe(true);
        expect(isNoTranslateLanguage("zh-Hans", set)).toBe(true);
        // franc's ISO-639-3 Mandarin, which lang.ts already resolves by script.
        expect(isNoTranslateLanguage("cmn", set)).toBe(true);
    });

    it("does not match a different variant of the same base language", () => {
        expect(isNoTranslateLanguage("zh-TW", set)).toBe(false);
    });

    it("treats an unknown language as translatable — never as a match", () => {
        expect(isNoTranslateLanguage("", set)).toBe(false);
        expect(isNoTranslateLanguage(undefined, set)).toBe(false);
        expect(isNoTranslateLanguage(null, set)).toBe(false);
    });

    it("is off entirely when nothing is configured", () => {
        expect(isNoTranslateLanguage("en", new Set())).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Which provider can answer per paragraph
// ---------------------------------------------------------------------------
describe("provider capability split", () => {
    it("lists the three providers that report a source language per text", () => {
        for (const s of [TRANSLATE_SERVICE.GOOGLE, TRANSLATE_SERVICE.MICROSOFT, TRANSLATE_SERVICE.DEEPL]) {
            expect(reportsPerTextSourceLang(s)).toBe(true);
            expect(needsCompanionDetect(s)).toBe(false);
        }
    });

    it("sends everyone else — including an unknown future provider — to the companion detect", () => {
        for (const s of [TRANSLATE_SERVICE.YANDEX, TRANSLATE_SERVICE.BUILTIN, `${AI_PREFIX}abc`, "brand-new"]) {
            expect(reportsPerTextSourceLang(s)).toBe(false);
            expect(needsCompanionDetect(s)).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// Pass 1 — local (franc)
// ---------------------------------------------------------------------------
describe("partitionByLocalLanguage", () => {
    const set = buildNoTranslateLanguageSet(["en"]);
    const id = (s: string) => s;

    it("drops a long paragraph franc names as a no-translate language", () => {
        mockFranc.mockReturnValue("eng");
        const text = longText("hello world ");
        const out = partitionByLocalLanguage([text], id, set);
        expect(out.excluded).toEqual([text]);
        expect(out.keep).toEqual([]);
        expect(out.undetermined).toEqual([]);
    });

    it("keeps a long paragraph in another language and does NOT re-ask the provider about it", () => {
        mockFranc.mockReturnValue("deu");
        const text = longText("guten tag welt ");
        const out = partitionByLocalLanguage([text], id, set);
        expect(out.keep).toEqual([text]);
        // franc already answered; only unnamed paragraphs go to pass 2.
        expect(out.undetermined).toEqual([]);
    });

    it("never hands short text to franc — it goes to the provider pass instead", () => {
        const out = partitionByLocalLanguage(["hi"], id, set);
        expect(mockFranc).not.toHaveBeenCalled();
        expect(out.keep).toEqual(["hi"]);
        expect(out.undetermined).toEqual(["hi"]);
    });

    it("treats franc's 'und' as unknown, not as a verdict", () => {
        mockFranc.mockReturnValue("und");
        const text = longText("?!?! ");
        const out = partitionByLocalLanguage([text], id, set);
        expect(out.excluded).toEqual([]);
        expect(out.undetermined).toEqual([text]);
    });

    it("memoizes, so a re-scan of the same page costs no second detection", () => {
        mockFranc.mockReturnValue("eng");
        const text = longText("hello world ");
        partitionByLocalLanguage([text], id, set);
        partitionByLocalLanguage([text], id, set);
        expect(mockFranc).toHaveBeenCalledTimes(1);
    });

    it("stores the language rather than the verdict, so editing the list takes effect", () => {
        mockFranc.mockReturnValue("eng");
        const text = longText("hello world ");
        expect(partitionByLocalLanguage([text], id, set).excluded).toEqual([text]);
        // Same cached "en", different configured list → opposite answer.
        const other = buildNoTranslateLanguageSet(["de"]);
        expect(partitionByLocalLanguage([text], id, other).keep).toEqual([text]);
    });

    it("is a no-op when nothing is configured", () => {
        mockFranc.mockReturnValue("eng");
        const text = longText("hello world ");
        const out = partitionByLocalLanguage([text], id, new Set());
        expect(out.excluded).toEqual([]);
        expect(out.keep).toEqual([text]);
    });
});

// ---------------------------------------------------------------------------
// Pass 2 — the provider's word
// ---------------------------------------------------------------------------
describe("rejectByDetectedLanguage", () => {
    const set = buildNoTranslateLanguageSet(["en"]);

    it("rejects a match and accepts anything else", () => {
        expect(rejectByDetectedLanguage("some text", "en-GB", set)).toBe(true);
        expect(rejectByDetectedLanguage("some text", "de", set)).toBe(false);
    });

    it("treats a missing answer exactly like never having asked", () => {
        expect(rejectByDetectedLanguage("some text", "", set)).toBe(false);
        expect(rejectByDetectedLanguage("some text", undefined, set)).toBe(false);
    });

    it("feeds the memo, so the same paragraph is dropped locally next time", () => {
        const text = longText("hello world ");
        expect(rejectByDetectedLanguage(text, "en", set)).toBe(true);
        const out = partitionByLocalLanguage([text], (s) => s, set);
        expect(out.excluded).toEqual([text]);
        expect(mockFranc).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Page-level decision
// ---------------------------------------------------------------------------
describe("needsTranslate + noTranslateLanguages", () => {
    const base = {
        globalSwitch: true,
        domainStrategy: DOMAIN_STRATEGY.AUTO,
        defaultStrategy: DEFAULT_STRATEGY.AUTO,
        targetLang: "zh-CN",
        pageLang: "en",
        noTranslateLanguages: buildNoTranslateLanguageSet(["en"]),
    };

    it("does not auto-translate a page in a no-translate language", () => {
        expect(needsTranslate(base)).toBe(false);
    });

    it("still auto-translates a page in any other language", () => {
        expect(needsTranslate({ ...base, pageLang: "de" })).toBe(true);
    });

    it("is bypassed by an ALWAYS strategy — naming the site outranks the global list", () => {
        expect(needsTranslate({ ...base, domainStrategy: DOMAIN_STRATEGY.ALWAYS })).toBe(true);
        expect(needsTranslate({ ...base, defaultStrategy: DEFAULT_STRATEGY.ALWAYS })).toBe(true);
    });

    it("behaves exactly as before when nothing is configured", () => {
        expect(needsTranslate({ ...base, noTranslateLanguages: undefined })).toBe(true);
        expect(needsTranslate({ ...base, noTranslateLanguages: new Set() })).toBe(true);
    });
});
