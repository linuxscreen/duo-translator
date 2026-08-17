import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

// Pointer-driven paragraph translation (double-tap Ctrl) must act on the single
// logical-paragraph unit under the cursor, not on the whole container. The
// fixture's #brsplit div holds two units separated by <br><br>.
//
// The gesture is driven with real input: page.mouse.move updates the content
// script's lastX/lastY through a trusted mousemove, and two Control presses
// inside DOUBLE_TAP_INTERVAL_MS (400ms) trigger the handler.
test.describe('@paragraph-unit pointer-driven per-unit translation', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        await mockTranslateProviders(context);
        // 'never': nothing is auto-translated, so every translation on the page
        // is one this test asked for.
        await seedConfig({
            config_defaultStrategy: 'never',
            config_doubleTapModifier: 'ctrl',
            config_doubleTapToggleParagraph: true,
            config_doubleTapTranslateSelection: false,
            config_doubleTapTranslateInput: false,
        });
    });

    /** Point at the first line of `selector`'s text and double-tap Ctrl. */
    async function doubleTapOver(page: any, selector: string, which: 'first' | 'last' = 'first') {
        const point = await page.evaluate(([sel, w]: [string, string]) => {
            const el = document.querySelector(sel)!;
            const range = document.createRange();
            range.selectNodeContents(el);
            const rects = Array.from(range.getClientRects()).filter((r: any) => r.width > 4 && r.height > 4) as DOMRect[];
            const r = w === 'first' ? rects[0] : rects[rects.length - 1];
            return { x: r.left + 3, y: r.top + r.height / 2 };
        }, [selector, which]);
        await page.mouse.move(point.x, point.y);
        await page.keyboard.press('Control');
        await page.keyboard.press('Control');
    }

    test('translates only the hovered unit, and toggling off removes only that one', async ({ page }) => {
        await page.goto('/segments.html');
        // Nothing auto-translated with strategy "never".
        await expect(page.locator('.duo-translation')).toHaveCount(0);

        // Point at the FIRST unit of the two-unit container.
        await doubleTapOver(page, '#brsplit', 'first');
        await expect(page.locator('#brsplit > .duo-translation')).toHaveCount(1);
        const only = page.locator('#brsplit > .duo-translation');
        await expect(only).toContainText(ZH);
        await expect(only).toContainText('First visual');
        await expect(only).not.toContainText('Second visual');
        // Nothing else on the page was touched.
        await expect(page.locator('.duo-translation')).toHaveCount(1);

        // Now the SECOND unit: both are translated, each next to its own run.
        await doubleTapOver(page, '#brsplit', 'last');
        await expect(page.locator('#brsplit > .duo-translation')).toHaveCount(2);
        await expect(page.locator('#brsplit > .duo-translation').last()).toContainText('Second visual');

        // Toggle the FIRST unit back off — the second one survives.
        await doubleTapOver(page, '#brsplit', 'first');
        await expect(page.locator('#brsplit > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#brsplit > .duo-translation')).toContainText('Second visual');
        await expect(page.locator('#brsplit')).toContainText('First visual paragraph before the double break.');
    });

    test('double-tapping over the translation toggles the same unit off', async ({ page }) => {
        await page.goto('/segments.html');
        await doubleTapOver(page, '#brsplit', 'first');
        await expect(page.locator('#brsplit > .duo-translation')).toHaveCount(1);

        await doubleTapOver(page, '#brsplit > .duo-translation');
        await expect(page.locator('#brsplit > .duo-translation')).toHaveCount(0);
        await expect(page.locator('#brsplit')).toContainText('First visual paragraph before the double break.');
        await expect(page.locator('#brsplit')).toContainText('Second visual paragraph after the double break.');
    });

    test('a plain single-unit paragraph still toggles as a whole', async ({ page }) => {
        await page.goto('/segments.html');

        await doubleTapOver(page, '#softbr');
        await expect(page.locator('#softbr > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#softbr > .duo-translation')).toContainText('line one');
        await expect(page.locator('#softbr > .duo-translation')).toContainText('line two');

        await doubleTapOver(page, '#softbr');
        await expect(page.locator('#softbr > .duo-translation')).toHaveCount(0);
        await expect(page.locator('#softbr')).toContainText('Only line one here.');
    });

    test('translates the hovered run of a mixed container without touching the list', async ({ page }) => {
        await page.goto('/segments.html');

        // The leading run of #mixed (text, then a <ul>, then trailing text).
        await doubleTapOver(page, '#mixed', 'first');
        await expect(page.locator('#mixed > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#mixed > .duo-translation')).toContainText('Leading introduction');
        // Neither the list items nor the trailing run were translated.
        await expect(page.locator('#li1 .duo-translation')).toHaveCount(0);
        await expect(page.locator('#li2 .duo-translation')).toHaveCount(0);
        await expect(page.locator('.duo-translation')).toHaveCount(1);

        // A nested <li> is its own container: hovering it translates just it.
        await doubleTapOver(page, '#li1');
        await expect(page.locator('#li1 .duo-translation')).toHaveCount(1);
        await expect(page.locator('#li2 .duo-translation')).toHaveCount(0);
    });

    // A hand-translated paragraph has to stay in step with its source, the same
    // way page translation does. The page switch is OFF here, so these also pin
    // the boundary: repairing an existing translation is allowed, starting a new
    // one is not.
    test.describe('a hand-translated paragraph follows its source', () => {
        /** Translate #lonespan by hand and hand back its translation text. */
        async function translateLoneSpan(page: any) {
            await page.goto('/segments.html');
            await expect(page.locator('.duo-translation')).toHaveCount(0);
            await doubleTapOver(page, '#lonespan');
            await expect(page.locator('#lonespan > .duo-translation')).toContainText(ZH);
            await page.evaluate(() => {
                document.querySelector('#lonespan > .duo-translation')!.setAttribute('data-e2e-stamp', 'v1');
            });
        }

        test('its text changing re-translates it', async ({ page }) => {
            await translateLoneSpan(page);

            await page.evaluate(() => {
                const span = document.querySelector('#lonespan')!;
                (span.firstChild as Text).textContent = 'Completely different sentence now.';
            });

            await expect(page.locator('#lonespan > .duo-translation')).toContainText('Completely different');
            await expect(page.locator('#lonespan > .duo-translation')).toHaveCount(1);
        });

        test('the page growing it re-translates the whole run', async ({ page }) => {
            await translateLoneSpan(page);

            await page.evaluate(() => {
                const extra = document.createElement('span');
                extra.textContent = ' Plus an appended tail.';
                document.querySelector('#lonespan')!.appendChild(extra);
            });

            await expect(page.locator('#lonespan > .duo-translation')).toContainText('appended tail');
            await expect(page.locator('#lonespan > .duo-translation')).toContainText('Wrapped in exactly one');
            await expect(page.locator('#lonespan > .duo-translation')).toHaveCount(1);
            // Replaced, not appended to.
            await expect(page.locator('#lonespan > .duo-translation')).not.toHaveAttribute('data-e2e-stamp', 'v1');
        });

        // The permission is narrow: repair what is translated, never start
        // anything new. Nothing else on the page may pick up a translation just
        // because one paragraph was repaired.
        test('does not start translating anything else on the page', async ({ page }) => {
            await translateLoneSpan(page);

            await page.evaluate(() => {
                document.querySelector('#lonespan')!.appendChild(document.createElement('span')).textContent =
                    ' Plus an appended tail.';
                const fresh = document.createElement('p');
                fresh.id = 'fresh';
                fresh.textContent = 'A brand new paragraph that nobody asked to translate.';
                document.body.appendChild(fresh);
            });

            await expect(page.locator('#lonespan > .duo-translation')).toContainText('appended tail');
            await expect(page.locator('#fresh .duo-translation')).toHaveCount(0);
            await expect(page.locator('#softbr .duo-translation')).toHaveCount(0);
            await expect(page.locator('.duo-translation')).toHaveCount(1);
        });
    });
});
