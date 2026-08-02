// Language detection must weigh only text the reader can see
// (main/dom/visibility.ts). Detection scores samples by byte length, so a block
// of hidden text — an offscreen SEO copy, a screen-reader duplicate, a collapsed
// panel — used to be able to outvote the real article and flip the verdict.
//
// Real layout is the whole point here, which is why this lives in e2e: jsdom has
// no boxes, so the unit suite can only pin the rules (visibility.test.ts) and the
// sampling logic around them (lang.dom.test.ts).
//
// The fixture (hidden-text.html) always pairs a visible article with a hidden
// block ~3x its size in the *other* language, so an unfiltered sample lands on
// the wrong answer. Assertions read the content script's own detection log — the
// verdict itself — and then the observable consequence.
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders } from '../mocks/translateRoutes';
import { sendAction } from '../common/utils';

/**
 * Resolve with the content script's detection log line. Call BEFORE `goto` —
 * detection runs during the initial pass. This doubles as the sync point every
 * assertion below needs: it is the moment the verdict exists.
 */
function detectionLog(page: Page): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no language-detection log appeared')), 20_000);
        page.on('console', (msg) => {
            const text = msg.text();
            if (!text.includes('detect language by')) return;
            clearTimeout(timer);
            resolve(text);
        });
    });
}

// Every hiding recipe the fixture can apply. `collapsed` is the one that needs
// the clipping-ancestor walk when applied to a wrapper: the children keep their
// full natural height and only the clip makes them unreadable.
const HIDING_RECIPES = [
    'offscreen',
    'above',
    'sr-only',
    'fontsize0',
    'display-none',
    'visibility',
    'opacity',
    'collapsed',
];

test.describe('@hidden-text language detection', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        // 'auto' hands the translate/skip decision to detectLanguage; the seeded
        // target language is zh-CN.
        await seedConfig({ config_defaultStrategy: 'auto' });
        await mockTranslateProviders(context);
    });

    // Visible Chinese + a bigger hidden English block. Correct verdict is zh-CN,
    // which equals the target language, so the page must be left alone.
    for (const recipe of HIDING_RECIPES) {
        test(`hidden English (${recipe}) does not outvote the visible Chinese article`, async ({ page, serviceWorker }) => {
            const log = detectionLog(page);
            await page.goto(`/hidden-text.html?hide=${recipe}`, { waitUntil: 'domcontentloaded' });

            expect(await log).toContain('zh-CN');
            await expect(page.locator('#visible .duo-translation')).toHaveCount(0);

            // Proves the negative above is a decision, not a dead content
            // script: the same page translates on demand.
            await sendAction(serviceWorker, 'translate');
            await expect(page.locator('#visible .duo-translation').first()).toBeVisible();
        });
    }

    // Same, with the recipe on the wrapper instead of each paragraph — the
    // filter reads layout, so an offscreen ancestor must carry its descendants
    // offscreen with it.
    test('hidden English behind an offscreen ancestor does not vote', async ({ page }) => {
        const log = detectionLog(page);
        await page.goto('/hidden-text.html?hide=offscreen&on=ancestor', { waitUntil: 'domcontentloaded' });

        expect(await log).toContain('zh-CN');
        await expect(page.locator('#visible .duo-translation')).toHaveCount(0);
    });

    // The collapsed-panel wrapper is the case per-element geometry cannot see:
    // each child paragraph has a perfectly normal box, and only the ancestor's
    // `height:0;overflow:hidden` clips it away.
    test('hidden English inside a collapsed panel does not vote', async ({ page }) => {
        const log = detectionLog(page);
        await page.goto('/hidden-text.html?hide=collapsed&on=ancestor', { waitUntil: 'domcontentloaded' });

        expect(await log).toContain('zh-CN');
        await expect(page.locator('#visible .duo-translation')).toHaveCount(0);
    });

    // Mirror image, so the suite cannot pass by simply never translating:
    // visible English + a bigger hidden Chinese block must still translate.
    test('hidden Chinese does not suppress translation of a visible English article', async ({ page }) => {
        const log = detectionLog(page);
        await page.goto('/hidden-text.html?hide=offscreen&visible=en', { waitUntil: 'domcontentloaded' });

        expect(await log).toMatch(/\ben\b/);
        await expect(page.locator('#visible .duo-translation').first()).toBeVisible();
    });

    // A display:contents container generates no box of its own (0x0 rect) while
    // being a real unit container. Writing it off as invisible would leave the
    // sample empty and hand the verdict back to the hidden Chinese block — and
    // `checkVisibility()` answers false for ANY boxless element, so it must not
    // be the one deciding here either.
    //
    // Verdict only: such a container is never actually translated, because
    // IntersectionObserver reports a boxless target as permanently
    // non-intersecting. That is a separate, pre-existing pipeline gap.
    test('counts text in a display:contents container', async ({ page }) => {
        const log = detectionLog(page);
        await page.goto('/hidden-text.html?hide=offscreen&visible=en&shape=contents', { waitUntil: 'domcontentloaded' });

        expect(await log).toMatch(/\ben\b/);
    });

    // The filter is detection-only. Hidden paragraphs are still marked, and the
    // IntersectionObserver translates them the moment they are revealed — this
    // is what breaks if the visibility check ever leaks into marking.
    test('still translates hidden paragraphs once they are revealed', async ({ page, seedConfig }) => {
        await seedConfig({ config_defaultStrategy: 'always' });
        // `on=ancestor` keeps each hidden <p> a paragraph of its own: a
        // display:none child is classified inline, so per-paragraph hiding would
        // collapse the whole block into a single unit on the host.
        await page.goto('/hidden-text.html?hide=offscreen&on=ancestor&visible=en', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('#visible .duo-translation').first()).toBeVisible();
        // Parked offscreen, so the IntersectionObserver has not reached them.
        await expect(page.locator('#hidden-host .duo-translation')).toHaveCount(0);

        await page.evaluate(() => {
            document.getElementById('hidden-host')?.classList.remove('hide-offscreen');
        });

        await expect(page.locator('#hidden-host .duo-translation').first()).toBeVisible();
    });
});
