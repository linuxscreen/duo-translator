// ---------------------------------------------------------------------------
// The characters a shortcut types on its way to firing.
//
// A shortcut on a printable key ("triple-tap Space") types before it fires: the
// browser inserts on every press, and nothing at press time can know whether
// the sequence will complete — that ambiguity is why such a shortcut can
// coexist with ordinary typing at all. So the insertions are tracked here and
// removed afterwards by main/dom/typedEcho.ts.
//
// Pure and DOM-free (the element is only ever compared by identity), because
// the interesting part is a small state machine with several ways to be subtly
// wrong, and every one of them is a silent bug: too few characters and a space
// is left in the user's text, too many and the guard in typedEcho refuses to
// cut at all, leaving ALL of them behind.
// ---------------------------------------------------------------------------

import { GESTURE_TRIGGER, type ShortcutDef } from "./types";

export interface TypedRun {
    el: HTMLElement;
    /** Consecutive presses of one character, oldest first. */
    text: string;
}

/** The parts of a keydown this needs. Structural, so tests need no real event. */
export interface TypedKey {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    /** The IME is mid-composition, so this press edits the composition. */
    isComposing?: boolean;
    /** Legacy IME signal; 229 means "the IME took this one". */
    keyCode?: number;
}

/** Is this press being consumed by an IME rather than inserting a character? */
function imeConsumed(e: TypedKey): boolean {
    return e.isComposing === true || e.keyCode === 229;
}

/**
 * Fold one keydown into the run.
 *
 * `el` is the editable the character would land in, or null when the focus is
 * not in one. Returns the new run — `null` means "nothing is pending".
 */
export function extendTypedRun(run: TypedRun | null, e: TypedKey, el: HTMLElement | null): TypedRun | null {
    // Ctrl / Alt / Meta suppress text input, and a `key` longer than one
    // character is not a character at all (Enter, ArrowLeft, F5).
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return null;
    // An IME-consumed press inserts nothing of its own. In a Chinese IME the
    // Space that COMMITS the candidate is exactly this: the user sees three
    // presses and the field receives two spaces. Counting it made the run one
    // longer than the text actually there, and since typedEcho verifies before
    // it cuts, the mismatch meant nothing was removed at all — the shortcut
    // left two spaces in the message it had just translated.
    if (imeConsumed(e)) return null;
    if (!el) return null;
    // Only a run of the SAME character can belong to one shortcut. Starting
    // over on anything else is what keeps "hello   " from being read as eight
    // characters of shortcut.
    if (run && run.el === el && run.text[0] === e.key) return { el, text: run.text + e.key };
    return { el, text: e.key };
}

/**
 * How much of the run the shortcut that just fired can account for.
 *
 * The cap matters: three spaces where the shortcut is a double-tap means the
 * first was the user's own (its sequence had already timed out), and removing
 * it would delete a character they meant to keep.
 */
export function typedRunForShortcut(run: TypedRun | null, def: ShortcutDef | null): TypedRun | null {
    if (!run || !def) return null;
    const presses = def.trigger === GESTURE_TRIGGER.MULTI ? def.count
        : def.trigger === GESTURE_TRIGGER.CLICK ? 1
            // HOLD: the key auto-repeats for as long as it is held, so how many
            // characters arrived is not something the definition can say — the
            // run itself is the only answer. Characters arriving after the hold
            // fires are missed; a hold on a printable key bound to "translate
            // input box" is a pathological setup, not worth a second pass.
            : run.text.length;
    const text = run.text.slice(-Math.min(run.text.length, presses));
    return text ? { el: run.el, text } : null;
}
