// Google Drive sync provider.
//
// Scope = drive.appdata, so the synced file lives in the per-app hidden folder
// (invisible in drive.google.com, no access to the user's other files).
//
// File layout: a single JSON snapshot at
//   appDataFolder/{APP_NAME}-config.json
// fileId is cached after first push so subsequent updates use PATCH not POST.
//
// ─── Credentials: two paths, no client_secret anywhere ──────────────────────
//
// A `client_secret` is only ever needed to call Google's *token endpoint*. Both
// paths below avoid that endpoint entirely, so the secret does not exist in
// this codebase — and neither does the backend token broker that would
// otherwise have to hold it. See .ai/plans/google-drive-oauth-no-broker.md for
// why a broker was rejected (it would make us the data controller, force an
// "authentication information" disclosure in the store listing, and turn every
// broker 5xx into a sign-out).
//
//   Chrome  → `identity.getAuthToken`. The browser owns the grant and refreshes
//             silently, so auto-sync works with zero interaction.
//   Others  → `launchWebAuthFlow` + OAuth **implicit** flow (`response_type=token`).
//             The token arrives in the redirect fragment; it lasts ~1h and there
//             is NO refresh token. Renewal is a second, non-interactive
//             `launchWebAuthFlow` with `prompt=none`, done lazily right before a
//             token is needed.
//
// The missing `refreshToken` field on `Tokens` is deliberate, not an oversight.
//
// Which path is used is the user's call (Options › "Authorize through Chrome",
// stored per device), and **connecting never silently switches paths**: if the
// Chrome path was asked for and fails, that is an error with a remedy in it, not
// a quiet detour through the web flow. An earlier version did fall back, sorted
// by matching the error message against a list of "user refused" strings — and
// promptly misclassified Chrome's "The user is not signed in." (raised when the
// user dismisses the sign-in prompt), so cancelling that prompt landed them on a
// ~1h web token with the checkbox still ticked. Any string-matching version of
// this has the same failure mode; don't reintroduce one.
//
// Consequence for Edge/Brave/Vivaldi: they are Chromium and *do* expose
// `getAuthToken` (it fails at call time — no Chrome account system behind it,
// and the `oauth2` manifest key is only emitted for the `chrome` build target),
// so the checkbox is offered there and ticked by default. First connect fails
// with a message telling them to untick it. Loud and fixable beats silent.
//
// The probe itself is never `import.meta.env.FIREFOX` — a browser with no
// getAuthToken at all (Firefox, Safari) isn't offered the checkbox and goes
// straight to the web flow, which is not a fallback but its only option.
//
// A silent renewal (or any launchWebAuthFlow) is a browser-level navigation in a
// hidden context — it does NOT show up in the background page's Network panel,
// so devtools traffic is no evidence either way about whether one happened.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { browser } from 'wxt/browser';
import { APP_NAME_KEBAB_CASE, APP_NAME_WITH_SUFFIX, IS_CHROME, SYNC_PROVIDER_ID } from '@/main/constants';
import type { Snapshot } from '@/main/storage/snapshot';
import { isValidSnapshot } from '@/main/storage/snapshot';
import type { SyncProvider, RemoteBackupInfo } from './types';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const REMOTE_FILE_NAME = `${APP_NAME_KEBAB_CASE}-config.json`;

// OAuth client id, type "Web application" — used by the implicit flow on every
// browser except Chrome. Its client_secret is NOT used and must not be bundled.
// The redirect URI reported by `identity.getRedirectURL()` must be registered
// under this client's "Authorized redirect URIs", once per browser and per
// extension id (unpacked dev id + store id).
const GOOGLE_CLIENT_ID_WEB = import.meta.env.VITE_GOOGLE_CLIENT_ID_WEB;

