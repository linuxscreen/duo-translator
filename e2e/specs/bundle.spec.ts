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
    test('content script contains no background-only provider clients', () => {
        const content = readFileSync(`${OUT}/content-scripts/content.js`, 'utf8');

        // Provider SSE/completion clients and their auth headers. If any of
        // these appear, a content module imported main/aiService.ts.
        for (const marker of ['anthropic-version', 'x-api-key', 'chatCompleteNonStream', 'acquireNonStreamSlot']) {
            expect(content, `content.js must not contain "${marker}"`).not.toContain(marker);
        }

        // The Microsoft token endpoint is minted in background only.
        expect(content).not.toContain('edge.microsoft.com/translate/auth');

        // NOTE: DeepL's endpoints and the DeepL-Auth-Key header ARE expected in
        // content.js — DeepL builds its full request on the content side and
        // sends it through the background proxy, whose allow-list is what
        // constrains where the key can go. Do not add them here.
    });

    test('background bundle does contain the provider clients', () => {
        const background = readFileSync(`${OUT}/background.js`, 'utf8');
        // Guards against the inverse mistake: the split silently moving the
        // clients out of background would break every AI feature at runtime.
        expect(background).toContain('anthropic-version');
        expect(background).toContain('edge.microsoft.com/translate/auth');
    });
});
