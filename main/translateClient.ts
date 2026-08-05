import { ACTION, AI_PREFIX, AI_REQUEST_TIMEOUT, APP_NAME_WITH_SUFFIX, CONFIG_KEY, EXCLUDE_CHILD_ELEMENT_TAGS, API_REQUEST_TIMEOUT, TRANSLATE_SERVICE, VIEW_STRATEGY } from "@/main/constants";
import { sendMessageToBackgroundOrThrow } from "../utils/message";
import { abortableRequest } from "@/utils/abortableRequest";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";
import { getConfig } from "@/utils/db";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { isTraditionalChinese } from "@/utils/language";
import { contentInvisible, decodeHtmlText } from "@/utils/dom";
import type { TranslationUnit, UnitRange } from "@/main/dom/segments";
import { unitRangeOf } from "@/main/dom/unitHit";

//#region types
// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// UnitRange is a unit concept and lives with the segmentation; re-exported here
// because it is part of TranslateResult's shape.
export type { UnitRange } from "@/main/dom/segments";

export class TranslateResult {
    translatedMappedHtmlText: string; // translated innerHtml of the mapped tag element, for example <b0>translated text</b0>, or <a i=0>translated text</a>(google translate)
    sourceLang: string;
    score: number;
    rawText: string = "";
    rawTextLength: number = 0; // original text length, sum of all text nodes length
    translatedCopyElement?: HTMLElement; // a translated copy of the original element use for double view strategy
    originalSliceElements?: HTMLElement[]; // first element is the original element itself, then are child elements of the original element
    rawMappedHtmlText?: string; // original innerHtml of the mapped tag element, for example <b0>original text</b0>
    translatedHtmlText?: string; // translated innerHtml of the original tag element, for example <p class="x" id="y">translated text</p>
    targetLang?: string;
    textNodes?: Text[];
    textIndexMap?: Map<number, number>; // key: text node index, value: corresponding childNode of original element(ancestor of text node) index
    replacedTextNodes?: Text[]; // use for SINGLE view strategy, text nodes that have been replaced(has been translated or restored)
    unit?: TranslationUnit; // the logical paragraph this result belongs to
    // SINGLE only: the unit's span among the container's direct children, as
    // exclusive boundary anchors (null = container edge). Write-back and
    // restore stay inside this range so sibling units are never touched.
    unitRange?: UnitRange;

    constructor(rawTranslatedText: string, sourceLang: string, score: number) {
        this.translatedMappedHtmlText = rawTranslatedText;
        this.sourceLang = sourceLang;
        this.score = score;
    }
}

export class TranslateParams {
    constructor(
        public serviceName: string,
        public targetLang: string,
        public sourceLang?: string,
        public defaultStrategy?: string,
        public autoTrigger?: boolean,
        public isBody?: boolean,
    ) { }
}
// Backward-compatible alias for existing call sites that use lowercase name.
export { TranslateParams as translateParams };

export default defineUnlistedScript(() => { });

//#endregion

//#region dom
// ---------------------------------------------------------------------------
// DOM-level helpers used by content scripts
// ---------------------------------------------------------------------------
class PreProcessResult {
    elements: HTMLElement[]; // original elements that need mapping tag, which come from element and its children
    mappedHtmlText: string;
    textNodes: Text[]; // text nodes that need to be deleted, which come from the child text nodes of element
    text: string;
    totalTextNodesLength: number;
    textIndexMap: Map<number, number>

    constructor(elements: HTMLElement[], mappedHtmlText: string, textNodes: Text[], text: string, totalTextNodesLength: number, textIndexMap: Map<number, number>) {
        this.elements = elements;
        this.mappedHtmlText = mappedHtmlText;
        this.textNodes = textNodes;
        this.text = text;
        this.totalTextNodesLength = totalTextNodesLength;
        this.textIndexMap = textIndexMap
    }
}

