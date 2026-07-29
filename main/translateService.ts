// ---------------------------------------------------------------------------
// Translate provider services — BACKGROUND ONLY.
//
// The half of translation that needs the extension principal: outbound HTTP
// (content-script fetches are blocked by the host page's CSP in Firefox and by
// page-origin CORS in Chrome), the Microsoft auth token, and the DeepL API key.
//
// Content scripts must never import this module — they go through
// main/translateClient.ts, which messages background instead.
// ---------------------------------------------------------------------------

import {
    ACTION,
    APP_NAME_WITH_SUFFIX,
    CONFIG_KEY,
    STATUS_FAIL,
    STATUS_SUCCESS,
    TRANSLATE_SERVICE,
} from "@/main/constants";
import {
    DeepLTranslateService,
    Token,
    TRANSLATE_PROXY_ALLOWED_URLS,
    resolveTranslateService,
    setTranslateTransport,
    type TranslateTransport,
} from "@/main/translateClient";
import { aiPageTranslate } from "@/main/aiService";
import { configRepo } from "@/main/storage/configStore";
import { ABORT_SCOPE, handleAbort, handleAbortable, handleAsync } from "@/main/messageBridge";

// ---------------------------------------------------------------------------
// Microsoft auth token
// ---------------------------------------------------------------------------

const MS_TOKEN_URL = "https://edge.microsoft.com/translate/auth";
const MS_TOKEN_TTL = 10 * 60 * 1000;

let cachedToken: Token | null = null;
let inflight: Promise<Token> | null = null;
let inflightForced = false;

if (import.meta.env.DEV) {
    // Debug hook kept from the previous implementation; reads the live cache.
    (globalThis as any).__debugMicrosoftToken = () => cachedToken;
}

/**
 * Fetch (or reuse) the Microsoft translate auth token.
 *
 * One latch covers both the normal and the forced path. Previously these were
 * two mechanisms — an async-mutex for the cached read and a separate promise
 * latch for the refresh — each repeating the same "store in cache, persist to
 * config, return" triple.
 *
 * @param force skip the cache entirely. Used by the 401-retry path: it must NOT
 *   join a non-forced in-flight request, or it could be handed back the very
 *   stale token that caused the 401 and spin until MS_MAX_RETRY.
 * @throws when the token cannot be fetched. Callers at the message boundary map
 *   this to a STATUS_FAIL reply carrying an empty Token.
 */
export function getMicrosoftToken(force = false): Promise<Token> {
    if (!force && cachedToken?.isValid()) return Promise.resolve(cachedToken);
    // Coalesce concurrent callers (a 401 storm across parallel batches shares
    // one refetch), but never let a forced refresh join a non-forced request.
    if (inflight && (inflightForced || !force)) return inflight;

    inflightForced = force;
    inflight = (async () => {
        if (!force) {
            const stored = Token.fromData(await configRepo.get(CONFIG_KEY.MICROSOFT_TOKEN));
            if (stored?.isValid()) {
                cachedToken = stored;
                return stored;
            }
        }
        const raw = await fetch(MS_TOKEN_URL).then((r) => r.text());
        const fresh = new Token(raw, Date.now() + MS_TOKEN_TTL);
        cachedToken = fresh;
        await configRepo.set(CONFIG_KEY.MICROSOFT_TOKEN, fresh);
        return fresh;
    })().finally(() => {
        inflight = null;
        inflightForced = false;
    });

    return inflight;
}

/** Warm the token cache at startup. Failures are non-fatal. */
export function initTokenMap(): void {
    void getMicrosoftToken().catch((e) => {
        console.error(APP_NAME_WITH_SUFFIX, "initTokenMap error", e);
    });
}

/**
 * ACCESS_TOKEN_GET / ACCESS_TOKEN_REFRESH reply shape.
 *
 * The wire contract is unchanged: STATUS_SUCCESS with the Token, or STATUS_FAIL
 * with an empty Token. Content (`MicrosoftTranslateService.fetchToken`) checks
 * `typeof raw.token === 'string'`, so the empty Token is the "no token" signal
 * rather than an error it has to catch.
 */
