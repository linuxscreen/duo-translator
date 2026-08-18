/**
 * Detects whether a focused element is a sensible AI-writing target.
 *
 * Conservative by default — we only auto-mount on:
 *   - contentEditable=true subtrees
 *   - <textarea>
 *   - <input type=text> when it's clearly a long-text input (no maxlength,
 *     or maxlength > LONG_TEXT_MIN), and not a password/OTP/etc.
 *
 * Credential fields, OTP inputs, structured inputs (number, date, color, ...),
 * and the hidden input proxies of code editors / web terminals are
 * intentionally excluded. Users can still summon the workbench via shortcut or
 * popup for those inputs.
 */

import { composedTarget, deepActiveElement, deepClosest, parentElementOrHost } from "@/main/dom/shadowTraversal";
import { isInOwnUi } from "@/main/dom/shadowRoots";

const LONG_TEXT_MIN = 32;

const FORBIDDEN_INPUT_TYPES = new Set([
    "password", "hidden", "email", "tel", "url",
    "number", "date", "datetime-local", "time", "week", "month",
    "file", "color", "range", "checkbox", "radio", "submit",
    "reset", "button", "image",
]);

const FORBIDDEN_AUTOCOMPLETE = new Set([
    "current-password", "new-password", "username", "one-time-code",
    "cc-number", "cc-csc", "cc-exp", "cc-exp-month", "cc-exp-year",
]);

const SENSITIVE_TEXT = /(password|otp|2fa|captcha|verif|username|user_name|email|phone|identif|terminal|密码|验证|用户名|账号|身份|证件|手机|邮箱)/i;

// Code editors (CodeMirror 5/6, Monaco, Ace) and web terminals (xterm.js —
// which is what BT panel / fnOS / PVE / ttyd / wetty / code-server all embed — plus
// jQuery Terminal, hterm, noVNC). Same shape in both cases: the focused node
// is the app's *input proxy*, not its document — a hidden field that only
// mirrors recent keystrokes while the real content lives in a canvas or a
// virtualized row list. We can neither read the content nor write back, and on
// a terminal a write-back would inject a synthetic paste into the live shell.
//
// Matching the container class is what makes this reliable. The `terminal`
// keyword in SENSITIVE_TEXT only catches xterm because xterm happens to label
// its proxy `aria-label="Terminal input"` — that label is not required by
// anything, and a contentEditable-based terminal (hterm's `<x-screen>`,
// jQuery Terminal's `.cmd`) never reaches the text probe at all, since
// `isContentEditable` answers first. Keep the keyword as a cheap backstop.
const PROXY_INPUT_HOST_SELECTOR = [
    ".CodeMirror", ".cm-editor", ".monaco-editor", ".ace_editor",
    ".xterm", ".terminal", ".hterm", "x-screen", ".noVNC_keyboardinput",
].join(", ");

export type AiTarget = HTMLElement;

export function isAiWritingTarget(el: Element | null | undefined): el is AiTarget {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;
    // Exclude our own shadow-hosted UI to avoid recursion when the workbench
    // textarea is itself focused. The registry, not the attribute: the six
    // surfaces carry three different marker attributes, and `closest` could not
    // cross out of a surface's own shadow root to find one anyway.
    if (isInOwnUi(el)) return false;
    // Editors and terminals — see PROXY_INPUT_HOST_SELECTOR.
    // deepClosest: an editor mounted inside a web component keeps its wrapper
    // outside the input's own shadow tree, where plain `closest` cannot see it.
    if (deepClosest(el, PROXY_INPUT_HOST_SELECTOR)) return false;
    // Visible?
    if (el.getClientRects().length === 0) return false;

    // contentEditable
    if (el.isContentEditable) return true;

    if (el instanceof HTMLTextAreaElement) {
        if (isUnwritableField(el)) return false;
        return !isSensitiveField(el);
    }

    if (el instanceof HTMLInputElement) {
        const type = (el.type || "text").toLowerCase();
        if (FORBIDDEN_INPUT_TYPES.has(type)) return false;
        // if (type !== "text" && type !== "") return false;
        if (isUnwritableField(el)) return false;
        if (isSensitiveField(el)) return false;
        // Long-text heuristic: maxlength absent / large means body-style input.
        const max = el.maxLength;
        if (max > 0 && max < LONG_TEXT_MIN) return false;
        return true;
    }

    return false;
}

