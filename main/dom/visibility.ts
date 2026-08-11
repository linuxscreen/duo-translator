// "Would the reader actually see this text?" — used by LANGUAGE DETECTION ONLY.
//
// Pages routinely park long text where nobody reads it: SEO/alternate-language
// blocks at `left:-9999px`, `.sr-only` screen-reader copies, `font-size:0`
// wrappers, collapsed accordions (`height:0;overflow:hidden`). Detection weighs
// each sample by its byte length, so one such block can outvote the whole
// article and flip the detected page language.
//
// This filter is deliberately NOT part of marking/translation: a collapsed panel
// or a hidden tab must still be marked, and it gets translated the moment it is
// revealed (the IntersectionObserver picks it up). Only the "what language is
// this page written in?" vote excludes it.
//
// Split in two layers on purpose: `classifyRect` is pure so the geometry rules
// can be unit-tested (jsdom has no layout — every rect there is 0×0), and
// `isVisibleForDetect` is the thin DOM-reading wrapper.

/** The subset of DOMRect the geometry rules need. */
export interface RectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export type RectVerdict =
    /** Renders somewhere a reader could reach. */
    | "visible"
    /** Degenerate or parked outside the document — do not sample. */
    | "hidden"
    /**
     * No box at all (0×0). Ambiguous: either the element generates no box of
     * its own (`display:contents`) or there is genuinely nothing laid out.
     * The caller re-asks with the *content* rect before deciding.
     */
    | "no-box";

/**
 * Boxes thinner than this in either axis are clipping tricks, not text. The
 * classic visually-hidden recipe is `width:1px;height:1px;overflow:hidden`, and
 * `font-size:0` collapses the line box to height 0.
 */
import type { UnitContainer } from "@/main/dom/segments";
import { isShadowRoot, parentElementOrHost } from "@/main/dom/shadowTraversal";

const MIN_VISIBLE_PX = 2;

/**
 * Geometry verdict for one rect. `scrollX`/`scrollY` convert the viewport-
 * relative rect to document coordinates — without that, everything below the
 * fold or scrolled past would look "off-screen".
 */
export function classifyRect(rect: RectLike, scrollX: number, scrollY: number): RectVerdict {
    if (rect.width === 0 && rect.height === 0) return "no-box";
    if (rect.width < MIN_VISIBLE_PX || rect.height < MIN_VISIBLE_PX) return "hidden";
    // Parked left of / above the document origin (`left:-9999px`,
    // `text-indent:-9999px`, `top:-9999px`).
    if (rect.right + scrollX <= 0 || rect.bottom + scrollY <= 0) return "hidden";
    return "visible";
}

/**
 * Do two rects share an area big enough to show text? Used against a clipping
 * ancestor, so a zero-height clip box (the collapsed-accordion recipe) and a
 * box scrolled fully out of its clipper both come out as "no".
 */
export function rectsOverlap(rect: RectLike, clip: RectLike): boolean {
    const width = Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left);
    const height = Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top);
    return width >= MIN_VISIBLE_PX && height >= MIN_VISIBLE_PX;
}

/** Depth cap for the ancestor walks — pathological DOMs must not make them unbounded. */
const MAX_CLIP_ANCESTORS = 32;

/**
 * Hidden by a CSS property that leaves no geometric trace: `display:none` (incl.
 * the `hidden` attribute and any hidden ancestor), `visibility:hidden`,
 * `opacity:0`, `content-visibility`.
 *
 * `checkVisibility` is Chrome 105+ / Firefox 106+; jsdom does not have it, and
 * its absence must read as "not hidden". The option set spans both the original
 * Chrome names (checkOpacity / checkVisibilityCSS) and the later spec names
 * (opacityProperty / visibilityProperty) — unknown dictionary members are
 * ignored, so one call covers every engine version.
 *
 * Only meaningful for an element that HAS a box: the spec makes it answer false
 * for anything boxless, `display:contents` included.
 */
function cssHidden(element: HTMLElement): boolean {
    if (typeof element.checkVisibility !== "function") return false;
    return !element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        contentVisibilityAuto: true,
        opacityProperty: true,
        visibilityProperty: true,
    });
}

/**
 * Closest ancestor that generates a box, skipping chained transparent wrappers
 * (`display:contents` inside `display:contents`, which segments.ts supports).
 */
function nearestBoxedAncestor(element: HTMLElement): HTMLElement | null {
    let parent = parentElementOrHost(element);
    for (let depth = 0; parent && depth < MAX_CLIP_ANCESTORS; depth++, parent = parentElementOrHost(parent)) {
        const rect = parent.getBoundingClientRect();
        if (rect.width !== 0 || rect.height !== 0) return parent;
    }
    return null;
}

