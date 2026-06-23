// @vitest-environment jsdom
//
// DOM-dependent tests for main/translateService.ts. These need a browser-
// faithful DOM: the pipeline parses non-standard <b0>/<b1> placeholder tags via
// innerHTML, relies on Node.TEXT_NODE/ELEMENT_NODE, cloneNode, outerHTML and
// .remove(). WxtVitest sets no DOM environment (default is node), so we opt into
// jsdom per-file here. Pure/provider tests live in translateService.test.ts.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/utils/message", () => ({ sendMessageToBackground: vi.fn() }));
vi.mock("@/utils/db", () => ({ getConfig: vi.fn(async () => undefined) }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));

import {
    TranslateService,
    TranslateResult,
    translationServices,
    resetTranslationCacheEnabled,
    getTranslateResult,
    translate,
    restore,
    getElementPreProcessResult,
    updateTranslateElementContent,
    DeepLTranslateService,
} from "@/main/translateService";
import { VIEW_STRATEGY } from "@/main/constants";
import { sendMessageToBackground } from "@/utils/message";

const mockSend = sendMessageToBackground as unknown as Mock;

/** A controllable in-memory provider, registered into the shared registry. */
class FakeService extends TranslateService {
    readonly name = "fake";
    constructor(private fn: (texts: string[]) => TranslateResult[]) {
        super();
    }
    async translateText(texts: string[]) {
        return this.fn(texts);
    }
    async translateHtml() {
        return [];
    }
}

function registerFake(fn: (texts: string[]) => TranslateResult[]) {
    translationServices.set("fake", new FakeService(fn));
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    // Bypass the cache so getTranslateResult calls the provider directly.
    resetTranslationCacheEnabled(false);
});

// ---------------------------------------------------------------------------
// getElementPreProcessResult
// ---------------------------------------------------------------------------
describe("getElementPreProcessResult", () => {
    it("maps non-empty child elements to <bN> placeholders (SINGLE)", () => {
        document.body.innerHTML = "<p>Hello <b>world</b></p>";
        const p = document.body.querySelector("p")!;
        const res = getElementPreProcessResult(p, VIEW_STRATEGY.SINGLE);

        expect(res.mappedHtmlText).toBe("Hello <b0>world</b0>");
        expect(res.text).toBe("Hello world");
        expect(res.elements[0]).toBe(p);
        expect(res.elements[1]).toBe(p.querySelector("b"));
        expect(res.textNodes).toHaveLength(2);
        expect(res.totalTextNodesLength).toBe("Hello world".length);
    });

    it("drops empty child elements from the mapping and the DOM (DOUBLE)", () => {
        document.body.innerHTML = "<p>Hi<span></span></p>";
        const p = document.body.querySelector("p")!;
        const res = getElementPreProcessResult(p, VIEW_STRATEGY.DOUBLE);

        expect(res.mappedHtmlText).toBe("Hi");
        // Empty <span> is removed in DOUBLE mode.
        expect(p.querySelector("span")).toBeNull();
    });

    it("ignores zero-width-only text nodes", () => {
        document.body.innerHTML = "<p>​<b>x</b></p>";
        const p = document.body.querySelector("p")!;
        const res = getElementPreProcessResult(p, VIEW_STRATEGY.SINGLE);
        // The zero-width text node is not counted; only "x" inside <b>.
        expect(res.text).toBe("​x");
        expect(res.mappedHtmlText).toContain("<b0>x</b0>");
    });
});

// ---------------------------------------------------------------------------
// updateTranslateElementContent
// ---------------------------------------------------------------------------
describe("updateTranslateElementContent", () => {
    it("writes a plain translated text node into the container element", () => {
        document.body.innerHTML = "<p></p>";
        const p = document.body.querySelector("p")!;
        updateTranslateElementContent("你好", [p]);
        expect(p.textContent).toBe("你好");
    });

    it("re-attaches mapped <bN> children to their original elements", () => {
        document.body.innerHTML = "<p></p>";
        const p = document.body.querySelector("p")!;
        const b = document.createElement("b"); // stands in for B0
        updateTranslateElementContent("<b0>世界</b0>", [p, b]);
        expect(p.querySelector("b")).toBe(b);
        expect(b.textContent).toBe("世界");
    });

    it("is a no-op for empty html or no elements", () => {
        document.body.innerHTML = "<p>keep</p>";
        const p = document.body.querySelector("p")!;
        updateTranslateElementContent("", [p]);
        expect(p.textContent).toBe("keep");
        updateTranslateElementContent("x", []);
        expect(p.textContent).toBe("keep");
    });
});

// ---------------------------------------------------------------------------
// getTranslateResult -> translate / restore  (full orchestration)
// ---------------------------------------------------------------------------
describe("getTranslateResult + translate/restore (SINGLE)", () => {
    it("preprocesses, translates via the provider, and annotates results", async () => {
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")!;
        registerFake((texts) => texts.map((t) => new TranslateResult(`译:${t}`, "en", 1)));

        const results = await getTranslateResult("fake", [p], "zh-CN", VIEW_STRATEGY.SINGLE);

        expect(results).toHaveLength(1);
        expect(results[0].translatedMappedHtmlText).toBe("译:Hello");
        expect(results[0].rawMappedHtmlText).toBe("Hello");
        expect(results[0].rawText).toBe("Hello");
        expect(results[0].originalSliceElement?.[0]).toBe(p);
    });

    it("translate() writes the translation into the DOM; restore() puts the original back", async () => {
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")!;
        registerFake(() => [new TranslateResult("你好", "en", 1)]);

        const results = await getTranslateResult("fake", [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        await translate(results);
        expect(p.textContent).toContain("你好");

        await restore(results);
        expect(p.textContent).toContain("Hello");
    });

    it("drops paragraphs whose translation equals the source", async () => {
        document.body.innerHTML = "<p>same</p>";
        const p = document.body.querySelector("p")!;
        // Echo the input -> treated as 'unchanged' and filtered out.
        registerFake((texts) => texts.map((t) => new TranslateResult(t, "en", 1)));

        const results = await getTranslateResult("fake", [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        expect(results).toHaveLength(0);
    });

    it("returns [] when the service is unknown", async () => {
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")!;
        const results = await getTranslateResult("does-not-exist", [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        expect(results).toEqual([]);
    });
});

describe("getTranslateResult (DOUBLE)", () => {
    it("prepares a translated copy element without mutating the original text", async () => {
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")!;
        registerFake(() => [new TranslateResult("你好", "en", 1)]);

        const results = await getTranslateResult("fake", [p], "zh-CN", VIEW_STRATEGY.DOUBLE);

        expect(results).toHaveLength(1);
        expect(results[0].translatedMappedHtmlText).toBe("你好");
        expect(results[0].translatedCopyElement).toBeDefined();
        // Original paragraph text is untouched at this stage.
        expect(p.textContent).toBe("Hello");
    });
});

// ---------------------------------------------------------------------------
// translateHtml (DeepL — the provider that surfaces translatedHtmlText)
// ---------------------------------------------------------------------------
describe("DeepLTranslateService.translateHtml", () => {
    it("sends element outerHTML with tag_handling=html and surfaces the HTML result", async () => {
        mockSend.mockResolvedValue({
            translations: [{ text: "<p>你好</p>", detected_source_language: "EN" }],
        });
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")! as HTMLElement;

        const out = await new DeepLTranslateService().translateHtml([p], "zh-CN");

        expect(out[0].translatedHtmlText).toBe("<p>你好</p>");
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    body: expect.objectContaining({ tag_handling: "html" }),
                }),
            }),
        );
    });
});
