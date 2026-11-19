// ---------------------------------------------------------------------------
// A copy of the extension's browser commands (`commands.getAll()`) in
// storage.local, for the content script.
//
// The content script needs the CURRENT shortcut of every command — to take over
// a chord that a focused text field would otherwise eat on macOS, see
// main/customShortcut/browserShortcuts.ts — and it needs the answer
// synchronously inside a keydown handler, where the decision to cancel the key
// has to be made. `browser.commands` does not exist in a content script, so the
// background publishes the list and content reads it.
//
// Storage rather than a message: the change event reaches every open page with
// no round trip, so a shortcut edited in Options (Firefox) or in Safari's
// settings is live everywhere at once, and a page never has to wake the
// background just to ask. A list fetched once per page would go stale the
// moment the user rebinds — and a stale chord here means running a command for
// a key that is no longer bound to it.
//
// The key carries no data prefix, so it is device-local and never synced:
// shortcuts are a property of this browser, not of the account.
// ---------------------------------------------------------------------------

import { browser } from 'wxt/browser';
import { storage, type StorageItemKey } from 'wxt/utils/storage';

export const BROWSER_COMMANDS_STORAGE_KEY = '__browser_commands';
const ITEM_KEY = `local:${BROWSER_COMMANDS_STORAGE_KEY}` as StorageItemKey;

export type MirroredCommand = { name: string; shortcut: string };

function normalize(raw: unknown): MirroredCommand[] {
    if (!Array.isArray(raw)) return [];
    const out: MirroredCommand[] = [];
    for (const entry of raw) {
        const name = typeof entry?.name === 'string' ? entry.name : '';
        const shortcut = typeof entry?.shortcut === 'string' ? entry.shortcut : '';
        // Unbound commands take no key, so there is nothing for a page to match.
        if (name && shortcut) out.push({ name, shortcut });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Background only: publish the current bindings. Cheap enough to call on every
 * start-up — it writes only when something changed, so a page is not handed a
 * change event for a list that is the same as before.
 */
export async function mirrorBrowserCommands(): Promise<void> {
    try {
        const current = normalize(await browser.commands.getAll());
        const stored = normalize(await storage.getItem(ITEM_KEY));
        if (JSON.stringify(current) === JSON.stringify(stored)) return;
        await storage.setItem(ITEM_KEY, current);
    } catch {
        // No commands API on this target, or storage refused: the page-side
        // takeover simply stays inert.
    }
}

/**
 * Content side: call `onChange` with the published bindings now and on every
 * later change. Safe in the first synchronous pass — nothing here awaits.
 */
export function watchBrowserCommands(onChange: (commands: MirroredCommand[]) => void): void {
    // A change that lands before the initial read resolves is newer than what
    // that read returns; it must not be overwritten by it.
    let changed = false;
    storage.watch<unknown>(ITEM_KEY, (value) => {
        changed = true;
        onChange(normalize(value));
    });
    storage.getItem(ITEM_KEY).then((value) => {
        if (!changed) onChange(normalize(value));
    }).catch(() => { /* extension context gone; nothing to match against */ });
}