export function getElementPreProcessResult(element: HTMLElement, viewStrategy: VIEW_STRATEGY, nodes?: ChildNode[]): PreProcessResult {
    let i = 0;
    let totalTextNodesLength = 0;
    let text = "";
    const elements: HTMLElement[] = [];
    const processParent = document.createElement("div");
    const textNodes: Text[] = [];
    // Default (whole element) keeps the legacy byte-identical serialization;
    // a caller passing a unit's node list scopes everything to that unit.
    const rootNodes: ChildNode[] = nodes ?? Array.from(element.childNodes);

    // flag all children of the element that textNode is not empty
    let textNotEmptyElementSet = new Set<HTMLElement>();
    if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
        let notEmptyNodes: Node[] = [];
        let stack = [...rootNodes];
        while (stack.length > 0) {
            let pop = stack.pop();
            if (!pop) continue;
            if (pop.nodeType === Node.TEXT_NODE && !contentInvisible(pop)) {
                notEmptyNodes.push(pop);
            }
            if (pop.nodeType === Node.ELEMENT_NODE) {
                let p = pop as HTMLElement;
                if (EXCLUDE_CHILD_ELEMENT_TAGS.has(p.tagName)) continue;
                stack.push(...pop.childNodes);
            }
        }
        notEmptyNodes.forEach(node => {
            while (node.parentNode !== element && node.parentNode?.nodeType === Node.ELEMENT_NODE) {
                textNotEmptyElementSet.add(node.parentNode as HTMLElement);
                node = node.parentNode;
            }
        });
    }

    elements.push(element);
    const removeChildren: Node[] = []
    let textIndex = 0
    let textIndexMap = new Map<number, number>()
    let index = 0
    const process = (isSon: boolean, node: Node | null, parent: HTMLElement) => {
        if (!node) return;
        if (node.nodeType === Node.ELEMENT_NODE) {
            const ele = node as HTMLElement;
            // ignore empty element in double mode
            if (viewStrategy === VIEW_STRATEGY.DOUBLE && !textNotEmptyElementSet.has(ele)) {
                removeChildren.push(ele)
                return
            }
            const rootProcessedElement = document.createElement("b" + i);
            parent.appendChild(rootProcessedElement);
            elements.push(ele);
            i++;
            for (const child of node.childNodes) process(false, child, rootProcessedElement);
            if (isSon) {
                index++
            }
        } else if (node.nodeType === Node.TEXT_NODE) {
            const textNode = node as Text;
            if (contentInvisible(textNode)) return;
            totalTextNodesLength += textNode.textContent.length;
            text += textNode.textContent;
            textNodes.push(textNode);
            textIndexMap.set(textIndex, index)
            textIndex++
            if (isSon) {
                index++
            }
            parent.appendChild(textNode.cloneNode(true));
        } else {
            if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
                removeChildren.push(node)
            }
        }
    };
    rootNodes.forEach(child => process(true, child, processParent));
    if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
        removeChildren.forEach(child => child.parentNode?.removeChild(child))
    }
    return { elements, mappedHtmlText: processParent.innerHTML, textNodes: textNodes, totalTextNodesLength, text, textIndexMap };
}

export function updateTranslateElementContent(rawTranslatedHtml: string, originalElements: HTMLElement[], range?: UnitRange) {
    if (originalElements.length === 0 || rawTranslatedHtml === "") return;

    const container = originalElements[0];
    // Anchors invalidated by page mutations degrade to whole-container writes.
    const rangeStart = range?.start && range.start.parentNode === container ? range.start : null;
    const rangeEnd = range?.end && range.end.parentNode === container ? range.end : null;

    const translatedElement = document.createElement("div");
    translatedElement.innerHTML = rawTranslatedHtml;
    const replacedTextNodes: Text[] = [];
    const element2TextNodes: Map<HTMLElement, Text[]> = new Map();
    const element2TextNodeIndex: Map<HTMLElement, number> = new Map();

    /** Direct children of the container inside the unit range (whole list when unbounded). */
    function containerChildNodes(): ChildNode[] {
        const out: ChildNode[] = [];
        let node = rangeStart ? rangeStart.nextSibling : container.firstChild;
        while (node && node !== rangeEnd) {
            out.push(node);
            node = node.nextSibling;
        }
        return out;
    }

    /** Container-level insert honoring the range end (plain append when unbounded). */
    function appendToContainer(node: Node) {
        if (rangeEnd) {
            container.insertBefore(node, rangeEnd);
        } else {
            container.appendChild(node);
        }
    }

    function getOriginalElement(tagName: string) {
        if (tagName === "DIV") {
            return originalElements[0];
        } else {
            const num = parseInt(tagName.replace("B", ""));
            if (isNaN(num) || num + 1 >= originalElements.length) return null;
            return originalElements[num + 1];
        }
    }

    function getNextTextNode(element: HTMLElement): Text {
        let textNodes = element2TextNodes.get(element);
        if (textNodes === undefined) {
            const candidates = element === container ? containerChildNodes() : Array.from(element.childNodes);
            textNodes = candidates.filter(node => node.nodeType === Node.TEXT_NODE) as Text[];
            element2TextNodes.set(element, textNodes)
            element2TextNodeIndex.set(element, 0)
        }
        let index = element2TextNodeIndex.get(element) || 0
        if (index >= textNodes.length) {
            return document.createTextNode('')
        }
        element2TextNodeIndex.set(element, index + 1)
        return textNodes[index]
    }

    function translate(node: Node | null) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const textParent = node.parentElement;
            if (!textParent) return;
            const original = getOriginalElement(textParent.tagName)
            if (!original) return;
            let textNode = getNextTextNode(original)
            textNode.textContent = node.textContent
            replacedTextNodes.push(textNode);
            if (original === container) {
                appendToContainer(textNode);
            } else {
                original.appendChild(textNode);
            }
            return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const ele = node as HTMLElement;
            for (const child of node.childNodes) translate(child);
            const eleParent = ele.parentElement;
            if (eleParent) {
                const originalParent = getOriginalElement(eleParent.tagName)
                if (!originalParent) return;
                const original = getOriginalElement(ele.tagName)
                if (!original) return;
                if (originalParent === container) {
                    appendToContainer(original);
                } else {
                    originalParent.appendChild(original);
                }
            }
        }
    }
    translatedElement.childNodes.forEach(translate);
    return replacedTextNodes
}

