// Logical-paragraph segmentation — the "translation unit" model.
//
// A container's direct children are split into *units*: maximal runs of inline
// content (text nodes + inline elements) delimited by block-level children,
// runs of >= SEGMENT_BR_SPLIT_MIN consecutive <br>s, and the container edges.
// Each unit is the minimal translation unit; block-level children are handed
// back to the marking scan so nested paragraphs (<li>, <p>, …) become units of
// their own.
//
// A run becomes a unit when it holds translatable text *anywhere inside it* —
// not only in a direct child text node. That is what makes
// `<div><span>Hello </span><span>world</span></div>` one sentence-sized unit
// instead of one translation per span; the old "container must own >= 1 valid
// direct text node" gate (isParagraphElement) is gone. See `flushRun` for the
// four ordered criteria, including the lone-inline-wrapper unwrap that keeps
// containers tight and translation-cache keys byte-compatible.
//
// Units are *derived data* — recomputed from the live DOM on every call,
// never stored. "Already translated" is likewise derived from the presence of
// our own `.duo-translation` marker inside the run. This keeps the marking
// pipeline zero-DOM-write and immune to page mutations invalidating stored
// node lists.
import {
    blockTagSet,
    BLOCK_SELECTOR,
    EXCLUDE_CHILD_ELEMENT_TAGS,
    SEGMENT_BR_SPLIT_MIN,
} from "@/main/constants";
import { contentValid } from "@/utils/dom";
import { hasTranslatableText } from "@/main/dom/textNodes";

/**
 * Exclusive boundary anchors of a translation unit among its container's direct
 * children (null = container edge). Anchors sit *outside* the unit and are never
 * moved by the unit's own rewrite, so they survive translate/restore round-trips
 * and the insertion of our own nodes — which makes (container, range) the only
 * stable identity a unit has. See main/dom/unitHit.ts for the helpers.
 */
export interface UnitRange {
    start: ChildNode | null;
    end: ChildNode | null;
}

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

