// Logical-paragraph segmentation — the "translation unit" model.
//
// A container's direct children are split into *units*: maximal runs of inline
// content (text nodes + inline elements) delimited by block-level children,
// runs of >= SEGMENT_BR_SPLIT_MIN consecutive <br>s, and the container edges.
// Each unit is the minimal translation unit; block-level children are handed
// back to the marking scan so nested paragraphs (<li>, <p>, …) become units of
// their own.
//
// A run with no direct text of its own can still become a unit, but only when
// *every* element in it is mergeable (`isMergeableInline`: an all-inline subtree
// whose every leaf is a non-blank text node). That is what makes
// `<div><span>Hello </span><span>world</span></div>` one sentence-sized unit
// instead of one translation per span, while keeping runs that are really page
// structure — a nested block, an `<img>`, an inline-block chip — out of the
// merge; those are descended into and become containers of their own. The old
// "container must own >= 1 valid direct text node" gate (isParagraphElement) is
// gone. See `flushRun` for the four ordered criteria, including the
// lone-inline-wrapper unwrap that keeps containers tight and translation-cache
// keys byte-compatible.
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
import { isEditable, isExcludedNodeType, isTranslateIndicator } from "@/main/dom/predicates";
import { hasTranslatableText } from "@/main/dom/textNodes";
import { pageShadowRootOf } from "@/main/dom/shadowRoots";

/**
 * A host whose shadow tree renders *structure* — block-level content with real
 * text in it — as opposed to a piece of a sentence.
 *
 * The two failure directions are not symmetric, which is what sets the gate:
 *
 *   - calling an inline component a boundary CUTS A SENTENCE IN HALF
 *     (`Click <x-icon>★</x-icon> to continue.` → two units, two requests, and a
 *     translation injected inside the icon). Icon/badge/chip components are
 *     everywhere, so this would be constant, visible damage;
 *   - missing a boundary leaves that component's text untranslated. Narrower,
 *     and quiet.
 *
 * So "carries text" is NOT enough — `★` is text. The signal is that the root
 * renders a BLOCK: a card/article component emits `<p>`/`<div>`/`<li>`, an icon
 * emits a `<span>` or an `<svg>`. Note this check is only load-bearing for hosts
 * that are inline boxes themselves; a component declaring `:host{display:block}`
 * (the common shape for content components) is already a boundary via
 * `isBlockBoundary`, since `:host` rules do reach the host's computed style.
 *
 * Accepted gap: an INLINE host whose root holds only inline prose stays part of
 * the sentence, so that prose is never translated. Preferred over the alternative
 * of shredding every sentence containing an icon.
 */
function isTranslatableShadowHost(el: HTMLElement): boolean {
    const root = pageShadowRootOf(el);
    if (!root) return false;
    let rendersBlock = false;
    for (const child of Array.from(root.children)) {
        if (isSegmentBoundary(child as HTMLElement)) {
            rendersBlock = true;
            break;
        }
    }
    // Cheap structural test first; the subtree walk only runs on the few hosts
    // that actually look like structure.
    return rendersBlock && hasTranslatableText(root);
}

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

/**
 * What a translation unit hangs off. A `ShadowRoot` is a first-class container,
 * not a special case: it has `childNodes`, `insertBefore`/`appendChild` and
 * `querySelectorAll`, so every write-back and restore path works on it
 * unchanged. What it lacks is the *Element* surface (`matches`, `classList`,
 * `getBoundingClientRect`, IntersectionObserver eligibility) — each of those is
 * guarded at its one call site rather than by excluding roots from the model.
 */
export type UnitContainer = HTMLElement | ShadowRoot;

