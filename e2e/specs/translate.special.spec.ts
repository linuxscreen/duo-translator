import { sendAction } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders } from '../mocks/translateRoutes';

test.describe('@special translation', () => {
    test('translates dynamic class modify elements', async ({ context, page, seedConfig, serviceWorker }) => {
        await seedConfig({ config_defaultStrategy: 'never' });
        await mockTranslateProviders(context);

        await page.goto('/basic.html', { waitUntil: 'domcontentloaded' });

        await expect(page.locator("#p1")).toHaveClass(/duo-paragraph/)

        await page.evaluate(() => {
            let p = document.querySelector("#p1")
            p?.classList.remove("duo-paragraph")
            p?.classList.remove("duo-needs-translate")
        })
        await expect(page.locator("#p1")).toHaveClass(/duo-paragraph/)
        await sendAction(serviceWorker, 'translate')
        await expect(page.locator('#p1 .duo-translation')).toBeVisible()
        // await page.pause()
        // await new Promise(() => {})
    });
});
