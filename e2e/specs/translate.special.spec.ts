import { sendAction } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders } from '../mocks/translateRoutes';

test.describe('@special translation', () => {
    // Paragraph marks live in content-script memory (main/dom/paragraphMarks.ts),
    // not in classes on page elements — so a page rewriting className (React
    // re-render, SPA router) cannot wipe the marking state. Clobber the
    // paragraph's class list between two translate rounds and verify the
    // second round still translates it.
    test('translates elements whose classes are dynamically rewritten', async ({ context, page, seedConfig, serviceWorker }) => {
        await seedConfig({ config_defaultStrategy: 'never' });
        await mockTranslateProviders(context);

        await page.goto('/basic.html', { waitUntil: 'domcontentloaded' });

        // Round 1 — also synchronizes with marking: once the translation node
        // shows up, the initial marking pass has definitely completed.
        await expect(page.locator('#p1')).toBeVisible();
        await sendAction(serviceWorker, 'translate');
        await expect(page.locator('#p1 .duo-translation')).toBeVisible();

        await sendAction(serviceWorker, 'showOriginal');
        await expect(page.locator('#p1 .duo-translation')).toHaveCount(0);

        // Page-side class clobbering (the old class-based marking lost its
        // state here; the in-memory marks must survive it).
        await page.evaluate(() => {
            const p = document.querySelector('#p1');
            if (p) p.className = 'page-own-class';
        });

        // Round 2 — still translated.
        await sendAction(serviceWorker, 'translate');
        await expect(page.locator('#p1 .duo-translation')).toBeVisible();
    });
});
