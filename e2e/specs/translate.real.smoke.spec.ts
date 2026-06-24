import { test, expect } from '../fixtures/extension';

// Real end-to-end smoke: no provider mocking, hits the live Microsoft edge
// translator (token fetched by background; no API key required). Tagged @real
// so the default `pnpm e2e` run skips it; run with `pnpm e2e:real`.
//
// Weak assertions only — the live service's exact wording changes, so we just
// confirm the pipeline produced non-empty bilingual output.
test.describe('@real live translation smoke', () => {
    test('translates a live English page', async ({ page, seedConfig }) => {
        // Microsoft path works offline-of-API-key (free edge token).
        await seedConfig({ config_translateService: 'microsoft' });

        await page.goto('https://en.wikipedia.org/wiki/Cat', { waitUntil: 'domcontentloaded' });

        const translations = page.locator('.duo-translation');
        await expect(translations.first()).toBeVisible({ timeout: 30_000 });
        expect(await translations.count()).toBeGreaterThan(0);
        await expect(translations.first()).not.toBeEmpty();
    });
});
