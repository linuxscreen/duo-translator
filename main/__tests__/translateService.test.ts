// Unit tests for the non-DOM surface of main/translateService.ts.
// Runs in the default `node` environment (WxtVitest sets no DOM) — these cover
// pure string/tag transforms, data classes, and every provider's translateText
// / detectLanguage / batching with network + message mocks. DOM-dependent
// orchestration lives in translateService.dom.test.ts (jsdom env).
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// --- module mocks (hoisted) ---------------------------------------------------
vi.mock("@/utils/message", () => ({ sendMessageToBackground: vi.fn() }));
vi.mock("@/utils/db", () => ({ getConfig: vi.fn(async () => undefined) }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));

import {
    convertAToBTags,
    TagReplacer,
    transferLanguageCode,
    Token,
    TranslateResult,
    TranslateParams,
    GoogleTranslateService,
    MicrosoftTranslateService,
    DeepLTranslateService,
    AiTranslateService,
    resolveTranslateService,
    translationServices,
    googleTranslationService,
    microsoftTranslationService,
    deeplTranslationService,
} from "@/main/translateService";
import { ACTION, TRANSLATE_SERVICE, AI_PREFIX } from "@/main/constants";
import { sendMessageToBackground } from "@/utils/message";
import { isTraditionalChinese } from "@/utils/language";

const mockSend = sendMessageToBackground as unknown as Mock;
const mockIsTraditional = isTraditionalChinese as unknown as Mock;

/** Build a fetch Response-like object. */
function jsonResponse(body: unknown, status = 200): any {
    return { status, statusText: status === 200 ? "OK" : "ERR", json: async () => body };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockIsTraditional.mockReturnValue(false);
    // Fresh fetch mock per test. We avoid vi.unstubAllGlobals() because the
    // setup file stubs `browser`/`chrome` globally and that would clobber them.
    vi.stubGlobal("fetch", vi.fn());
});

// ---------------------------------------------------------------------------
// convertAToBTags
// ---------------------------------------------------------------------------
describe("convertAToBTags", () => {
    it("converts a single <a i=N> pair to <bN>", () => {
        expect(convertAToBTags("<a i=0>x</a>")).toBe("<b0>x</b0>");
    });

    it("numbers multiple sibling tags independently", () => {
        expect(convertAToBTags("<a i=0>a</a><a i=1>b</a>")).toBe("<b0>a</b0><b1>b</b1>");
    });

    it("closes nested tags with the matching open number (stack)", () => {
        expect(convertAToBTags("<a i=0><a i=1>x</a></a>")).toBe("<b0><b1>x</b1></b0>");
    });

    it("handles deep nesting", () => {
        expect(convertAToBTags("<a i=0><a i=1><a i=2>x</a></a></a>")).toBe(
            "<b0><b1><b2>x</b2></b1></b0>",
        );
    });

    it("handles text outside the tag", () => {
        expect(convertAToBTags("hello <a i=0>world</a>")).toBe("hello <b0>world</b0>");
        expect(convertAToBTags("<a i=0>hello</a> world")).toBe("<b0>hello</b0> world");
    })

    it("returns empty string unchanged", () => {
        expect(convertAToBTags("")).toBe("");
    });

    it("leaves tag-free text untouched", () => {
        expect(convertAToBTags("hello world")).toBe("hello world");
    });
});