function tokenResponse(sendResponse: (r: any) => void, force: boolean): true {
    getMicrosoftToken(force)
        .then((token) => sendResponse({ status: STATUS_SUCCESS, data: token }))
        .catch((e) => {
            console.error(APP_NAME_WITH_SUFFIX, "getMicrosoftToken error", e);
            sendResponse({ status: STATUS_FAIL, data: new Token("", 0) });
        });
    return true;
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

type MessageHandler = (message: any, sendResponse: (r: any) => void) => boolean | void;

/** Translate actions handled in background, keyed by ACTION. Consumed by background.ts. */
export const translateMessageHandlers: Record<string, MessageHandler> = {
    [ACTION.ACCESS_TOKEN_GET]: (message, sendResponse) => {
        // todo support other services
        if (message.data?.service !== TRANSLATE_SERVICE.MICROSOFT) {
            sendResponse({ status: STATUS_FAIL, data: new Token("", 0) });
            return;
        }
        return tokenResponse(sendResponse, false);
    },

    [ACTION.ACCESS_TOKEN_REFRESH]: (message, sendResponse) => {
        if (message.data?.service !== TRANSLATE_SERVICE.MICROSOFT) {
            sendResponse({ status: STATUS_FAIL, data: new Token("", 0) });
            return;
        }
        return tokenResponse(sendResponse, true);
    },

    [ACTION.TRANSLATE_PROXY_FETCH]: (message, sendResponse) => handleAbortable(
        // HTTP proxy for the built-in translate providers. Content fetches are
        // blocked by the host page's CSP connect-src in Firefox MV3 and depend
        // on page-origin CORS in Chrome, so the request runs here with the
        // extension principal instead. Only fixed provider endpoints are
        // allowed — this must never become a generic fetch proxy.
        ABORT_SCOPE.TRANSLATE_PROXY, 'Translate proxy fetch', message, sendResponse,
        async (data, signal) => {
            const { url, init } = data as {
                url?: string;
                init?: { method?: string; headers?: Record<string, string>; body?: string };
            };
            if (!url || !TRANSLATE_PROXY_ALLOWED_URLS.some((prefix) => url.startsWith(prefix))) {
                throw new Error(`URL not allowed by translate proxy: ${url}`);
            }
            const r = await fetch(url, {
                method: init?.method ?? 'GET',
                headers: init?.headers,
                body: init?.body,
                signal,
            });
            return { status: r.status, statusText: r.statusText, bodyText: await r.text() };
        },
    ),

    [ACTION.TRANSLATE_PROXY_ABORT]: (message, sendResponse) =>
        handleAbort(ABORT_SCOPE.TRANSLATE_PROXY, message, sendResponse),

    [ACTION.TRANSLATE_SERVICE_TEST]: (message, sendResponse) =>
        handleAsync('Translate service test', sendResponse, () => testTranslateService(message.data)),
};


// ---------------------------------------------------------------------------
// Background transport
// ---------------------------------------------------------------------------

/**
 * Transport used when a provider class runs INSIDE background (the
 * connectivity test). Fetches directly instead of messaging: background's own
 * `runtime.sendMessage` is not delivered to its own onMessage listener, so the
 * message transport would hang until the timeout and yield `undefined`.
 */
export function createBackgroundTransport(): TranslateTransport {
    return {
        async fetch(url, init, signal) {
            // Enforced here too, even though this is a local call: one
            // implementation, one invariant, independent of which transport is
            // live.
            if (!url || !TRANSLATE_PROXY_ALLOWED_URLS.some((prefix) => url.startsWith(prefix))) {
                throw new Error(`URL not allowed by translate proxy: ${url}`);
            }
            const r = await fetch(url, {
                method: init?.method ?? 'GET',
                headers: init?.headers,
                body: init?.body,
                signal: signal ?? undefined,
            });
            const bodyText = await r.text();
            return {
                status: r.status,
                statusText: r.statusText,
                json: async () => JSON.parse(bodyText),
            };
        },

        microsoftToken: (force = false) => getMicrosoftToken(force),

        aiTranslate: (providerId, texts, targetLang, signal) =>
            aiPageTranslate(providerId, texts, targetLang, signal ?? undefined),
    };
}

/**
 * Install the background transport and expose the translate message handlers.
 *
 * Called synchronously from background() in the same turn as the listener
 * registrations, so no message can be dispatched before the transport is in
 * place.
 */
export function registerTranslateBridge(): void {
    setTranslateTransport(createBackgroundTransport());
}

// ---------------------------------------------------------------------------
// Connectivity test (Options → Services)
// ---------------------------------------------------------------------------

/**
 * Validate a service by running the REAL translation path against a sample.
 *
 * Deliberately not a hand-rolled request per provider: that older version
 * hardcoded its own endpoints (which drifted from the ones actually used) and
 * sent DeepL as form-urlencoded while production sends JSON — so a passing test
 * did not prove production worked. Going through the provider classes means the
 * test exercises exactly what a real translation does, and `ai:<id>` services
 * become testable for free.
 *
 * `strict` turns the providers' degrade-to-`[]` behaviour into a throw, so the
 * user sees the real reason rather than a bare failure.
 */
async function testTranslateService(
    data: { service?: string; targetLang?: string; apiKey?: string } | undefined,
): Promise<{ reply: string }> {
    const svc = data?.service;
    const targetLang = data?.targetLang || 'zh-CN';
    if (!svc) throw new Error('Unknown service: undefined');

    // A draft DeepL key typed into the Options dialog but not yet saved needs a
    // one-off instance; everything else uses the shared singletons.
    const service = (svc === TRANSLATE_SERVICE.DEEPL && data?.apiKey)
        ? new DeepLTranslateService(data.apiKey)
        : resolveTranslateService(svc);
    if (!service) throw new Error(`Unknown service: ${svc}`);

    const results = await service.translateText(
        ['Hello, world.'], targetLang, undefined, undefined, { strict: true },
    );
    const reply = results[0]?.translatedMappedHtmlText;
    if (!reply) throw new Error('empty translation response');
    return { reply };
}