/**
 * Is the element clipped out of existence by an ancestor?
 *
 * `classifyRect` cannot see this: a collapsed panel (`height:0;overflow:hidden`,
 * the CSS-transition accordion) leaves its children at full natural height, so
 * the child's own box looks perfectly normal — only the ancestor's clip makes it
 * unreadable. Cost is one computed style per ancestor, and a rect read only for
 * the ones that actually clip; the walk runs on the handful of elements that
 * reach the sample, not on every paragraph.
 *
 * Known and accepted: an item scrolled out of a carousel/scroll container reads
 * as clipped. For "which language is this page in?" that is harmless — the
 * on-screen items answer the same question.
 */
function isClippedAway(element: HTMLElement, rect: RectLike): boolean {
    // Crosses host boundaries: a collapsed accordion *outside* the component is
    // exactly what makes shadow text unreadable, and `parentElement` would stop
    // at the boundary and report it visible.
    let parent = parentElementOrHost(element);
    for (let depth = 0; parent && depth < MAX_CLIP_ANCESTORS; depth++, parent = parentElementOrHost(parent)) {
        const style = getComputedStyle(parent);
        // Either axis being non-visible clips the box (CSS forces the other axis
        // to `auto` anyway), so one rect test covers both.
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        if (!rectsOverlap(rect, parent.getBoundingClientRect())) return true;
    }
    return false;
}

/**
 * Bounding box of an element's *contents*, independent of its own box. Null when
 * the environment cannot measure it (jsdom's Range has no geometry at all).
 */
function contentRect(element: HTMLElement): RectLike | null {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    if (typeof range.getBoundingClientRect !== "function") return null;
    return range.getBoundingClientRect();
}

/**
 * Is this element's text worth sampling for language detection?
 *
 * Four tiers — all of them ancestor-aware by construction (an offscreen ancestor
 * moves the descendant's rect too, an inherited `font-size:0` collapses the
 * descendant's line box), which is why this must never be "simplified" into
 * reading the element's own `style` attribute or matching `.sr-only`-ish class
 * names:
 *
 *   1. Degenerate box — clipped 1×1 recipes, `font-size:0`, `height:0`.
 *   2. Parked outside the document — `left:-9999px` and friends.
 *   3. `cssHidden` — `display:none`, `visibility:hidden`, `opacity:0`, …
 *   4. Clipped away by an ancestor — the collapsed panel.
 *
 * Geometry goes FIRST, and tier 3 is not allowed to answer for a boxless
 * element: `checkVisibility()` returns false for anything that generates no box,
 * so asking it about a `display:contents` container — a legitimate unit
 * container — would hide the very text the page is made of.
 *
 * Fails OPEN: anything it cannot measure counts as visible. In jsdom (and in a
 * frame that never got laid out) every rect is 0×0, and detection must keep
 * working exactly as it did before this filter existed.
 */
export function isVisibleForDetect(container: UnitContainer): boolean {
    // A ShadowRoot has no box of its own — measure the host, which encloses
    // exactly the content the root renders.
    const element: HTMLElement = isShadowRoot(container) ? (container.host as HTMLElement) : container;
    const view = element.ownerDocument.defaultView;
    const scrollX = view?.scrollX ?? 0;
    const scrollY = view?.scrollY ?? 0;

    let rect: RectLike = element.getBoundingClientRect();
    let verdict = classifyRect(rect, scrollX, scrollY);

    if (verdict !== "no-box") {
        if (verdict === "hidden") return false;
        if (cssHidden(element)) return false;
        return !isClippedAway(element, rect);
    }

    // No box of its own. Either the element generates none (`display:contents`,
    // a real unit container per segments.ts) or nothing about it renders.
    // A 1×1 clipped box must NOT reach here: `overflow:hidden` only clips
    // visually, so its content rect still reports the full text width and the
    // element would come back "visible".
    const content = contentRect(element);
    if (!content) return true; // cannot measure at all (jsdom) — fail open
    rect = content;
    verdict = classifyRect(content, scrollX, scrollY);
    // Contents render nowhere either (display:none) — or render degenerately.
    if (verdict !== "visible") return false;
    // `checkVisibility` answers false for ANY boxless element, `display:contents`
    // included, so asking it about this element would always say "hidden". Ask
    // the nearest ancestor that does have a box instead.
    const boxed = nearestBoxedAncestor(element);
    if (boxed && cssHidden(boxed)) return false;
    return !isClippedAway(element, rect);
}
