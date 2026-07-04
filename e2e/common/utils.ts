import type { Worker } from '@playwright/test';

// Drive the content script the way the popup/shortcut does: a runtime message
// to the active fixture tab. Fire-and-forget — content's onMessage acts on it.
export async function sendAction(sw: Worker, action: string): Promise<void> {
    await sw.evaluate(async (act) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url?.includes('localhost:5566'));
        if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { action: act });
    }, action);
}