/** Computed `display` of a connected element, or undefined when unavailable. */
function computedDisplay(el: HTMLElement): string | undefined {
    if (!el.isConnected) return undefined;
    try {
        return getComputedStyle(el).display || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether `el` behaves as a block-level box. Computed style wins when
 * available (CSS can blockify a <span> or inline a <div>); detached elements
 * and environments without computed style fall back to the static tag set.
 * Results are cached — `display` rarely changes at runtime, and a stale hit
 * only degrades to static-tag precision.
 *
 * `display: contents` is the one value with no answer of its own: the element
 * generates NO box, its children are laid out as if they were the parent's. So
 * it answers for what actually renders — a boundary iff any child is one,
 * recursing through chained transparent wrappers (strictly descending, and each
 * level memoized). Answering a flat "inline" instead would swallow block
 * children into an inline run; `isSegmentBoundary`'s tag probe covers the common
 * shape (`<div>`/`<p>` children) but not CSS-blockified ones, and any direct
 * caller would get the wrong answer outright.
 */
export function isBlockBoundary(el: HTMLElement): boolean {
    const cached = boundaryCache.get(el);
    if (cached !== undefined) return cached;

    let result: boolean | undefined;
    const display = computedDisplay(el);
    if (display === "contents") {
        result = false;
        for (const child of Array.from(el.children)) {
            if (isBlockBoundary(child as HTMLElement)) {
                result = true;
                break;
            }
        }
    } else if (display !== undefined) {
        result = BLOCK_DISPLAYS.has(display) || display.startsWith("table");
    }
    if (result === undefined) {
        result = blockTagSet.has(el.tagName.toLowerCase());
    }
    boundaryCache.set(el, result);
    return result;
}

/**
 * Whether `el` must act as a segment boundary: it either is a block box itself,
 * or it hides one (an inline wrapper containing block content — `<span><div>…` —
 * has to be descended into instead of being swallowed into an inline run).
 *
 * The tag-level `querySelector` is only a *probe*. It runs natively with an
 * early exit, so it costs nothing on the overwhelming majority of inline
 * elements that hold no block-tagged descendant at all — but it must never be
 * the verdict on its own: a block-tagged descendant that CSS inlined
 * (`<div style="display:inline">`) renders as inline content, and calling its
 * wrapper a boundary cuts a sentence in half. A probe hit is therefore
 * re-checked against computed style with a TreeWalker rather than by
 * materializing every match — the walk stops at the first descendant that
 * really is a block, so (unlike a capped sample of `querySelectorAll`) a real
 * block sitting behind many inlined ones can't be missed.
 *
 * EXCLUDE_CHILD_ELEMENT_TAGS subtrees are rejected wholesale: script/style/
 * template/noscript content is not rendered and img/svg hold no HTML block
 * boxes, so nothing in them can break the line. This is deliberately NOT
 * `excludedTagSet` — `<pre>`/`<code>`/`<video>` do render, so a block inside
 * them is a real boundary even though their text is never translated.
 *
 * Known gap, unchanged from before: the inverse case, a CSS-*blockified* inline
 * tag (`<span><span style="display:block">`), is invisible to the tag probe.
 * Catching it would mean walking every inline subtree unconditionally, which
 * isn't worth the cost.
 */
export function isSegmentBoundary(el: HTMLElement): boolean {
    if (isBlockBoundary(el)) return true;
    if (!el.querySelector(BLOCK_SELECTOR)) return false;
    // Detached / no computed style available: keep the tag-level verdict, the
    // same degradation isBlockBoundary itself falls back to.
    if (!el.isConnected) return true;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node: Node): number {
            const child = node as HTMLElement;
            if (EXCLUDE_CHILD_ELEMENT_TAGS.has(child.tagName)) return NodeFilter.FILTER_REJECT;
            return isBlockBoundary(child) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });
    return walker.nextNode() !== null;
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
    // Covers both "is a block box" and "is an inline wrapper hiding block
    // descendants" — the latter must be a boundary so the scan descends into it.
    if (isSegmentBoundary(el)) return "block";
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
        const elementNodes: HTMLElement[] = [];
        for (const node of curNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName !== "BR") {
                elementNodes.push(node as HTMLElement);
            }
        }
        // Run qualification, in order:
        //   1. a valid direct text node → unit (the legacy path; serialization
        //      and therefore the translation-cache key stay byte-identical);
        //   2. no direct text but exactly one element node → *not* a unit,
        //      descend into it. This unwraps lone inline wrappers
        //      (`<div><span>text</span></div>`) so the container stays as tight
        //      as possible, the translation is inserted closest to the text,
        //      and the cache key matches what the whole-element path produced;
        //   3. no direct text, >= 2 element nodes, and text anywhere inside the
        //      run → one unit spanning the whole run. This is what makes
        //      `<div><span>Hello </span><span>world</span></div>` a single
        //      sentence-sized request instead of one request per span;
        //   4. no translatable text at all → descend into the run's elements.
        //
        // `curTranslated` (an adjacent .duo-translation) qualifies the run on
        // its own, so a re-scan can never descend into our own output and
        // translate an already-translated run a second time. This was load
        // bearing when sentence highlighting wrapped the run's text into
        // <duo-span>s and emptied the original text nodes (criterion 1 stopped
        // firing, criterion 2 then "unwrapped" into the wrapper). Highlighting
        // no longer writes to the page, so that exact shape can't occur — but
        // the guard stays: it is the invariant, not the workaround.
        const qualifies =
            curHasText ||
            curTranslated ||
            (elementNodes.length > 1 && elementNodes.some(hasTranslatableText));
        if (qualifies) {
            units.push({
                container,
                nodes: curNodes,
                wholeElement: false,
                translated: curTranslated,
            });
        } else {
            descendChildren.push(...elementNodes);
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
