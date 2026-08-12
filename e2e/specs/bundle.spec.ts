import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../.output/e2e-build/chrome-mv3-dev');

/**
 * The background/content split is enforced by module boundaries
 * (main/aiService.ts and main/translateService.ts are background-only;
 * content goes through aiClient/translateClient), but nothing at build time
 * fails if someone imports across that line — the code would just silently
 * ship into every page's content script, provider API clients and all.
 *
 * These assertions turn that implicit assumption into a failing test.
 */
test.describe('@bundle background/content separation', () => {
    test('content script contains no provider endpoints or credentials', () => {
        const content = readFileSync(`${OUT}/content-scripts/content.js`, 'utf8');

        // Content asks for a translation by meaning (ACTION.TRANSLATE_TEXTS) and
        // never builds a provider request, so NO provider host, auth header or
        // client symbol may appear here.
        const forbidden = [
            // AI provider clients
            'anthropic-version', 'x-api-key', 'chatCompleteNonStream', 'acquireNonStreamSlot',
            // Translate provider endpoints
            'translate-pa.googleapis.com', 'cognitive.microsofttranslator.com',
            'edge.microsoft.com/translate/auth',
            'api.deepl.com', 'api-free.deepl.com',
            'browser.translate.yandex.net',
            // Dictionary providers — Bing's page is scraped and Google's
            // dictionary mode is parsed entirely in background.
            'www.bing.com', 'translate.google.com', 'translate_a/single',
            // Credentials
            'DeepL-Auth-Key', 'x-goog-api-key',
            // Built-in AI has no endpoint and no credential, so nothing else
            // here would catch it leaking. Both the translation AND the model
            // download run in background, so the page never touches the model.
            'Translator.create', 'LanguageDetector.create',
        ];
        for (const marker of forbidden) {
            expect(content, `content.js must not contain "${marker}"`).not.toContain(marker);
        }
    });

    test('the shadow bridge stays dependency-free and page-safe', () => {
        // It patches Element.prototype.attachShadow on EVERY page in EVERY
        // frame, in the page's own world. Anything it drags in runs there too,
        // so it must import nothing but the protocol constants — same discipline
        // as the YouTube bridge.
        const bridge = readFileSync(`${OUT}/content-scripts/shadow-bridge.js`, 'utf8');

        for (const marker of [
            'translate-pa.googleapis.com', 'cognitive.microsofttranslator.com',
            'api.deepl.com', 'browser.translate.yandex.net',
            'DeepL-Auth-Key', 'x-api-key', 'x-goog-api-key',
        ]) {
            expect(bridge, `shadow-bridge.js must not contain "${marker}"`).not.toContain(marker);
        }
        // It cannot use extension APIs from the MAIN world anyway; the one
        // permitted `chrome.runtime.id` read is its world self-check.
        expect(bridge).not.toContain('browser.runtime');
        expect(bridge).toContain('chrome?.runtime?.id');
        // The whole point: closed roots are forced open.
        expect(bridge).toContain('attachShadow');
    });

    test('background bundle does contain the provider clients', () => {
        const background = readFileSync(`${OUT}/background.js`, 'utf8');
        // Guards against the inverse mistake: the split silently moving the
        // clients out of background would break translation at runtime.
        for (const marker of [
            'anthropic-version',
            'edge.microsoft.com/translate/auth',
            'translate-pa.googleapis.com',
            'translate.yandex.net',
            'DeepL-Auth-Key',
            'translate_a/single',
        ]) {
            expect(background, `background.js must contain "${marker}"`).toContain(marker);
        }
    });

    test('built-in AI runs in background, model download included', () => {
        // Counter-intuitive but measured: the `Translator` / `LanguageDetector`
        // globals ARE exposed in an MV3 extension service worker (the docs'
        // "not available in Web Workers" is about `new Worker()`), and
        // `Translator.create()` there downloads a model with NO user gesture —
        // which a web page cannot do. That combination is the whole reason the
        // download is silent and automatic, so pin it: if this ever moves back
        // into a page or an offscreen document, the download stops being
        // gesture-free and the feature quietly regresses.
        const background = readFileSync(`${OUT}/background.js`, 'utf8');
        expect(background, 'background must own the on-device model').toContain('Translator.create');
    });
});
