// Unit tests for the background-side translation providers
// (main/translateService.ts). The provider classes now live in background and
// call `fetch` directly, so network behaviour is mocked at global `fetch` —
// these assert the real request the provider sends (URL, headers, body), not
// an intermediate proxy envelope as the previous content-side version did.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// --- module mocks (hoisted) ---------------------------------------------------
const { mockConfigGet } = vi.hoisted(() => ({ mockConfigGet: vi.fn(async (_key?: string): Promise<any> => undefined) }));
vi.mock("@/main/storage/configStore", () => ({
    configRepo: { get: mockConfigGet, set: vi.fn(async () => { }) },
}));
vi.mock("@/main/storage/translationCache", () => ({
    getMany: vi.fn(async (_s: string, _t: string, texts: string[]) => texts.map(() => null)),
    putMany: vi.fn(async () => { }),
}));
vi.mock("@/main/aiService", () => ({ aiPageTranslate: vi.fn() }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));
vi.mock("@/main/messageBridge", () => ({
    ABORT_SCOPE: { TRANSLATE: "translate" },
    handleAbort: vi.fn(),
    handleAbortable: vi.fn(),
    handleAsync: vi.fn(),
}));

import {
    Token,
    transferLanguageCode,
    GoogleTranslateService,
    MicrosoftTranslateService,
    DeepLTranslateService,
    AiTranslateService,
    resolveTranslateService,
    translationServices,
    googleTranslationService,
    microsoftTranslationService,
    deeplTranslationService,
    builtinAiTranslationService,
    translateTextsWithCache,
} from "@/main/translateService";
import { TRANSLATE_SERVICE, AI_PREFIX, CONFIG_KEY } from "@/main/constants";
import { isTraditionalChinese } from "@/utils/language";
import { aiPageTranslate } from "@/main/aiService";

const mockFetch = vi.fn();
const mockIsTraditional = isTraditionalChinese as unknown as Mock;
const mockAiPageTranslate = aiPageTranslate as unknown as Mock;

/** Build a fetch Response stub carrying a JSON payload. */
function reply(body: unknown, status = 200): any {
    return {
        status,
        statusText: status === 200 ? "OK" : "ERR",
        ok: status === 200,
        text: async () => JSON.stringify(body),
    };
}

/** fetch calls whose URL starts with `prefix`. */
function fetchCalls(prefix: string) {
    return mockFetch.mock.calls.filter(([url]: any[]) => String(url).startsWith(prefix));
}

const MS_TOKEN_HOST = "https://edge.microsoft.com/translate/auth";
/** Translate AND detect both go here now — detect just pins `to=en`. */
const MS_TRANSLATE_HOST = "https://edge.microsoft.com/translate/translatetext";

/**
 * Answer the MS auth-token fetch with a valid token and everything else via
 * `handler(url, init)`.
 */
