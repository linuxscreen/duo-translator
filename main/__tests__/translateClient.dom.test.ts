// @vitest-environment jsdom
//
// DOM-dependent tests for main/translateClient.ts. These need a browser-
// faithful DOM: the pipeline parses non-standard <b0>/<b1> placeholder tags via
// innerHTML, relies on Node.TEXT_NODE/ELEMENT_NODE, cloneNode, outerHTML and
// .remove(). WxtVitest sets no DOM environment (default is node), so we opt into
// jsdom per-file here. Pure/provider tests live in translateClient.test.ts.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// The providers now run in background, so the seam for these orchestration
// tests is the message client. abortableRequest lives in its own module
// precisely so it can be intercepted here (a helper defined inside
// utils/message.ts would call its own binding and escape the mock).
const { abortStub } = vi.hoisted(() => ({ abortStub: vi.fn() }));
vi.mock("@/utils/abortableRequest", () => ({ abortableRequest: abortStub }));
vi.mock("@/utils/message", () => ({
    sendMessageToBackground: vi.fn(),
    sendMessageToBackgroundOrThrow: vi.fn(),
}));
vi.mock("@/utils/db", () => ({ getConfig: vi.fn(async () => undefined) }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));

import {
    TranslateResult,
    getTranslateResult,
    translate,
    restore,
    getElementPreProcessResult,
    updateTranslateElementContent,
} from "@/main/translateClient";
import { VIEW_STRATEGY } from "@/main/constants";
import { abortableRequest } from "@/utils/abortableRequest";

const mockTranslate = abortableRequest as unknown as Mock;

/**
 * Stand in for the background translation service: `fn` receives the texts the
 * orchestration layer extracted and returns the results it would have gotten.
 */
