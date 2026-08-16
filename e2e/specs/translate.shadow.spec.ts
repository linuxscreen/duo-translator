import { sendAction } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

// Shadow DOM support: content inside open and nested shadow roots is translated
// and restored like light DOM. CLOSED roots are deliberately out of scope and
// there is a test pinning that.
//
// Every assertion counts translations PER TREE via an explicit
// `shadowRoot.querySelectorAll(...)`, never Playwright's implicit piercing —
// "did the translation land in the right tree?" is exactly the question here,
// and a piercing locator cannot tell a shadow hit from a light one.
test.describe('@shadow shadow DOM (mocked providers)', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        await mockTranslateProviders(context);
        await seedConfig();
    });

    /** Number of `sel` matches inside the shadow root of `hostSelector`. */
    async function countInRoot(page: any, hostSelector: string, sel: string): Promise<number> {
        return page.evaluate(
            ([host, inner]: [string, string]) => {
                const el = document.querySelector(host) as HTMLElement | null;
                return el?.shadowRoot ? el.shadowRoot.querySelectorAll(inner).length : -1;
            },
            [hostSelector, sel],
        );
    }

    /** Text of the first `sel` inside the shadow root of `hostSelector`. */
    async function textInRoot(page: any, hostSelector: string, sel: string): Promise<string> {
        return page.evaluate(
            ([host, inner]: [string, string]) => {
                const el = document.querySelector(host) as HTMLElement | null;
                return el?.shadowRoot?.querySelector(inner)?.textContent ?? '';
            },
            [hostSelector, sel],
        );
    }

    test('paragraphs inside an open root are translated in their own tree', async ({ page }) => {
        await page.goto('/shadow-dom.html');

        // Light DOM keeps working — the regression guard for the whole change.
        await expect(page.locator('#l1 .duo-translation')).toContainText(ZH);

        await expect
            .poll(() => countInRoot(page, '#open-host', '#s1 > .duo-divide + .duo-translation'))
            .toBe(1);
        expect(await textInRoot(page, '#open-host', '.duo-translation')).toContain(ZH);

        // The two inline spans are ONE unit, so exactly one translation for #s2.
        await expect.poll(() => countInRoot(page, '#open-host', '#s2 > .duo-translation')).toBe(1);
        const s2 = await page.evaluate(() => {
            const root = (document.querySelector('#open-host') as HTMLElement).shadowRoot!;
            return root.querySelector('#s2 > .duo-translation')?.textContent ?? '';
        });
        // One unit spanning both spans — the mock prefixes each inline segment,
        // so the single translation carries both halves.
        expect(s2).toContain('Shadow split ');
        expect(s2).toContain('sentence here.');
    });

    test('a nested shadow root is translated too', async ({ page }) => {
        await page.goto('/shadow-dom.html');

        await expect
            .poll(async () =>
                page.evaluate(() => {
                    const outer = (document.querySelector('#open-host') as HTMLElement).shadowRoot!;
                    const nested = (outer.getElementById('nest-host') as HTMLElement).shadowRoot;
                    return nested ? nested.querySelectorAll('.duo-translation').length : -1;
                }),
            )
            .toBe(1);
    });

    test('a block-level component gets its shadow body translated', async ({ page }) => {
        await page.goto('/shadow-dom.html');
        await expect.poll(() => countInRoot(page, '#card', '#c1 > .duo-divide + .duo-translation')).toBe(1);
    });

    test('slotted content is translated exactly once, in the light DOM', async ({ page }) => {
        await page.goto('/shadow-dom.html');

        // The <p> lives in the light DOM and renders through the slot.
        await expect(page.locator('#slotted .duo-translation')).toContainText(ZH);
        await expect(page.locator('#slotted > .duo-translation')).toHaveCount(1);
        // Nothing duplicated into the wrapper's own tree.
        expect(await countInRoot(page, '#wrap', '.duo-translation')).toBe(0);
    });

    test('an inline icon component does not split the sentence', async ({ page }) => {
        await page.goto('/shadow-dom.html');

        await expect(page.locator('#inline-ce > .duo-translation')).toHaveCount(1);
        const translated = await page.locator('#inline-ce > .duo-translation').textContent();
        // One request for the whole sentence — both halves in one translation.
        expect(translated).toContain('Click');
        expect(translated).toContain('to continue reading the guide.');
        // The icon's own tree is left alone.
        const iconTranslations = await page.evaluate(() => {
            const icon = document.querySelector('#inline-ce x-icon') as HTMLElement;
            return icon.shadowRoot!.querySelectorAll('.duo-translation').length;
        });
        expect(iconTranslations).toBe(0);
    });

    test('a root attached to an already-connected element is NOT picked up', async ({ page }) => {
        // Inverted on purpose, like the closed-root case below. Attaching a
        // shadow root emits NO mutation record, so the only way to see this one
        // was a MAIN-world script wrapping `Element.prototype.attachShadow` —
        // and that patch made Cloudflare answer 600010 ("Bot behavior
        // detected") on a real login page. It was removed; see the header of
        // main/dom/shadowRoots.ts for the bisect and for why no idle sweep
        // replaced it.
        //
        // The fixture's #late button is the pure form of the gap: its handler
        // ONLY attaches the root and fills it, touching nothing in the light
        // DOM, so nothing ever asks us to re-scan that host. Components that
        // attach in `connectedCallback` are unaffected — their host's insertion
        // is a mutation record, and our observer callback is a microtask that
        // runs after it, so the root is already there when we scan (covered by
        // the tests above).
        await page.goto('/shadow-dom.html');
        await expect(page.locator('#l1 .duo-translation')).toContainText(ZH);

        await page.click('#late');

        await page.waitForTimeout(1500);
        expect(await countInRoot(page, '#late-host', '.duo-translation')).toBe(0);
    });

    test('a CLOSED root stays closed and untranslated', async ({ page }) => {
        // Inverted on purpose. A MAIN-world script used to rewrite
        // `mode: "closed"` to "open" so we could translate inside; that made
        // Cloudflare's challenge fail (it builds its widget in a closed root in
        // the calling page), and a user who cannot pass a bot check has no way
        // to blame a translator. So `closed` is honored, and this test exists to
        // make reintroducing the rewrite a visible, deliberate act rather than a
        // silent regression. See the header of main/dom/shadowRoots.ts.
        await page.goto('/shadow-dom.html');

        // Sync point: the open-root work is done, so the scan has been past
        // #closed-host too and its absence below means "skipped", not "not yet".
        await expect.poll(() => countInRoot(page, '#open-host', '.duo-translation')).toBeGreaterThan(0);

        expect(
            await page.evaluate(
                () => (document.getElementById('closed-host') as HTMLElement).shadowRoot,
            ),
        ).toBeNull();

        // Reached through the page's own handle, which is the only way in now.
        expect(
            await page.evaluate(
                () => (window as any).__closedRoot.querySelectorAll('.duo-translation').length,
            ),
        ).toBe(0);
    });

    test('restore removes every shadow translation and leaves the text byte-identical', async ({ page, serviceWorker }) => {
        await page.goto('/shadow-dom.html');
        await expect.poll(() => countInRoot(page, '#open-host', '.duo-translation')).toBeGreaterThan(0);

        await sendAction(serviceWorker, 'showOriginal');

        await expect.poll(async () =>
            page.evaluate(() => {
                // #closed-host is absent: its root is unreachable from here now,
                // and nothing was ever written into it. See the CLOSED test.
                const hosts = ['#open-host', '#card', '#late-host'];
                let n = 0;
                for (const h of hosts) {
                    const root = (document.querySelector(h) as HTMLElement | null)?.shadowRoot;
                    if (root) n += root.querySelectorAll('.duo-translation, .duo-divide').length;
                }
                return n;
            }),
        ).toBe(0);
        await expect(page.locator('.duo-translation')).toHaveCount(0);

        // Original text survived the round trip untouched.
        expect(await textInRoot(page, '#open-host', '#s1')).toBe('Shadow paragraph one.');
        expect(await page.locator('#inline-ce').innerText()).toContain('Click');

        // …and re-translating works from that clean state.
        await sendAction(serviceWorker, 'translate');
        await expect.poll(() => countInRoot(page, '#open-host', '.duo-translation')).toBeGreaterThan(0);
    });
});
