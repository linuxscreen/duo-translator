// WebDAV sync provider.
//
// Auth: HTTP Basic over HTTPS (HTTP refused unless the user explicitly
// flips the "I understand the risk" toggle). Credentials are user-supplied
// (baseUrl + username + password + optional path).
//
// Layout:
//   <baseUrl>/<basePath>/{APP_NAME}-config.json
//
// Because the URL is user-supplied at runtime, the manifest declares
// `optional_host_permissions: ['<all_urls>']` and we request the specific
// origin via `browser.permissions.request` on connect.

import { storage, type StorageItemKey } from 'wxt/utils/storage';
import { browser } from 'wxt/browser';
import { APP_NAME_KEBAB_CASE, APP_NAME_WITH_SUFFIX, SYNC_PROVIDER_ID } from '@/main/constants';
import type { Snapshot } from '@/main/storage/snapshot';
import { isValidSnapshot } from '@/main/storage/snapshot';
import type { SyncProvider, RemoteBackupInfo } from './types';

const CREDS_KEY: StorageItemKey = 'local:__sync_webdav_creds';
// Disconnect keeps the credentials (so the config form stays pre-filled and
// reconnecting is one click) but flips this flag so the provider counts as
// not-authenticated and stops syncing. Cleared on (re)authenticate.
const DISCONNECTED_KEY: StorageItemKey = 'local:__sync_webdav_disconnected';
const REMOTE_FILE_NAME = `${APP_NAME_KEBAB_CASE}-config.json`;

export type WebDavCredentials = {
    baseUrl: string;
    username: string;
    password: string;
    basePath?: string;
    /** When the user explicitly opts in to plain HTTP. Default false. */
    allowInsecure?: boolean;
};

function joinUrl(...parts: string[]): string {
    return parts
        .map((p, i) => {
            if (i === 0) return p.replace(/\/+$/, '');
            return p.replace(/^\/+/, '').replace(/\/+$/, '');
        })
        .filter((p) => p.length > 0)
        .join('/');
}

