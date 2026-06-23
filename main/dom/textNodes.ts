// Text-node / cleanup DOM helpers extracted from main/content.ts so they can be
// unit tested in isolation (jsdom). Behaviour is preserved verbatim.
import { EXCLUDE_CHILD_ELEMENT_TAGS } from "@/main/constants";

/** Strip every `duo-*` class and attribute the extension added to an element. */
export function removeDuoClassAndAttribute(element: HTMLElement) {
    const attributes = element.getAttributeNames();
    for (const attribute of attributes) {
        if (attribute.startsWith("duo-")) {
            element.removeAttribute(attribute);
        }
    }
    const classList: string[] = [];
    element.classList.forEach((className) => {
        if (className.startsWith("duo-")) {
            classList.push(className);
        }
    });
    for (const className of classList) {
        element.classList.remove(className);
    }
}

/** Remove every text node in the subtree (used when replacing original text). */
export function removeTextNodes(element: HTMLElement) {
    function getTextNodes(el: HTMLElement): Text[] {
        const textNodes: Text[] = [];
        for (const child of el.childNodes) {
            if (child instanceof Text) {
                textNodes.push(child);
            } else if (child instanceof HTMLElement) {
                textNodes.push(...getTextNodes(child));
            }
        }
        return textNodes;
    }
    for (const textNode of getTextNodes(element)) {
        textNode.remove();
    }
}

/**
 * Collect all non-zero-width text nodes (and their concatenated text) in the
 * subtree, skipping EXCLUDE_CHILD_ELEMENT_TAGS (script/style/img/…).
 */
export function getTextNodesAndText(element: Node): { textNodes: Text[]; text: string } {
    let text = "";
    const textNodes: Text[] = [];
    const process = function (node: Node) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.replace(/\p{Cf}/gu, "") != "") {
            textNodes.push(node as Text);
            text += node.textContent;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const ele = node as HTMLElement;
            if (EXCLUDE_CHILD_ELEMENT_TAGS.has(ele.tagName)) {
                return;
            }
            for (const child of node.childNodes) {
                process(child);
            }
        }
    };
    process(element);
    return { textNodes, text };
}

/** Does the subtree contain at least one non-zero-width text node? */
export function isContainsValidTextElement(element: Node): boolean | undefined {
    if (element.nodeType === Node.TEXT_NODE) {
        return true;
    }
    const stack = [element];
    while (stack.length > 0) {
        const pop = stack.pop();
        if (!pop) continue;
        if (pop.nodeType === Node.TEXT_NODE && pop.textContent?.replace(/\p{Cf}/gu, "") != "") {
            return true;
        }
        if (pop.nodeType === Node.ELEMENT_NODE) {
            const ele = pop as HTMLElement;
            if (EXCLUDE_CHILD_ELEMENT_TAGS.has(ele.tagName)) {
                continue;
            }
            stack.push(...pop.childNodes);
        }
    }
}

/** The last child node that actually contains rendered text. */
export function getLastContainingTextChild(element: Node): ChildNode | null {
    let lastChild = element.lastChild;
    while (lastChild && !isContainsValidTextElement(lastChild)) {
        lastChild = lastChild.previousSibling;
    }
    return lastChild;
}
