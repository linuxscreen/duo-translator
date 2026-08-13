// Pure element predicates used by the content-script translation pipeline.
// Extracted from main/content.ts so the marking/skip rules are unit-testable
// without a full content() context.
import { excludedTagSet } from "@/main/constants";
import { isNoTranslate, isOwnNoTranslate } from "@/main/dom/paragraphMarks";
import { isOwnHost } from "@/main/dom/shadowRoots";

/** An element the user (or a rule) marked as a no-translate region. */
export function isNotTranslateElement(element: HTMLElement): boolean {
    return isNoTranslate(element);
}

/**
 * The same question with the user's own exclusions taken out of the answer —
 * what the marking scan asks while the site is set to "translate all elements".
 * Only our own inserted UI still counts.
 */
export function isOwnNoTranslateElement(element: HTMLElement): boolean {
    return isOwnNoTranslate(element);
}

/** True for tags we never descend into / mark (script, style, our own UI, …). */
export function isExcludedNodeType(node: Node): boolean {
    return excludedTagSet.has(node.nodeName.toLowerCase());
}

/**
 * Elements that must not be marked: our own translation output, our own Shadow
 * DOM UI hosts, or excluded tags.
 *
 * The UI-host check only starts mattering once the scan pierces shadow roots —
 * until then our surfaces are invisible to it purely by accident of living
 * behind a boundary. It is not an attribute test on purpose: the six hosts carry
 * three different marker attributes, and the video-subtitle one is mounted
 * inside page content where the scan genuinely reaches it. See
 * main/dom/shadowRoots.ts.
 */
export function isNotMarkElement(element: HTMLElement): boolean {
    // todo support user defined class to exclude translation
    // todo support user defined tag to exclude
    return (
        element.classList.contains("duo-translation") ||
        isOwnHost(element) ||
        isExcludedNodeType(element)
    );
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

// NOTE: there is deliberately no `isParagraphElement` here any more. "Is this a
// paragraph?" used to mean "does the element own >= 1 valid direct text node",
// which made a container whose sentence is spread over inline children
// (`<div><span>Hello </span><span>world</span></div>`) not a paragraph — each
// span was then translated on its own. The question is now answered by
// segmentParagraph in main/dom/segments.ts: an element is a unit container iff
// it has a qualifying run. Do not reintroduce a direct-text-node gate.
