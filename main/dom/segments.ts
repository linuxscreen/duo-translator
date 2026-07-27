// Logical-paragraph segmentation — the "translation unit" model.
//
// A container that qualifies as a paragraph (>= 1 valid direct text node) is
// no longer translated as one monolithic block. Its direct children are split
// into *units*: maximal runs of inline content (text nodes + inline elements)
// delimited by block-level children, runs of >= SEGMENT_BR_SPLIT_MIN
// consecutive <br>s, and the container edges. Each unit is the minimal
// translation unit; block-level children are handed back to the marking scan
// so nested paragraphs (<li>, <p>, …) become units of their own.
//
// Units are *derived data* — recomputed from the live DOM on every call,
// never stored. "Already translated" is likewise derived from the presence of
// our own `.duo-translation` marker inside the run. This keeps the marking
// pipeline zero-DOM-write and immune to page mutations invalidating stored
// node lists.
import {
    blockTagSet,
    BLOCK_SELECTOR,
    SEGMENT_BR_SPLIT_MIN,
} from "@/main/constants";
import { contentValid } from "@/utils/dom";

export interface TranslationUnit {
    container: HTMLElement;
    /** Ordered direct children of `container` making up this unit. */
    nodes: ChildNode[];
    /** True ⇒ `nodes` is exactly `container.childNodes` (legacy whole-element path). */
    wholeElement: boolean;
    /** Derived: a `.duo-translation` marker already sits inside this run. */
    translated: boolean;
}

export interface SegmentScan {
    units: TranslationUnit[];
    /** Block-ish children the marking scan should keep descending into. */
    descendChildren: HTMLElement[];
}

// Computed `display` values that make an element a segment boundary.
const BLOCK_DISPLAYS = new Set([
    "block", "flex", "grid", "list-item", "flow-root",
]);

const boundaryCache = new WeakMap<Element, boolean>();

/**
 * Whether `el` behaves as a block-level box. Computed style wins when
 * available (CSS can blockify a <span> or inline a <div>); detached elements
 * and environments without computed style fall back to the static tag set.
 * Results are cached — `display` rarely changes at runtime, and a stale hit
 * only degrades to static-tag precision.
 */
export function isBlockBoundary(el: HTMLElement): boolean {
    const cached = boundaryCache.get(el);
    if (cached !== undefined) return cached;

    let result: boolean | undefined;
    if (el.isConnected) {
        try {
            const display = getComputedStyle(el).display;
            if (display) {
                result = BLOCK_DISPLAYS.has(display) || display.startsWith("table");
            }
        } catch {
            // fall through to the static tag set
        }
    }
    if (result === undefined) {
        result = blockTagSet.has(el.tagName.toLowerCase());
    }
    boundaryCache.set(el, result);
    return result;
}

type NodeKind = "text" | "passive" | "duo-marker" | "br" | "block" | "inline";

function classify(node: ChildNode): NodeKind {
    if (node.nodeType === Node.TEXT_NODE) return "text";
    if (node.nodeType !== Node.ELEMENT_NODE) return "passive";
    const el = node as HTMLElement;
    if (
        el.classList.contains("duo-translation") ||
        el.classList.contains("duo-divide")
    ) {
        return "duo-marker";
    }
    if (el.tagName === "BR") return "br";
    // An inline-tagged wrapper hiding block descendants (<span><div>…) must
    // still act as a boundary so the scan descends into it.
    if (isBlockBoundary(el) || el.querySelector(BLOCK_SELECTOR)) return "block";
    return "inline";
}

/**
 * Split `container`'s direct children into translation units. Pure DOM read.
 *
 * Runs without a valid direct text node do not become units — their element
 * children are returned in `descendChildren` instead, preserving the legacy
 * descent behavior for containers of nested <span>s.
 */
export function segmentParagraph(container: HTMLElement): SegmentScan {
    const units: TranslationUnit[] = [];
    const descendChildren: HTMLElement[] = [];

    let curNodes: ChildNode[] = [];
    let curHasText = false;
    let curTranslated = false;
    // Trailing <br> run (plus whitespace-only text between the brs).
    let brStreak: ChildNode[] = [];
    let brCount = 0;
    let sawSplitOrMarker = false;

    const flushRun = () => {
        if (curHasText) {
            units.push({
                container,
                nodes: curNodes,
                wholeElement: false,
                translated: curTranslated,
            });
        } else {
            for (const node of curNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName !== "BR") {
                    descendChildren.push(node as HTMLElement);
                }
            }
        }
        curNodes = [];
        curHasText = false;
        curTranslated = false;
    };
    const resetBrStreak = () => {
        brStreak = [];
        brCount = 0;
    };

    for (const node of Array.from(container.childNodes)) {
        switch (classify(node)) {
            case "text":
                if (contentValid(node)) {
                    curHasText = true;
                    resetBrStreak();
                } else if (brCount > 0) {
                    // Whitespace between consecutive <br>s joins the streak.
                    brStreak.push(node);
                }
                curNodes.push(node);
                break;
            case "passive":
            case "inline":
                curNodes.push(node);
                resetBrStreak();
                break;
            case "br":
                brStreak.push(node);
                brCount++;
                curNodes.push(node);
                if (brCount >= SEGMENT_BR_SPLIT_MIN) {
                    // The streak sits at the tail of the run — drop it and split.
                    curNodes.length -= brStreak.length;
                    sawSplitOrMarker = true;
                    flushRun();
                    resetBrStreak();
                }
                break;
            case "block":
                flushRun();
                resetBrStreak();
                descendChildren.push(node as HTMLElement);
                break;
            case "duo-marker":
                sawSplitOrMarker = true;
                if ((node as HTMLElement).classList.contains("duo-translation")) {
                    curTranslated = true;
                }
                // Never part of a unit's nodes.
                break;
        }
    }
    flushRun();

    // Legacy whole-element path: byte-identical serialization (and therefore
    // identical translation-cache keys) for plain paragraphs.
    if (units.length === 1 && descendChildren.length === 0 && !sawSplitOrMarker) {
        units[0].nodes = Array.from(container.childNodes);
        units[0].wholeElement = true;
    }

    return { units, descendChildren };
}

/** Whether `container` still has a unit without an inserted translation. */
export function hasUntranslatedUnit(container: HTMLElement): boolean {
    return segmentParagraph(container).units.some((unit) => !unit.translated);
}
