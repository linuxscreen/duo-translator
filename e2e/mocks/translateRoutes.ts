import type { BrowserContext } from '@playwright/test';

// Sentinel prefix injected into every mocked translation so specs can assert
// that a `.duo-translation` node was produced by the (mocked) provider rather
// than by anything else on the page.
export const ZH = '「译」';

/**
 * What the (mocked) providers were actually asked to translate.
 *
 * Counting `.duo-translation` nodes cannot tell "nothing was re-sent" from
 * "it was re-sent and the result happened to look the same" — the
 * same-language drop and the echo guard both hide a redundant request. So the
 * incremental specs assert on the request payloads instead.
 */
export interface TranslateRecorder {
    /** Every source string handed to a provider, in request order. */
    texts: string[];
    /** Translate requests only — the auth/token endpoint is not counted. */
    requests: number;
    /** Forget everything recorded so far (call right before the mutation). */
    reset(): void;
}

/**
 * Intercept every translation-provider request at the context level (catches
 * both content-script `fetch` — Google — and background service-worker requests
 * — Microsoft) and answer with a deterministic, offline translation:
 * `${ZH}<original text>`.
 *
 * Call once per context in `beforeEach`. The returned recorder is live.
 */
export async function mockTranslateProviders(context: BrowserContext): Promise<TranslateRecorder> {
    const recorder: TranslateRecorder = {
        texts: [],
        requests: 0,
        reset() {
            this.texts.length = 0;
            this.requests = 0;
        },
    };
    const record = (texts: string[]) => {
        recorder.requests++;
        recorder.texts.push(...texts);
    };

    // --- Google: POST translate-pa.googleapis.com/v1/translateHtml ---------
    // Request body: [[<texts[]>, "auto", <target>], "te_lib"]
    // Response shape consumed by GoogleTranslateService.translateText:
    //   data[0] = translated texts, data[1] = detected source langs
    await context.route('**/translate-pa.googleapis.com/**', async (route) => {
        const body = route.request().postDataJSON() as [[string[], string, string], string];
        const texts = body?.[0]?.[0] ?? [];
        record(texts);
        const translated = texts.map((t) => t.replace(/(<a i=\d+>)([^<>]+(<\/a>))/g, (_, sep, text) => `${sep}${ZH}${text}`));
        const langs = texts.map(() => 'en');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([translated, langs]),
        });
    });

    // --- Microsoft: POST edge.microsoft.com/translate/translatetext ---------
    // One handler covers BOTH translate and detect: detection now goes to the
    // same endpoint (pinned to `to=en`) and reads `detectedLanguage` off the
    // translation response, so the old separate api-edge detect host is gone.
    // Request body is a bare `string[]`; response shape consumed by
    // MicrosoftTranslateService: [{ translations: [{text}], detectedLanguage }]
    await context.route('**/edge.microsoft.com/translate/translatetext*', async (route) => {
        const texts = (route.request().postDataJSON() as string[]) ?? [];
        // The detect path posts to this same endpoint pinned to `to=en`; it is a
        // real provider request and is recorded like any other.
        record(texts);
        const body = texts.map((text) => ({
            translations: [{ text: text.replace(/(^|>)([^<>]+)/g, (_, sep, inner) => `${sep}${ZH}${inner}`) }],
            detectedLanguage: { language: 'en', score: 1 },
        }));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // --- Yandex: POST translate.yandex.net/api/v1/tr.json/translate --
    // Batch-native: the body repeats a `text` field per snippet and the reply
    // carries a `text` array in the same order. Detect is a separate GET on the
    // same host answering `{code, lang}` — matched by the same glob.
    await context.route('**/translate.yandex.net/api/v1/tr.json/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/detect')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ code: 200, lang: 'en' }),
            });
            return;
        }
        const texts = new URLSearchParams(route.request().postData() ?? '').getAll('text');
        record(texts);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                code: 200,
                lang: `en-${url.searchParams.get('lang') ?? 'zh'}`,
                text: texts.map((t) => t.replace(/(^|>)([^<>]+)/g, (_, sep, inner) => `${sep}${ZH}${inner}`)),
            }),
        });
    });

    // The auth endpoint returns a bare token string. `translatetext` no longer
    // sends the header, but getMicrosoftToken can still be reached — answering
    // it offline keeps the mocked run off the network entirely.
    await context.route('**/edge.microsoft.com/translate/auth', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'e2e-token' });
    });

    return recorder;
}