const TOKENS_KEY: StorageItemKey = 'local:__sync_gdrive_tokens';
const FILE_ID_KEY: StorageItemKey = 'local:__sync_gdrive_file_id';
// Device-local fact ("this browser can't mint a token any more"), deliberately
// outside the sync snapshot: it says nothing about the account, only about this
// install. Set when renewal fails for a reason the user has to resolve.
const NEEDS_REAUTH_KEY: StorageItemKey = 'local:__sync_gdrive_needs_reauth';
// Which credential path the user wants (Options checkbox, Chrome only, default
// on). Device-local like the two keys above and for the same reason: it answers
// "how does THIS browser talk to Google", which is meaningless on any other
// device. Deliberately NOT a CONFIG_KEY — `config_*` keys are in the sync
// snapshot, and syncing this one would push a Chrome-only choice onto a
// Firefox install where it cannot be honoured.
const USE_BROWSER_AUTH_KEY: StorageItemKey = 'local:__sync_gdrive_use_browser_auth';

/** Which credential path this install connected through. */
type GdriveMode = 'chrome' | 'web';

type Tokens = {
    mode: GdriveMode;
    /**
     * Web (implicit) mode only. In Chrome mode the browser holds the token and
     * hands out a fresh one on demand, so we never store one.
     */
    accessToken?: string;
    /** Epoch ms when accessToken expires. Web mode only. */
    expiresAt?: number;
    /** Account email pulled from userinfo, for the UI label. */
    email?: string;
};

type NeedsReauth = { reason: string; at: number };

// -------- identity helpers --------

/**
 * Narrow view of the Chrome-only half of the identity API. `wxt/browser` types
 * follow the WebExtensions standard, which has no getAuthToken.
 */
type ChromeIdentity = {
    getAuthToken?: (
        details: { interactive?: boolean },
        callback?: (result: unknown, grantedScopes?: string[]) => void,
    ) => unknown;
    removeCachedAuthToken?: (details: { token: string }, callback?: () => void) => unknown;
};

function chromeIdentity(): ChromeIdentity {
    return browser.identity as unknown as ChromeIdentity;
}

/**
 * Positive identification of Google Chrome — not "is it Chromium".
 *
 * Needed because the build-target macro is not enough on its own: Edge offers
 * "allow extensions from other stores", so the **chrome artifact** legitimately
 * runs in Edge, where IS_CHROME is true and `getAuthToken` exists but can never
 * succeed. Same for Brave/Vivaldi/Opera installing from the Chrome Web Store.
 *
 * UA-CH brands first (that is what it is for); the UA string is the fallback for
 * engines without it, requiring Chrome and rejecting the known re-branders.
 */
function isGoogleChrome(): boolean {
    const brands = (navigator as unknown as { userAgentData?: { brands?: { brand?: string }[] } })
        .userAgentData?.brands;
    if (Array.isArray(brands)) return brands.some((b) => b?.brand === 'Google Chrome');
    const ua = navigator.userAgent;
    return (
        /Chrome\//.test(ua) &&
        !/(Edg|EdgA|EdgiOS|OPR|Vivaldi|Brave|YaBrowser|SamsungBrowser)\//.test(ua)
    );
}

/**
 * The one branch point, and the one thing the "Authorize through Chrome"
 * checkbox is offered on. Three conditions, each covering what the others miss:
 *
 *  - build target `chrome` — only that target emits the `oauth2` manifest key
 *    getAuthToken needs, so the edge/firefox/safari builds can never succeed;
 *  - the browser really is Chrome — the chrome build also runs in Edge/Brave via
 *    "install from the Chrome Web Store", and there getAuthToken exists but has
 *    no account system behind it;
 *  - the API is actually present.
 *
 * If the browser check is ever wrong the damage is bounded: the checkbox shows,
 * connecting fails with a message naming the remedy, and the user unticks it.
 * That is only true because `authenticate` no longer silently falls back to the
 * web flow — with a fallback, a wrong answer here would be invisible.
 *
 * UI and provider MUST agree on this: hiding the checkbox somewhere the provider
 * would still attempt the Chrome path leaves the user with a connect error whose
 * remedy is "untick a box that isn't rendered".
 */