export interface TranslationUnit {
    container: UnitContainer;
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
        // What renders in place of this element is NOT necessarily `el.children`:
        //   - a shadow host renders its ROOT's children (its light children only
        //     render where a <slot> places them), so a `display:contents` host
        //     wrapping a block shadow tree would otherwise answer "inline";
        //   - a <slot> is `display:contents` by default and renders its ASSIGNED
        //     nodes, not the fallback content in `el.children`.
        // Projection order is deliberately not modelled — the only question is
        // whether any of them is a block.
        const root = pageShadowRootOf(el);
        let kids: Element[] = root
            ? [...Array.from(root.children), ...Array.from(el.children)]
            : Array.from(el.children);
        if (el.tagName === "SLOT") {
            const assigned = (el as HTMLSlotElement)
                .assignedNodes?.({ flatten: true })
                ?.filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE) ?? [];
            if (assigned.length > 0) kids = assigned;
        }
        result = false;
        for (const child of kids) {
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
    // A component that renders structure of its own has to be descended into,
    // not merged into a neighbouring run — its content lives in a separate tree
    // that the run's serialization cannot reach. Placed after the WeakMap-cached
    // block test and gated on a single `el.shadowRoot` read, which is null for
    // essentially every element on a page.
    if (isTranslatableShadowHost(el)) return true;
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

/**
 * Whether `el` renders as a plain inline box. Strictly `display: inline` —
 * `inline-block` / `inline-flex` / `inline-grid` are excluded on purpose: they
 * are atomic boxes, laid out as a single unbreakable rectangle rather than as
 * text flowing with its neighbours, so their content is not part of the
 * surrounding sentence. `display: contents` is excluded too (it generates no box
 * of its own, and what its children render as is already the boundary
 * question `isBlockBoundary` answers).
 *
 * Detached elements / environments without computed style fall back to the
 * static tag set, the same degradation `isBlockBoundary` uses.
 *
 * Cached like `isBlockBoundary`, and for the same reason squared: `display`
 * rarely changes at runtime, a stale hit only degrades to static-tag precision,
 * and `isMergeableInline` asks this of *every element in a run's subtree* on
 * *every* scan — uncached that is one `getComputedStyle` per element per scan.
 */
const inlineBoxCache = new WeakMap<Element, boolean>();

function isInlineBox(el: HTMLElement): boolean {
    const cached = inlineBoxCache.get(el);
    if (cached !== undefined) return cached;
    const display = computedDisplay(el);
    const result =
        display === undefined
            ? !blockTagSet.has(el.tagName.toLowerCase())
            : display === "inline";
    inlineBoxCache.set(el, result);
    return result;
}

/**
 * Whether `el` may be merged into a sibling run — the gate on run merging
 * (criterion 3 in `flushRun`). Two conditions on the whole subtree, `el`
 * included:
 *
 *   1. **every element in it is an inline box** — one block/inline-block
 *      descendant anywhere and the element is out (`<a><span>a</span><div/></a>`);
 *   2. **every leaf is a non-blank text node** — an element that bottoms out in
 *      anything else contributes a box the merged text can't account for, so it
 *      is out too: `<img>`, an empty `<i></i>`, a `<br>`, an `<svg>`.
 *
 * Branching is fine (that was the point of merging in the first place):
 * `<a><span>a</span></a>`, `<a>b<span>a</span></a>` and
 * `<a><span>a</span><span>b</span></a>` all qualify.
 *
 * Non-element nodes other than text — comments in particular — are simply
 * skipped: they render nothing, and a React `<!---->` marker between two spans
 * must not disqualify ordinary markup. Blank text nodes are skipped the same way
 * (the whitespace in `<span> <b>x</b> </span>`), but they cannot satisfy
 * condition 2 on their own — an element with no non-blank text anywhere inside
 * has nothing to merge and is rejected.
 *
 * `excludedTagSet` tags (`<code>`, `<pre>`, `<video>`, `<img>`, …) and editable
 * subtrees are rejected outright even when they do hold text: the marking scan
 * refuses to translate them, so their text must not qualify a run either. This
 * is what keeps `<div><code>foo()</code><code>bar()</code></div>` out of the
 * merged path.
 */
export function isMergeableInline(el: HTMLElement): boolean {
    // Its text is in another tree: `getTextNodesAndText` would never see it, so
    // merging would build a unit whose serialization silently omits it.
    // An EMPTY host (`<x-icon></x-icon>`) is unaffected — it already fails the
    // "every leaf is a non-blank text node" test below.
    if (isTranslatableShadowHost(el)) return false;
    if (isExcludedNodeType(el) || isEditable(el)) return false;
    if (!isInlineBox(el)) return false;
    let hasText = false;
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (contentValid(child)) hasText = true;
            continue;
        }
        // Comments and other non-element nodes render nothing — skip them.
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (!isMergeableInline(child as HTMLElement)) return false;
        hasText = true; // a mergeable child always carries text of its own
    }
    return hasText;
}