/** Normalize a legacy element argument into a whole-element unit. */
function toTranslationUnit(item: HTMLElement | TranslationUnit): TranslationUnit {
    if (item instanceof HTMLElement) {
        return {
            container: item,
            nodes: Array.from(item.childNodes),
            wholeElement: true,
            translated: false,
        };
    }
    return item;
}

export async function getTranslateResult(
    service: string,
    elements: (HTMLElement | TranslationUnit)[],
    targetLang: string,
    viewStrategy: VIEW_STRATEGY,
    signal?: AbortSignal
): Promise<TranslateResult[]> {
    if (!elements || elements.length === 0) return [];

    // One pending entry per unit that survives preprocessing — kept aligned
    // as an object instead of parallel arrays so later drops can't misalign
    // the annotations.
    interface PendingUnit {
        unit: TranslationUnit;
        pre: PreProcessResult;
        text: string;
        copy?: HTMLElement;
        range?: UnitRange;
    }
    const pendings: PendingUnit[] = [];

    for (const item of elements) {
        const unit = toTranslationUnit(item);
        let element = unit.container;
        let nodes: ChildNode[] | undefined = unit.wholeElement ? undefined : unit.nodes;
        let copy: HTMLElement | undefined;
        let range: UnitRange | undefined;
        if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
            // The detached copy holds only this unit's nodes, so downstream
            // preprocessing/translation of the copy needs no node scoping.
            copy = document.createElement("span");
            for (const node of unit.nodes) copy.appendChild(node.cloneNode(true));
            element = copy;
            nodes = undefined;
        } else {
            // SINGLE writes back into the live container — capture the unit's
            // exclusive boundary anchors before anything moves.
            range = unitRangeOf(unit);
        }
        const pre = getElementPreProcessResult(element, viewStrategy, nodes);
        if (pre.mappedHtmlText.trim() === "") continue;
        let text: string;
        if (service === TRANSLATE_SERVICE.GOOGLE) {
            text = "";
            for (let index = 0; index < pre.textNodes.length; index++) {
                text += `<a i=${index}>${pre.textNodes[index].textContent}</a>`
            }
        } else {
            text = pre.mappedHtmlText;
        }
        pendings.push({ unit, pre, text, copy, range });
    }
    if (pendings.length === 0) return [];

    const results = await translateTexts(service, pendings.map(p => p.text), targetLang, signal);
    if (!results) return [];

    const out: TranslateResult[] = [];
    for (let i = 0; i < results.length && i < pendings.length; i++) {
        const result = results[i];
        const pending = pendings[i];
        // Echoed translation (same as source) — nothing to change, drop it.
        if (pending.text === result.translatedMappedHtmlText) continue;
        result.unit = pending.unit;
        result.originalSliceElements = pending.pre.elements
        result.rawMappedHtmlText = pending.pre.mappedHtmlText;
        result.rawTextLength = pending.pre.totalTextNodesLength;
        result.rawText = pending.pre.text
        service === TRANSLATE_SERVICE.GOOGLE && (result.textIndexMap = pending.pre.textIndexMap)
        if (viewStrategy === VIEW_STRATEGY.DOUBLE) {
            result.translatedCopyElement = pending.copy;
        } else {
            result.unitRange = pending.range;
        }
        result.textNodes = pending.pre.textNodes
        out.push(result);
    }
    return out;
}

