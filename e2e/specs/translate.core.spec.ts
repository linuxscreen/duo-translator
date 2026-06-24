import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';
import type { Worker } from '@playwright/test';

// Drive the content script the way the popup/shortcut does: a runtime message
// to the active fixture tab. Fire-and-forget — content's onMessage acts on it.
async function sendAction(sw: Worker, action: string): Promise<void> {
    await sw.evaluate(async (act) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url?.includes('localhost:5566'));
        if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { action: act });
    }, action);
}

test.describe('core page translation (mocked providers)', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        await mockTranslateProviders(context);
        await seedConfig();
    });

    test('auto-translates plain paragraphs on load and leaves excluded nodes alone', async ({ page }) => {
        await page.goto('/basic.html');

        // Each paragraph gets a sibling .duo-translation carrying the mock sentinel.
        await expect(page.locator('#p1 .duo-translation')).toContainText(ZH);
        await expect(page.locator('#p1 .duo-translation')).toContainText('quick brown fox');
        await expect(page.locator('#p2 .duo-translation')).toContainText(ZH);
        await expect(page.locator('#p3 .duo-translation')).toContainText(ZH);

        // At least the three <p> paragraphs were translated.
        expect(await page.locator('.duo-translation').count()).toBeGreaterThanOrEqual(3);

        // <pre><code> is an excluded node type — never translated.
        await expect(page.locator('#code .duo-translation')).toHaveCount(0);
    });

    test('restore removes translations and re-translate brings them back', async ({ page, serviceWorker }) => {
        await page.goto('/basic.html');
        await expect(page.locator('#p1 .duo-translation')).toBeVisible();

        await sendAction(serviceWorker, 'showOriginal');
        await expect(page.locator('.duo-translation')).toHaveCount(0);
        // Original text is intact after restore.
        await expect(page.locator('#p1')).toContainText('quick brown fox');

        await sendAction(serviceWorker, 'translate');
        await expect(page.locator('#p1 .duo-translation')).toContainText(ZH);
    });

    test('translates content inside sub-frames (all_frames)', async ({ page }) => {
        await page.goto('/iframe.html');

        await expect(page.locator('#top .duo-translation')).toContainText(ZH);

        const child = page.frameLocator('#child');
        await expect(child.locator('#inframe .duo-translation')).toContainText(ZH);
    });

    test('translates paragraphs injected after load (MutationObserver)', async ({ page }) => {
        await page.goto('/dynamic.html');

        await expect(page.locator('#static .duo-translation')).toContainText(ZH);
        // #injected is appended ~1s after load; the observer must pick it up.
        await expect(page.locator('#injected .duo-translation')).toContainText(ZH);
    });
});
