/**
 * Detects whether a focused element is a sensible AI-writing target.
 *
 * Conservative by default — we only auto-mount on:
 *   - contentEditable=true subtrees
 *   - <textarea>
 *   - <input type=text> when it's clearly a long-text input (no maxlength,
 *     or maxlength > LONG_TEXT_MIN), and not a password/OTP/etc.
 *
 * Search boxes, credential fields, OTP inputs, and structured inputs (number,
 * date, color, ...) are intentionally excluded. Users can still summon the
 * workbench via shortcut or popup for those inputs.
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

const SENSITIVE_TEXT = /(password|otp|2fa|captcha|verif|username|user_name|email|phone|identif|密码|验证|用户名|账号|身份|证件|手机|邮箱)/i;

export type AiTarget = HTMLElement;

export function isAiWritingTarget(el: Element | null | undefined): el is AiTarget {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;
    // Exclude our own shadow-hosted UI to avoid recursion when the workbench
    // textarea is itself focused. The registry, not the attribute: the six
    // surfaces carry three different marker attributes, and `closest` could not
    // cross out of a surface's own shadow root to find one anyway.
    if (isInOwnUi(el)) return false;
    // Code editors (CodeMirror 5/6, Monaco, Ace) — the focused element is the
    // editor's input proxy, not the document: CM5 focuses a hidden textarea
    // that only mirrors the selection / recent keystrokes (and its geometry
    // sticks out of the editor, misplacing the dot), CM6/Monaco virtualize
    // rendering so the DOM only holds the visible lines. We can neither read
    // the full content nor write back safely without editor-specific APIs, so
    // skip them entirely.
    // deepClosest: an editor mounted inside a web component keeps its wrapper
    // outside the input's own shadow tree, where plain `closest` cannot see it.
    if (deepClosest(el, ".CodeMirror, .cm-editor, .monaco-editor, .ace_editor")) return false;
    // Visible?
    if (el.getClientRects().length === 0) return false;

    // contentEditable
    if (el.isContentEditable) return true;

    if (el instanceof HTMLTextAreaElement) {
        return !isSensitiveField(el);
    }

    if (el instanceof HTMLInputElement) {
        const type = (el.type || "text").toLowerCase();
        if (FORBIDDEN_INPUT_TYPES.has(type)) return false;
        // if (type !== "text" && type !== "") return false;
        if (isSensitiveField(el)) return false;
        // Long-text heuristic: maxlength absent / large means body-style input.
        const max = el.maxLength;
        if (max > 0 && max < LONG_TEXT_MIN) return false;
        return true;
    }

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
