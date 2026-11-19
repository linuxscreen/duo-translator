// ---------------------------------------------------------------------------
// Browser-level shortcuts (`chrome.commands`), expressed in the combo form the
// gesture layer matches on.
//
// Why this exists: a browser command is registered with the BROWSER, which
// handles the key itself and never dispatches it to the page. A page-level
// gesture on the same combo therefore cannot fire — not sometimes, ever — and
// from inside the editor that looks exactly like a bug in this extension. It
// bit us with `Alt+W`, which is this extension's own AI-workbench command.
//
// The list is read from `commands.getAll()` rather than hardcoded, so it
// reflects what the user actually has bound today (Chrome's
// chrome://extensions/shortcuts, or our own editor on Firefox) instead of the
// manifest's suggestions.
//
// Scope, honestly: this covers the extension's OWN commands, which is all the
// browser will tell us. The browser's built-in shortcuts (Ctrl+T, Ctrl+W, …)
// are not enumerable by any API, and hardcoding them would mean maintaining a
// per-browser, per-platform, per-version table that would be wrong somewhere
// from the day it was written.
// ---------------------------------------------------------------------------

import { buildCombo, gestureKeyOf, isModifierToken, type ModifierState } from './types';

/**
 * Command-syntax key names that are not just their own token.
 *
 * Everything else the syntax allows is either a letter (`A` → `KeyA`), a digit
 * (`1` → `Digit1`) or a function key (`F5`, which already matches). The arrows
 * are the only real renames.
 */
const NAMED_KEYS: Record<string, string> = {
    Comma: 'Comma',
    Period: 'Period',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Space: 'Space',
    Insert: 'Insert',
    Delete: 'Delete',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
};

/**
 * Chrome on macOS reports a shortcut the way the menu bar draws it — glyphs,
 * unseparated: `"⌥A"`, `"⇧⌘Y"` — instead of the manifest grammar it accepts.
 * Unlike the word `Ctrl`, the glyphs are literal: ⌃ is the Control key.
 */
const MAC_GLYPH_MODIFIERS: Record<string, string> = {
    '⌃': 'Control',
    '⌥': 'Alt',
    '⇧': 'Shift',
    '⌘': 'Meta',
};

/**
 * `"Alt+W"` / `"Ctrl+Shift+Y"` → `"Alt+KeyW"` / `"Control+Shift+KeyY"`, and the
 * macOS glyph form `"⌥W"` → `"Alt+KeyW"`.
 *
 * `null` for anything this syntax allows but the gesture layer cannot express,
 * which is the safe answer: a combo we fail to parse simply produces no
 * warning, never a wrong one.
 */
export function commandShortcutToCombo(shortcut: string, isMac: boolean): string | null {
    const parts = (shortcut || '').split('+').map((p) => p.trim()).filter((p) => p !== '');
    if (parts.length === 0) return null;

    const modifiers: string[] = [];
    let main: string | null = null;

    for (let part of parts) {
        while (part !== '' && MAC_GLYPH_MODIFIERS[part[0]]) {
            modifiers.push(MAC_GLYPH_MODIFIERS[part[0]]);
            part = part.slice(1);
        }
        if (part === '') continue;
        switch (part) {
            // Not a typo: in the command syntax `Ctrl` means Command on macOS,
            // and the physical Control key is spelled `MacCtrl`. Reading it as
            // Control there would warn about the wrong combo.
            case 'Ctrl':
                modifiers.push(isMac ? 'Meta' : 'Control');
                continue;
            case 'Command':
                modifiers.push('Meta');
                continue;
            case 'MacCtrl':
                modifiers.push('Control');
                continue;
            case 'Alt':
            case 'Shift':
                modifiers.push(part);
                continue;
            // ChromeOS's Search key has no KeyboardEvent token to compare with.
            case 'Search':
                return null;
        }
        // A second ordinary key is not a shape this syntax produces; bail
        // rather than guess which one the browser would act on.
        if (main !== null) return null;
        if (/^[A-Z]$/.test(part)) main = `Key${part}`;
        else if (/^[0-9]$/.test(part)) main = `Digit${part}`;
        else if (/^F([1-9]|1[0-2])$/.test(part)) main = part;
        else if (NAMED_KEYS[part]) main = NAMED_KEYS[part];
        else return null;
    }

    // Every command has exactly one ordinary key; modifiers alone are not a
    // shortcut the browser can register, so there is nothing to warn about.
    if (main === null) return null;
    return buildCombo(modifiers, main);
}

