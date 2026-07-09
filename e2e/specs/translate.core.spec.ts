import { sendAction } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

test.describe('@core page translation (mocked providers)', () => {
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

    test('text node dynamically update in single view', async ({ page, seedConfig, serviceWorker }) => {
        await seedConfig({ config_viewStrategy: 'single', config_translateService: 'microsoft' });
        await page.goto('/basic.html');
        await expect(page.locator('#p1')).toContainText(ZH);
        await expect(page.locator('#p4')).toContainText(ZH);
        let newText = 'updated content';
        await page.evaluate((arg) => {
            const t1 = document.querySelector('#p1')?.firstChild as Text;
            if (t1) t1.textContent = arg;

            const t2 = document.querySelector('#p4')?.firstChild?.nextSibling as Text;
            if (t2) t2.textContent = arg;
        }, newText)
        await expect(page.locator('#p1')).toContainText(ZH + newText);
        await expect(page.locator('#p4')).toContainText(`${ZH}This is ${ZH}${newText}${ZH} English text.`);
    });

    test('text node dynamically update in double view', async ({ page, seedConfig, serviceWorker }) => {
        await seedConfig({ config_viewStrategy: 'double', config_translateService: 'microsoft' });
        await page.goto('/basic.html');
        await expect(page.locator('#p1')).toContainText(ZH);
        await expect(page.locator('#p4')).toContainText(ZH);
        let newText = 'updated content';
        await page.evaluate((arg) => {
            const t1 = document.querySelector('#p1')?.firstChild as Text;
            if (t1) t1.textContent = arg;

            const t2 = document.querySelector('#p4')?.firstChild?.nextSibling as Text;
            if (t2) t2.textContent = arg;
        }, newText)
        let text = await page.locator('#p1').evaluate(ele => ele.firstChild?.textContent)
        expect(text).toEqual(newText);
        await expect(page.locator('#p1 .duo-translation')).toContainText(ZH + newText);
        const text1 = await page.locator('#p4').evaluate(ele => {
            let text = ''
            Array.from(ele.childNodes).slice(0, 3).forEach(node => text += node.textContent)
            return text
        });
        expect(text1).toEqual('This is ' + newText + ' English text.');
        await expect(page.locator('#p4 .duo-translation')).toContainText(`${ZH}This is ${ZH}${newText}${ZH} English text.`);
    });
});
