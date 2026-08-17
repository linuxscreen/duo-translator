// @vitest-environment jsdom
//
// Unit tests for main/dom/unitCoverage.ts — "what has to happen to this run?",
// answered from our own bookkeeping instead of from where our output happens to
// sit in the DOM.
import { describe, it, expect, beforeEach } from "vitest";
import { segmentParagraph, type TranslationUnit } from "@/main/dom/segments";
import { planUnit } from "@/main/dom/unitCoverage";

beforeEach(() => {
    document.body.innerHTML = "";
});

function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

/** The unit of `container` whose nodes include `node`. */
function unitOf(container: HTMLElement, node: Node): TranslationUnit {
    return segmentParagraph(container).units.find((u) => u.nodes.includes(node as ChildNode))!;
}

/** Everything a text node's owning container currently holds, in order. */
function textsIn(container: HTMLElement): Text[] {
    const out: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) out.push(walker.currentNode as Text);
    return out;
}

describe("planUnit — never translated", () => {
    it("asks for a translation for a container we have never seen", () => {
        const p = el("<p>Hello world.</p>");
        expect(planUnit(segmentParagraph(p).units[0], undefined, undefined)).toEqual({ action: "translate" });
    });

    it("asks again once the page replaces the text we recorded", () => {
        const p = el("<p>你好世界。</p>");
        const result = { replacedTextNodes: textsIn(p) };
        p.textContent = "Something else entirely.";

        const unit = segmentParagraph(p).units[0];
        expect(planUnit(unit, undefined, [result]).action).toBe("translate");
    });

    it("ignores records whose nodes the page has detached", () => {
        const p = el("<p>Hello world.</p>");
        const stale = document.createTextNode("gone");
        expect(planUnit(segmentParagraph(p).units[0], [{ covered: [stale] }], undefined).action).toBe("translate");
    });
});

describe("planUnit — already translated and unchanged", () => {
    it("skips a run whose translation sits next to it (DOUBLE marker, no record)", () => {
        const p = el(
            '<p>Hello world.<br class="duo-divide"><span class="duo-translation">你好</span></p>'
        );
        expect(planUnit(segmentParagraph(p).units[0], undefined, undefined).action).toBe("skip");
    });

    // The SINGLE view writes the translation into the page's own text nodes and
    // leaves no marker at all, so the adjacency signal above is blind to it.
    // Without the record, every re-scan treats the paragraph as fresh work.
    it("skips a SINGLE-covered run with no marker anywhere", () => {
        const p = el("<p>你好世界。</p>");
        const unit = segmentParagraph(p).units[0];
        const result = { replacedTextNodes: textsIn(p) };
        expect(planUnit(unit, undefined, [result]).action).toBe("skip");
    });

    // A block inserted between the run and its translation flushes the run
    // before `.duo-translation` is seen, so the adjacency signal goes false and
    // the paragraph would be translated a second time. The record still knows.
    it("skips when a block was inserted between the run and its translation", () => {
        const p = el(
            '<p>Hello world.<br class="duo-divide"><span class="duo-translation">你好</span></p>'
        );
        const covered = [p.firstChild as Text];
        const toolbar = document.createElement("div");
        toolbar.textContent = "Share";
        p.insertBefore(toolbar, p.querySelector(".duo-divide"));

        const unit = unitOf(p, p.firstChild!);
        expect(unit.translated).toBe(false); // the adjacency signal is gone
        expect(planUnit(unit, [{ covered }], undefined).action).toBe("skip");
    });

    it("counts a recorded node nested inside one of the run's elements", () => {
        // The recorded nodes are whole-subtree text nodes, not just the direct
        // children — `<p>Hello <b>world</b></p>` records the <b>'s text too.
        const p = el("<p>Hello <b>world</b>.</p>");
        const covered = textsIn(p);
        const unit = segmentParagraph(p).units[0];
        expect(planUnit(unit, [{ covered }], undefined).action).toBe("skip");
    });

    // The <duo-span> highlight fallback empties the run's own text nodes and
    // puts the text into wrappers of ours. Counting those as page content would
    // mark every highlighted paragraph as changed on the very next scan.
    it("does not read its own highlight wrappers as new page content", () => {
        const p = el("<p>Hello world.</p>");
        const original = p.firstChild as Text;
        const wrapper = document.createElement("duo-span");
        wrapper.textContent = original.textContent;
        p.insertBefore(wrapper, original);
        original.textContent = "";
        const divide = document.createElement("br");
        divide.className = "duo-divide";
        const translation = document.createElement("span");
        translation.className = "duo-translation";
        translation.textContent = "你好世界。";
        p.append(divide, translation);

        const unit = unitOf(p, wrapper);
        expect(planUnit(unit, [{ covered: [original] }], undefined).action).toBe("skip");
    });

    // The covered set is built with `contentVisible`, so the whitespace between
    // inline children is in it. A framework re-render that normalizes one away
    // must not read as a changed run and cost a request for a cosmetic edit.
    it("does not treat whitespace the page removed as a change", () => {
        const p = el("<p><span>Hello </span> <span>brave world.</span></p>");
        const covered = textsIn(p);
        expect(covered).toHaveLength(3); // the gap between the spans is one of them
        p.removeChild(p.childNodes[1]);

        const unit = unitOf(p, p.firstChild!);
        expect(planUnit(unit, [{ covered }], undefined).action).toBe("skip");
    });

    it("does not treat whitespace the page added as a change", () => {
        const p = el("<p>你好世界。</p>");
        const result = { replacedTextNodes: textsIn(p) };
        p.appendChild(document.createTextNode("\n   "));

        const unit = unitOf(p, p.firstChild!);
        expect(planUnit(unit, undefined, [result]).action).toBe("skip");
    });

    it("does not let one unit's record cover a sibling unit", () => {
        const div = el("<div>first<br><br>second</div>");
        const [first, second] = segmentParagraph(div).units;
        const covered = [first.nodes[0] as Text];
        expect(planUnit(first, [{ covered }], undefined).action).toBe("skip");
        expect(planUnit(second, [{ covered }], undefined).action).toBe("translate");
    });
});