export type BrowserShortcut = {
    /** The command's manifest name, which is what the background dispatches on. */
    name: string;
    /** In gesture-layer combo form. */
    combo: string;
    /** What to call it in the warning — the browser's own localized description. */
    label: string;
};

/** Unassigned commands are dropped: they take no key, so they collide with none. */
export function browserShortcutsFrom(
    commands: { name?: string; description?: string; shortcut?: string }[],
    isMac: boolean,
): BrowserShortcut[] {
    const out: BrowserShortcut[] = [];
    for (const command of commands) {
        if (!command.shortcut) continue;
        const combo = commandShortcutToCombo(command.shortcut, isMac);
        if (!combo) continue;
        out.push({ name: command.name ?? '', combo, label: command.description || command.name || command.shortcut });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Commands the browser does not deliver while a text field has focus.
//
// On macOS, Option+<key> TYPES a character (Option+A is "å"). Firefox and
// Safari let the focused text field have the key, so a command bound to
// Alt+<key> never fires there — the character is inserted instead. Firefox
// documents this as intended (bug 1743946, WONTFIX); Chromium takes extension
// commands before the page sees the key and is not affected.
//
// All four shipped defaults are Alt+<letter>, and "translate the input box" is
// only ever pressed with an input focused, so on those two browsers the default
// shortcut for it could not work at all. The content script therefore takes the
// key itself in exactly that situation and has the background run the command.
// ---------------------------------------------------------------------------

/** The parts of a keydown the matcher reads. Structural, so tests need no event. */
export type CommandKeyEvent = ModifierState & { key: string; code: string; keyCode?: number };

/**
 * The ordinary key of a keydown, named by the CHARACTER on it where possible.
 *
 * A command shortcut is a character ("A"), not a position, and with Option held
 * `key` is the composed character ("å") — useless for finding the letter. The
 * legacy `keyCode` is the one field that is both layout-aware and unaffected by
 * Option: it stays 65 for the key that types "a", wherever the layout puts it.
 * `code` (position) is the fallback for everything else and for an IME-consumed
 * press (229); it is right on QWERTY and names the wrong letter on AZERTY.
 */
function characterKeyOf(e: CommandKeyEvent): string {
    const keyCode = e.keyCode ?? 0;
    if (keyCode >= 65 && keyCode <= 90) return `Key${String.fromCharCode(keyCode)}`;
    if (keyCode >= 48 && keyCode <= 57) return `Digit${String.fromCharCode(keyCode)}`;
    return gestureKeyOf(e);
}

/**
 * The command this keydown would have run had a text field not eaten it, or
 * null.
 *
 * Only chords whose modifiers are Option or Option+Shift: those are the ones
 * that type. With Control or Command held the key is not text input, the
 * browser does deliver the command, and answering here would run it twice.
 *
 * The caller still has to establish the other half — that this is macOS and an
 * editable element holds focus. Outside that, the browser runs the command
 * itself.
 */
export function commandSwallowedByTextInput(shortcuts: BrowserShortcut[], e: CommandKeyEvent): BrowserShortcut | null {
    if (shortcuts.length === 0) return null;
    if (!e.altKey || e.ctrlKey || e.metaKey) return null;
    const main = characterKeyOf(e);
    if (isModifierToken(main)) return null;
    const combo = buildCombo(e.shiftKey ? ['Alt', 'Shift'] : ['Alt'], main);
    return shortcuts.find((s) => s.name !== '' && s.combo === combo) ?? null;
}