export function canUseBrowserAuth(): boolean {
    return IS_CHROME && isGoogleChrome() && typeof chromeIdentity()?.getAuthToken === 'function';
}

/**
 * `getAuthToken` as a promise. Chrome ≥105 resolves/callbacks with a
 * `{token, grantedScopes}` object, older builds with a bare string; and a
 * callback suppresses the promise return. Handle all three shapes.
 */
function getAuthTokenAsync(interactive: boolean): Promise<string> {
    const identity = chromeIdentity();
    if (typeof identity?.getAuthToken !== 'function') {
        throw new Error('identity.getAuthToken is not available in this browser');
    }
    return new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (result: unknown) => {
            if (settled) return;
            settled = true;
            const lastError = browser.runtime?.lastError;
            if (lastError) return reject(new Error(lastError.message || 'getAuthToken failed'));
            const token =
                typeof result === 'string' ? result : (result as { token?: string } | null)?.token;
            if (!token) return reject(new Error('getAuthToken returned no token'));
            resolve(token);
        };
        const fail = (e: unknown) => {
            if (settled) return;
            settled = true;
            reject(e instanceof Error ? e : new Error(String(e)));
        };
        try {
            const ret = identity.getAuthToken!({ interactive }, finish);
            if (ret && typeof (ret as Promise<unknown>).then === 'function') {
                (ret as Promise<unknown>).then(finish, fail);
            }
        } catch (e) {
            fail(e);
        }
    });
}

function removeCachedAuthToken(token: string): Promise<void> {
    const identity = chromeIdentity();
    if (typeof identity?.removeCachedAuthToken !== 'function') return Promise.resolve();
    return new Promise<void>((resolve) => {
        try {
            const ret = identity.removeCachedAuthToken!({ token }, () => resolve());
            if (ret && typeof (ret as Promise<unknown>).then === 'function') {
                (ret as Promise<unknown>).then(
                    () => resolve(),
                    () => resolve(),
                );
            }
        } catch {
            resolve();
        }
    });
}

/**
 * Is the browser-managed path (getAuthToken) wanted here? Default on: the
 * browser owns the grant and refreshes it indefinitely, which is what lets
 * auto-sync run untouched. Off sends the user through the web flow, whose token
 * lasts ~1h and whose silent renewal depends on the browser's Google session
 * still being alive — the escape hatch when the Chrome path won't work here.
 *
 * It IS also the account-choice switch, and the account rule is not obvious:
 * getAuthToken has no account picker (confirmed in the chrome.identity docs and
 * by a Chromium engineer on chromium-extensions) — it derives the account from
 * the profile, "the Sync account if there is one, or otherwise the first Google
 * web account". So the Drive it lands on can differ from what the user calls
 * "my Chrome account" WITHOUT anyone choosing anything, and it can move later:
 * turning Chrome Sync on, or a different web account becoming first, changes it
 * on the next connect — a different appDataFolder, i.e. the synced settings
 * appear to vanish. The web flow always shows a real picker.
 */
export async function getUseBrowserAuth(): Promise<boolean> {
    const v = await storage.getItem<boolean>(USE_BROWSER_AUTH_KEY);
    return v ?? true;
}

export async function setUseBrowserAuth(value: boolean): Promise<void> {
    await storage.setItem(USE_BROWSER_AUTH_KEY, value);
}

// -------- misc helpers --------

function base64UrlEncode(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length = 32): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return base64UrlEncode(bytes.buffer);
}

async function googleFetch(
    accessToken: string,
    input: string,
    init: RequestInit = {},
): Promise<Response> {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
}