// ---------------------------------------------------------------------------
// TagReplacer
// ---------------------------------------------------------------------------
describe("TagReplacer", () => {
    it("round-trips real tags through <bN> placeholders preserving attributes", () => {
        const tr = new TagReplacer();
        const html = '<p class="x">Hi <b>bold</b></p>';
        const replaced = tr.replaceTags(html);
        expect(replaced).toBe("<b11>Hi <b12>bold</b12></b11>");
        expect(tr.restoreTags(replaced)).toBe(html);
    });

    it("starts numbering at 11", () => {
        const tr = new TagReplacer();
        expect(tr.replaceTags("<span>x</span>")).toBe("<b11>x</b11>");
    });

    it("uses a fresh counter per instance (request isolation)", () => {
        const a = new TagReplacer();
        a.replaceTags("<p>1</p>");
        const b = new TagReplacer();
        expect(b.replaceTags("<p>2</p>")).toBe("<b11>2</b11>");
    });

    it("matches nested closing tags to the correct opener", () => {
        const tr = new TagReplacer();
        const replaced = tr.replaceTags("<div><span>x</span></div>");
        expect(replaced).toBe("<b11><b12>x</b12></b11>");
    });

    it("leaves unknown <bN> markers untouched on restore", () => {
        const tr = new TagReplacer();
        // b99 was never registered
        expect(tr.restoreTags("<b99>x</b99>")).toBe("<b99>x</b99>");
    });
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
        expect(transferLanguageCode("fr")).toBe("fr");
    });
});

// ---------------------------------------------------------------------------
// Data classes
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

describe("TranslateResult / TranslateParams", () => {
    it("TranslateResult stores the constructor args", () => {
        const r = new TranslateResult("译文", "en", 0.9);
        expect(r.translatedMappedHtmlText).toBe("译文");
        expect(r.sourceLang).toBe("en");
        expect(r.score).toBe(0.9);
        expect(r.rawText).toBe("");
        expect(r.rawTextLength).toBe(0);
    });
    it("TranslateParams stores its fields", () => {
        const p = new TranslateParams("google", "zh-CN", "en");
        expect(p.serviceName).toBe("google");
        expect(p.targetLang).toBe("zh-CN");
        expect(p.sourceLang).toBe("en");
    });
});

