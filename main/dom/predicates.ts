// Pure element predicates used by the content-script translation pipeline.
// Extracted from main/content.ts so the marking/skip rules are unit-testable
// without a full content() context.
import { excludedTagSet } from "@/main/constants";

/** An element the user (or a rule) marked as a no-translate region. */
export function isNotTranslateElement(element: HTMLElement): boolean {
    return element.classList.contains("duo-no-translate");
}

/** True for tags we never descend into / mark (script, style, our own UI, …). */
export function isExcludedNodeType(node: Node): boolean {
    return excludedTagSet.has(node.nodeName.toLowerCase());
}

/** Elements that must not be marked: our own translation output or excluded tags. */
export function isNotMarkElement(element: HTMLElement): boolean {
    // todo support user defined class to exclude translation
    // todo support user defined tag to exclude
    return element.classList.contains("duo-translation") || isExcludedNodeType(element);
}

/**
 * Editable elements are skipped — translating an input/textarea/contentEditable
 * would clobber what the user is typing.
 */
export function isEditable(element: HTMLElement): boolean {
    if (element.isContentEditable) {
        return true;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return !element.disabled && !element.readOnly;
    }
    if (element instanceof HTMLSelectElement) {
        return !element.disabled;
    }
    return false;
}

/**
 * An element is a "paragraph" (translation unit) when it has at least one direct
 * child text node with non-zero-width, non-whitespace content.
 */
export function isParagraphElement(element: HTMLElement): boolean {
    for (let i = 0; i < element.childNodes.length; i++) {
        // \p{Cf}: all zero-width / format characters.
        if (
            element.childNodes[i].nodeType === Node.TEXT_NODE &&
            element.childNodes[i].textContent!.replace(/\p{Cf}/gu, "").trim() !== ""
        ) {
            return true;
        }
    }
    return false;
}
