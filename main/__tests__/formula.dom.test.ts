// @vitest-environment jsdom
//
// Rendered formulas (KaTeX / MathJax / MathML) are opaque to the translation
// pipeline: never a unit of their own, never read into a sentence's
// serialization, and carried through a translation as one empty placeholder
// that only says where the formula goes. The pieces live in several modules
// (predicates, textNodes, segments, unitCoverage, translateClient, lang) and
// only work when they all agree, so they are pinned together here.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

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
} from "@/main/translateClient";
import { TRANSLATE_SERVICE, VIEW_STRATEGY } from "@/main/constants";
import { abortableRequest } from "@/utils/abortableRequest";
import { isFormulaElement, isNotMarkElement } from "@/main/dom/predicates";
import { segmentParagraph } from "@/main/dom/segments";
import { getTextNodesAndText, hasTranslatableText } from "@/main/dom/textNodes";
import { planUnit } from "@/main/dom/unitCoverage";
import { getElementTextContent } from "@/main/lang";

const mockTranslate = abortableRequest as unknown as Mock;

function registerFake(fn: (texts: string[]) => TranslateResult[]) {
    mockTranslate.mockImplementation(async (opts: any) => fn(opts.data.texts));
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

/** What KaTeX emits for `$<glyphs>$`: assistive MathML + TeX source + visual spans. */
function katex(glyphs: string): string {
    return (
        '<span class="katex">' +
        '<span class="katex-mathml"><math><semantics><mrow><mi>' + glyphs + "</mi></mrow>" +
        '<annotation encoding="application/x-tex">' + glyphs + "</annotation></semantics></math></span>" +
        '<span class="katex-html" aria-hidden="true"><span class="base"><span class="mord mathnormal">' +
        glyphs + "</span></span></span>" +
        "</span>"
    );
}

describe("isFormulaElement", () => {
    it.each([
        ['<span class="katex">x</span>', "KaTeX"],
        ['<span class="foo katex bar">x</span>', "KaTeX among other classes"],
        ["<mjx-container>x</mjx-container>", "MathJax v3"],
        ['<span class="MathJax">x</span>', "MathJax v2 HTML-CSS"],
        ['<span class="mjx-chtml MathJax_CHTML">x</span>', "MathJax v2 CommonHTML"],
        ['<span class="MathJax_Preview">x</span>', "MathJax v2 preview"],
        ["<math><mi>x</mi></math>", "native MathML"],
    ])("recognizes %s (%s)", (html) => {
        const node = el(html);
        expect(isFormulaElement(node)).toBe(true);
        expect(isNotMarkElement(node)).toBe(true);
    });

    it.each([
        "<span>x</span>",
        '<span class="katex-display">x</span>', // the wrapper; the .katex inside answers
        '<span class="katexify">x</span>',
        '<span class="not-MathJax">x</span>',
        '<div class="mathematics">x</div>',
    ])("does not claim %s", (html) => {
        expect(isFormulaElement(el(html))).toBe(false);
    });

    it("answers false for non-element nodes", () => {
        expect(isFormulaElement(document.createTextNode("x"))).toBe(false);
        expect(isFormulaElement(document.createDocumentFragment())).toBe(false);
    });
});

describe("formulas and segmentation", () => {
    it("an inline formula stays part of its sentence — one whole-element unit", () => {
        const p = el(`<p>A skill ${katex("s")} maps inputs to outputs.</p>`);
        const scan = segmentParagraph(p);
        expect(scan.units).toHaveLength(1);
        expect(scan.units[0].wholeElement).toBe(true);
        expect(scan.descendChildren).toHaveLength(0);
    });

    it("a display formula is not a unit, and nothing inside it qualifies one", () => {
        const display = el(`<span class="katex-display">${katex("Inner: c = arg max J")}</span>`);
        expect(hasTranslatableText(display)).toBe(false);
        const scan = segmentParagraph(display);
        expect(scan.units).toHaveLength(0);
        // The scan is handed the formula and refuses it there.
        expect(scan.descendChildren.every(isNotMarkElement)).toBe(true);
    });

    it("a run of nothing but formulas is not a unit", () => {
        const div = el(`<div>${katex("x")}${katex("y")}</div>`);
        expect(segmentParagraph(div).units).toHaveLength(0);
    });
});

describe("formulas and text collection", () => {
    it("getTextNodesAndText leaves formula text out", () => {
        const p = el(`<p>A skill ${katex("s")} maps.</p>`);
        const res = getTextNodesAndText(p);
        expect(res.text).toBe("A skill  maps.");
        expect(res.textNodes).toHaveLength(2);
    });

    it("the language sample leaves formula text out", () => {
        const p = el(`<p>A skill ${katex("sss")} maps.</p>`);
        expect(getElementTextContent(p)).toBe("A skillmaps.");
    });

    it("a translated unit holding a formula is still accounted for (no perpetual re-translation)", () => {
        const p = el(`<p>A skill ${katex("s")} maps.</p>`);
        const unit = segmentParagraph(p).units[0];
        const covered = getTextNodesAndText(p).textNodes;
        expect(planUnit(unit, [{ covered }], undefined).action).toBe("skip");
    });
});

describe("formulas and serialization", () => {
    it("SINGLE: the formula is one empty placeholder and none of its nodes are collected", () => {
        const p = el(`<p>A skill ${katex("s")} maps <b>inputs</b>.</p>`);
        const res = getElementPreProcessResult(p, VIEW_STRATEGY.SINGLE);
        expect(res.mappedHtmlText).toBe("A skill <b0></b0> maps <b1>inputs</b1>.");
        expect(res.text).toBe("A skill  maps inputs.");
        expect(res.textNodes.every((n) => !n.parentElement!.closest(".katex"))).toBe(true);
        expect(res.elements[1]).toBe(p.querySelector(".katex"));
    });

    it("DOUBLE: same serialization, and the formula survives in the copy — even with no text in it", () => {
        const p = el(`<p>A skill ${katex("s")} maps <i><mjx-container></mjx-container></i> here.</p>`);
        const copy = p.cloneNode(true) as HTMLElement;
        const res = getElementPreProcessResult(copy, VIEW_STRATEGY.DOUBLE);
        expect(res.mappedHtmlText).toBe("A skill <b0></b0> maps <b1><b2></b2></b1> here.");
        expect(copy.querySelector(".katex")).not.toBeNull();
        expect(copy.querySelector(".katex-html")!.textContent).toBe("s");
        expect(copy.querySelector("i > mjx-container")).not.toBeNull();
    });

    it("serializes identically under both strategies", () => {
        const html = `<p>Let ${katex("x")} be ${katex("y")}.</p>`;
        const single = getElementPreProcessResult(el(html), VIEW_STRATEGY.SINGLE).mappedHtmlText;
        const double = getElementPreProcessResult(el(html), VIEW_STRATEGY.DOUBLE).mappedHtmlText;
        expect(single).toBe("Let <b0></b0> be <b1></b1>.");
        expect(double).toBe(single);
    });
});

describe("formulas through a translation round-trip", () => {
    it("SINGLE: the formula is moved to where the translation puts it, untouched, and restore puts it back", async () => {
        const p = el(`<p>If ${katex("x")} holds, stop.</p>`);
        const formula = p.querySelector(".katex")!;
        const formulaHtml = formula.outerHTML;
        // The translated sentence wants the formula after the first clause.
        registerFake(() => [new TranslateResult("如果成立<b0></b0>，停止。", "en", 1)]);

        const results = await getTranslateResult("microsoft", [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        expect(mockTranslate.mock.calls[0][0].data.texts).toEqual(["If <b0></b0> holds, stop."]);
        await translate("microsoft", results);

        expect(p.querySelector(".katex")).toBe(formula);
        expect(formula.outerHTML).toBe(formulaHtml);
        expect(p.textContent).toBe("如果成立" + formula.textContent + "，停止。");

        await restore(results);
        expect(formula.outerHTML).toBe(formulaHtml);
        expect(p.textContent).toBe("If " + formula.textContent + " holds, stop.");
    });

    it("DOUBLE: the copy carries the formula at its translated position and the page is untouched", async () => {
        const p = el(`<p>If ${katex("x")} holds, stop.</p>`);
        const before = p.innerHTML;
        registerFake(() => [new TranslateResult("如果成立<b0></b0>，停止。", "en", 1)]);

        const results = await getTranslateResult("microsoft", [p], "zh-CN", VIEW_STRATEGY.DOUBLE);
        await translate("microsoft", results);

        expect(p.innerHTML).toBe(before);
        const copy = results[0].translatedCopyElement!;
        const formula = copy.querySelector(".katex")!;
        expect(formula.outerHTML).toBe(p.querySelector(".katex")!.outerHTML);
        expect(copy.textContent).toBe("如果成立" + formula.textContent + "，停止。");
    });
});

describe("formulas on the Google path (text-node slots)", () => {
    it("gives each formula an empty slot at its place, numbered after the text nodes", async () => {
        const p = el(`<p>If ${katex("x")} holds, ${katex("y")}</p>`);
        registerFake((texts) => texts.map((t) => new TranslateResult(t + " ", "en", 1)));
        await getTranslateResult(TRANSLATE_SERVICE.GOOGLE, [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        expect(mockTranslate.mock.calls[0][0].data.texts).toEqual([
            "<a i=0>If </a><a i=2></a><a i=1> holds, </a><a i=3></a>",
        ]);
    });

    it("SINGLE: places the formula where its slot comes back", async () => {
        const p = el(`<p>${katex("x")} is large when trained.</p>`);
        const formula = p.querySelector(".katex")!;
        const formulaHtml = formula.outerHTML;
        // Source: <a i=1></a><a i=0> is large when trained.</a>
        registerFake(() => [new TranslateResult("<a i=0>训练后，</a><a i=1></a>很大。", "en", 1)]);

        const results = await getTranslateResult(TRANSLATE_SERVICE.GOOGLE, [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        await translate(TRANSLATE_SERVICE.GOOGLE, results);

        expect(formula.outerHTML).toBe(formulaHtml);
        expect(p.textContent).toBe("训练后，" + formula.textContent + "很大。");
    });

    it("DOUBLE: same, inside the copy", async () => {
        const p = el(`<p>If ${katex("x")} holds, stop.</p>`);
        const before = p.innerHTML;
        // Source: <a i=0>If </a><a i=2></a><a i=1> holds, stop.</a>
        registerFake(() => [new TranslateResult("<a i=0>如果</a><a i=2></a><a i=1>成立，停止。</a>", "en", 1)]);

        const results = await getTranslateResult(TRANSLATE_SERVICE.GOOGLE, [p], "zh-CN", VIEW_STRATEGY.DOUBLE);
        await translate(TRANSLATE_SERVICE.GOOGLE, results);

        expect(p.innerHTML).toBe(before);
        const copy = results[0].translatedCopyElement!;
        const formula = copy.querySelector(".katex")!;
        expect(copy.textContent).toBe("如果" + formula.textContent + "成立，停止。");
    });

    it("a formula inside an inline child stays inside it", async () => {
        const p = el(`<p>Note: <b>when ${katex("x")} holds</b> stop.</p>`);
        // Source: <a i=0>Note: </a><a i=1>when </a><a i=4></a><a i=2> holds</a><a i=3> stop.</a>
        registerFake(() => [new TranslateResult(
            "<a i=0>注意：</a><a i=1>当</a><a i=4></a><a i=2>成立时</a><a i=3>停止。</a>", "en", 1,
        )]);
        const results = await getTranslateResult(TRANSLATE_SERVICE.GOOGLE, [p], "zh-CN", VIEW_STRATEGY.SINGLE);
        await translate(TRANSLATE_SERVICE.GOOGLE, results);

        const b = p.querySelector("b")!;
        expect(b.querySelector(".katex")).not.toBeNull();
        expect(p.textContent).toBe("注意：当" + b.querySelector(".katex")!.textContent + "成立时停止。");
    });
});
