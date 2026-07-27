import { sendAction } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

// Logical-paragraph segmentation: a container with direct text AND block
// children (or <br><br> separators) is split into per-run translation units,
// each with its translation inserted right after the run — not one blob at
// the container bottom.
test.describe('@segments logical paragraphs (mocked providers)', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        await mockTranslateProviders(context);
        await seedConfig();
    });

    test('text + list + text: each run and each <li> gets its own adjacent translation', async ({ page }) => {
        await page.goto('/segments.html');

        // The leading run's translation sits between the leading text and the <ul>.
        await expect(page.locator('#mixed > .duo-translation').first()).toContainText(ZH);
        const firstIsBeforeList = await page.evaluate(() => {
            const div = document.querySelector('#mixed')!;
            const first = div.querySelector(':scope > .duo-translation');
            return first?.nextElementSibling?.tagName === 'UL';
        });
        expect(firstIsBeforeList).toBe(true);

        // Each list item is its own unit.
        await expect(page.locator('#li1 .duo-translation')).toContainText(ZH);
        await expect(page.locator('#li1 .duo-translation')).toContainText('First list item');
        await expect(page.locator('#li2 .duo-translation')).toContainText(ZH);

        // The trailing run's translation is the container's last element.
        await expect(page.locator('#mixed > .duo-translation')).toHaveCount(2);
        const trailingIsLast = await page.evaluate(() => {
            const div = document.querySelector('#mixed')!;
            const last = div.lastElementChild;
            return last?.classList.contains('duo-translation') === true;
        });
        expect(trailingIsLast).toBe(true);

        // Run translations never contain list text (units don't overlap).
        await expect(page.locator('#mixed > .duo-translation').first()).toContainText('Leading introduction');
        await expect(page.locator('#mixed > .duo-translation').first()).not.toContainText('First list item');
        await expect(page.locator('#mixed > .duo-translation').last()).toContainText('Trailing conclusion');
        await expect(page.locator('#mixed > .duo-translation').last()).not.toContainText('list item');
    });

    test('<br><br> splits into two units; a single <br> does not', async ({ page }) => {
        await page.goto('/segments.html');

        // Double break: two translations, each adjacent to its own run.
        await expect(page.locator('#brsplit > .duo-translation')).toHaveCount(2);
        await expect(page.locator('#brsplit > .duo-translation').first()).toContainText('First visual');
        await expect(page.locator('#brsplit > .duo-translation').first()).not.toContainText('Second visual');
        await expect(page.locator('#brsplit > .duo-translation').last()).toContainText('Second visual');
        const firstBeforeBreak = await page.evaluate(() => {
            const div = document.querySelector('#brsplit')!;
            const first = div.querySelector(':scope > .duo-translation');
            // The next element after the first translation is the splitting <br>
            // (a bare br, not our .duo-divide).
            const next = first?.nextElementSibling;
            return next?.tagName === 'BR' && !next.classList.contains('duo-divide');
        });
        expect(firstBeforeBreak).toBe(true);

        // Soft line break: still one unit containing both lines.
        await expect(page.locator('#softbr > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#softbr > .duo-translation')).toContainText('line one');
        await expect(page.locator('#softbr > .duo-translation')).toContainText('line two');
    });

    test('restore removes all unit translations and keeps the original intact; re-translate restores them', async ({ page, serviceWorker }) => {
        await page.goto('/segments.html');
        await expect(page.locator('#mixed > .duo-translation')).toHaveCount(2);

        await sendAction(serviceWorker, 'showOriginal');
        await expect(page.locator('.duo-translation')).toHaveCount(0);
        await expect(page.locator('#mixed')).toContainText('Leading introduction text');
        await expect(page.locator('#li1')).toContainText('First list item with some words.');
        await expect(page.locator('#mixed')).toContainText('Trailing conclusion text');

        await sendAction(serviceWorker, 'translate');
        await expect(page.locator('#mixed > .duo-translation')).toHaveCount(2);
        await expect(page.locator('#li1 .duo-translation')).toContainText(ZH);
    });
});
