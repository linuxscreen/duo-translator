import type { Page } from '@playwright/test';
import { fireCommand, waitForContentScripts } from '../common/utils';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH, type TranslateRecorder } from '../mocks/translateRoutes';

// "Translate the input box" and "translate the selection" each have three
// entries — the browser command (Alt+A), the double-tap modifier and a custom
// shortcut — that all end in the same two actions but reach them through their
// own code. One entry being broken therefore says nothing about the others:
// the command's "is an input focused?" check sat inverted for a long time while
// the double-tap one worked, so every entry is driven here on its own.
const COMMAND = 'shortcut-translate-selection-input';
// The selection card lives in our own (open) shadow root; the CSS engine
// pierces it, and `.duo-ai-root` is the React mount whose text is the card's.
const POPUP = '#duo-selection-translate-host .duo-ai-root';

const INPUT_TEXT = 'Hello input world';
const PARA_TEXT = 'Selected sentence for the selection translation test.';

test.describe('@input-selection input box and selection translation', () => {
    let recorder: TranslateRecorder;

    test.beforeEach(async ({ context, seedConfig }) => {
        recorder = await mockTranslateProviders(context);
        await seedConfig({
            // Nothing is auto-translated, so every provider request below is
            // one a gesture in the test asked for.
            config_defaultStrategy: 'never',
            // Microsoft's mock prefixes plain text; Google's only rewrites the
            // `<a i=N>` slots of page translation and would echo these.
            config_aiTranslateService: 'microsoft',
            config_aiTargetLanguage: 'zh-CN',
            config_selectionTranslateService: 'microsoft',
            config_doubleTapModifier: 'ctrl',
            config_doubleTapTranslateSelection: true,
            config_doubleTapTranslateInput: true,
            config_doubleTapToggleParagraph: false,
        });
    });

    /** Open the fixture and wait until both frames can act on a gesture. */
    async function open(page: Page, serviceWorker: Parameters<typeof waitForContentScripts>[0]) {
        await page.goto('/input-selection.html');
        await waitForContentScripts(serviceWorker, 2);
    }

    /**
     * Select the paragraph without moving focus, the way a selection made
     * while an input still holds focus looks to the content script.
     */
    async function selectParagraph(page: Page) {
        await page.evaluate(() => {
            window.getSelection()!.selectAllChildren(document.querySelector('#para')!);
        });
    }

    const FIELDS = [
        { name: '<input>', selector: '#field', text: INPUT_TEXT, value: true },
        { name: '<textarea>', selector: '#area', text: 'Hello textarea world', value: true },
        { name: 'contenteditable element', selector: '#rich', text: 'Hello editable world', value: false },
    ];

    for (const field of FIELDS) {
        test(`the browser command translates the focused ${field.name}`, async ({ page, serviceWorker }) => {
            await open(page, serviceWorker);
            await page.locator(field.selector).click();

            await fireCommand(serviceWorker, COMMAND);

            const target = page.locator(field.selector);
            if (field.value) await expect(target).toHaveValue(`${ZH}${field.text}`);
            else await expect(target).toHaveText(`${ZH}${field.text}`);
        });
    }

    test('the browser command translates the selection, and a selection wins over a focused input', async ({ page, serviceWorker }) => {
        await open(page, serviceWorker);
        // Both preconditions hold at once: an input has focus AND text is
        // selected. Only the selection may be acted on.
        await page.locator('#field').click();
        await selectParagraph(page);

        await fireCommand(serviceWorker, COMMAND);

        await expect(page.locator(POPUP)).toContainText(`${ZH}${PARA_TEXT}`);
        // The card showing its translation is the sync point: an input
        // translation would have been requested in the same turn as it.
        await expect(page.locator('#field')).toHaveValue(INPUT_TEXT);
        expect(recorder.texts).not.toContain(INPUT_TEXT);
    });

    test('double-tap Ctrl translates the focused input', async ({ page, serviceWorker }) => {
        await open(page, serviceWorker);
        await page.locator('#field').click();

        await page.keyboard.press('Control');
        await page.keyboard.press('Control');

        await expect(page.locator('#field')).toHaveValue(`${ZH}${INPUT_TEXT}`);
    });

    test('double-tap Ctrl translates the selection', async ({ page, serviceWorker }) => {
        await open(page, serviceWorker);
        await page.locator('#field').click();
        await selectParagraph(page);

        await page.keyboard.press('Control');
        await page.keyboard.press('Control');

        await expect(page.locator(POPUP)).toContainText(`${ZH}${PARA_TEXT}`);
        await expect(page.locator('#field')).toHaveValue(INPUT_TEXT);
        expect(recorder.texts).not.toContain(INPUT_TEXT);
    });

    test('a custom shortcut on a printable key translates the input without its own characters', async ({ page, serviceWorker, seedConfig }) => {
        await seedConfig({
            config_aiTranslateService: 'microsoft',
            config_aiTargetLanguage: 'zh-CN',
            config_defaultStrategy: 'never',
            config_customShortcutSwitch: true,
            // Built-in triple-Space, bound to "translate input box".
            config_customShortcutBindings: [{ id: 'e2e', action: 'translateInput', shortcutId: 'tripleSpace' }],
        });
        await open(page, serviceWorker);
        await page.locator('#field').click();

        await page.keyboard.press('Space');
        await page.keyboard.press('Space');
        await page.keyboard.press('Space');

        // Exact value: the three spaces the gesture typed are neither sent to
        // the provider nor left behind in the field.
        await expect(page.locator('#field')).toHaveValue(`${ZH}${INPUT_TEXT}`);
        expect(recorder.texts).toContain(INPUT_TEXT);
    });

    // The command is broadcast to every frame of the tab, so each frame decides
    // for itself. Exactly one may act: the one holding the focused input.
    test('the browser command translates an input inside an iframe, and only the focused one', async ({ page, serviceWorker }) => {
        await open(page, serviceWorker);
        const inner = page.frameLocator('#child').locator('#inner');
        const INNER_TEXT = 'Hello inner frame';

        // Focus in the sub-frame: its input is translated, the top frame's is
        // left alone.
        await inner.click();
        await fireCommand(serviceWorker, COMMAND);
        await expect(inner).toHaveValue(`${ZH}${INNER_TEXT}`);
        await expect(page.locator('#field')).toHaveValue(INPUT_TEXT);
        expect(recorder.texts).not.toContain(INPUT_TEXT);

        // Focus back in the top frame: now it is the other way round. The
        // sub-frame's input must not be sent again — a second pass would show
        // up both as a doubled marker and as a second request.
        await page.locator('#field').click();
        await fireCommand(serviceWorker, COMMAND);
        await expect(page.locator('#field')).toHaveValue(`${ZH}${INPUT_TEXT}`);
        await expect(inner).toHaveValue(`${ZH}${INNER_TEXT}`);
        expect(recorder.texts.filter((t) => t.includes(INNER_TEXT))).toHaveLength(1);
    });
});