function registerFake(fn: (texts: string[]) => TranslateResult[]) {
    mockTranslate.mockImplementation(async (opts: any) => fn(opts.data.texts));
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
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
        const res = getElementPreProcessResult(p, VIEW_STRATEGY.DOUBLE);
        // The zero-width text node is not counted; only "x" inside <b>.
        expect(res.text).toBe('x');
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
        expect(results[0].originalSliceElements?.[0]).toBe(p);
    });

    it("translate() writes the translation into the DOM; restore() puts the original back", async () => {
        document.body.innerHTML = "<p>Hello</p>";
        const p = document.body.querySelector("p")!;
        registerFake(() => [new TranslateResult("你好", "en", 1)]);

        const results = await getTranslateResult("fake", [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        await translate("fake", results);
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
// TranslationUnit path (logical paragraphs)
// ---------------------------------------------------------------------------
import { segmentParagraph } from "@/main/dom/segments";

describe("getElementPreProcessResult — per-unit node lists", () => {
    it("serializes only the given nodes, <bN> numbered from 0 per unit (SINGLE)", () => {
        document.body.innerHTML = "<div>A <b>x</b><ul><li>ignored</li></ul>B <i>y</i></div>";
        const div = document.body.querySelector("div")! as HTMLElement;
        const units = segmentParagraph(div).units;
        expect(units).toHaveLength(2);

        const res1 = getElementPreProcessResult(div, VIEW_STRATEGY.SINGLE, units[0].nodes);
        expect(res1.mappedHtmlText).toBe("A <b0>x</b0>");
        expect(res1.elements[0]).toBe(div);
        expect(res1.elements[1]).toBe(div.querySelector("b"));

        const res2 = getElementPreProcessResult(div, VIEW_STRATEGY.SINGLE, units[1].nodes);
        expect(res2.mappedHtmlText).toBe("B <b0>y</b0>");
        expect(res2.mappedHtmlText).not.toContain("ignored");
    });
});

describe("getElementPreProcessResult — the translating indicator", () => {
    // The whole-element path re-reads element.childNodes at preprocessing time,
    // i.e. AFTER the marker for this very batch was inserted. Serializing it
    // would ship scaffolding to the provider and change the cache key of every
    // paragraph translated while a spinner is up.
    it("is never serialized, and does not shift the <bN> numbering", () => {
        document.body.innerHTML = "<p>Hello <b>world</b></p>";
        const p = document.body.querySelector("p")! as HTMLElement;
        const clean = getElementPreProcessResult(p, VIEW_STRATEGY.SINGLE);

        document.body.innerHTML = "<p><duo-loading></duo-loading>Hello <b>world</b><duo-loading></duo-loading></p>";
        const marked = document.body.querySelector("p")! as HTMLElement;
        const withMarkers = getElementPreProcessResult(marked, VIEW_STRATEGY.SINGLE);

        expect(withMarkers.mappedHtmlText).toBe(clean.mappedHtmlText);
        expect(withMarkers.elements).toHaveLength(clean.elements.length);
    });
});

describe("getTranslateResult — TranslationUnit input", () => {
    it("whole-element unit produces byte-identical provider text (SINGLE and DOUBLE)", async () => {
        for (const strategy of [VIEW_STRATEGY.SINGLE, VIEW_STRATEGY.DOUBLE]) {
            const seen: string[][] = [];
            registerFake((texts) => {
                seen.push([...texts]);
                return texts.map((t) => new TranslateResult(`译:${t}`, "en", 1));
            });

            document.body.innerHTML = "<p>Hello <b>world</b></p>";
            const legacy = document.body.querySelector("p")! as HTMLElement;
            await getTranslateResult("fake", [legacy], "zh-CN", strategy);

            document.body.innerHTML = "<p>Hello <b>world</b></p>";
            const fresh = document.body.querySelector("p")! as HTMLElement;
            const units = segmentParagraph(fresh).units;
            expect(units[0].wholeElement).toBe(true);
            await getTranslateResult("fake", units, "zh-CN", strategy);

            expect(seen[1]).toEqual(seen[0]);
            expect(seen[0]).toEqual(["Hello <b0>world</b0>"]);
        }
    });

    it("multi-unit container sends one text per unit, excluding block children", async () => {
        const seen: string[][] = [];
        registerFake((texts) => {
            seen.push([...texts]);
            return texts.map((t) => new TranslateResult(`译:${t}`, "en", 1));
        });
        document.body.innerHTML = "<div>first part<ul><li>skip me</li></ul>second part</div>";
        const div = document.body.querySelector("div")! as HTMLElement;
        const units = segmentParagraph(div).units;

        const results = await getTranslateResult("fake", units, "zh-CN", VIEW_STRATEGY.SINGLE);

        expect(seen[0]).toEqual(["first part", "second part"]);
        expect(results).toHaveLength(2);
        expect(results[0].unit).toBe(units[0]);
        expect(results[1].unit).toBe(units[1]);
    });
});

describe("SINGLE per-unit write-back and restore", () => {
    it("keeps each unit's translation in place around the block child, and restores", async () => {
        registerFake((texts) => texts.map((t) => new TranslateResult(`译:${t}`, "en", 1)));
        document.body.innerHTML = "<div>first part<ul><li>keep</li></ul>second part</div>";
        const div = document.body.querySelector("div")! as HTMLElement;
        const ul = div.querySelector("ul")!;
        const units = segmentParagraph(div).units;

        const results = await getTranslateResult("fake", units, "zh-CN", VIEW_STRATEGY.SINGLE);
        await translate("fake", results);

        // Translated text stays in its unit's position: before / after the <ul>.
        expect((div.firstChild as Text).textContent).toBe("译:first part");
        expect(div.firstChild!.nextSibling).toBe(ul);
        expect(div.lastChild!.textContent).toBe("译:second part");
        expect(ul.textContent).toBe("keep");

        await restore(results);
        expect((div.firstChild as Text).textContent).toBe("first part");
        expect(div.firstChild!.nextSibling).toBe(ul);
        expect(div.lastChild!.textContent).toBe("second part");
    });
});

describe("updateTranslateElementContent — scoped to a unit range", () => {
    it("only touches direct text nodes inside the range", () => {
        document.body.innerHTML = "<div>one<ul><li>k</li></ul>two</div>";
        const div = document.body.querySelector("div")! as HTMLElement;
        const ul = div.querySelector("ul")!;

        updateTranslateElementContent("新二", [div], { start: ul, end: null });

        expect(div.firstChild!.textContent).toBe("one");
        expect(div.lastChild!.textContent).toBe("新二");
        expect(div.lastChild!.previousSibling).toBe(ul);
    });
});

describe("a ShadowRoot as the unit container", () => {
    it("serializes byte-identically to the same markup in the light DOM", () => {
        // The translation cache is keyed on this string, so a shadow paragraph
        // must produce the SAME key as the light-DOM paragraph it mirrors —
        // otherwise every component page starts cold and re-pays for text the
        // cache already holds.
        document.body.innerHTML = "<div id='light'>Hello <b>world</b></div><div id='host'></div>";
        const light = document.getElementById("light") as HTMLElement;
        const root = document.getElementById("host")!.attachShadow({ mode: "open" });
        root.innerHTML = "Hello <b>world</b>";

        const fromLight = getElementPreProcessResult(light, VIEW_STRATEGY.DOUBLE);
        const fromShadow = getElementPreProcessResult(root, VIEW_STRATEGY.DOUBLE);

        expect(fromShadow.mappedHtmlText).toBe(fromLight.mappedHtmlText);
        expect(fromShadow.text).toBe(fromLight.text);
    });

    it("writes back into the root through updateTranslateElementContent", () => {
        document.body.innerHTML = "<div id='host'></div>";
        const root = document.getElementById("host")!.attachShadow({ mode: "open" });
        root.innerHTML = "Hello <b>world</b>";

        const pre = getElementPreProcessResult(root, VIEW_STRATEGY.SINGLE);
        pre.textNodes.forEach((t) => (t.textContent = ""));
        // Same shape as the real pipeline: `mappedHtmlText` is the scratch
        // div's innerHTML, so there is no wrapper element around it.
        updateTranslateElementContent("\u4f60\u597d <b0>\u4e16\u754c</b0>", pre.elements);

        expect(root.textContent).toContain("\u4f60\u597d");
        expect(root.querySelector("b")?.textContent).toBe("\u4e16\u754c");
    });
});
