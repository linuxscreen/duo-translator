import type { Page } from '@playwright/test';
import { waitForContentScripts } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

// A custom shortcut on a chord the browser also uses (Alt+F opens the browser
// menu on Windows) only works if the page cancels the key press: the browser
// runs a non-reserved accelerator only when the page left the event alone, and
// its action takes focus away, so the gesture never sees the release.
//
// What can be asserted here is OUR half — that the completing keydown is
// default-prevented, and only that one. Whether the browser then really keeps
// its menu closed cannot be: Playwright injects keys below the accelerator
// layer, so the menu would not open in a test either way.

const INPUT_TEXT = 'Hello input world';
// Alt+F as the gesture layer spells it; the timings are only read for the
// trigger that uses them.
const chord = (trigger: 'click' | 'hold') => ({
    id: 'e2e-chord',
    name: '',
    key: 'Alt+KeyF',
    trigger,
    count: 2,
    interval: 400,
    holdMs: 200,
});

type Keydown = { code: string; repeat: boolean; prevented: boolean };

test.describe('@custom-shortcut a chord shared with a browser accelerator', () => {
    test.beforeEach(async ({ context }) => {
        await mockTranslateProviders(context);
    });

    async function open(
        page: Page,
        serviceWorker: Parameters<typeof waitForContentScripts>[0],
        seedConfig: (cfg?: Record<string, unknown>) => Promise<void>,
        shortcuts: Record<string, unknown>,
    ) {
        await seedConfig({
            config_defaultStrategy: 'never',
            // Microsoft's mock prefixes plain text; Google's would echo it.
            config_aiTranslateService: 'microsoft',
            config_aiTargetLanguage: 'zh-CN',
            config_customShortcutSwitch: true,
            ...shortcuts,
        });
        await page.goto('/input-selection.html');
        await waitForContentScripts(serviceWorker, 2);
        // Bubble phase on window: runs after the content script's capture-phase
        // listener on document, so `defaultPrevented` is its verdict.
        await page.evaluate(() => {
            const w = window as unknown as { __keydowns: Keydown[] };
            w.__keydowns = [];
            window.addEventListener('keydown', (e) => {
                w.__keydowns.push({ code: e.code, repeat: e.repeat, prevented: e.defaultPrevented });
            });
        });
        // Caret at the end, so a character that does get typed lands where the
        // exact-value assertions expect it.
        await page.locator('#field').focus();
        await page.evaluate(() => {
            const field = document.querySelector<HTMLInputElement>('#field')!;
            field.setSelectionRange(field.value.length, field.value.length);
        });
    }

    const keydowns = (page: Page) =>
        page.evaluate(() => (window as unknown as { __keydowns: Keydown[] }).__keydowns);

    const BOUND_TO_INPUT = [{ id: 'e2e', action: 'translateInput', shortcutId: 'e2e-chord' }];

    test('the keydown that completes a configured chord is cancelled, and the gesture fires', async ({ page, serviceWorker, seedConfig }) => {
        await open(page, serviceWorker, seedConfig, {
            config_customShortcutList: [chord('click')],
            config_customShortcutBindings: BOUND_TO_INPUT,
        });

        await page.keyboard.down('Alt');
        await page.keyboard.down('KeyF');
        await page.keyboard.up('KeyF');
        await page.keyboard.up('Alt');

        expect(await keydowns(page)).toEqual([
            // Alt alone completes nothing here, so a bare Alt tap keeps its
            // browser meaning (focus the menu bar).
            { code: 'AltLeft', repeat: false, prevented: false },
            { code: 'KeyF', repeat: false, prevented: true },
        ]);
        await expect(page.locator('#field')).toHaveValue(`${ZH}${INPUT_TEXT}`);
    });

    test('every auto-repeat of a held chord is cancelled too', async ({ page, serviceWorker, seedConfig }) => {
        await open(page, serviceWorker, seedConfig, {
            config_customShortcutList: [chord('hold')],
            config_customShortcutBindings: BOUND_TO_INPUT,
        });

        await page.keyboard.down('Alt');
        await page.keyboard.down('KeyF');
        // A second down of a held key is what Playwright sends as auto-repeat.
        await page.keyboard.down('KeyF');
        await page.keyboard.down('KeyF');

        expect((await keydowns(page)).filter((k) => k.code === 'KeyF')).toEqual([
            { code: 'KeyF', repeat: false, prevented: true },
            { code: 'KeyF', repeat: true, prevented: true },
            { code: 'KeyF', repeat: true, prevented: true },
        ]);
        // Still held: the hold fires on its timer, not on the release.
        await expect(page.locator('#field')).toHaveValue(`${ZH}${INPUT_TEXT}`);

        await page.keyboard.up('KeyF');
        await page.keyboard.up('Alt');
    });

    test('keys that do not complete the chord are left to the browser and the page', async ({ page, serviceWorker, seedConfig }) => {
        await open(page, serviceWorker, seedConfig, {
            config_customShortcutList: [chord('click')],
            config_customShortcutBindings: BOUND_TO_INPUT,
        });

        // A neighbouring chord, a superset of ours, and the bare key.
        await page.keyboard.press('Alt+KeyG');
        await page.keyboard.press('Control+Alt+KeyF');
        await page.keyboard.press('KeyF');

        const pressed = (await keydowns(page)).filter((k) => k.code === 'KeyG' || k.code === 'KeyF');
        expect(pressed).toEqual([
            { code: 'KeyG', repeat: false, prevented: false },
            { code: 'KeyF', repeat: false, prevented: false },
            { code: 'KeyF', repeat: false, prevented: false },
        ]);
        // The bare key still types, and nothing was translated.
        await expect(page.locator('#field')).toHaveValue(`${INPUT_TEXT}f`);
    });

    test('a gesture on a bare key is never cancelled, so the key keeps typing', async ({ page, serviceWorker, seedConfig }) => {
        await open(page, serviceWorker, seedConfig, {
            // Built-in triple-Space: one press is the start of a sequence that
            // may never complete, and must not cost the user their space.
            config_customShortcutBindings: [{ id: 'e2e', action: 'translateInput', shortcutId: 'tripleSpace' }],
        });

        await page.keyboard.press('Space');

        expect(await keydowns(page)).toEqual([{ code: 'Space', repeat: false, prevented: false }]);
        await expect(page.locator('#field')).toHaveValue(`${INPUT_TEXT} `);
    });
});
