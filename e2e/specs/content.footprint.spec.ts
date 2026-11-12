import type { Frame } from '@playwright/test';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

// The content script must not post anything to the page's window.
//
// It used to, without a line of our own code doing so: WXT's
// ContentScriptContext announces startup with a CustomEvent AND, for backwards
// compatibility, a `window.postMessage({type: 'wxt:content-script-started'})`.
// That message reaches every page `message` listener, in every frame, on every
// http(s) page — before any of our settings are read, so not even the global
// switch can stop it. On a page that answers every message (see the fixture),
// it started an endless self-ping-pong that pinned a CPU core for as long as
// the tab stayed open. `noScriptStartedPostMessage: true` in the entrypoint
// turns the legacy message off.
const SENTINEL = '__duo_e2e_sentinel__';

async function messagesReceivedBy(frame: Frame) {
    // Positive sync point first: messages posted to one window are delivered
    // in order, so once the page has seen a sentinel posted NOW, anything the
    // content script posted at startup has already been delivered too.
    await frame.evaluate((s) => window.postMessage(s, '*'), SENTINEL);
    await expect.poll(() => frame.evaluate(() => (window as any).__sentinelSeen)).toBe(true);
    return frame.evaluate(() => (window as any).__received as { fromSelf: boolean; type: string }[]);
}

test.describe('@footprint content script footprint on the page', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        await mockTranslateProviders(context);
        await seedConfig();
    });

    test('posts no window message in any frame', async ({ page }) => {
        await page.goto('/message-echo.html');

        // Translations prove the content script is running in both frames.
        await expect(page.locator('#p1 .duo-translation')).toContainText(ZH);
        await expect(page.frameLocator('#child').locator('#inframe .duo-translation')).toContainText(ZH);

        const child = page.frames().find((f) => f.url().endsWith('/message-echo-child.html'));
        expect(child, 'child frame').toBeTruthy();

        expect(await messagesReceivedBy(page.mainFrame()), 'top frame').toEqual([]);
        expect(await messagesReceivedBy(child!), 'child frame').toEqual([]);
    });
});
