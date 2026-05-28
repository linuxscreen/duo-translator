// Google Drive sync provider.
//
// Auth: `browser.identity.launchWebAuthFlow` (WebExtensions standard) with
// Google OAuth 2.0 + PKCE. Scope = drive.appdata so the synced file lives in
// the per-app hidden folder (invisible in drive.google.com, no access to the
// user's other files).
//
// File layout: a single JSON snapshot at
//   appDataFolder/duo-translator-config.json
// fileId is cached after first push so subsequent updates use PATCH not POST.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { browser } from 'wxt/browser';
import { APP_NAME_WITH_SUFFIX, SYNC_PROVIDER_ID } from '@/main/constants';
import type { Snapshot } from '@/main/storage/snapshot';
import { isValidSnapshot } from '@/main/storage/snapshot';
import type { SyncProvider } from './types';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const REMOTE_FILE_NAME = 'duo-translator-config.json';

// OAuth client id from Google Cloud Console. Public installed-app client id —
// no client_secret. Replace with the actual project's client id before shipping.
// (Stored in code intentionally; OAuth installed-app client ids are not secrets.)
const GOOGLE_CLIENT_ID = '__GOOGLE_OAUTH_CLIENT_ID__';

const TOKENS_KEY: StorageItemKey = 'local:__sync_gdrive_tokens';
const FILE_ID_KEY: StorageItemKey = 'local:__sync_gdrive_file_id';

type Tokens = {
    accessToken: string;
    refreshToken?: string;
    /** Epoch ms when accessToken expires. */
    expiresAt: number;
    /** Optional account email pulled from userinfo for UI labeling. */
    email?: string;
};

// -------- PKCE helpers --------

function base64UrlEncode(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string): Promise<ArrayBuffer> {
    const data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data);
}

function randomString(length = 64): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return base64UrlEncode(bytes.buffer);
}

// -------- HTTP helper --------

async function googleFetch(
    accessToken: string,
    input: string,
    init: RequestInit = {},
): Promise<Response> {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
}

// ----------------------------------------------------------------------------

class GoogleDriveProviderImpl implements SyncProvider {
    readonly id = SYNC_PROVIDER_ID.GDRIVE;

    private async getTokens(): Promise<Tokens | null> {
        return storage.getItem<Tokens>(TOKENS_KEY);
    }

    private async saveTokens(tokens: Tokens): Promise<void> {
        await storage.setItem(TOKENS_KEY, tokens);
    }

    async isAuthenticated(): Promise<boolean> {
        const t = await this.getTokens();
        return !!t && !!t.accessToken;
    }

    async describe(): Promise<string | null> {
        const t = await this.getTokens();
        return t?.email ?? null;
    }

    async authenticate(): Promise<void> {
        const redirectUri = browser.identity.getRedirectURL();
        const verifier = randomString(64);
        const challenge = base64UrlEncode(await sha256(verifier));
        const state = randomString(16);

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', `${SCOPE} email`);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);

        const responseUrl = await browser.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive: true,
        });
        if (!responseUrl) throw new Error('Google sign-in cancelled');

        const parsed = new URL(responseUrl);
        const returnedState = parsed.searchParams.get('state');
        if (returnedState !== state) throw new Error('OAuth state mismatch');
        const code = parsed.searchParams.get('code');
        if (!code) {
            const err = parsed.searchParams.get('error');
            throw new Error(err || 'OAuth response missing code');
        }

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                grant_type: 'authorization_code',
                code,
                code_verifier: verifier,
                redirect_uri: redirectUri,
            }),
        });
        if (!tokenRes.ok) {
            throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
        }
        const tokenJson = (await tokenRes.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
        };

        const tokens: Tokens = {
            accessToken: tokenJson.access_token,
            refreshToken: tokenJson.refresh_token,
            expiresAt: Date.now() + (tokenJson.expires_in - 60) * 1000,
        };

        // Best-effort: fetch the account email for UI label.
        try {
            const ures = await googleFetch(
                tokens.accessToken,
                'https://www.googleapis.com/oauth2/v3/userinfo',
            );
            if (ures.ok) {
                const ui = (await ures.json()) as { email?: string };
                if (ui.email) tokens.email = ui.email;
            }
        } catch {
            /* non-fatal */
        }

        await this.saveTokens(tokens);
    }

    async disconnect(): Promise<void> {
        await storage.removeItem(TOKENS_KEY);
        await storage.removeItem(FILE_ID_KEY);
    }

    private async getFreshAccessToken(): Promise<string> {
        const t = await this.getTokens();
        if (!t) throw new Error('Google Drive not connected');
        if (t.expiresAt > Date.now() + 5_000) return t.accessToken;
        if (!t.refreshToken) {
            // No refresh token (some PKCE flows skip it on re-consent).
            // Force a reauth.
            throw new Error('Access token expired and no refresh_token available; please reconnect Google Drive');
        }
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                grant_type: 'refresh_token',
                refresh_token: t.refreshToken,
            }),
        });
        if (!res.ok) {
            // Refresh token revoked / expired — clear and ask user to reconnect.
            await storage.removeItem(TOKENS_KEY);
            throw new Error(`Refresh failed (${res.status}); please reconnect Google Drive`);
        }
        const j = (await res.json()) as { access_token: string; expires_in: number };
        const next: Tokens = {
            ...t,
            accessToken: j.access_token,
            expiresAt: Date.now() + (j.expires_in - 60) * 1000,
        };
        await this.saveTokens(next);
        return next.accessToken;
    }

    private async resolveFileId(accessToken: string): Promise<string | null> {
        const cached = await storage.getItem<string>(FILE_ID_KEY);
        if (cached) return cached;

        const url = new URL('https://www.googleapis.com/drive/v3/files');
        url.searchParams.set('spaces', 'appDataFolder');
        url.searchParams.set('q', `name='${REMOTE_FILE_NAME}'`);
        url.searchParams.set('fields', 'files(id,name)');

        const res = await googleFetch(accessToken, url.toString());
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
        const accessToken = await this.getFreshAccessToken();
        const fileId = await this.resolveFileId(accessToken);
        if (!fileId) return null;
        const res = await googleFetch(
            accessToken,
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        );
        if (res.status === 404) {
            // Stale fileId — drop the cache and try once more via fresh list.
            await storage.removeItem(FILE_ID_KEY);
            const retryFileId = await this.resolveFileId(accessToken);
            if (!retryFileId) return null;
            const retry = await googleFetch(
                accessToken,
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
        const accessToken = await this.getFreshAccessToken();
        const existing = await this.resolveFileId(accessToken);
        const body = JSON.stringify(snap);

        if (existing) {
            const res = await googleFetch(
                accessToken,
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

        const res = await googleFetch(
            accessToken,
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
