// Text-node / cleanup DOM helpers extracted from main/content.ts so they can be
// unit tested in isolation (jsdom). Behaviour is preserved verbatim.
import { EXCLUDE_CHILD_ELEMENT_TAGS } from "@/main/constants";
import { contentValid, contentVisible } from "@/utils/dom";
import { isEditable, isExcludedNodeType } from "@/main/dom/predicates";
import { pageShadowRootOf } from "@/main/dom/shadowRoots";

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
        if (node.nodeType === Node.TEXT_NODE && contentVisible(node)) {
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

/** Like getTextNodesAndText, but over an ordered list of sibling nodes (a translation unit). */
export function getTextNodesAndTextOfNodes(nodes: ChildNode[]): { textNodes: Text[]; text: string } {
    let text = "";
    const textNodes: Text[] = [];
    for (const node of nodes) {
        const result = getTextNodesAndText(node);
        textNodes.push(...result.textNodes);
        text += result.text;
    }
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
        if (pop.nodeType === Node.TEXT_NODE && contentVisible(pop)) {
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

/**
 * Does this subtree hold text worth translating? Early-exit walk, used by the
 * segmentation to qualify an inline run whose text may sit anywhere inside it
 * (not only in direct child text nodes).
 *
 * Deliberately NOT the same question as `isContainsValidTextElement` above —
 * do not merge them:
 *   - the skip set is `excludedTagSet` (script/style/code/pre/img/video/…, via
 *     `isExcludedNodeType`) — the tags the marking scan refuses to mark — not
 *     the narrower EXCLUDE_CHILD_ELEMENT_TAGS used when serializing a run that
 *     already qualified;
 *   - editable subtrees are skipped: we never translate what the user is
 *     typing, so their text must not qualify a run either;
 *   - the text test is `contentValid` (non-blank) rather than `contentVisible`
 *     (non-zero-width) — a whitespace-only run is not a paragraph.
 */
export function hasTranslatableText(node: Node): boolean {
    const stack: Node[] = [node];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur.nodeType === Node.TEXT_NODE) {
            if (contentValid(cur)) return true;
            continue;
        }
        // A ShadowRoot is a DocumentFragment, and it is a legitimate argument
        // here: "does this host carry translatable text?" is asked of the root.
        // Rejecting fragments outright made that question answer false always.
        if (cur.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            stack.push(...cur.childNodes);
            continue;
        }
        if (cur.nodeType !== Node.ELEMENT_NODE) continue;
        const el = cur as HTMLElement;
        if (isExcludedNodeType(el) || isEditable(el)) continue;
        stack.push(...el.childNodes);
        // Nested components count too — the text a reader sees inside `node`
        // includes whatever its descendants render from their own roots. Our own
        // UI hosts answer null here and are never descended into.
        const shadow = pageShadowRootOf(el);
        if (shadow) stack.push(shadow);
    }
    return false;
}

/** The last child node that actually contains rendered text. */
export function getLastContainingTextChild(element: Node): ChildNode | null {
    let lastChild = element.lastChild;
    while (lastChild && !isContainsValidTextElement(lastChild)) {
        lastChild = lastChild.previousSibling;
    }
    return lastChild;
}
