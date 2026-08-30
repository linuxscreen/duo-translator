// ---------------------------------------------------------------------------
// Undo the characters a shortcut typed on its way to firing.
//
// A custom shortcut on a printable key — "triple-tap Space" is the obvious one
// — types before it fires. The browser inserts the character on every press,
// and at press time nothing can know whether the sequence will complete: that
// ambiguity is exactly why such a gesture can coexist with ordinary typing at
// all (preventing the default would take Space away from the user). So the
// characters are removed afterwards, by the one action that reads the field.
//
// Everything here VERIFIES before it edits. If the characters are not sitting
// where they are claimed to be — a rich editor reformatted, the page moved the
// caret, an autocomplete rewrote the field — the call does nothing and returns
// false. Leaving a stray space behind is a blemish; deleting a character the
// user typed is data loss.
// ---------------------------------------------------------------------------

import { selectionForNode } from "@/main/dom/shadowTraversal";

/**
 * Remove `text` from immediately before the caret in `el`.
 *
 * @returns whether it was found there and removed.
 */
export function removeTypedEcho(el: HTMLElement, text: string): boolean {
    if (!text || !el.isConnected) return false;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        return removeFromField(el, text);
    }
    if (el.isContentEditable) return removeFromEditable(el, text);
    return false;
}

function removeFromField(el: HTMLTextAreaElement | HTMLInputElement, text: string): boolean {
    const caret = el.selectionStart;
    // A field whose type has no selection API (`number`, `email` in some
    // engines) reports null, and there is no way to place the cut without it.
    if (caret === null || caret < text.length) return false;
    const start = caret - text.length;
    if (el.value.slice(start, caret) !== text) return false;

    // The same native-setter dance as applyTextToTarget: React tracks the last
    // value on the node and would swallow a plain assignment as a no-op, so the
    // component would keep rendering the text we just removed.
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const next = el.value.slice(0, start) + el.value.slice(caret);
    try {
        if (setter) setter.call(el, next);
        else el.value = next;
        el.setSelectionRange(start, start);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    } catch {
        return false;
    }
}

function removeFromEditable(el: HTMLElement, text: string): boolean {
    const selection = selectionForNode(el);
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0).cloneRange();
    if (!range.collapsed) return false;

    // Only the same-text-node case is handled, on purpose. The characters were
    // typed consecutively a moment ago, so they are in one node in every
    // realistic editor; walking backwards across nodes would mean reimplementing
    // the editor's own idea of where text lives, for a case that does not occur.
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const end = range.startOffset;
    if (end < text.length) return false;
    if ((node as Text).data.slice(end - text.length, end) !== text) return false;

    try {
        range.setStart(node, end - text.length);
        selection.removeAllRanges();
        selection.addRange(range);
        // execCommand, deprecated and all, for the same reason applyTextToTarget
        // uses it: rich editors (Twitter, ChatGPT, Gmail) track their model from
        // the InputEvent it produces, and a direct `range.deleteContents()`
        // leaves them showing text their state no longer has.
        return document.execCommand("delete");
    } catch {
        return false;
    }
}
