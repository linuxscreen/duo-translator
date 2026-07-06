/**
 * Whether `applyTextToTarget` could actually write into `el` right now.
 * True only for a connected <textarea> / <input> / contentEditable element —
 * the same set `applyTextToTarget` knows how to write to. Used to gate the
 * "Apply to input" button: if the cursor isn't in an editable target, applying
 * is impossible, so the button must be disabled.
 */
export function canApplyToTarget(el: HTMLElement | null | undefined): boolean {
    if (!el || !el.isConnected) return false;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return true;
    return el.isContentEditable;
}

/** Resolves after the pending `selectionchange` event (if any) has been
 * dispatched, or after `timeoutMs` when no event arrives (e.g. the selection
 * did not actually change). Rich editors sync their internal selection model
 * from this event, so awaiting it guarantees a programmatic `addRange` has
 * been observed by the editor before we edit. */
function selectionSynced(timeoutMs = 150): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            window.clearTimeout(timer);
            document.removeEventListener("selectionchange", done);
            resolve();
        };
        const timer = window.setTimeout(done, timeoutMs);
        document.addEventListener("selectionchange", done);
    });
}

const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Write `text` into the element the user was last focused on, in a way that
 * frameworks (React controlled inputs, Vue v-model, contentEditable rich
 * editors like Twitter / ChatGPT / Gmail) actually observe.
 *
 * Returns true on success.
 */
export async function applyTextToTarget(el: HTMLElement | null, text: string): Promise<boolean> {
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
        // Visible text incl. emoji that editors (x.com) render as <img alt="…">,
        // which plain textContent would drop.
        const readText = (root: HTMLElement) => {
            let out = "";
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (n.nodeType === Node.TEXT_NODE) out += (n as Text).data;
                else if (n instanceof HTMLImageElement) out += n.alt;
            }
            return out;
        };
        // Also strips zero-width chars some editors keep as placeholders.
        const normalize = (s: string) => s.replace(/[\s\u200B-\u200D\uFEFF]+/g, "");
        const want = normalize(text);
        const selectContents = () => {
            try {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            } catch { /* selection may fail in iframe-restricted contexts */ }
        };

        el.focus({ preventScroll: true });

        // Attempt 1 — synthetic paste over a select-all. Rich editors
        // (Draft.js on x.com, Lexical, ProseMirror) run execCommand edits
        // OUTSIDE their document model: the text lands in the DOM natively,
        // the model/selection stay stale, and the next Backspace deletes
        // nothing until the user types once. Their paste handlers, however,
        // write both content and caret into the model. So: select everything,
        // let the editor sync its model selection (async, via
        // `selectionchange`), then hand it a paste event carrying the text.
        selectContents();
        await selectionSynced();
        try {
            const dt = new DataTransfer();
            dt.setData("text/plain", text);
            const handled = !el.dispatchEvent(
                new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
            );
            // `handled` = some listener preventDefault'ed, i.e. an editor
            // consumed the paste. Verify the content actually got replaced —
            // an untrusted paste has no browser default, so plain
            // contentEditables fall through to attempt 2.
            if (handled) {
                await nextMacrotask();
                if (normalize(readText(el)) === want) return true;
            }
        } catch { /* DataTransfer/ClipboardEvent construction can fail (Firefox Xray) */ }

        // Attempt 2, phase 1 — clear the old content, and VERIFY it is gone.
        // A single select-all + insertText is not reliable: editors sync
        // selection from the async `selectionchange` event and some reset the
        // DOM selection back to their own collapsed caret at any time, so the
        // insert can land at a stale caret and leave the old text in place.
        // Deleting first makes the outcome checkable: retry until empty.
        let cleared = normalize(readText(el)) === "";
        for (let attempt = 0; attempt < 3 && !cleared; attempt++) {
            selectContents();
            await selectionSynced();
            // Re-assert in case the editor moved the selection during the wait,
            // then edit immediately so nothing can clobber it in between.
            selectContents();
            try { document.execCommand("delete"); } catch { /* retry */ }
            // The editor may re-render its DOM asynchronously.
            await nextMacrotask();
            cleared = normalize(readText(el)) === "";
        }

        // Phase 3 (run after a successful insert) — leave the editor with a
        // caret it knows about: place the DOM caret at the end and let
        // `selectionchange` dispatch re-seed the editor's internal selection.
        const settleCaretAtEnd = async () => {
            try {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            } catch { /* best effort */ }
            await selectionSynced();
        };

        // Phase 2 — insert at the (now collapsed) caret inside the editor.
        // execCommand is deprecated but produces a trusted InputEvent, which
        // plain contentEditables and legacy editors listen for.
        try {
            if (document.execCommand("insertText", false, text)) {
                await settleCaretAtEnd();
                return true;
            }
        } catch { /* fall through */ }

        // Fallback: replace via Selection API + InputEvent.
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(text));
                el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
                await settleCaretAtEnd();
                return true;
            }
        } catch { /* give up */ }

        return false;
    }

    return false;
}