// ---------------------------------------------------------------------------
// GoogleTranslateService.translateText
// ---------------------------------------------------------------------------
describe("GoogleTranslateService.translateText", () => {
    it("returns [] for empty input without calling fetch", async () => {
        const svc = new GoogleTranslateService("k");
        expect(await svc.translateText([], "zh-CN")).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("parses translated text + detected language on 200", async () => {
        (fetch as Mock).mockResolvedValue(jsonResponse([["你好"], ["en"]]));
        const svc = new GoogleTranslateService("k");
        const out = await svc.translateText(["hello"], "zh-CN");
        expect(out).toHaveLength(1);
        expect(out[0].translatedMappedHtmlText).toBe("你好");
        expect(out[0].sourceLang).toBe("en");
    });

    it("converts <a i=N> tags in the response to <bN>", async () => {
        (fetch as Mock).mockResolvedValue(jsonResponse([["<a i=0>你好</a>"], ["en"]]));
        const svc = new GoogleTranslateService("k");
        const out = await svc.translateText(["<b0>hello</b0>"], "zh-CN");
        expect(out[0].translatedMappedHtmlText).toBe("<b0>你好</b0>");
    });

    it("returns [] on a non-200 response", async () => {
        (fetch as Mock).mockResolvedValue(jsonResponse(null, 500));
        const svc = new GoogleTranslateService("k");
        expect(await svc.translateText(["hello"], "zh-CN")).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// MicrosoftTranslateService
// ---------------------------------------------------------------------------
describe("MicrosoftTranslateService.translateText", () => {
    function tokenReply() {
        return { token: "tok", expireTime: Date.now() + 600000 };
    }

    it("fetches a token then parses the translation response", async () => {
        mockSend.mockResolvedValue(tokenReply());
        (fetch as Mock).mockResolvedValue(
            jsonResponse([
                { translations: [{ text: "你好" }], detectedLanguage: { language: "en", score: 0.97 } },
            ]),
        );
        const svc = new MicrosoftTranslateService();
        const out = await svc.translateText(["hello"], "zh-CN");
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({ action: ACTION.ACCESS_TOKEN_GET }),
        );
        expect(out[0].translatedMappedHtmlText).toBe("你好");
        expect(out[0].sourceLang).toBe("en");
        expect(out[0].score).toBe(0.97);
    });

    it("refreshes the token and retries on 401, giving up after MS_MAX_RETRY", async () => {
        mockSend.mockResolvedValue(tokenReply());
        (fetch as Mock).mockResolvedValue(jsonResponse(null, 401));
        const svc = new MicrosoftTranslateService();
        const out = await svc.translateText(["hello"], "zh-CN");
        expect(out).toEqual([]);
        // initial attempt + 5 retries = 6 fetch calls
        expect(fetch).toHaveBeenCalledTimes(6);
    });

    it("returns [] for empty input", async () => {
        const svc = new MicrosoftTranslateService();
        expect(await svc.translateText([], "zh-CN")).toEqual([]);
    });
});

describe("MicrosoftTranslateService.translateBatchText", () => {
    // Echo each request 1:1 so we can assert order/length across chunks.
    function echoFetch() {
        (fetch as Mock).mockImplementation(async (_url: string, init: any) => {
            const items: { text: string }[] = JSON.parse(init.body);
            return jsonResponse(
                items.map((it) => ({
                    translations: [{ text: it.text }],
                    detectedLanguage: { language: "en", score: 1 },
                })),
            );
        });
    }

    it("returns results 1:1 in order for a single chunk", async () => {
        mockSend.mockResolvedValue({ token: "tok", expireTime: Date.now() + 600000 });
        echoFetch();
        const svc = new MicrosoftTranslateService();
        const out = await svc.translateBatchText(["a", "b", "c"], "zh-CN");
        expect(out.map((r) => r.translatedMappedHtmlText)).toEqual(["a", "b", "c"]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("splits past the 900-item limit into multiple chunks, preserving order", async () => {
        mockSend.mockResolvedValue({ token: "tok", expireTime: Date.now() + 600000 });
        echoFetch();
        const inputs = Array.from({ length: 901 }, (_, i) => `t${i}`);
        const svc = new MicrosoftTranslateService();
        const out = await svc.translateBatchText(inputs, "zh-CN");
        expect(out).toHaveLength(901);
        expect(out.map((r) => r.translatedMappedHtmlText)).toEqual(inputs);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe("MicrosoftTranslateService.detectLanguage", () => {
    it("returns the byte-weighted dominant language", async () => {
        mockSend.mockResolvedValue({ token: "tok", expireTime: Date.now() + 600000 });
        (fetch as Mock).mockResolvedValue(
            jsonResponse([
                { language: "en", score: 0.99 },
                { language: "fr", score: 0.99 },
            ]),
        );
        const svc = new MicrosoftTranslateService();
        // First text is much longer -> more bytes -> higher weight -> wins.
        const lang = await svc.detectLanguage(["a very long english paragraph here", "le"]);
        expect(lang).toBe("en");
    });

    it("returns '' on a non-200 response", async () => {
        mockSend.mockResolvedValue({ token: "tok", expireTime: Date.now() + 600000 });
        (fetch as Mock).mockResolvedValue(jsonResponse(null, 500));
        const svc = new MicrosoftTranslateService();
        expect(await svc.detectLanguage(["x"])).toBe("");
    });
});

// ---------------------------------------------------------------------------
// DeepLTranslateService
// ---------------------------------------------------------------------------
describe("DeepLTranslateService.translateText", () => {
    it("proxies through background and maps the target language code", async () => {
        mockSend.mockResolvedValue({
            translations: [{ text: "你好", detected_source_language: "EN" }],
        });
        const svc = new DeepLTranslateService();
        const out = await svc.translateText(["hello"], "zh-CN");
        expect(out[0].translatedMappedHtmlText).toBe("你好");
        // zh-CN must be converted to DeepL's ZH-HANS in the request body.
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                action: ACTION.DEEPL_REQUEST,
                data: expect.objectContaining({
                    body: expect.objectContaining({ target_lang: "ZH-HANS" }),
                }),
            }),
        );
    });

    it("returns [] when background returns nothing", async () => {
        mockSend.mockResolvedValue(undefined);
        const svc = new DeepLTranslateService();
        expect(await svc.translateText(["hello"], "zh-CN")).toEqual([]);
    });

    it("returns [] for empty input", async () => {
        const svc = new DeepLTranslateService();
        expect(await svc.translateText([], "zh-CN")).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// AiTranslateService.translateText (non-streaming, one-shot message)
// ---------------------------------------------------------------------------
describe("AiTranslateService.translateText", () => {
    it("derives its name from the provider id", () => {
        expect(new AiTranslateService("p1").name).toBe(AI_PREFIX + "p1");
    });

    it("maps the background translations array to results", async () => {
        mockSend.mockResolvedValue(["你好", "世界"]);
        const svc = new AiTranslateService("p1");
        const out = await svc.translateText(["hello", "world"], "zh-CN");
        expect(out.map((r) => r.translatedMappedHtmlText)).toEqual(["你好", "世界"]);
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                action: ACTION.AI_TRANSLATE_TEXT,
                data: expect.objectContaining({ providerId: "p1", requestId: expect.any(String) }),
            }),
            expect.any(Number),
        );
    });

    it("returns [] when background yields no translations", async () => {
        mockSend.mockResolvedValue(undefined);
        const svc = new AiTranslateService("p1");
        expect(await svc.translateText(["hello"], "zh-CN")).toEqual([]);
    });

    it("throws AbortError immediately when the signal is already aborted", async () => {
        const svc = new AiTranslateService("p1");
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(svc.translateText(["x"], "zh-CN", ctrl.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("relays an abort message with the same requestId and throws AbortError", async () => {
        let capturedRequestId: string | undefined;
        let resolveText!: (v: unknown) => void;
        mockSend.mockImplementation((msg: any) => {
            if (msg.action === ACTION.AI_TRANSLATE_TEXT) {
                capturedRequestId = msg.data.requestId;
                return new Promise((r) => (resolveText = r));
            }
            return Promise.resolve(undefined); // the abort message
        });

        const svc = new AiTranslateService("p1");
        const ctrl = new AbortController();
        const p = svc.translateText(["x"], "zh-CN", ctrl.signal);
        ctrl.abort();
        resolveText(undefined);

        await expect(p).rejects.toMatchObject({ name: "AbortError" });
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                action: ACTION.AI_TRANSLATE_ABORT,
                data: { requestId: capturedRequestId },
            }),
        );
    });
});

// ---------------------------------------------------------------------------
// resolveTranslateService + registry
// ---------------------------------------------------------------------------
describe("resolveTranslateService", () => {
    it("resolves built-in services from the shared registry", () => {
        expect(resolveTranslateService(TRANSLATE_SERVICE.GOOGLE)).toBe(googleTranslationService);
        expect(resolveTranslateService(TRANSLATE_SERVICE.MICROSOFT)).toBe(microsoftTranslationService);
        expect(resolveTranslateService(TRANSLATE_SERVICE.DEEPL)).toBe(deeplTranslationService);
    });

    it("creates an AiTranslateService for ai:-prefixed ids", () => {
        const svc = resolveTranslateService(AI_PREFIX + "abc");
        expect(svc).toBeInstanceOf(AiTranslateService);
        expect(svc!.name).toBe(AI_PREFIX + "abc");
    });

    it("returns undefined for an unknown service", () => {
        expect(resolveTranslateService("nope")).toBeUndefined();
    });

    it("registers all three built-ins in translationServices", () => {
        expect(translationServices.get(TRANSLATE_SERVICE.GOOGLE)).toBe(googleTranslationService);
        expect(translationServices.size).toBeGreaterThanOrEqual(3);
    });
});
