// @vitest-environment jsdom
//
// Undoing the characters a printable-key shortcut types on its way to firing
// (main/dom/typedEcho.ts). The <input>/<textarea> half only: jsdom reports
// `isContentEditable` as false regardless of the attribute and has no
// execCommand, so the rich-editor path belongs to manual/e2e territory.
import { describe, it, expect, beforeEach } from "vitest";
import { removeTypedEcho } from "@/main/dom/typedEcho";

function field(value: string, caret = value.length): HTMLTextAreaElement {
    const el = document.createElement("textarea");
    el.value = value;
    document.body.appendChild(el);
    el.setSelectionRange(caret, caret);
    return el;
}

describe("removeTypedEcho", () => {
    beforeEach(() => { document.body.innerHTML = ""; });

    it("removes the run sitting before the caret and leaves the caret there", () => {
        const el = field("hello   ");
        expect(removeTypedEcho(el, "   ")).toBe(true);
        expect(el.value).toBe("hello");
        expect(el.selectionStart).toBe(5);
    });

    it("cuts at the caret, not at the end of the value", () => {
        // "hello  |world" — the shortcut was typed mid-text.
        const el = field("hello  world", 7);
        expect(removeTypedEcho(el, "  ")).toBe(true);
        expect(el.value).toBe("helloworld");
        expect(el.selectionStart).toBe(5);
    });

    it("fires input so a controlled component sees the change", () => {
        const el = field("hi  ");
        let seen = "";
        el.addEventListener("input", () => { seen = el.value; });
        expect(removeTypedEcho(el, "  ")).toBe(true);
        expect(seen).toBe("hi");
    });

    it("refuses when those characters are not there — deleting the user's text is the worse failure", () => {
        const el = field("hello!!");
        expect(removeTypedEcho(el, "  ")).toBe(false);
        expect(el.value).toBe("hello!!");
    });

    it("refuses when the caret is closer to the start than the run is long", () => {
        const el = field("  hello", 1);
        expect(removeTypedEcho(el, "  ")).toBe(false);
        expect(el.value).toBe("  hello");
    });

    it("does nothing for an empty run, a detached node or a plain element", () => {
        const el = field("hello  ");
        expect(removeTypedEcho(el, "")).toBe(false);
        const gone = document.createElement("textarea");
        gone.value = "hello  ";
        expect(removeTypedEcho(gone, "  ")).toBe(false);
        const div = document.createElement("div");
        document.body.appendChild(div);
        expect(removeTypedEcho(div, "  ")).toBe(false);
    });
});