type NodeKind = "text" | "passive" | "duo-marker" | "duo-indicator" | "br" | "block" | "inline";

function classify(node: ChildNode): NodeKind {
    if (node.nodeType === Node.TEXT_NODE) return "text";
    if (node.nodeType !== Node.ELEMENT_NODE) return "passive";
    const el = node as HTMLElement;
    // The translating indicator is transient scaffolding, not output: unlike
    // `duo-marker` it must not even set `sawSplitOrMarker`, or a container
    // re-segmented while a spinner is up would lose the whole-element path and
    // translate under a different cache key than the same container does when
    // nothing is in flight.
    if (isTranslateIndicator(el)) return "duo-indicator";
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
 * Runs that do not qualify (see `flushRun`) do not become units — their element
 * children are returned in `descendChildren` instead, and the marking scan
 * visits them next.
 */
export function segmentParagraph(container: UnitContainer): SegmentScan {
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
        //   3. no direct text, >= 2 element nodes, and *every* one of them is
        //      mergeable (see `isMergeableInline`: all-inline subtree, every leaf
        //      a non-blank text node) → one unit spanning the whole run. This is
        //      what makes `<div><span>Hello </span><span>world</span></div>` a
        //      single sentence-sized request instead of one request per span.
        //      One non-mergeable element is enough to disqualify the run — an
        //      `<img>` or a nested block between two spans means the run is page
        //      structure, not one sentence;
        //   4. anything else → descend into the run's elements, each becoming a
        //      container of its own.
        //
        // `curTranslated` (an adjacent .duo-translation) qualifies the run on
        // its own, so a re-scan can never descend into our own output and
        // translate an already-translated run a second time. This is load
        // bearing on the <duo-span> highlight fallback: wrapping moves the run's
        // text into the spans and leaves the direct text nodes empty, so
        // criterion 1 stops firing and criterion 2 would "unwrap" straight into
        // our own output. The preferred Highlight-API path writes nothing to the
        // page and never produces that shape — the guard is the invariant, not
        // the workaround for one of the two paths.
        //
        // Criterion 1 is deliberately NOT gated by the mergeable test: a run
        // that owns its own sentence ("Use <a>the <b>new</b> API</a> now") is
        // one paragraph by every reading, and re-cutting it would both split
        // ordinary prose into three requests and change long-standing
        // translation-cache keys.
        //
        // The merge test sits behind the `||` short-circuit on purpose: the two
        // cheap flags answer for the overwhelming majority of runs, and this
        // walks the run's whole subtree.
        const qualifies =
            curHasText ||
            curTranslated ||
            (elementNodes.length > 1 && elementNodes.every(isMergeableInline));
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
            case "duo-indicator":
                // Skipped entirely: not part of any unit, not a split, and no
                // trace left in the scan's flags.
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
        // Re-reading childNodes here would put a translating indicator straight
        // back into the unit the loop above was careful to keep it out of — and
        // `nodes` is what DOUBLE clones into the copy it sends to the provider,
        // and what the insertion anchor is picked from.
        units[0].nodes = Array.from(container.childNodes).filter(n => !isTranslateIndicator(n));
        units[0].wholeElement = true;
    }

    return { units, descendChildren };
}

/** Whether `container` still has a unit without an inserted translation. */
export function hasUntranslatedUnit(container: UnitContainer): boolean {
    return segmentParagraph(container).units.some((unit) => !unit.translated);
}
