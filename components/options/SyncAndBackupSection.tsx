import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { SettingRow } from '@/components/options/SettingRow';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { browser } from 'wxt/browser';
import { sendMessageToBackground, sendMessageToBackgroundOrThrow } from '@/utils/message';
import { getConfig, setConfig } from '@/utils/db';
import { ACTION, APP_NAME, APP_NAME_KEBAB_CASE, APP_NAME_PASCAL_CASE, CONFIG_KEY, DB_ACTION, IS_PROD, IS_SAFARI, SYNC_ACTION, SYNC_PROVIDER_ID } from '@/main/constants';
import { hostPermissionPattern } from '@/utils/url';

const SYNC_INTERVAL_OPTIONS = IS_PROD ? [5, 10, 15, 20, 30, 45, 60] : [0.1, 0.5, 1, 3, 5, 10, 15, 20, 30, 45, 60];

type ProviderState = {
    authenticated: boolean;
    description: string | null;
    /** Connected, but this device can no longer renew the credentials silently. */
    needsReauth: boolean;
};

type StatusInfo = Record<SYNC_PROVIDER_ID, ProviderState>;

type RemoteBackupInfo = {
    name: string;
    size: number | null;
    modifiedTime: number | null;
};

const EMPTY_PROVIDER: ProviderState = { authenticated: false, description: null, needsReauth: false };

function formatSize(bytes: number | null): string {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleString();
}