export function parseIndexedText(input: string): { index: number, text: string }[] {
    const result: { index: number, text: string }[] = []

    const regex = /<a\b[^>]*\bi\s*=\s*["']?(-?\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi

    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(input)) !== null) {
        const beforeText = input.slice(lastIndex, match.index)

        if (beforeText) {
            result.push({ index: -1, text: beforeText })
        }

        const index = Number(match[1])
        const text = match[2]

        if (text) {
            result.push({ index: Number.isFinite(index) ? index : -1, text })
        }

        lastIndex = regex.lastIndex
    }

    const restText = input.slice(lastIndex)

    if (restText) {
        result.push({ index: -1, text: restText })
    }

    return result
}

export function googleTranslate(results: TranslateResult[]) {
    for (const result of results) {
        if (!result.originalSliceElements || result.originalSliceElements.length === 0) continue;
        let targetElement = result.originalSliceElements[0]
        // SINGLE per-unit: stay inside the unit's anchor range so sibling
        // units of the same container are never reordered.
        const rangeStart = result.unitRange?.start && result.unitRange.start.parentNode === targetElement
            ? result.unitRange.start : null;
        const rangeEnd = result.unitRange?.end && result.unitRange.end.parentNode === targetElement
            ? result.unitRange.end : null;
        let targetElementChildNodes: ChildNode[]
        if (rangeStart || rangeEnd) {
            targetElementChildNodes = []
            let node = rangeStart ? rangeStart.nextSibling : targetElement.firstChild
            while (node && node !== rangeEnd) {
                targetElementChildNodes.push(node)
                node = node.nextSibling
            }
        } else {
            targetElementChildNodes = Array.from(targetElement.childNodes)
        }
        // Place a node at the start of the unit (container start when unbounded).
        const placeFirst = (node: ChildNode) => {
            if (rangeStart) {
                rangeStart.after(node)
            } else {
                targetElement.prepend(node)
            }
        }
        let emptyNode: ChildNode | null = null
        for (let index = 0; index < targetElementChildNodes.length; index++) {
            const element = targetElementChildNodes[index];
            if (contentInvisible(element)) {
                emptyNode = element
            } else {
                break
            }
        }
        // .filter(node => node.nodeType !== Node.COMMENT_NODE)
        let textNodes = result.textNodes
        if (textNodes === undefined) return
        let indexedTexts = parseIndexedText(result.translatedMappedHtmlText)
        let replacedTextNodes = [...textNodes]

        let movedNodeSet = new Set<number>()
        let lastMovedNodeIndex = -1
        let lastMovedNode: ChildNode | null = null
        let lastTextNodeIndex = -1
        for (const indexedText of indexedTexts) {
            if (indexedText.text === "") continue
            if (indexedText.index === -1) {
                let textNode = document.createTextNode(decodeHtmlText(indexedText.text))
                if (!lastMovedNode) {
                    placeFirst(textNode)
                } else {
                    lastMovedNode.after(textNode)
                }
                lastMovedNode = textNode
                if (indexedText.text.trim() === "") continue
                lastMovedNodeIndex = -1
                replacedTextNodes.push(textNode)
                continue
            }
            let num = indexedText.index
            if (num < 0 || num >= textNodes.length) continue
            textNodes[num].textContent = decodeHtmlText(indexedText.text)
            // console.log('debug', indexedText.text, textNodes[num].textContent, num, result.translatedCopyElement?.textContent)
            let childIndex = result.textIndexMap?.get(num)
            if (childIndex === undefined) continue
            if (movedNodeSet.has(childIndex)) {
                if (lastMovedNodeIndex === childIndex && lastTextNodeIndex < num) continue
                lastMovedNode!.after(textNodes[num])
                lastMovedNode = textNodes[num]
                continue
            }
            if (!lastMovedNode) {
                if (emptyNode) {
                    emptyNode.after(targetElementChildNodes[childIndex])
                } else {
                    placeFirst(targetElementChildNodes[childIndex])
                }
            } else {
                while (lastMovedNode?.nextSibling && contentInvisible(lastMovedNode?.nextSibling)) {
                    lastMovedNode = lastMovedNode!.nextSibling
                }
                lastMovedNode!.after(targetElementChildNodes[childIndex])
            }
            lastMovedNode = targetElementChildNodes[childIndex]
            lastMovedNodeIndex = childIndex
            lastTextNodeIndex = num
            movedNodeSet.add(childIndex)
            // console.log('debug', result.translatedCopyElement?.textContent)
        }
        result.replacedTextNodes = replacedTextNodes
    }

}

