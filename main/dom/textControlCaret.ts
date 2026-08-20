/**
 * Selection geometry INSIDE an `<input>` / `<textarea>`.
 *
 * A text control's content is not in the DOM: `selectionStart`/`selectionEnd`
 * are character offsets into `value`, no Range can address them, and nothing on
 * the platform reports where they land on screen. The only way to get a rect is
 * to lay the same string out a second time in a mirror element that copies every
 * property affecting line breaking, and read the position of a marker placed at
 * the character in question.
 *
 * Measurement is an ENHANCEMENT, never a requirement: everything here degrades
 * to the control's own content box (`fallback` below), so a control we cannot
 * mirror still gets a pill sitting under it rather than none at all.
 */

import { attachOwnShadow } from "@/main/dom/shadowRoots";

export type TextControl = HTMLInputElement | HTMLTextAreaElement;

export interface TextControlSelection {
    start: number;
    end: number;
    /** Raw slice of `value` — the caller decides about trimming. */
    text: string;
}

/**
 * The control's current selection, or null when there is none.
 *
 * `selectionStart` THROWS on input types that do not support selection
 * (`number`, `email`, `date`, …). The icon's own predicate rejects those, but a
 * geometry helper must not be the thing that breaks if that list ever drifts.
 */
export function textControlSelection(el: TextControl): TextControlSelection | null {
    let start: number | null;
    let end: number | null;
    try {
        start = el.selectionStart;
        end = el.selectionEnd;
    } catch {
        return null;
    }
    if (start === null || end === null || start === end) return null;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    return { start: from, end: to, text: el.value.slice(from, to) };
}

/**
 * Line box of the caret at the selection's END — the pill's anchor, matching
 * what `caretRectOf` does for a DOM selection.
 */
export function textControlCaretRect(el: TextControl): DOMRect | null {
    const sel = textControlSelection(el);
    if (!sel) return null;
    return caretRect(el, sel.end);
}

/**
 * Bounding box of the whole selection — what the translate card anchors to.
 * The union of both carets: exact for a selection on one line, and the right
 * enclosing box for a multi-line one.
 */