function routeFetch(handler: (url: string, init: any) => any) {
    mockFetch.mockImplementation(async (url: string, init: any) => {
        if (String(url).startsWith(MS_TOKEN_HOST)) {
            return { status: 200, statusText: "OK", ok: true, text: async () => "ms-token" };
        }
        return handler(String(url), init);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockIsTraditional.mockReturnValue(false);
    mockConfigGet.mockImplementation(async () => undefined);
});

// ---------------------------------------------------------------------------
// transferLanguageCode
// ---------------------------------------------------------------------------
describe("transferLanguageCode", () => {
    it("maps zh-Hans -> zh-CN and zh-Hant -> zh-TW", () => {
        expect(transferLanguageCode("zh-Hans")).toBe("zh-CN");
        expect(transferLanguageCode("zh-Hant")).toBe("zh-TW");
    });

    it("defaults bare ZH to zh-CN when no text is given", () => {
        expect(transferLanguageCode("ZH")).toBe("zh-CN");
    });

    it("resolves ZH via isTraditionalChinese when text is provided", () => {
        mockIsTraditional.mockReturnValue(true);
        expect(transferLanguageCode("ZH", "繁體")).toBe("zh-TW");
        mockIsTraditional.mockReturnValue(false);
        expect(transferLanguageCode("ZH", "简体")).toBe("zh-CN");
    });

    it("passes other languages through unchanged", () => {
        expect(transferLanguageCode("en")).toBe("en");
    });
});

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------
describe("Token", () => {
    it("is invalid when empty", () => {
        expect(new Token("", Date.now() + 10000).isValid()).toBe(false);
    });
    it("is invalid when expired", () => {
        expect(new Token("t", Date.now() - 1).isValid()).toBe(false);
    });
    it("is valid with a token and a future expiry", () => {
        expect(new Token("t", Date.now() + 10000).isValid()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// GoogleTranslateService
// ---------------------------------------------------------------------------
describe("GoogleTranslateService.translateText", () => {
    it("posts to the Google endpoint and parses text + detected language", async () => {
        routeFetch(() => reply([["你好"], ["en"]]));
        const out = await new GoogleTranslateService("k").translateText(["hello"], "zh-CN");

        expect(out).toHaveLength(1);
        expect(out[0].translatedMappedHtmlText).toBe("你好");
        expect(out[0].sourceLang).toBe("en");

        const [[url, init]] = fetchCalls("https://translate-pa.googleapis.com") as any[];
        expect(url).toBe("https://translate-pa.googleapis.com/v1/translateHtml");
        expect(init.headers["x-goog-api-key"]).toBe("k");
        expect(JSON.parse(init.body)).toEqual([[["hello"], "auto", "zh-CN"], "te_lib"]);
    });

    // Providers always throw now — the old degrade-to-[] path hid the reason in
    // the background console, which is exactly the bug this replaced. Resilience
    // moved to translateUnits in main/content.ts.
    it("throws on a non-200 response, naming the provider and host", async () => {
        routeFetch(() => reply(null, 500));
        await expect(
            new GoogleTranslateService("k").translateText(["x"], "zh-CN"),
        ).rejects.toThrow(/Google Translate HTTP 500.*translate-pa\.googleapis\.com/);
    });

    it("quotes the response body in the error so the provider's reason survives", async () => {
        routeFetch(() => reply({ error: { message: "API key not valid" } }, 400));
        await expect(
            new GoogleTranslateService("k").translateText(["x"], "zh-CN"),
        ).rejects.toThrow(/API key not valid/);
    });

    it("returns [] for empty input without touching the network", async () => {
        routeFetch(() => reply(null, 500));
        expect(await new GoogleTranslateService("k").translateText([], "zh-CN")).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// MicrosoftTranslateService
// ---------------------------------------------------------------------------
describe("MicrosoftTranslateService.translateText", () => {
    it("posts a bare string[] to the edge endpoint and parses translations + detected language", async () => {
        routeFetch(() => reply([
            { translations: [{ text: "你好" }], detectedLanguage: { language: "en", score: 1 } },
        ]));
        const out = await new MicrosoftTranslateService().translateText(["hello"], "zh-CN");

        expect(out[0].translatedMappedHtmlText).toBe("你好");
        expect(out[0].sourceLang).toBe("en");

        const [[url, init]] = fetchCalls(MS_TRANSLATE_HOST) as any[];
        expect(String(url)).toContain("to=zh-CN");
        // No Authorization header any more — the endpoint is unauthenticated,
        // which is also why there is no 401/token-refresh retry left to test.
        expect(init.headers.Authorization).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual(["hello"]);
    });

    it("throws on a non-200 response", async () => {
        routeFetch(() => reply(null, 500));
        await expect(
            new MicrosoftTranslateService().translateText(["x"], "zh-CN"),
        ).rejects.toThrow(/Microsoft Translate HTTP 500/);
    });
});

describe("MicrosoftTranslateService.translateBatchText", () => {
    it("returns one result per input across chunk boundaries", async () => {
        routeFetch((url, init) => {
            if (!url.startsWith(MS_TRANSLATE_HOST)) return reply(null, 500);
            const texts = JSON.parse(init.body) as string[];
            return reply(texts.map((text) => ({
                translations: [{ text: `译:${text}` }],
                detectedLanguage: { language: "en", score: 1 },
            })));
        });
        const out = await new MicrosoftTranslateService().translateBatchText(["a", "b", "c"], "zh-CN");
        expect(out.map((r) => r.translatedMappedHtmlText)).toEqual(["译:a", "译:b", "译:c"]);
    });
});

describe("MicrosoftTranslateService.detectLanguage", () => {
    // Detection reuses the translate endpoint (pinned to `to=en`) and reads the
    // detectedLanguage field off the translation response — there is no longer
    // a separate detect host.
    it("returns the dominant detected language", async () => {
        routeFetch((url) => {
            if (url.startsWith(MS_TRANSLATE_HOST)) {
                return reply([
                    { translations: [{ text: "a" }], detectedLanguage: { language: "en", score: 1 } },
                    { translations: [{ text: "b" }], detectedLanguage: { language: "en", score: 1 } },
                ]);
            }
            return reply(null, 500);
        });
        expect(await new MicrosoftTranslateService().detectLanguage(["a", "b"])).toBe("en");
    });

    // Detection throws like every other provider call. The degrade to "" moved
    // one level out, to detectTextsLanguage in main/translateClient.ts, which
    // logs the reason and falls back to the local franc detector — see the
    // `silent` reporting case there.
    it("throws on a non-200 response", async () => {
        routeFetch(() => reply(null, 500));
        await expect(
            new MicrosoftTranslateService().detectLanguage(["x"]),
        ).rejects.toThrow(/Microsoft Detect HTTP 500/);
    });
});

// ---------------------------------------------------------------------------
// DeepLTranslateService
// ---------------------------------------------------------------------------
describe("DeepLTranslateService.translateText", () => {
    it("builds a full authorized request and maps the target language code", async () => {
        routeFetch(() => reply({ translations: [{ text: "你好", detected_source_language: "EN" }] }));
        const out = await new DeepLTranslateService("key-abc").translateText(["hello"], "zh-CN");
        expect(out[0].translatedMappedHtmlText).toBe("你好");

        const [[url, init]] = fetchCalls("https://api.deepl.com") as any[];
        expect(url).toBe("https://api.deepl.com/v2/translate");
        expect(init.headers.Authorization).toBe("DeepL-Auth-Key key-abc");
        expect(JSON.parse(init.body)).toMatchObject({ target_lang: "ZH-HANS" });
    });

    it("picks the free endpoint for a :fx key", async () => {
        routeFetch(() => reply({ translations: [{ text: "你好", detected_source_language: "EN" }] }));
        await new DeepLTranslateService("key-abc:fx").translateText(["hello"], "zh-CN");
        expect(fetchCalls("https://api-free.deepl.com")).toHaveLength(1);
    });

    it("falls back to the stored key when no override is given", async () => {
        mockConfigGet.mockImplementation(async (k?: string) =>
            (k === CONFIG_KEY.DEEPL_API_KEY ? "stored-key" : undefined) as any);
        routeFetch(() => reply({ translations: [{ text: "你好", detected_source_language: "EN" }] }));
        await new DeepLTranslateService().translateText(["hello"], "zh-CN");
        const [[, init]] = fetchCalls("https://api.deepl.com") as any[];
        expect(init.headers.Authorization).toBe("DeepL-Auth-Key stored-key");
    });

    it("throws without a key and never calls the network", async () => {
        routeFetch(() => reply({}));
        await expect(
            new DeepLTranslateService().translateText(["hello"], "zh-CN"),
        ).rejects.toThrow(/API key is not configured/);
        expect(fetchCalls("https://api")).toHaveLength(0);
    });

    it("throws on a non-200 response", async () => {
        routeFetch(() => reply(null, 403));
        await expect(
            new DeepLTranslateService("key-abc").translateText(["hello"], "zh-CN"),
        ).rejects.toThrow(/DeepL HTTP 403/);
    });
});

// ---------------------------------------------------------------------------
// AiTranslateService
// ---------------------------------------------------------------------------
describe("AiTranslateService.translateText", () => {
    it("derives its name from the provider id", () => {
        expect(new AiTranslateService("p1").name).toBe(AI_PREFIX + "p1");
    });

    it("delegates to aiPageTranslate and wraps the strings", async () => {
        mockAiPageTranslate.mockResolvedValue(["你好", "世界"]);
        const out = await new AiTranslateService("p1").translateText(["hello", "world"], "zh-CN");
        expect(out.map((r) => r.translatedMappedHtmlText)).toEqual(["你好", "世界"]);
        expect(mockAiPageTranslate).toHaveBeenCalledWith("p1", ["hello", "world"], "zh-CN", undefined);
    });

    // An AI provider's own message ("invalid api key", "insufficient balance")
    // is the most actionable error in the pipeline — it must not be swallowed.
    it("propagates the provider's failure", async () => {
        mockAiPageTranslate.mockRejectedValue(new Error("boom"));
        await expect(
            new AiTranslateService("p1").translateText(["hello"], "zh-CN"),
        ).rejects.toThrow(/boom/);
    });

    it("returns [] for empty input", async () => {
        expect(await new AiTranslateService("p1").translateText([], "zh-CN")).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// resolveTranslateService + registry
// ---------------------------------------------------------------------------
describe("resolveTranslateService", () => {
    it("resolves the built-ins to the shared singletons", () => {
        expect(resolveTranslateService(TRANSLATE_SERVICE.GOOGLE)).toBe(googleTranslationService);
        expect(resolveTranslateService(TRANSLATE_SERVICE.MICROSOFT)).toBe(microsoftTranslationService);
        expect(resolveTranslateService(TRANSLATE_SERVICE.DEEPL)).toBe(deeplTranslationService);
        expect(resolveTranslateService(TRANSLATE_SERVICE.BUILTIN)).toBe(builtinAiTranslationService);
    });

    it("builds an AiTranslateService for an ai: prefixed id", () => {
        const svc = resolveTranslateService(AI_PREFIX + "abc");
        expect(svc).toBeInstanceOf(AiTranslateService);
        expect(svc!.name).toBe(AI_PREFIX + "abc");
    });

    it("returns undefined for an unknown service", () => {
        expect(resolveTranslateService("nope")).toBeUndefined();
    });

    it("registers every built-in in translationServices", () => {
        expect(translationServices.get(TRANSLATE_SERVICE.GOOGLE)).toBe(googleTranslationService);
        expect(translationServices.get(TRANSLATE_SERVICE.BUILTIN)).toBe(builtinAiTranslationService);
        expect(translationServices.size).toBeGreaterThanOrEqual(4);
    });
});

// ---------------------------------------------------------------------------
// translateTextsWithCache
// ---------------------------------------------------------------------------
describe("translateTextsWithCache", () => {
    it("returns [] for empty input", async () => {
        expect(await translateTextsWithCache("google", [], "zh-CN")).toEqual([]);
    });

    it("returns undefined for an unknown service", async () => {
        expect(await translateTextsWithCache("nope", ["x"], "zh-CN")).toBeUndefined();
    });

    it("translates via the provider when the cache misses", async () => {
        routeFetch(() => reply([["你好"], ["en"]]));
        const out = await translateTextsWithCache(TRANSLATE_SERVICE.GOOGLE, ["hello"], "zh-CN");
        expect(out?.[0].translatedMappedHtmlText).toBe("你好");
    });
});
