import type { BrowserContext } from '@playwright/test';

// Sentinel prefix injected into every mocked translation so specs can assert
// that a `.duo-translation` node was produced by the (mocked) provider rather
// than by anything else on the page.
export const ZH = '「译」';

/**
 * Intercept every translation-provider request at the context level (catches
 * both content-script `fetch` — Google — and background service-worker requests
 * — Microsoft) and answer with a deterministic, offline translation:
 * `${ZH}<original text>`.
 *
 * Returns nothing; call once per context in `beforeEach`.
 */
export async function mockTranslateProviders(context: BrowserContext): Promise<void> {
    // --- Google: POST translate-pa.googleapis.com/v1/translateHtml ---------
    // Request body: [[<texts[]>, "auto", <target>], "te_lib"]
    // Response shape consumed by GoogleTranslateService.translateText:
    //   data[0] = translated texts, data[1] = detected source langs
    await context.route('**/translate-pa.googleapis.com/**', async (route) => {
        const body = route.request().postDataJSON() as [[string[], string, string], string];
        const texts = body?.[0]?.[0] ?? [];
        const translated = texts.map((t) => `${ZH}${t}`);
        const langs = texts.map(() => 'en');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([translated, langs]),
        });
    });

    // --- Microsoft: translate + detect (only hit when service=microsoft) ----
    await context.route('**/api.cognitive.microsofttranslator.com/**', async (route) => {
        const items = (route.request().postDataJSON() as { text: string }[]) ?? [];
        const body = items.map((it) => ({
            translations: [{ text: `${ZH}${it.text}` }],
            detectedLanguage: { language: 'en', score: 1 },
        }));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await context.route('**/api-edge.cognitive.microsofttranslator.com/**', async (route) => {
        const items = (route.request().postDataJSON() as { text: string }[]) ?? [];
        const body = items.map(() => ({ language: 'en', score: 1 }));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}
