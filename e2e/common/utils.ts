import { expect, type Worker } from '@playwright/test';

// Drive the content script the way the popup/shortcut does: a runtime message
// to the active fixture tab. Fire-and-forget — content's onMessage acts on it.
export async function sendAction(sw: Worker, action: string): Promise<void> {
    await sw.evaluate(async (act) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url?.includes('localhost:5566'));
        if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { action: act });
    }, action);
}

/**
 * Fire a manifest command (a browser-level keyboard shortcut) through the
 * background's real `commands.onCommand` listener.
 *
 * Playwright cannot press one: its key events are injected into the renderer,
 * below the browser accelerator layer where extension commands are matched.
 * Dispatching the event still runs everything we own — the global-switch gate,
 * the command → action mapping and the fan-out to the tab.
 */
export async function fireCommand(sw: Worker, command: string): Promise<void> {
    await sw.evaluate((cmd) => {
        (chrome.commands.onCommand as unknown as { dispatch(c: string): void }).dispatch(cmd);
    }, command);
}

/**
 * Resolve once the content script in at least `frames` frames of the fixture
 * tab has finished starting up.
 *
 * A message sent before the content script's listener exists is dropped with no
 * error on either side, so a test that messages the tab right after navigation
 * races the injection. The ping is an action nobody handles: content's listener
 * awaits `startupReady` before dispatching, so the reply arrives exactly when
 * that frame is able to act; a frame with no listener yet rejects instead.
 */
export async function waitForContentScripts(sw: Worker, frames = 1): Promise<void> {
    await expect(async () => {
        const ready = await sw.evaluate(async () => {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find((t) => t.url?.includes('localhost:5566'));
            if (tab?.id == null) return 0;
            const tabId = tab.id;
            const all = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
            const replies = await Promise.allSettled(
                all.map((f) => chrome.tabs.sendMessage(tabId, { action: 'e2e:ping' }, { frameId: f.frameId })),
            );
            return replies.filter((r) => r.status === 'fulfilled').length;
        });
        expect(ready).toBeGreaterThanOrEqual(frames);
    }).toPass({ timeout: 10_000 });
}
