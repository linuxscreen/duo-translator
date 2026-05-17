/**
 * Write `text` into the element the user was last focused on, in a way that
 * frameworks (React controlled inputs, Vue v-model, contentEditable rich
 * editors like Twitter / ChatGPT / Gmail) actually observe.
 *
 * Returns true on success.
 */
export function applyTextToTarget(el: HTMLElement | null, text: string): boolean {
    if (!el || !el.isConnected) return false;

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        // React tracks the previous value on the DOM node and short-circuits
        // setState if `el.value = x` looks like a no-op. Going through the
        // native prototype setter forces React's onChange to fire.
        const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        try {
            el.focus({ preventScroll: true });
            if (setter) setter.call(el, text);
            else el.value = text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        } catch {
            return false;
        }
    }

    if (el.isContentEditable) {
        el.focus({ preventScroll: true });
        // Select existing content so insertText replaces rather than appends.
        try {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        } catch { /* selection may fail in iframe-restricted contexts */ }

        // execCommand is deprecated but is still the only API that produces
        // the InputEvent rich editors (Twitter, ChatGPT, Gmail) listen for.
        try {
            const ok = document.execCommand("insertText", false, text);
            if (ok) return true;
        } catch { /* fall through */ }

        // Fallback: replace via Selection API + InputEvent.
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(text));
                el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
                return true;
            }
        } catch { /* give up */ }

        return false;
    }

    return false;
}
