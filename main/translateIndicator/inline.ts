// The in-page half of the translating indicator: one marker per logical
// paragraph unit, inserted where that unit's translation is about to appear.
//
// Deliberately plain DOM, not the React-in-Shadow-DOM pattern every other
// surface in this extension uses. That pattern is for panels — one host, one
// React root, one stylesheet. Here there is one marker per unit, so a full page
// means hundreds of them appearing and disappearing as paragraphs scroll into
// view; a shadow root plus a React root each would be orders of magnitude more
// work than the markup it renders, and a shadow root cannot inherit the
// paragraph's font-size/colour, which is exactly what makes the marker sit in
// the text as if it belonged there. The whole node is four elements with no
// state, so there is nothing React would be managing.
//
// Its styling comes from main/translateIndicator/indicatorCss.ts, which rides
// along with the translation stylesheet and therefore also reaches page shadow
// roots.
import { TRANSLATE_INDICATOR_TAG } from "@/main/constants";
import { markNoTranslate } from "@/main/dom/paragraphMarks";
import { isContainsValidTextElement } from "@/main/dom/textNodes";
import type { TranslationUnit } from "@/main/dom/segments";
import { t } from "@/main/aiWriting/i18n";

/** lucide `circle-alert` and `rotate-cw`, as raw path data. */
const ICON_ALERT = '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>';
const ICON_RETRY = '<path d="M21 12a9 9 0 1 1-3.5-7.1"/><path d="M21 3v6h-6"/>';

export type InlineVariant = "dots" | "spinner";

export interface InlineErrorHandlers {
    /**
     * "Show me the reason". Receives the button itself, because the reason is
     * shown anchored to it rather than at the top of the page — see
     * ./errorPopover.tsx.
     */
    onDetails: (anchor: HTMLElement) => void;
    /** "Try this one again". */
    onRetry: () => void;
}

function icon(paths: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    // Static markup we authored; `innerHTML` here only ever parses these two
    // constants (same as the `&nbsp;` divider in main/content.ts).
    svg.innerHTML = paths;
    return svg;
}

function button(className: string, label: string, paths: string, onClick: (el: HTMLElement) => void): HTMLElement {
    // A <span role="button"> rather than a real <button>: this lands inside
    // arbitrary page content, where a `button {}` rule in the site's stylesheet
    // would restyle it, and a form ancestor would make it a submit button.
    const el = document.createElement("span");
    el.className = `duo-loading-btn ${className}`;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    // `title`/`aria-label` rather than a text node: the marker must carry no
    // translatable text of its own (it sits inside a translation container).
    el.setAttribute("title", label);
    el.setAttribute("aria-label", label);
    el.appendChild(icon(paths));
    const fire = (e: Event) => {
        // The marker is inside page content, often inside a link or a clickable
        // card — the click must not reach it.
        e.preventDefault();
        e.stopPropagation();
        onClick(el);
    };
    el.addEventListener("click", fire);
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") fire(e);
    });
    return el;
}

/** The unit's last text-bearing node — the same anchor the translation uses. */
function anchorOf(unit: TranslationUnit): ChildNode | null {
    for (let i = unit.nodes.length - 1; i >= 0; i--) {
        const node = unit.nodes[i];
        if (isContainsValidTextElement(node) && node.parentNode === unit.container) return node;
    }
    return null;
}

/**
 * Insert a spinning marker for `unit`. Returns null when the unit has no
 * attached text node to hang it off (detached mid-scan) — the caller treats
 * that as "no indicator for this one" and carries on translating it.
 */
export function mountInlineIndicator(unit: TranslationUnit, variant: InlineVariant): HTMLElement | null {
    const anchor = anchorOf(unit);
    if (!anchor) return null;
    const el = document.createElement(TRANSLATE_INDICATOR_TAG);
    el.setAttribute("data-duo-anim", variant);
    // Our own UI: never translated, never sampled for language detection, and
    // unaffected by "translate every element on this site" (the `own` set is
    // the one that switch cannot turn off).
    markNoTranslate(el, { own: true });
    renderBusy(el, variant);
    try {
        unit.container.insertBefore(el, anchor.nextSibling);
    } catch {
        return null;
    }
    return el;
}

function renderBusy(el: HTMLElement, variant: InlineVariant): void {
    el.replaceChildren();
    el.classList.remove("duo-loading-error");
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", t("translatingStatus", "Translating…"));
    if (variant === "spinner") {
        const spin = document.createElement("span");
        spin.className = "duo-loading-spin";
        el.appendChild(spin);
        return;
    }
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement("span");
        dot.className = "duo-loading-dot";
        el.appendChild(dot);
    }
}

/** Turn a busy marker into the failure pair: details + retry. */
export function renderInlineError(el: HTMLElement, handlers: InlineErrorHandlers): void {
    el.replaceChildren();
    el.classList.add("duo-loading-error");
    el.setAttribute("role", "alert");
    el.removeAttribute("aria-label");
    el.appendChild(button(
        "duo-loading-details",
        t("translateIndicatorDetails", "Translation failed — show details"),
        ICON_ALERT,
        handlers.onDetails,
    ));
    el.appendChild(button(
        "duo-loading-retry",
        t("translateIndicatorRetry", "Retry"),
        ICON_RETRY,
        handlers.onRetry,
    ));
}

export function removeInlineIndicator(el: HTMLElement): void {
    el.remove();
}
