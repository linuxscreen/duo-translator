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

import { buildCombo } from './types';

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
 * `"Alt+W"` / `"Ctrl+Shift+Y"` → `"Alt+KeyW"` / `"Control+Shift+KeyY"`.
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

    for (const part of parts) {
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
        out.push({ combo, label: command.description || command.name || command.shortcut });
    }
    return out;
}