/**
 * A field we could not write back to, or that is not really a field the user
 * types into. Two shapes, both of which the class list above cannot cover:
 *
 *  - readOnly / disabled: `applyText` would run and change nothing, so the dot
 *    would sit there offering an action that silently does nothing. Log viewers
 *    and command-output panes are usually readonly <textarea>s.
 *  - the *invisible* input proxy. Terminal and remote-desktop apps that are not
 *    in the selector list (Apache Guacamole's input sink, in-house SSH panels)
 *    park a focusable field under the caret and paint it away: transparent, or
 *    pushed off-screen (xterm uses `left: -9999em` while unfocused), or clipped
 *    to a single character cell. A real writing surface is none of those.
 */
function isUnwritableField(el: HTMLInputElement | HTMLTextAreaElement): boolean {
    if (el.readOnly || el.disabled) return true;

    const rect = el.getBoundingClientRect();
    if (rect.right <= 0 || rect.bottom <= 0) return true;
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return true;
    // A one-cell box. Deliberately well under any real single-line input.
    if (rect.width < 24 || rect.height < 12) return true;

    const style = getComputedStyle(el);
    if (style.opacity === "0" || style.visibility === "hidden") return true;

    return false;
}

function isSensitiveField(el: HTMLInputElement | HTMLTextAreaElement): boolean {
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase().trim();
    if (FORBIDDEN_AUTOCOMPLETE.has(ac)) return true;
    const probes = [
        el.name,
        el.id,
        el.getAttribute("aria-label") || "",
        el.getAttribute("placeholder") || "",
    ].join(" ");
    return SENSITIVE_TEXT.test(probes);
}

function hasSensitiveAncestor(el: HTMLElement): boolean {
    // role="search" form or container
    let cur: HTMLElement | null = el;
    while (cur && cur !== document.body) {
        const role = cur.getAttribute("role");
        if (role === "search") return true;
        cur = parentElementOrHost(cur);
    }
    return false;
}

// ---------------------------------------------------------------------------
// Focus tracking — global event delegation, single listener pair
// ---------------------------------------------------------------------------

export interface FocusTrackerHandlers {
    onTargetIn(el: AiTarget): void;
    onTargetOut(el: AiTarget): void;
}

export function startFocusTracker(handlers: FocusTrackerHandlers): () => void {
    let current: AiTarget | null = null;

    // composedTarget throughout: focus events are composed, so they DO escape a
    // shadow root — but `e.target` is retargeted to the HOST, which is never an
    // input, so the dot never appeared for any input inside a web component.
    const onFocusIn = (e: FocusEvent) => {
        const t = composedTarget(e);
        if (isAiWritingTarget(t)) {
            if (current && current !== t) handlers.onTargetOut(current);
            current = t;
            handlers.onTargetIn(t);
        }
    };

    const onFocusOut = (e: FocusEvent) => {
        // We don't immediately drop on focusout — the floating dot itself may
        // briefly take focus when the user hovers it. Caller is responsible
        // for hide-debouncing. We still notify so caller can start the timer.
        const t = composedTarget(e);
        if (current && t === current) {
            handlers.onTargetOut(current);
            // Keep `current` so caller can re-confirm via getCurrentTarget().
        }
    };

    // Pointerdown safety net: pages like ChatGPT autofocus their composer
    // and the user keeps interacting with the same already-focused element.
    // Browsers do NOT re-fire focusin when the user clicks an element that
    // is already the active element, so without this listener focusin will
    // never fire and the dot stays hidden forever. Promote a click on an
    // already-focused valid target into a synthetic onTargetIn.
    const onPointerDown = (e: PointerEvent) => {
        const t = composedTarget(e);
        if (!t || current === t) return;
        if (deepActiveElement() !== t) return;
        if (isAiWritingTarget(t)) {
            current = t;
            handlers.onTargetIn(t);
        }
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);

    // Seed from whatever is already focused at mount time. Walk shadow roots
    // to find the real active element across composed boundaries.
    const seed = deepActiveElement();
    if (isAiWritingTarget(seed)) {
        current = seed;
        handlers.onTargetIn(seed);
    }

    return () => {
        document.removeEventListener("focusin", onFocusIn, true);
        document.removeEventListener("focusout", onFocusOut, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
    };
}

/**
 * Tracks the most recent qualifying target across focus changes. Survives
 * blur (used by the workbench to remember "where to apply").
 */
export function createLastTargetRef(): { get(): AiTarget | null; set(t: AiTarget | null): void } {
    let last: AiTarget | null = null;
    return {
        get() {
            if (last && last.isConnected) return last;
            return null;
        },
        set(t) { last = t; },
    };
}