/** Best effort — the email is only a UI label, never a credential. */
async function fetchEmail(accessToken: string): Promise<string | undefined> {
    try {
        const res = await googleFetch(
            accessToken,
            'https://www.googleapis.com/oauth2/v3/userinfo',
        );
        if (!res.ok) return undefined;
        const j = (await res.json()) as { email?: string };
        return j.email || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Implicit flow through `launchWebAuthFlow`.
 *
 * `interactive:false` + `prompt=none` is the silent-renewal path: when the user
 * already granted us and still has a live Google session in this browser, Google
 * 302s straight back with a new token and no window is ever shown.
 */
async function launchImplicitFlow(
    interactive: boolean,
    loginHint?: string,
): Promise<{ accessToken: string; expiresAt: number }> {
    if (!GOOGLE_CLIENT_ID_WEB) {
        throw new Error('Google Drive is not configured (missing VITE_GOOGLE_CLIENT_ID_WEB)');
    }
    // Reached only through a stale message or an old token record — the Safari
    // build offers WebDAV only. Without this the failure is
    // `undefined is not an object (evaluating 'browser.identity.getRedirectURL')`,
    // which names neither the cause nor the way out.
    if (typeof browser.identity?.launchWebAuthFlow !== 'function') {
        throw new Error(
            'Google Drive sync is unavailable in this browser: it has no extension identity API. Use WebDAV instead.',
        );
    }
    const redirectUri = browser.identity.getRedirectURL();
    const state = randomString(16);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID_WEB);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', `${SCOPE} email`);
    authUrl.searchParams.set('state', state);
    if (interactive) {
        // Always offer the account picker: this path has no browser account
        // state to fall back on, so leaving the choice implicit would silently
        // reuse whichever Google session the browser happens to hold.
        authUrl.searchParams.set('prompt', 'select_account');
    } else {
        authUrl.searchParams.set('prompt', 'none');
    }
    if (loginHint) authUrl.searchParams.set('login_hint', loginHint);

    let responseUrl: string | undefined;
    try {
        responseUrl = await browser.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Chromium collapses EVERY failed navigation into "Authorization page
        // could not be loaded" — it swallows whatever Google actually said, and
        // Google says very different things: redirect_uri_mismatch (400), an
        // unknown client (400), or "app is being tested, this account is not on
        // the allow-list" (403). All three look identical from in here, and the
        // fixes are unrelated, so do not guess: hand over the exact URL. Opening
        // it in a normal tab renders Google's real error page verbatim.
        if (/could not be loaded/i.test(msg)) {
            throw new Error(
                `${msg}\n\nGoogle rejected the request before a page could render, and the browser ` +
                `does not report why. Open this URL in a normal tab to see Google's own error:\n${authUrl.toString()}` +
                `\n\nredirect_uri: ${redirectUri}\nclient_id: ${GOOGLE_CLIENT_ID_WEB}`,
            );
        }
        throw e;
    }
    if (!responseUrl) throw new Error('Google sign-in cancelled');

    const parsed = new URL(responseUrl);
    // Implicit responses come back in the fragment; some error paths use the
    // query string, so read both.
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const read = (k: string) => fragment.get(k) ?? parsed.searchParams.get(k);

    const error = read('error');
    if (error) throw new Error(error);

    if (read('state') !== state) throw new Error('OAuth state mismatch');
    const accessToken = read('access_token');
    if (!accessToken) throw new Error('OAuth response missing access_token');
    const expiresIn = Number(read('expires_in')) || 3600;

    return { accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
}

/**
 * "The grant is gone" vs "we just couldn't reach anybody".
 *
 * Only the former may clear credentials — the implicit path routinely fails to
 * renew (session expired, offline, Google hiccup), and clearing on those would
 * kick the user back to "Not connected" every few days.
 */
function isAuthorizationRevoked(e: unknown): boolean {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    return (
        msg.includes('invalid_grant') ||
        msg.includes('access_denied') ||
        msg.includes('invalid_client')
    );
}

// ----------------------------------------------------------------------------

class GoogleDriveProviderImpl implements SyncProvider {
    readonly id = SYNC_PROVIDER_ID.GDRIVE;

    private async getTokens(): Promise<Tokens | null> {
        const t = await storage.getItem<Tokens>(TOKENS_KEY);
        if (!t) return null;
        // Records written before the two-path rewrite have no mode; they came
        // from the implicit-less code flow, so treat them as web and let the
        // first renewal decide their fate.
        return { ...t, mode: t.mode ?? 'web' };
    }

    private async saveTokens(tokens: Tokens): Promise<void> {
        await storage.setItem(TOKENS_KEY, tokens);
    }

    private async markNeedsReauth(reason: string): Promise<void> {
        await storage.setItem<NeedsReauth>(NEEDS_REAUTH_KEY, { reason, at: Date.now() });
    }

    private async clearNeedsReauth(): Promise<void> {
        // Read first: this runs after every successful token mint, i.e. several
        // times per sync, and the flag is set at most once in a blue moon.
        if (await storage.getItem<NeedsReauth>(NEEDS_REAUTH_KEY)) {
            await storage.removeItem(NEEDS_REAUTH_KEY);
        }
    }

    /** The grant itself is gone — drop the record so the UI offers Connect. */
    private async forgetGrant(reason: string): Promise<void> {
        console.warn(APP_NAME_WITH_SUFFIX, 'GDrive authorization lost:', reason);
        await storage.removeItem(TOKENS_KEY);
        await this.clearNeedsReauth();
    }

    async isAuthenticated(): Promise<boolean> {
        const t = await this.getTokens();
        if (!t) return false;
        // Chrome mode stores no token (the browser holds it), so the record's
        // existence IS the connection. Web mode keeps its last token even when
        // stale — that is the "needs reconnect" state, not a disconnection.
        return t.mode === 'chrome' || !!t.accessToken;
    }

    /**
     * Credentials are still on file but this browser can no longer mint a token
     * without the user. Surfaced in Options as "needs reconnect".
     */
    async needsReauth(): Promise<boolean> {
        if (!(await this.isAuthenticated())) return false;
        return !!(await storage.getItem<NeedsReauth>(NEEDS_REAUTH_KEY));
    }

    async describe(): Promise<string | null> {
        const t = await this.getTokens();
        return t?.email ?? null;
    }

    /**
     * The path is chosen from the stored preference, not from an argument: the
     * provider owning it is what makes it impossible for the checkbox and the
     * actual flow to disagree.
     *
     * Two differences, both load-bearing: who holds the grant afterwards (the
     * browser, indefinitely — vs. a ~1h token of ours), and whether the user
     * gets to pick the account (only the web flow does; see getUseBrowserAuth).
     */
    async authenticate(): Promise<void> {
        let tokens: Tokens;
        if ((await getUseBrowserAuth()) && canUseBrowserAuth()) {
            // Deliberately NO fallback to the web flow here. Failing loudly is
            // the whole point: the two paths differ in how long the grant lasts,
            // so quietly connecting through the other one leaves the checkbox
            // ticked while the connection is something else entirely.
            let token: string;
            try {
                token = await getAuthTokenAsync(true);
            } catch (e: any) {
                throw new Error(
                    `Chrome authorization failed: ${e?.message || e}. ` +
                    `Sign in to Chrome, or untick "Authorize through Chrome" to use web sign-in.`,
                );
            }
            tokens = { mode: 'chrome', email: await fetchEmail(token) };
        } else {
            // Not a fallback — either the user asked for web sign-in, or this
            // browser has no getAuthToken at all (Firefox, Safari), in which
            // case the checkbox isn't even offered.
            const { accessToken, expiresAt } = await launchImplicitFlow(true);
            tokens = { mode: 'web', accessToken, expiresAt, email: await fetchEmail(accessToken) };
        }

        console.log(APP_NAME_WITH_SUFFIX, 'GDrive connected via', tokens.mode, 'flow');
        await this.saveTokens(tokens);
        await this.clearNeedsReauth();
    }

    async disconnect(): Promise<void> {
        const t = await this.getTokens();
        if (t?.mode === 'chrome') {
            // Drop Chrome's cached token so a later Connect can land on a
            // different account. Deliberately NOT revoking the grant server-side:
            // that would sign the user out of this app on their other devices too.
            try {
                await removeCachedAuthToken(await getAuthTokenAsync(false));
            } catch {
                /* nothing cached — fine */
            }
        }
        await storage.removeItem(TOKENS_KEY);
        await storage.removeItem(FILE_ID_KEY);
        await this.clearNeedsReauth();
    }

    // -------- token plumbing --------

    /**
     * The single exit for credentials. Everything else goes through `api()`.
     */
    private async getFreshAccessToken(): Promise<string> {
        const t = await this.getTokens();
        if (!t) throw new Error('Google Drive not connected');

        if (t.mode === 'chrome') {
            try {
                const token = await getAuthTokenAsync(false);
                await this.clearNeedsReauth();
                return token;
            } catch (e: any) {
                await this.markNeedsReauth(e?.message || 'getAuthToken failed');
                throw new Error(
                    `Google Drive sign-in expired; please reconnect (${e?.message || e})`,
                );
            }
        }

        if (t.accessToken && (t.expiresAt ?? 0) > Date.now() + 30_000) return t.accessToken;

        // Lazy silent renewal — no background timer pinging Google from every
        // install; we only ask when a sync actually needs a token.
        try {
            const { accessToken, expiresAt } = await launchImplicitFlow(false, t.email);
            await this.saveTokens({ ...t, accessToken, expiresAt });
            await this.clearNeedsReauth();
            return accessToken;
        } catch (e: any) {
            const reason = e?.message || String(e);
            if (isAuthorizationRevoked(e)) {
                await this.forgetGrant(reason);
                throw new Error(`Google Drive access was revoked; please reconnect (${reason})`);
            }
            await this.markNeedsReauth(reason);
            throw new Error(`Google Drive sign-in expired; please reconnect (${reason})`);
        }
    }

    /** Invalidate whatever produced `token`, so the next mint returns a new one. */
    private async invalidateAccessToken(token: string): Promise<void> {
        const t = await this.getTokens();
        if (!t) return;
        if (t.mode === 'chrome') {
            await removeCachedAuthToken(token);
            return;
        }
        if (t.accessToken === token) {
            await this.saveTokens({ ...t, accessToken: undefined, expiresAt: 0 });
        }
    }

    /**
     * Authenticated request with one 401 retry.
     *
     * A 401 is the server telling us this specific token is no good — unlike a
     * network error, it can't be a connectivity problem. So: invalidate, mint a
     * fresh one, retry once; a second 401 means the grant itself is gone.
     */
    private async api(input: string, init: RequestInit = {}): Promise<Response> {
        const token = await this.getFreshAccessToken();
        const res = await googleFetch(token, input, init);
        if (res.status !== 401) return res;

        await this.invalidateAccessToken(token);
        const retryToken = await this.getFreshAccessToken();
        const retry = await googleFetch(retryToken, input, init);
        if (retry.status === 401) {
            await this.forgetGrant('Google rejected a freshly minted token (401)');
            throw new Error('Google Drive authorization is no longer valid; please reconnect');
        }
        return retry;
    }

    // -------- Drive operations --------

    async getRemoteInfo(): Promise<RemoteBackupInfo | null> {
        const fileId = await this.resolveFileId();
        if (!fileId) return null;
        const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
        url.searchParams.set('fields', 'name,size,modifiedTime');
        const res = await this.api(url.toString());
        if (res.status === 404) {
            // Stale cached id — the backup was removed elsewhere.
            await storage.removeItem(FILE_ID_KEY);
            return null;
        }
        if (!res.ok) {
            throw new Error(`Drive metadata failed: ${res.status} ${await res.text()}`);
        }
        const j = (await res.json()) as {
            name?: string;
            size?: string;
            modifiedTime?: string;
        };
        return {
            name: j.name ?? REMOTE_FILE_NAME,
            size: j.size != null ? Number(j.size) : null,
            modifiedTime: j.modifiedTime ? Date.parse(j.modifiedTime) : null,
        };
    }

    async deleteRemote(): Promise<void> {
        const fileId = await this.resolveFileId();
        if (!fileId) return;
        const res = await this.api(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
        });
        // 404 = already gone; treat as success.
        if (!res.ok && res.status !== 404) {
            throw new Error(`Drive delete failed: ${res.status} ${await res.text()}`);
        }
        await storage.removeItem(FILE_ID_KEY);
    }

    private async resolveFileId(): Promise<string | null> {
        const cached = await storage.getItem<string>(FILE_ID_KEY);
        if (cached) return cached;

        const url = new URL('https://www.googleapis.com/drive/v3/files');
        url.searchParams.set('spaces', 'appDataFolder');
        url.searchParams.set('q', `name='${REMOTE_FILE_NAME}'`);
        url.searchParams.set('fields', 'files(id,name)');

        const res = await this.api(url.toString());
        if (!res.ok) {
            throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
        }
        const j = (await res.json()) as { files?: Array<{ id: string; name: string }> };
        const f = j.files?.[0];
        if (!f) return null;
        await storage.setItem(FILE_ID_KEY, f.id);
        return f.id;
    }

    async pull(): Promise<Snapshot | null> {
        const fileId = await this.resolveFileId();
        if (!fileId) return null;
        const res = await this.api(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        );
        if (res.status === 404) {
            // Stale fileId — drop the cache and try once more via fresh list.
            await storage.removeItem(FILE_ID_KEY);
            const retryFileId = await this.resolveFileId();
            if (!retryFileId) return null;
            const retry = await this.api(
                `https://www.googleapis.com/drive/v3/files/${retryFileId}?alt=media`,
            );
            if (!retry.ok) {
                throw new Error(`Drive download failed: ${retry.status} ${await retry.text()}`);
            }
            const parsed = await retry.json();
            return isValidSnapshot(parsed) ? parsed : null;
        }
        if (!res.ok) {
            throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
        }
        const parsed = await res.json();
        if (!isValidSnapshot(parsed)) {
            console.warn(APP_NAME_WITH_SUFFIX, 'GDrive pull: invalid snapshot envelope, treating as missing');
            return null;
        }
        return parsed;
    }

    async push(snap: Snapshot): Promise<void> {
        const existing = await this.resolveFileId();
        const body = JSON.stringify(snap);

        if (existing) {
            const res = await this.api(
                `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                },
            );
            if (!res.ok) {
                throw new Error(`Drive PATCH failed: ${res.status} ${await res.text()}`);
            }
            return;
        }

        // First upload — multipart so we can set parents = [appDataFolder].
        const boundary = `duo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const metadata = JSON.stringify({
            name: REMOTE_FILE_NAME,
            parents: ['appDataFolder'],
        });
        const multipartBody =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            metadata +
            `\r\n--${boundary}\r\n` +
            `Content-Type: application/json\r\n\r\n` +
            body +
            `\r\n--${boundary}--`;

        const res = await this.api(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
            {
                method: 'POST',
                headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                body: multipartBody,
            },
        );
        if (!res.ok) {
            throw new Error(`Drive POST failed: ${res.status} ${await res.text()}`);
        }
        const j = (await res.json()) as { id: string };
        await storage.setItem(FILE_ID_KEY, j.id);
    }
}

export const googleDriveProvider: SyncProvider = new GoogleDriveProviderImpl();

// ---------------------------------------------------------------------------
// Connect, detached from the caller's promise.
//
// `getAuthToken` can hand control to browser UI and then never call back — close
// its sign-in tab and no token and no error ever arrive. Anything awaiting that
// promise is stuck until its own timeout, which is what made the Options section
// freeze for two minutes. Worse, Chrome QUEUES concurrent getAuthToken calls for
// the same scopes, so a second attempt opens no UI at all and simply waits
// behind the first one — "click connect again" could not possibly work.
//
// So connecting is fire-and-forget: the message returns at once and the outcome
// is published as state the UI polls. The latch makes a second click join the
// running flow instead of queueing another one behind it.
// ---------------------------------------------------------------------------

let authInFlight: Promise<void> | null = null;
let lastAuthError: string | null = null;
// Bumped per flow so a late callback from an abandoned one can't clobber the
// state of the flow that replaced it.
let authGeneration = 0;

export function startGoogleDriveAuth(): { alreadyRunning: boolean } {
    if (authInFlight) return { alreadyRunning: true };
    lastAuthError = null;
    const gen = ++authGeneration;
    authInFlight = googleDriveProvider
        .authenticate()
        .catch((e: any) => {
            if (gen === authGeneration) lastAuthError = e?.message || String(e);
        })
        .finally(() => {
            if (gen === authGeneration) authInFlight = null;
        });
    void watchSignInTabs(gen);
    return { alreadyRunning: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Notice the user closing the sign-in page, because `getAuthToken` will not tell
 * us: no token, no error, the promise just stays pending and the UI would sit on
 * "Authorizing…" until the extension is reloaded.
 *
 * The tab is identified as **whatever appeared right after we started the flow**
 * — deliberately NOT by matching its URL. A `chrome://chrome-signin/…` pattern
 * is an internal detail that can change silently, and when it changed the
 * failure would look exactly like today's bug: a button stuck forever, no clue
 * why. "New since we asked for a sign-in" holds whatever Chrome renders.
 *
 * Watching several tabs and only reacting when the LAST one closes is the
 * conservative direction: an unrelated tab opened in that same second only ever
 * delays the recovery, never triggers it early.
 *
 * `tabs.onRemoved` is registered here rather than in the first synchronous turn
 * — the usual MV3 rule does not apply because this listener must not wake
 * anything: if the worker dies, the in-memory flow state dies with it and the UI
 * reads "not in progress" anyway.
 */
async function watchSignInTabs(gen: number): Promise<void> {
    let before: Set<number>;
    try {
        before = new Set((await browser.tabs.query({})).map((t) => t.id).filter((id): id is number => id != null));
    } catch {
        return; // no tabs permission / not available — recovery is best-effort
    }

    // The sign-in surface appears a beat after the call, and how long depends on
    // what Chrome decides to show, so sample rather than guess one delay.
    const opened = new Set<number>();
    for (const delay of [300, 600, 1200]) {
        await sleep(delay);
        if (gen !== authGeneration || !authInFlight) return;
        for (const t of await browser.tabs.query({})) {
            if (t.id != null && !before.has(t.id)) opened.add(t.id);
        }
    }
    if (opened.size === 0) return;

    const onRemoved = (tabId: number) => {
        opened.delete(tabId);
        if (gen !== authGeneration) {
            browser.tabs.onRemoved.removeListener(onRemoved);
            return;
        }
        if (opened.size > 0) return;
        browser.tabs.onRemoved.removeListener(onRemoved);
        // A SUCCESSFUL sign-in also closes the tab, and the token can trail it
        // by a few hundred ms. Give the happy path room to land first.
        setTimeout(() => {
            if (gen !== authGeneration || !authInFlight) return;
            lastAuthError = 'The sign-in page was closed before authorization finished.';
            authInFlight = null;
        }, 2000);
    };
    browser.tabs.onRemoved.addListener(onRemoved);
}

/**
 * `inProgress` staying true forever is a real state, not a bug to paper over:
 * it means the browser never answered (typically the sign-in tab was closed).
 * Reported as-is so the UI can say so instead of pretending to retry.
 */
export function googleDriveAuthState(): { inProgress: boolean; lastError: string | null } {
    return { inProgress: !!authInFlight, lastError: lastAuthError };
}

export function clearGoogleDriveAuthError(): void {
    lastAuthError = null;
}