describe("planUnit — the run changed", () => {
    // Requirement 2. A translation cannot be composed from parts, so a run that
    // grew has to go out again as a whole — and the record it supersedes has to
    // come back with the verdict, since the caller has to take it down.
    it("asks to replace when the page appended text to a covered run", () => {
        const p = el("<p>你好世界。</p>");
        const result = { replacedTextNodes: textsIn(p) };
        p.appendChild(document.createElement("span")).textContent = "New";

        const unit = unitOf(p, p.firstChild!);
        expect(planUnit(unit, undefined, [result])).toEqual({ action: "replace", single: result });
    });

    it("asks to replace when a mergeable span joined the run (DOUBLE)", () => {
        const p = el("<p><span>Hello </span><span>brave world.</span></p>");
        const record = { covered: textsIn(p) };
        const divide = document.createElement("br");
        divide.className = "duo-divide";
        const translation = document.createElement("span");
        translation.className = "duo-translation";
        translation.textContent = "你好，勇敢的世界。";
        p.append(divide, translation);
        // The page appends AFTER our translation — segmentation steps over the
        // markers, so the late span joins the very same run.
        const late = document.createElement("span");
        late.textContent = " And more text.";
        p.appendChild(late);

        const unit = unitOf(p, late);
        expect(planUnit(unit, [record], undefined)).toEqual({ action: "replace", duo: record });
    });

    it("asks to replace when part of the covered run was removed", () => {
        const p = el("<p><span>Hello </span><span>brave world.</span></p>");
        const covered = textsIn(p);
        p.lastElementChild!.remove();
        p.appendChild(document.createElement("span")).textContent = "kind world.";

        const unit = unitOf(p, p.firstChild!);
        expect(planUnit(unit, [{ covered }], undefined).action).toBe("replace");
    });

    // The adjacent-translation signal is the fallback for a run we no longer
    // have bookkeeping for; a record that DOES match must outrank it, or a
    // DOUBLE unit could never be recognized as changed.
    it("outranks the adjacent-translation signal", () => {
        const p = el("<p>Hello world.</p>");
        const covered = [p.firstChild as Text];
        const divide = document.createElement("br");
        divide.className = "duo-divide";
        const translation = document.createElement("span");
        translation.className = "duo-translation";
        translation.textContent = "你好世界。";
        p.append(divide, translation);
        p.appendChild(document.createElement("span")).textContent = "New";

        const unit = unitOf(p, p.firstChild!);
        expect(unit.translated).toBe(true);
        expect(planUnit(unit, [{ covered }], undefined).action).toBe("replace");
    });
});