export function textControlSelectionRect(el: TextControl): DOMRect | null {
    const sel = textControlSelection(el);
    if (!sel) return null;
    const head = caretRect(el, sel.start);
    const tail = caretRect(el, sel.end);
    if (!head || !tail) return head ?? tail;
    const left = Math.min(head.left, tail.left);
    const top = Math.min(head.top, tail.top);
    const right = Math.max(head.right, tail.right);
    const bottom = Math.max(head.bottom, tail.bottom);
    return new DOMRect(left, top, right - left, bottom - top);
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Above this, the mirror is skipped and the pill anchors to the control itself.
 * Laying out a megabyte of text a second time — on every scroll frame while the
 * selection is live — is not worth a few pixels of precision.
 */
const MIRROR_MAX_CHARS = 20000;

/** Every property that can move a character within the control's content box. */
const COPIED_PROPS = [
    "direction",
    "font-style", "font-variant", "font-weight", "font-stretch",
    "font-size", "font-size-adjust", "font-family",
    "line-height", "letter-spacing", "word-spacing",
    "text-align", "text-indent", "text-transform",
    "tab-size", "word-break",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
];

function px(value: string): number {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function caretRect(el: TextControl, index: number): DOMRect | null {
    const view = el.ownerDocument.defaultView;
    if (!view) return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;

    const style = view.getComputedStyle(el);
    const borderTop = px(style.borderTopWidth);
    const borderLeft = px(style.borderLeftWidth);
    const padTop = px(style.paddingTop);
    const padBottom = px(style.paddingBottom);

    const local = el.value.length <= MIRROR_MAX_CHARS ? measure(el, index, style) : null;

    // An `<input>` centres its single line inside the content box whatever the
    // line-height, which the mirror does not reproduce. Its vertical extent is
    // therefore taken from the control itself — for one line that IS the answer,
    // and it costs nothing to be exact about it.
    const singleLine = el instanceof HTMLInputElement || !local;
    const top = singleLine ? box.top + borderTop + padTop : box.top + local!.top - el.scrollTop;
    const height = singleLine
        ? Math.max(el.clientHeight - padTop - padBottom, 1)
        : local!.height;
    const left = local ? box.left + local.left - el.scrollLeft : box.left + borderLeft;

    // The caret can be scrolled out of the control's visible area. Clamping to
    // the padding box keeps the pill on the control's edge instead of letting it
    // wander off to wherever the hidden text would be.
    const innerLeft = box.left + borderLeft;
    const innerTop = box.top + borderTop;
    const innerRight = innerLeft + el.clientWidth;
    const innerBottom = innerTop + el.clientHeight;
    const x = Math.min(Math.max(left, innerLeft), innerRight);
    const y = Math.min(Math.max(top, innerTop), Math.max(innerBottom - height, innerTop));
    return new DOMRect(x, y, 0, height);
}

/**
 * Position of character `index`, relative to the control's BORDER box and
 * before its own scroll offsets are applied. Null when it cannot be measured.
 */
function measure(
    el: TextControl,
    index: number,
    style: CSSStyleDeclaration,
): { left: number; top: number; height: number } | null {
    const doc = el.ownerDocument;
    const mirror = ensureMirror(doc);
    if (!mirror) return null;

    const isInput = el instanceof HTMLInputElement;
    const s = mirror.style;
    s.cssText = "";
    for (const prop of COPIED_PROPS) s.setProperty(prop, style.getPropertyValue(prop));
    s.position = "absolute";
    s.top = "0px";
    s.left = "0px";
    s.boxSizing = "border-box";
    // `clientWidth` is the padding box (no border, no scrollbar), so the borders
    // copied above have to be added back for a border-box width. Same content
    // width as the control ⇒ the same line breaks.
    s.width = `${el.clientWidth + px(style.borderLeftWidth) + px(style.borderRightWidth)}px`;
    // A single-line control never wraps however long its value is; a textarea
    // wraps exactly as its own computed style says.
    s.whiteSpace = isInput ? "pre" : "pre-wrap";
    s.overflowWrap = isInput ? "normal" : (style.getPropertyValue("overflow-wrap") || "break-word");

    // The marker holds a zero-width NO-BREAK space: a plain ZWSP would add a
    // line-break opportunity and could change the very wrapping we are measuring.
    // The remainder of the value follows it so the line it sits on breaks the
    // way it does in the control.
    const marker = doc.createElement("span");
    marker.textContent = "\uFEFF";
    mirror.textContent = el.value.slice(0, index);
    mirror.appendChild(marker);
    mirror.appendChild(doc.createTextNode(el.value.slice(index)));

    // offsetTop/offsetLeft are measured from the offsetParent's PADDING edge,
    // and the mirror copies the control's padding — so adding the border widths
    // back lands us on the control's border-box origin, which is what the
    // caller's `getBoundingClientRect()` reports.
    const result = {
        left: marker.offsetLeft + px(style.borderLeftWidth),
        top: marker.offsetTop + px(style.borderTopWidth),
        height: px(style.lineHeight) || marker.offsetHeight || px(style.fontSize) * 1.2,
    };
    // Never leave a copy of what the user typed lying around in the tree.
    mirror.textContent = "";
    return result;
}

// ---------------------------------------------------------------------------
// The mirror element
// ---------------------------------------------------------------------------

const HOST_ID = "duo-text-mirror-host";

let mirrorHost: HTMLElement | null = null;
let mirrorEl: HTMLDivElement | null = null;

/**
 * The mirror lives inside one of OUR shadow roots, not loose in the page.
 *
 * A stray absolutely-positioned copy of the page's text would be marked,
 * translated and sampled for language detection like any other paragraph, and
 * its own insert/remove would wake the content MutationObserver on every
 * measurement. Inside a registered own-root it is invisible to all three.
 */
function ensureMirror(doc: Document): HTMLDivElement | null {
    if (mirrorEl && mirrorHost?.isConnected && mirrorHost.ownerDocument === doc) return mirrorEl;
    try {
        const host = doc.createElement("div");
        host.id = HOST_ID;
        // Hidden and zero-sized, but still LAID OUT — `visibility`/`overflow`
        // change nothing about the offsets we read, while `display:none` would
        // make every one of them 0.
        host.style.cssText =
            "position:fixed; top:0; left:0; width:0; height:0; overflow:hidden;" +
            "visibility:hidden; pointer-events:none; z-index:-2147483648;";
        doc.documentElement.appendChild(host);
        const shadow = attachOwnShadow(host);
        const div = doc.createElement("div");
        shadow.appendChild(div);
        mirrorHost = host;
        mirrorEl = div;
        return div;
    } catch {
        return null;
    }
}