function normalizeBasePath(p: string | undefined): string {
    if (!p) return '';
    return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

function basicAuth(username: string, password: string): string {
    return 'Basic ' + btoa(`${username}:${password}`);
}

function buildFileUrl(creds: WebDavCredentials): string {
    const base = creds.baseUrl.replace(/\/+$/, '');
    const path = normalizeBasePath(creds.basePath);
    return path ? joinUrl(base, path, REMOTE_FILE_NAME) : joinUrl(base, REMOTE_FILE_NAME);
}

function buildFolderUrl(creds: WebDavCredentials): string {
    const base = creds.baseUrl.replace(/\/+$/, '');
    const path = normalizeBasePath(creds.basePath);
    return path ? joinUrl(base, path) + '/' : base + '/';
}

class WebDavProviderImpl implements SyncProvider {
    readonly id = SYNC_PROVIDER_ID.WEBDAV;

    private async getCreds(): Promise<WebDavCredentials | null> {
        return storage.getItem<WebDavCredentials>(CREDS_KEY);
    }

    async isAuthenticated(): Promise<boolean> {
        const c = await this.getCreds();
        if (!c || !c.baseUrl || !c.username) return false;
        const disconnected = await storage.getItem<boolean>(DISCONNECTED_KEY);
        return !disconnected;
    }

    async describe(): Promise<string | null> {
        const c = await this.getCreds();
        if (!c) return null;
        return `${c.username} @ ${c.baseUrl}`;
    }

    /**
     * `input` is the unsaved credentials the user just entered. We validate
     * shape, request host_permission, run a PROPFIND to confirm reachability,
     * and only then persist.
     */
    async authenticate(input?: unknown): Promise<void> {
        const creds = input as WebDavCredentials | undefined;
        if (
            !creds ||
            typeof creds.baseUrl !== 'string' ||
            typeof creds.username !== 'string' ||
            typeof creds.password !== 'string'
        ) {
            throw new Error('Missing WebDAV credentials');
        }

        let parsed: URL;
        try {
            parsed = new URL(creds.baseUrl);
        } catch {
            throw new Error('Invalid WebDAV URL');
        }

        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('WebDAV URL must use http:// or https://');
        }
        if (parsed.protocol === 'http:' && !creds.allowInsecure) {
            throw new Error('Plain HTTP is blocked. Enable "I understand the risk" to proceed.');
        }

        const origin = parsed.origin + '/*';
        try {
            const granted = await browser.permissions.request({ origins: [origin] });
            if (!granted) {
                throw new Error('Host permission was denied');
            }
        } catch (e) {
            // Some browsers throw instead of returning false when the user
            // dismisses the prompt; surface a consistent error.
            throw e instanceof Error ? e : new Error('Host permission request failed');
        }

        const folderUrl = buildFolderUrl(creds);
        const propRes = await fetch(folderUrl, {
            method: 'PROPFIND',
            headers: {
                Authorization: basicAuth(creds.username, creds.password),
                Depth: '0',
                'Content-Type': 'application/xml; charset=utf-8',
            },
        }).catch((e) => {
            throw new Error(`Cannot reach WebDAV server: ${e?.message || e}`);
        });

        if (propRes.status === 404) {
            // Try to create the folder.
            const mkcol = await fetch(folderUrl, {
                method: 'MKCOL',
                headers: { Authorization: basicAuth(creds.username, creds.password) },
            });
            if (!mkcol.ok && mkcol.status !== 405 /* method not allowed = already exists */) {
                throw new Error(
                    `WebDAV folder missing and MKCOL failed: ${mkcol.status} ${await mkcol.text().catch(() => '')}`,
                );
            }
        } else if (propRes.status === 401 || propRes.status === 403) {
            throw new Error('WebDAV authentication failed (wrong username/password?)');
        } else if (propRes.status >= 400 && propRes.status !== 405) {
            throw new Error(`WebDAV PROPFIND failed: ${propRes.status}`);
        }

        await storage.setItem(CREDS_KEY, creds);
        await storage.removeItem(DISCONNECTED_KEY);
    }

    async disconnect(): Promise<void> {
        // Keep credentials; just mark disconnected so the config (incl. password)
        // survives for an easy reconnect.
        await storage.setItem(DISCONNECTED_KEY, true);
    }

    async getRemoteInfo(): Promise<RemoteBackupInfo | null> {
        const creds = await this.getCreds();
        if (!creds) return null;
        const url = buildFileUrl(creds);
        const res = await fetch(url, {
            method: 'PROPFIND',
            headers: {
                Authorization: basicAuth(creds.username, creds.password),
                Depth: '0',
                'Content-Type': 'application/xml; charset=utf-8',
            },
        });
        if (res.status === 404) return null;
        if (!res.ok) {
            throw new Error(`WebDAV PROPFIND failed: ${res.status} ${await res.text().catch(() => '')}`);
        }
        // No DOMParser in a service worker — pull the two props out by regex,
        // tolerant of the various DAV namespace prefixes (d:, D:, lp1:, …).
        const xml = await res.text();
        const sizeM = xml.match(/<[^>]*getcontentlength[^>]*>(\d+)<\//i);
        const modM = xml.match(/<[^>]*getlastmodified[^>]*>([^<]+)<\//i);
        const modMs = modM ? Date.parse(modM[1].trim()) : NaN;
        return {
            name: REMOTE_FILE_NAME,
            size: sizeM ? Number(sizeM[1]) : null,
            modifiedTime: Number.isFinite(modMs) ? modMs : null,
        };
    }

    async deleteRemote(): Promise<void> {
        const creds = await this.getCreds();
        if (!creds) return;
        const url = buildFileUrl(creds);
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { Authorization: basicAuth(creds.username, creds.password) },
        });
        // 404 = already gone; treat as success.
        if (!res.ok && res.status !== 404) {
            throw new Error(`WebDAV DELETE failed: ${res.status} ${await res.text().catch(() => '')}`);
        }
    }

    async pull(): Promise<Snapshot | null> {
        const creds = await this.getCreds();
        if (!creds) throw new Error('WebDAV not connected');
        const url = buildFileUrl(creds);
        const res = await fetch(url, {
            method: 'GET',
            headers: { Authorization: basicAuth(creds.username, creds.password) },
        });
        if (res.status === 404) return null;
        if (!res.ok) {
            throw new Error(`WebDAV GET failed: ${res.status} ${await res.text().catch(() => '')}`);
        }
        const parsed = await res.json().catch(() => null);
        if (!isValidSnapshot(parsed)) {
            console.warn(APP_NAME_WITH_SUFFIX, 'WebDAV pull: invalid snapshot envelope');
            return null;
        }
        return parsed;
    }

    async push(snap: Snapshot): Promise<void> {
        const creds = await this.getCreds();
        if (!creds) throw new Error('WebDAV not connected');
        const url = buildFileUrl(creds);
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: basicAuth(creds.username, creds.password),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(snap),
        });
        if (!res.ok) {
            throw new Error(`WebDAV PUT failed: ${res.status} ${await res.text().catch(() => '')}`);
        }
    }
}

export const webdavProvider: SyncProvider = new WebDavProviderImpl();

/**
 * Read the persisted WebDAV credentials, for pre-filling the options config
 * form. Returns null when nothing has been saved yet.
 */
export async function getWebdavConfig(): Promise<WebDavCredentials | null> {
    return storage.getItem<WebDavCredentials>(CREDS_KEY);
}
