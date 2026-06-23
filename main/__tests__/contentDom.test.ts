// @vitest-environment jsdom
//
// Unit tests for the DOM helpers extracted from main/content.ts:
//   - main/dom/predicates.ts
//   - main/dom/textNodes.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
    isEditable,
    isExcludedNodeType,
    isNotMarkElement,
    isNotTranslateElement,
    isParagraphElement,
} from "@/main/dom/predicates";
import {
    removeDuoClassAndAttribute,
    removeTextNodes,
    getTextNodesAndText,
    isContainsValidTextElement,
    getLastContainingTextChild,
} from "@/main/dom/textNodes";

beforeEach(() => {
    document.body.innerHTML = "";
});

/** Parse a fragment and return its first element child. */
function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

// ---------------------------------------------------------------------------
// predicates
// ---------------------------------------------------------------------------
describe("isNotTranslateElement", () => {
    it("is true only for elements marked .duo-no-translate", () => {
        expect(isNotTranslateElement(el('<p class="duo-no-translate">x</p>'))).toBe(true);
        expect(isNotTranslateElement(el("<p>x</p>"))).toBe(false);
    });
});

describe("isExcludedNodeType", () => {
    it("is true for excluded tags (script/style/svg/…), false otherwise", () => {
        expect(isExcludedNodeType(el("<script>1</script>"))).toBe(true);
        expect(isExcludedNodeType(el("<style>1</style>"))).toBe(true);
        expect(isExcludedNodeType(el("<p>1</p>"))).toBe(false);
    });
});

describe("isNotMarkElement", () => {
    it("is true for our own translation output or excluded tags", () => {
        expect(isNotMarkElement(el('<div class="duo-translation">x</div>'))).toBe(true);
        expect(isNotMarkElement(el("<code>x</code>"))).toBe(true);
        expect(isNotMarkElement(el("<p>x</p>"))).toBe(false);
    });
});

describe("isEditable", () => {
    // NOTE: contentEditable is not covered here — jsdom does not implement
    // `HTMLElement.isContentEditable` (it returns false regardless of the
    // attribute), so the contentEditable branch can't be exercised under jsdom.

    it("treats enabled input/textarea as editable, disabled/readonly as not", () => {
        expect(isEditable(el("<input>"))).toBe(true);
        expect(isEditable(el("<textarea></textarea>"))).toBe(true);
        expect(isEditable(el("<input disabled>"))).toBe(false);
        const ro = el("<textarea readonly></textarea>") as HTMLTextAreaElement;
        expect(isEditable(ro)).toBe(false);
    });

    it("is false for plain elements", () => {
        expect(isEditable(el("<p>x</p>"))).toBe(false);
    });
});

describe("isParagraphElement", () => {
    it("is true when there is a direct non-empty text node", () => {
        expect(isParagraphElement(el("<p>hello</p>"))).toBe(true);
        expect(isParagraphElement(el("<p>hi <b>there</b></p>"))).toBe(true);
    });

    it("is false without a direct text node, or with only whitespace/zero-width", () => {
        expect(isParagraphElement(el("<p><span>only child</span></p>"))).toBe(false);
        expect(isParagraphElement(el("<p>   </p>"))).toBe(false);
        expect(isParagraphElement(el("<p>​</p>"))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// textNodes
// ---------------------------------------------------------------------------
describe("removeDuoClassAndAttribute", () => {
    it("strips only duo-* classes and attributes", () => {
        const e = el('<p class="keep duo-paragraph" duo-id="5" title="t">x</p>');
        removeDuoClassAndAttribute(e);
        expect(e.classList.contains("keep")).toBe(true);
        expect(e.classList.contains("duo-paragraph")).toBe(false);
        expect(e.hasAttribute("duo-id")).toBe(false);
        expect(e.getAttribute("title")).toBe("t");
    });
});

describe("removeTextNodes", () => {
    it("removes every text node in the subtree", () => {
        const e = el("<p>a<b>b</b>c</p>");
        removeTextNodes(e);
        expect(e.textContent).toBe("");
        // The <b> element itself remains, just emptied.
        expect(e.querySelector("b")).not.toBeNull();
    });
});

describe("getTextNodesAndText", () => {
    it("concatenates text and collects text nodes, skipping excluded tags", () => {
        const e = el("<p>Hello <b>world</b><script>ignore()</script></p>");
        const { textNodes, text } = getTextNodesAndText(e);
        expect(text).toBe("Hello world");
        expect(textNodes).toHaveLength(2);
    });

    it("ignores zero-width-only text nodes", () => {
        const e = el("<p>​<b>x</b></p>");
        const { textNodes, text } = getTextNodesAndText(e);
        // The leading zero-width text node is stripped; only "x" remains.
        expect(text).toBe("x");
        expect(textNodes).toHaveLength(1);
    });
});

describe("isContainsValidTextElement", () => {
    it("is truthy for a text node or an element containing text", () => {
        const e = el("<p><span>deep</span></p>");
        expect(isContainsValidTextElement(e)).toBe(true);
        expect(isContainsValidTextElement(e.firstChild as Node)).toBe(true);
    });

    it("is falsy for an element with no rendered text", () => {
        const e = el("<p><span></span></p>");
        expect(isContainsValidTextElement(e)).toBeFalsy();
    });
});

describe("getLastContainingTextChild", () => {
    it("returns the last child node that actually contains text", () => {
        const e = el("<p>first<span></span><b>last</b></p>");
        const last = getLastContainingTextChild(e);
        expect((last as HTMLElement).tagName).toBe("B");
    });
});