export function SyncAndBackupSection() {
    const { t } = useTranslation();
    const { show: toast, viewport: toastViewport } = useToast();

    const [status, setStatus] = useState<StatusInfo>({
        [SYNC_PROVIDER_ID.GDRIVE]: EMPTY_PROVIDER,
        [SYNC_PROVIDER_ID.WEBDAV]: EMPTY_PROVIDER,
    });
    const [busy, setBusy] = useState(false);

    // A connect flow is running in the background. Not `busy`: connecting no
    // longer blocks this section at all, because the flow can outlive any
    // reasonable timeout (see startGoogleDriveAuth).
    const [authInProgress, setAuthInProgress] = useState(false);
    // Set on the click, cleared once the outcome has been reported. Distinct
    // from `authInProgress`, which is the background's view — it can stay true
    // forever when the browser never answers, and we must not toast about a
    // flow this page did not start.
    const [watchingAuth, setWatchingAuth] = useState(false);

    // The one sync target. Everything below renders for this provider only; the
    // other keeps its credentials and simply isn't synced to.
    // Seeded from the build target rather than a fixed default: on Safari the
    // real value is always WebDAV, and defaulting to Drive would flash its row
    // for one render before the status arrives.
    const [activeId, setActiveId] = useState<SYNC_PROVIDER_ID>(
        IS_SAFARI ? SYNC_PROVIDER_ID.WEBDAV : SYNC_PROVIDER_ID.GDRIVE,
    );

    // Chrome-only: use identity.getAuthToken rather than the web sign-in flow.
    // Device-local (not a CONFIG_KEY, so it never enters the sync snapshot) —
    // see googleDriveProvider.ts. Default on; the real value arrives with the
    // first status refresh.
    const [gdriveBrowserAuth, setGdriveBrowserAuth] = useState(true);


    // Whether the Chrome path is usable at all here — decided by the provider
    // (`canUseBrowserAuth`), never re-derived locally. If this view disagreed
    // with the provider, hiding the checkbox would strand the user on a connect
    // error telling them to untick something they cannot see.
    const [canUseBrowserAuth, setCanUseBrowserAuth] = useState(false);

    // WebDAV config dialog + form state
    const [configOpen, setConfigOpen] = useState(false);
    const [wdUrl, setWdUrl] = useState('');
    const [wdUser, setWdUser] = useState('');
    const [wdPass, setWdPass] = useState('');
    const [wdPath, setWdPath] = useState(`${APP_NAME_PASCAL_CASE}/`);
    const [wdAllowInsecure, setWdAllowInsecure] = useState(false);
    const [showWdPass, setShowWdPass] = useState(false);

    // "Manage synced file" dialog — which provider's panel is open (null = closed).
    const [manageId, setManageId] = useState<SYNC_PROVIDER_ID | null>(null);
    const [remoteInfo, setRemoteInfo] = useState<RemoteBackupInfo | null>(null);
    const [remoteLoading, setRemoteLoading] = useState(false);

    // Whether cloud sync includes API keys. Off by default. Separate from the
    // per-export "include keys" checkbox below.
    const [syncSecrets, setSyncSecrets] = useState(false);

    // Auto-sync (off by default) + periodic interval in minutes.
    const [autoSync, setAutoSync] = useState(false);
    const [intervalMinutes, setIntervalMinutes] = useState(15);

    // Gate the initial render until config is hydrated, so switches render with
    // their real value from the first paint instead of animating from default.
    const [ready, setReady] = useState(false);

    // Backup state — import always merges (file values win, local-only kept).
    const [includeSecrets, setIncludeSecrets] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fail = (err?: any) => toast(err?.message || err || t('syncStatusFailed', 'Sync failed'), 'error');

    const refreshStatus = async () => {
        const s = await sendMessageToBackground({ action: SYNC_ACTION.SYNC_STATUS });
        if (s?.providers) {
            setStatus({
                [SYNC_PROVIDER_ID.GDRIVE]: s.providers[SYNC_PROVIDER_ID.GDRIVE] ?? EMPTY_PROVIDER,
                [SYNC_PROVIDER_ID.WEBDAV]: s.providers[SYNC_PROVIDER_ID.WEBDAV] ?? EMPTY_PROVIDER,
            });
            if (typeof s.gdriveBrowserAuth === 'boolean') setGdriveBrowserAuth(s.gdriveBrowserAuth);
            setCanUseBrowserAuth(!!s.gdriveCanUseBrowserAuth);
            setAuthInProgress(!!s.gdriveAuth?.inProgress);
            if (s.activeProvider) setActiveId(s.activeProvider);
        }
        // Returned so the auth watcher can read the same payload it just applied
        // instead of issuing a second round-trip.
        return s;
    };

    const onChangeMethod = async (value: string) => {
        const id = value as SYNC_PROVIDER_ID;
        setActiveId(id);
        await sendMessageToBackground({ action: SYNC_ACTION.ACTIVE_PROVIDER_SET, data: { id } });
        // The row about to render belongs to the other provider — pull its state
        // rather than showing the previous one's for a frame.
        await refreshStatus();
    };

    const onToggleGdriveBrowserAuth = async (next: boolean) => {
        setGdriveBrowserAuth(next);
        await sendMessageToBackground({
            action: SYNC_ACTION.GDRIVE_BROWSER_AUTH_SET,
            data: { value: next },
        });
    };

    // Pull the persisted WebDAV credentials into the form. The credentials
    // survive disconnect, so reopening the config dialog always shows them
    // (incl. the password).
    const loadWebdavConfig = async () => {
        const cfg = await sendMessageToBackground({ action: SYNC_ACTION.WEBDAV_CONFIG_GET });
        if (cfg) {
            setWdUrl(cfg.baseUrl ?? '');
            setWdUser(cfg.username ?? '');
            setWdPass(cfg.password ?? '');
            setWdPath(cfg.basePath ?? `${APP_NAME}/`);
            setWdAllowInsecure(!!cfg.allowInsecure);
        }
    };

    useEffect(() => {
        void refreshStatus();
        void loadWebdavConfig();
        (async () => {
            const [secrets, auto, interval] = await Promise.all([
                getConfig(CONFIG_KEY.SYNC_INCLUDE_SECRETS),
                getConfig(CONFIG_KEY.AUTO_SYNC_CONFIG_SWITCH),
                getConfig(CONFIG_KEY.SYNC_INTERVAL_MINUTES),
            ]);
            setSyncSecrets(!!secrets);
            setAutoSync(!!auto);
            const n = Number(interval);
            if (Number.isFinite(n) && n > 0) setIntervalMinutes(n);
            setReady(true);
        })();
    }, []);

    // Watch the background's auth state instead of awaiting the flow: it may
    // never end (closing Chrome's sign-in tab produces no token AND no error).
    // Polling is bounded by `watchingAuth`, which only this page's own click
    // sets, and by the flow ending. Returning to the tab checks immediately —
    // that is when the user has usually just finished or abandoned it.
    useEffect(() => {
        if (!watchingAuth) return;
        let stopped = false;

        const check = async () => {
            if (stopped || document.visibilityState === 'hidden') return;
            const s = await refreshStatus();
            if (stopped || !s) return;
            const auth = s.gdriveAuth;
            if (auth?.inProgress) return; // still out there; keep waiting
            stopped = true;
            setWatchingAuth(false);
            if (auth?.lastError) {
                fail(new Error(auth.lastError));
                void sendMessageToBackground({ action: SYNC_ACTION.GDRIVE_AUTH_ERROR_CLEAR });
            } else if (s.providers?.[SYNC_PROVIDER_ID.GDRIVE]?.authenticated) {
                toast(t('syncConnected', 'Connected'));
            }
        };

        const timer = window.setInterval(check, 2000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
        return () => {
            stopped = true;
            window.clearInterval(timer);
            window.removeEventListener('focus', check);
            document.removeEventListener('visibilitychange', check);
        };
    }, [watchingAuth]);

    const onToggleSyncSecrets = async (next: boolean) => {
        setSyncSecrets(next);
        await setConfig(CONFIG_KEY.SYNC_INCLUDE_SECRETS, next);
    };

    const onToggleAutoSync = async (next: boolean) => {
        setAutoSync(next);
        await setConfig(CONFIG_KEY.AUTO_SYNC_CONFIG_SWITCH, next);
        await sendMessageToBackground({ action: SYNC_ACTION.AUTO_SYNC_CONFIG_CHANGED });
    };

    const onChangeInterval = async (value: string) => {
        const n = Number(value);
        setIntervalMinutes(n);
        await setConfig(CONFIG_KEY.SYNC_INTERVAL_MINUTES, n);
        await sendMessageToBackground({ action: SYNC_ACTION.AUTO_SYNC_CONFIG_CHANGED });
    };

    const onConnectGdrive = async () => {
        setAuthInProgress(true);
        setWatchingAuth(true);
        try {
            const r = await sendMessageToBackgroundOrThrow({ action: SYNC_ACTION.AUTH_GDRIVE }, 10_000);
            if (r?.alreadyRunning) {
                // Chrome queues concurrent getAuthToken calls for the same
                // scopes, so a second flow would open no UI and wait behind the
                // first. Say that, rather than appearing to do nothing.
                toast(t('syncAuthAlreadyRunning', 'A sign-in is already open — finish it in that tab.'), 'error');
            }
        } catch (err: any) {
            setWatchingAuth(false);
            setAuthInProgress(false);
            fail(err);
        }
    };

    // Open the WebDAV config dialog, (re)loading the saved credentials first so
    // the form — password included — is always populated.
    const openConfig = async () => {
        await loadWebdavConfig();
        setShowWdPass(false);
        setConfigOpen(true);
    };

    const onConnectWebdav = async () => {
        // Firefox only allows permissions.request() from within a user-input
        // handler, so request the host permission here (synchronously in the
        // click, before any other await) instead of in the background — the
        // background then just verifies it via permissions.contains.
        // No port in the pattern — see hostPermissionPattern. The background's
        // permissions.contains uses the same builder; the two must agree.
        const origin = hostPermissionPattern(wdUrl.trim());
        if (!origin) {
            fail(new Error(t('invalidDomain', 'Invalid website.')));
            return;
        }
        try {
            const granted = await browser.permissions.request({ origins: [origin] });
            if (!granted) {
                fail(new Error(t('hostPermissionDenied', 'Host permission was denied')));
                return;
            }
        } catch (err: any) {
            fail(err);
            return;
        }

        setBusy(true);
        try {
            await sendMessageToBackgroundOrThrow(
                {
                    action: SYNC_ACTION.AUTH_WEBDAV,
                    data: {
                        baseUrl: wdUrl.trim(),
                        username: wdUser,
                        password: wdPass,
                        basePath: wdPath.trim() || undefined,
                        allowInsecure: wdAllowInsecure,
                    },
                },
                30_000,
            );
            setConfigOpen(false);
            await refreshStatus();
            toast(t('syncConnected', 'Connected'));
        } catch (err: any) {
            // Keep the dialog open on failure so the user can fix the input.
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const onDisconnect = async (id: SYNC_PROVIDER_ID) => {
        setBusy(true);
        try {
            await sendMessageToBackground({ action: SYNC_ACTION.DISCONNECT_PROVIDER, data: { id } });
            if (manageId === id) {
                setManageId(null);
                setRemoteInfo(null);
            }
            await refreshStatus();
        } finally {
            setBusy(false);
        }
    };

    const onSyncNow = async (id: SYNC_PROVIDER_ID) => {
        setBusy(true);
        try {
            const r = await sendMessageToBackground({ action: SYNC_ACTION.SYNC_NOW, data: { id } }, 60_000);
            if (!r) return fail();
            if (!r.ok) {
                // A sync can fail *because* the credentials went stale, which is
                // a state change: without this the row keeps showing the account
                // as healthy while the toast says otherwise.
                await refreshStatus();
                return toast(r.error || t('syncStatusFailed', 'Sync failed'), 'error');
            }
            if (r.direction === 'upload') toast(t('syncStatusUploaded', 'Uploaded to remote'));
            else if (r.direction === 'download') toast(t('syncStatusDownloaded', 'Downloaded from remote'));
            else if (r.direction === 'merge') toast(t('syncStatusMerged', 'Merged with remote'));
            else toast(t('syncStatusNoop', 'Already up to date'));
        } finally {
            setBusy(false);
        }
    };

    const loadRemoteInfo = async (id: SYNC_PROVIDER_ID) => {
        setRemoteLoading(true);
        try {
            const info = await sendMessageToBackground(
                { action: SYNC_ACTION.REMOTE_INFO, data: { id } },
                30_000,
            );
            setRemoteInfo(info ?? null);
        } catch (err: any) {
            fail(err);
        } finally {
            setRemoteLoading(false);
        }
    };

    const openManage = async (id: SYNC_PROVIDER_ID) => {
        setManageId(id);
        setRemoteInfo(null);
        await loadRemoteInfo(id);
    };

    const onDownloadRemote = async (id: SYNC_PROVIDER_ID) => {
        setBusy(true);
        try {
            const snap = await sendMessageToBackground(
                { action: SYNC_ACTION.REMOTE_DOWNLOAD, data: { id } },
                30_000,
            );
            if (!snap) {
                toast(t('backupRemoteEmpty', 'No remote backup yet'), 'error');
                return;
            }
            const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = remoteInfo?.name || `${APP_NAME_KEBAB_CASE}-backup-${date}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: any) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const onDeleteRemote = async (id: SYNC_PROVIDER_ID) => {
        if (!window.confirm(t('backupRemoteDeleteConfirm', 'Delete the remote backup? This cannot be undone.'))) {
            return;
        }
        setBusy(true);
        try {
            await sendMessageToBackground({ action: SYNC_ACTION.REMOTE_DELETE, data: { id } }, 30_000);
            setRemoteInfo(null);
            toast(t('backupRemoteDeleted', 'Remote backup deleted'));
        } catch (err: any) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const onExport = async () => {
        setBusy(true);
        try {
            const snap = await sendMessageToBackground({
                action: DB_ACTION.BACKUP_EXPORT,
                data: { includeSecrets },
            });
            if (!snap) return fail();
            const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `${APP_NAME_KEBAB_CASE}-backup-${date}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } finally {
            setBusy(false);
        }
    };

    const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            await sendMessageToBackground({
                action: DB_ACTION.BACKUP_IMPORT,
                data: { snapshot: parsed },
            });
            toast(t('backupImported', 'Backup imported'));
            await refreshStatus();
        } catch (err: any) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const gdrive = status[SYNC_PROVIDER_ID.GDRIVE];
    const webdav = status[SYNC_PROVIDER_ID.WEBDAV];

    // Plain-HTTP servers require explicit opt-in; block connect/save until the
    // user acknowledges the risk (the checkbox only shows for http:// URLs).
    const isInsecureUrl = /^http:\/\//i.test(wdUrl.trim());
    const webdavSubmitDisabled = busy || !wdUrl || !wdUser || (isInsecureUrl && !wdAllowInsecure);

    // Body of the "manage synced file" dialog, shared across providers.
    const renderManageBody = (id: SYNC_PROVIDER_ID) => {
        if (remoteLoading) {
            return <div className="text-[13px] text-ink-soft">{t('loading', 'Loading…')}</div>;
        }
        if (!remoteInfo) {
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-ink-soft">{t('backupRemoteEmpty', 'No remote backup yet')}</span>
                    <Button variant="ghost" size="sm" onClick={() => loadRemoteInfo(id)} disabled={busy || remoteLoading}>
                        {t('refresh', 'Refresh')}
                    </Button>
                </div>
            );
        }
        return (
            <div className="space-y-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                    <dt className="text-ink-mute">{t('backupRemoteName', 'File name')}</dt>
                    <dd className="text-ink break-all">{remoteInfo.name}</dd>
                    <dt className="text-ink-mute">{t('backupRemoteModified', 'Last backup')}</dt>
                    <dd className="text-ink">{formatTime(remoteInfo.modifiedTime)}</dd>
                    <dt className="text-ink-mute">{t('backupRemoteSize', 'Size')}</dt>
                    <dd className="text-ink">{formatSize(remoteInfo.size)}</dd>
                </dl>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => onDownloadRemote(id)} disabled={busy}>
                        {t('backupRemoteDownload', 'Download')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onDeleteRemote(id)} disabled={busy}>
                        {t('backupRemoteDelete', 'Delete')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => loadRemoteInfo(id)} disabled={busy || remoteLoading}>
                        {t('refresh', 'Refresh')}
                    </Button>
                </div>
            </div>
        );
    };

    if (!ready) {
        return <div className="h-60 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
    }

    return (
        <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
            {/* Sync method — the single target. Two remotes converge fine under
                the per-key CRDT, but then "which one restores me?" has no
                answer, and that is the question this setting exists to answer.
                Switching does NOT drop the other's credentials, so coming back
                is one click.

                The guard covers the SELECTOR ONLY — the provider row below must
                keep rendering, or Safari loses WebDAV too (it did once). Safari
                has no extension identity API, so Google Drive has no credential
                path there at all (see IS_SAFARI) and WebDAV is the only target;
                a selector with one option is a question with no answer. */}
            {!IS_SAFARI && (
                <SettingRow
                    label={t('syncMethod', 'Sync method')}
                    // hint={t('syncMethodHint', 'This device only — the choice itself is not synced.')}
                    control={
                        <Select value={activeId} onValueChange={onChangeMethod}>
                            <SelectTrigger className="min-w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={SYNC_PROVIDER_ID.GDRIVE}>
                                    {t('syncProviderGoogleDrive', 'Google Drive')}
                                </SelectItem>
                                <SelectItem value={SYNC_PROVIDER_ID.WEBDAV}>
                                    {t('syncProviderWebdav', 'WebDAV')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    }
                />
            )}

            {activeId === SYNC_PROVIDER_ID.GDRIVE ? (
                <>
                    <SettingRow
                        label={t('syncProviderGoogleDrive', 'Google Drive')}
                        hint={
                            gdrive.authenticated
                                ? gdrive.needsReauth
                                    // Credentials are still on file but can't be
                                    // renewed without the user. Saying "Connected"
                                    // here is how sync silently stops for weeks
                                    // unnoticed.
                                    ? t('syncNeedsReauth', 'Needs reconnect — sign in again to resume syncing')
                                    : gdrive.description ?? t('syncConnected', 'Connected')
                                : t('syncNotConnected', 'Not connected')
                        }
                        control={
                            gdrive.authenticated ? (
                                <div className="flex items-center gap-2">
                                    {gdrive.needsReauth ? (
                                        <Button
                                            size="sm"
                                            onClick={() => onConnectGdrive()}
                                            disabled={busy || authInProgress}
                                        >
                                            {authInProgress
                                                ? t('syncAuthorizing', 'Authorizing…')
                                                : t('syncReconnect', 'Reconnect')}
                                        </Button>
                                    ) : (
                                        <Button size="sm" onClick={() => onSyncNow(SYNC_PROVIDER_ID.GDRIVE)} disabled={busy}>
                                            {t('syncNow', 'Sync now')}
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openManage(SYNC_PROVIDER_ID.GDRIVE)}
                                        disabled={busy}
                                    >
                                        {t('manageSyncedFile', 'Manage synced file')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onDisconnect(SYNC_PROVIDER_ID.GDRIVE)}
                                        disabled={busy}
                                    >
                                        {t('syncDisconnect', 'Disconnect')}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onConnectGdrive()}
                                    disabled={busy || authInProgress}
                                >
                                    {authInProgress
                                        ? t('syncAuthorizing', 'Authorizing…')
                                        : t('syncConnect', 'Connect')}
                                </Button>
                            )
                        }
                    />

                    {/* Chrome build only (see canUseBrowserAuth): everywhere
                        else the Chrome path cannot work, and offering a choice
                        that always fails is worse than offering none. Shown
                        while disconnected too — it decides which flow the
                        Connect button will take. */}
                    {canUseBrowserAuth && (
                        <SettingRow
                            label={t('syncGdriveBrowserAuth', 'Authorize through Chrome')}
                            hint={t(
                                'syncGdriveBrowserAuthHint',
                                'Recommended. Requires the account you want to sync with to be signed in to Chrome. Unchecked uses web sign-in instead, which has no such requirement.',
                            )}
                            control={
                                // Locked while connected. The setting only takes
                                // effect at connect time, so letting it be
                                // toggled here would leave the box saying one
                                // thing and the live connection being another —
                                // with no way to tell, since the two paths look
                                // identical until one of them expires.
                                gdrive.authenticated ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            {/* The span is the trigger, not the
                                                input: a disabled control fires
                                                no pointer events, so a tooltip
                                                bound to it never opens. */}
                                            <span className="inline-flex">
                                                <input
                                                    type="checkbox"
                                                    checked={gdriveBrowserAuth}
                                                    disabled
                                                    readOnly
                                                />
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('syncGdriveBrowserAuthLocked', 'Disconnect Google Drive first')}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <input
                                        type="checkbox"
                                        checked={gdriveBrowserAuth}
                                        onChange={(e) => onToggleGdriveBrowserAuth(e.target.checked)}
                                    />
                                )
                            }
                        />
                    )}
                </>
            ) : (
                <SettingRow
                    label={t('syncProviderWebdav', 'WebDAV')}
                    hint={
                        webdav.authenticated
                            ? webdav.description ?? t('syncConnected', 'Connected')
                            : t('syncNotConnected', 'Not connected')
                    }
                    control={
                        webdav.authenticated ? (
                            <div className="flex items-center gap-2">
                                <Button size="sm" onClick={() => onSyncNow(SYNC_PROVIDER_ID.WEBDAV)} disabled={busy}>
                                    {t('syncNow', 'Sync now')}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openManage(SYNC_PROVIDER_ID.WEBDAV)}
                                    disabled={busy}
                                >
                                    {t('manageSyncedFile', 'Manage synced file')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={openConfig} disabled={busy}>
                                    {t('webdavConfigure', 'Configure')}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onDisconnect(SYNC_PROVIDER_ID.WEBDAV)}
                                    disabled={busy}
                                >
                                    {t('syncDisconnect', 'Disconnect')}
                                </Button>
                            </div>
                        ) : (
                            <Button variant="outline" size="sm" onClick={openConfig} disabled={busy}>
                                {t('webdavConfigure', 'Configure')}
                            </Button>
                        )
                    }
                />
            )}

            {/* Auto sync */}
            <SettingRow
                label={t('syncAuto', 'Auto sync')}
                hint={t('syncAutoHint', 'Sync on startup, ~30s after changes, and periodically. Off by default.')}
                control={<Switch checked={autoSync} onCheckedChange={onToggleAutoSync} />}
            />
            {autoSync && (
                <SettingRow
                    label={t('syncInterval', 'Sync interval')}
                    control={
                        <Select value={String(intervalMinutes)} onValueChange={onChangeInterval}>
                            <SelectTrigger className="min-w-[120px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SYNC_INTERVAL_OPTIONS.map((m) => (
                                    <SelectItem key={m} value={String(m)}>
                                        {t('syncIntervalMinutes', '{{count}} min', { count: m })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    }
                />
            )}

            {/* Sync options */}
            <SettingRow
                label={t('syncIncludeSecrets', 'Sync API keys')}
                hint={t('syncIncludeSecretsHint', 'Include AI provider keys and the DeepL key in the synced data. Off by default.')}
                control={
                    <label className="flex items-center gap-2 text-[12px] text-ink-soft">
                        <input
                            type="checkbox"
                            checked={syncSecrets}
                            onChange={(e) => onToggleSyncSecrets(e.target.checked)}
                        />
                    </label>
                }
            />

            {/* Backup */}
            <SettingRow
                label={t('backup', 'Backup')}
                control={
                    <div className="flex flex-col items-end gap-2">
                        <label className="flex items-center gap-2 text-[12px] text-ink-soft">
                            <input
                                type="checkbox"
                                checked={includeSecrets}
                                onChange={(e) => setIncludeSecrets(e.target.checked)}
                            />
                            {t('backupIncludeSecrets', 'Include API keys')}
                        </label>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
                                {t('backupExport', 'Export JSON')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={busy}
                            >
                                {t('backupImport', 'Import JSON')}
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,.json"
                                onChange={onImportFile}
                                className="hidden"
                            />
                        </div>
                    </div>
                }
            />

            {/* WebDAV config dialog */}
            <Dialog
                open={configOpen}
                onClose={() => setConfigOpen(false)}
                title={`WebDAV · ${t('webdavConfigure', 'Configure')}`}
                footer={
                    <>
                        <Button variant="outline" size="sm" onClick={() => setConfigOpen(false)} disabled={busy}>
                            {t('cancel', 'Cancel')}
                        </Button>
                        <Button size="sm" onClick={onConnectWebdav} disabled={webdavSubmitDisabled}>
                            {webdav.authenticated ? t('save', 'Save') : t('syncConnect', 'Connect')}
                        </Button>
                    </>
                }
            >
                <div className="space-y-3">
                    <div>
                        <label className="text-[12px] text-ink-soft">{t('webdavServerUrl', 'Server URL')}</label>
                        <Input
                            type="url"
                            value={wdUrl}
                            onChange={(e) => setWdUrl(e.target.value)}
                            placeholder="https://dav.example.com/dav/"
                            className="mt-1"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[12px] text-ink-soft">{t('webdavUsername', 'Username')}</label>
                            <Input
                                value={wdUser}
                                onChange={(e) => setWdUser(e.target.value)}
                                autoComplete="username"
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <label className="text-[12px] text-ink-soft">{t('webdavPassword', 'Password')}</label>
                            <div className="relative mt-1">
                                <Input
                                    type={showWdPass ? 'text' : 'password'}
                                    value={wdPass}
                                    onChange={(e) => setWdPass(e.target.value)}
                                    autoComplete="current-password"
                                    className="pr-9"
                                />
                                <button
                                    type="button"
                                    aria-label={showWdPass ? t('hide', 'Hide') : t('show', 'Show')}
                                    onClick={() => setShowWdPass((v) => !v)}
                                    className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-mute hover:bg-line/60 hover:text-ink"
                                >
                                    {showWdPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="text-[12px] text-ink-soft">{t('webdavPath', 'Path (optional)')}</label>
                        <Input value={wdPath} onChange={(e) => setWdPath(e.target.value)} className="mt-1" />
                    </div>
                    {/* Plain-HTTP opt-in only matters for http:// servers. */}
                    {/^http:\/\//i.test(wdUrl.trim()) && (
                        <label className="flex items-center gap-2 text-[12px] text-ink-soft">
                            <input
                                type="checkbox"
                                checked={wdAllowInsecure}
                                onChange={(e) => setWdAllowInsecure(e.target.checked)}
                            />
                            {t('webdavAllowInsecure', '')}
                        </label>
                    )}
                </div>
            </Dialog>

            {/* Manage synced file dialog */}
            <Dialog
                open={manageId !== null}
                onClose={() => setManageId(null)}
                title={t('manageSyncedFile', 'Manage synced file')}
            >
                {manageId !== null && renderManageBody(manageId)}
            </Dialog>

            {toastViewport}
        </div>
    );
}