// replace the element content with the translated text
export async function translate(service: string, results: TranslateResult[]): Promise<void> {
    if (service === TRANSLATE_SERVICE.GOOGLE) {
        googleTranslate(results)
        return
    }
    for (const result of results) {
        result.textNodes?.forEach(text => {
            text.textContent = ""
        });
        let textNodes = updateTranslateElementContent(result.translatedMappedHtmlText, result.originalSliceElements || [], result.unitRange);
        result.replacedTextNodes = textNodes
    }
}

// replace the element content with the original text, use for SINGLE view strategy
export async function restore(results: TranslateResult[]): Promise<void> {
    for (const result of results) {
        if (!result.rawMappedHtmlText) continue;
        result.replacedTextNodes?.forEach(text => {
            text.textContent = ""
        })
        updateTranslateElementContent(result.rawMappedHtmlText, result.originalSliceElements || [], result.unitRange);
    }
}
//#endregion

//#region background bridge
// ---------------------------------------------------------------------------
// Thin client over the background translation service.
//
// The provider classes, the registry and the result cache all live in
// background (main/translateService.ts). Content asks by meaning — service id,
// texts, target language — and never builds a provider request, so no API key
// or provider endpoint is reachable from a page context.
// ---------------------------------------------------------------------------

/**
 * Translate `texts` with `service`, resolving 1:1 with the input order.
 *
 * Resolves `undefined` only for an unknown service id. A provider that was
 * reached and failed **rejects**, carrying the provider's own reason — callers
 * report it (main/errorReport.ts) instead of silently rendering nothing. See
 * the failure note in main/translateService.ts for why this is not a degrade.
 */
export async function translateTexts(
    service: string,
    texts: string[],
    targetLang: string,
    signal?: AbortSignal | null,
): Promise<TranslateResult[] | undefined> {
    if (texts.length === 0) return [];
    const raw = await abortableRequest<any[] | null>({
        action: ACTION.TRANSLATE_TEXTS,
        abortAction: ACTION.TRANSLATE_TEXTS_ABORT,
        data: { service, texts, targetLang },
        signal,
        // Only AI services wait on a model; machine translators get the shorter budget.
        timeout: service.startsWith(AI_PREFIX) ? AI_REQUEST_TIMEOUT : API_REQUEST_TIMEOUT,
    });
    if (!raw) return undefined;
    // sendMessage structured-clones the reply, so the TranslateResult prototype
    // is gone (same trap as Token had). Rebuild real instances — callers set
    // DOM-bearing fields on these afterwards.
    return raw.map((r) =>
        Object.assign(new TranslateResult(r.translatedMappedHtmlText, r.sourceLang, r.score), r),
    );
}

/**
 * Provider-backed language detection, used when local franc detection is
 * inconclusive. Returns "" when detection is unavailable.
 */
export async function detectTextsLanguage(texts: string[]): Promise<string> {
    try {
        const res = await sendMessageToBackgroundOrThrow(
            { action: ACTION.DETECT_LANGUAGE, data: { texts } },
            // One provider round-trip. NOT the 5s default.
            API_REQUEST_TIMEOUT,
        );
        return res?.lang || "";
    } catch (e) {
        // The one request path that genuinely degrades: local franc detection is
        // the primary and this is only the tie-breaker, so a failure costs the
        // user nothing they could act on. Logged in full, but `silent` — a
        // bubble here would just duplicate the translate error that the same
        // dead endpoint is about to raise.
        reportRequestError(ERROR_SCOPE.PAGE_TRANSLATE, e, {
            silent: true,
            detail: { phase: "language detection" },
        });
        return "";
    }
}
//#endregion
