import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH, type TranslateRecorder } from '../mocks/translateRoutes';

/**
 * Acceptance specs for incremental re-translation.
 *
 * These assert on the PROVIDER REQUEST PAYLOADS, not on the rendered result.
 * Counting `.duo-translation` nodes cannot distinguish "we never re-sent this
 * paragraph" from "we re-sent it and the answer happened to look the same" —
 * the same-language drop (content.ts) and the echo guard (translateClient.ts)
 * both swallow a redundant round trip silently. The payload is the only place
 * the waste is visible.
 *
 * Every negative assertion is preceded by a POSITIVE sync point. `expect.poll`
 * is deliberately not used to prove absence: it succeeds on its first sample,
 * which lands long before the re-send it is supposed to catch.
 */
test.describe('@incremental incremental re-translation (mocked providers)', () => {
    let provider: TranslateRecorder;

    test.beforeEach(async ({ context, seedConfig }) => {
        provider = await mockTranslateProviders(context);
        await seedConfig();
    });

    /**
     * The sync point. Appending a fresh paragraph is both the mutation under
     * test (it forces a re-scan rooted at <body>, which is what re-visits every
     * already-translated paragraph) and the proof that a full pipeline cycle
     * finished: once its translation is on the page, every decision about the
     * pre-existing paragraphs has already been made.
     */
    async function appendParagraphAndWait(page: Page) {
        await page.evaluate(() => {
            const p = document.createElement('p');
            p.id = 'appended';
            p.textContent = 'A brand new paragraph appended after load.';
            document.body.appendChild(p);
        });
        await expect(page.locator('#appended')).toContainText(ZH);
    }

    // ---- Requirement 1: an unchanged unit is never sent again ---------------

    test('double: an unrelated mutation does not re-send already-translated paragraphs', async ({ page }) => {
        await page.goto('/incremental.html');
        await expect(page.locator('#plain .duo-translation')).toContainText(ZH);
        await expect(page.locator('#plain2 .duo-translation')).toContainText(ZH);

        provider.reset();
        await appendParagraphAndWait(page);

        const sent = provider.texts.join('\n');
        expect(sent).toContain('A brand new paragraph');
        expect(sent).not.toContain('quick brown fox');
        expect(sent).not.toContain('bilingual rendering');
        // Nothing we produced may ever be handed back to a provider.
        expect(provider.texts.filter((t) => t.includes(ZH))).toEqual([]);
    });

    test('single: an unrelated mutation does not re-send already-translated paragraphs', async ({ page, seedConfig }) => {
        await seedConfig({ config_viewStrategy: 'single', config_translateService: 'microsoft' });
        await page.goto('/incremental.html');
        await expect(page.locator('#plain')).toContainText(ZH);
        await expect(page.locator('#plain2')).toContainText(ZH);

        provider.reset();
        await appendParagraphAndWait(page);

        const sent = provider.texts.join('\n');
        expect(sent).toContain('A brand new paragraph');
        expect(sent).not.toContain('quick brown fox');
        expect(sent).not.toContain('bilingual rendering');
        // SINGLE writes the translation into the page's own text nodes, so a
        // redundant re-scan sends our own output back as if it were source.
        expect(provider.texts.filter((t) => t.includes(ZH))).toEqual([]);

        // Each paragraph still carries exactly one translation, not a stack.
        const zhCount = await page.evaluate(
            ({ zh }) => (document.querySelector('#plain')!.textContent ?? '').split(zh).length - 1,
            { zh: ZH },
        );
        expect(zhCount).toBe(1);
    });

    // ---- Requirement 3: an atomic inline element is its own unit ------------

    test('a button appended to a translated paragraph is translated on its own, leaving the paragraph untouched', async ({ page }) => {
        await page.goto('/incremental.html');
        await expect(page.locator('#plain > .duo-translation')).toContainText(ZH);

        // Stamp the existing translation node so we can prove it is the SAME
        // node afterwards — a whole-paragraph re-translation would replace it.
        await page.evaluate(() => {
            document.querySelector('#plain > .duo-translation')!.setAttribute('data-e2e-stamp', 'v1');
        });
        const before = await page.locator('#plain > .duo-translation').textContent();

        await page.evaluate(() => {
            const b = document.createElement('button');
            b.id = 'late-btn';
            b.textContent = 'Share';
            document.querySelector('#plain')!.appendChild(b);
        });

        // The button carries its own label and must get its own translation.
        await expect(page.locator('#late-btn .duo-translation')).toContainText(ZH);

        // The sentence's translation is untouched: same node, same text, one of it.
        await expect(page.locator('#plain > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#plain > .duo-translation')).toHaveAttribute('data-e2e-stamp', 'v1');
        expect(await page.locator('#plain > .duo-translation').textContent()).toBe(before);
    });

    test('a button present at load time is its own unit and is never cloned into the sentence translation', async ({ page }) => {
        await page.goto('/incremental.html');
        await expect(page.locator('#with-button > .duo-translation')).toContainText(ZH);
        await expect(page.locator('#act .duo-translation')).toContainText(ZH);

        // The sentence translation must not carry a copy of the button. A clone
        // duplicates its id and is inert — clicking it does nothing.
        await expect(page.locator('#with-button > .duo-translation button')).toHaveCount(0);
        await expect(page.locator('#act')).toHaveCount(1);
    });

    // ---- Requirement 2: a unit that grew is re-translated as a whole --------

    /** Grow the two-span run by a third mergeable span — same unit, new sentence. */
    async function growSpanRun(page: Page) {
        await page.evaluate(() => {
            const span = document.createElement('span');
            span.id = 'late-span';
            span.textContent = ' And more text.';
            document.querySelector('#spans')!.appendChild(span);
        });
    }

    test('double: growing a unit re-translates the whole sentence, replacing the old translation', async ({ page }) => {
        await page.goto('/incremental.html');
        await expect(page.locator('#spans > .duo-translation')).toContainText('brave world');

        // Stamp it: a *replacement* must not leave the superseded node behind.
        await page.evaluate(() => {
            document.querySelector('#spans > .duo-translation')!.setAttribute('data-e2e-stamp', 'v1');
        });
        provider.reset();
        await growSpanRun(page);

        await expect(page.locator('#spans > .duo-translation')).toContainText('And more text');
        // Exactly one translation for the unit — not the old one plus a new one.
        await expect(page.locator('#spans > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#spans > .duo-translation')).not.toHaveAttribute('data-e2e-stamp', 'v1');
        await expect(page.locator('#spans > .duo-translation')).toContainText('brave world');

        // The whole run went out in one request: a translation cannot be
        // composed from an old half plus a newly translated tail.
        expect(provider.texts.some((t) => t.includes('brave world') && t.includes('And more text'))).toBe(true);
        expect(provider.texts.filter((t) => t.includes(ZH))).toEqual([]);
    });

    test('single: growing a unit re-sends the SOURCE, not the translation already in the page', async ({ page, seedConfig }) => {
        await seedConfig({ config_viewStrategy: 'single', config_translateService: 'microsoft' });
        await page.goto('/incremental.html');
        await expect(page.locator('#spans')).toContainText(ZH);

        provider.reset();
        await growSpanRun(page);

        // The sync point has to be the marker count, not the English text:
        // SINGLE translates in place, so `'And more text'` matches the raw span
        // the instant it is appended and would race the re-translation.
        // One marker per span, and no stacking.
        const markers = () => page.evaluate(
            ({ zh }) => (document.querySelector('#spans')!.textContent ?? '').split(zh).length - 1,
            { zh: ZH },
        );
        await expect.poll(markers).toBe(3);

        // The point of the whole exercise. SINGLE replaced the page's own text
        // nodes with the translation, so the source no longer exists in the DOM
        // — sending what is there now would hand our output back to the
        // provider and stack `「译」` prefixes on every re-scan.
        expect(provider.texts.some((t) => t.includes('brave world') && t.includes('And more text'))).toBe(true);
        expect(provider.texts.filter((t) => t.includes(ZH))).toEqual([]);
    });

    // ---- The counter-case that keeps requirement 3 from cutting sentences ---

    test('a text-free inline-block icon stays inside the sentence', async ({ page }) => {
        await page.goto('/incremental.html');

        // One unit, one translation — the icon must not split the sentence.
        await expect(page.locator('#with-icon > .duo-translation')).toHaveCount(1);
        await expect(page.locator('#with-icon > .duo-translation')).toContainText('Press the');
        await expect(page.locator('#with-icon > .duo-translation')).toContainText('to continue reading');
    });
});
