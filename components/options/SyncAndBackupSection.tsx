import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SettingRow } from '@/components/options/SettingRow';
import { sendMessageToBackground } from '@/utils/message';
import { DB_ACTION, SYNC_ACTION, SYNC_PROVIDER_ID } from '@/main/constants';

type ActiveId = SYNC_PROVIDER_ID | null;

type StatusInfo = {
    activeId: ActiveId;
    authenticated: boolean;
    description: string | null;
};

export function SyncAndBackupSection() {
    const { t } = useTranslation();

    const [status, setStatus] = useState<StatusInfo>({
        activeId: null,
        authenticated: false,
        description: null,
    });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    // WebDAV form state
    const [webdavOpen, setWebdavOpen] = useState(false);
    const [wdUrl, setWdUrl] = useState('');
    const [wdUser, setWdUser] = useState('');
    const [wdPass, setWdPass] = useState('');
    const [wdPath, setWdPath] = useState('');
    const [wdAllowInsecure, setWdAllowInsecure] = useState(false);

    // Backup state
    const [includeSecrets, setIncludeSecrets] = useState(false);
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const refreshStatus = async () => {
        const s = await sendMessageToBackground({ action: SYNC_ACTION.SYNC_STATUS });
        if (s) setStatus(s);
    };

    useEffect(() => {
        void refreshStatus();
    }, []);

    const onConnectGdrive = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const r = await sendMessageToBackground(
                { action: SYNC_ACTION.AUTH_GDRIVE },
                60_000,
            );
            if (r) await refreshStatus();
            else setMessage(t('syncStatusFailed', 'Sync failed'));
        } finally {
            setBusy(false);
        }
    };

    const onConnectWebdav = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const r = await sendMessageToBackground(
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
            if (r) {
                setWebdavOpen(false);
                setWdPass('');
                await refreshStatus();
            } else {
                setMessage(t('syncStatusFailed', 'Sync failed'));
            }
        } finally {
            setBusy(false);
        }
    };

    const onDisconnect = async () => {
        setBusy(true);
        setMessage(null);
        try {
            await sendMessageToBackground({ action: SYNC_ACTION.DISCONNECT_PROVIDER });
            await refreshStatus();
        } finally {
            setBusy(false);
        }
    };

    const onSyncNow = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const r = await sendMessageToBackground({ action: SYNC_ACTION.SYNC_NOW }, 60_000);
            if (!r) {
                setMessage(t('syncStatusFailed', 'Sync failed'));
                return;
            }
            if (!r.ok) {
                setMessage(r.error || t('syncStatusFailed', 'Sync failed'));
                return;
            }
            if (r.direction === 'upload') setMessage(t('syncStatusUploaded', 'Uploaded to remote'));
            else if (r.direction === 'download') setMessage(t('syncStatusDownloaded', 'Downloaded from remote'));
            else setMessage(t('syncStatusNoop', 'Already up to date'));
        } finally {
            setBusy(false);
        }
    };

    const onExport = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const snap = await sendMessageToBackground({
                action: DB_ACTION.BACKUP_EXPORT,
                data: { includeSecrets },
            });
            if (!snap) {
                setMessage(t('syncStatusFailed', 'Sync failed'));
                return;
            }
            const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `duo-translator-backup-${date}.json`;
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
        setMessage(null);
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const r = await sendMessageToBackground({
                action: DB_ACTION.BACKUP_IMPORT,
                data: { snapshot: parsed, mode: importMode },
            });
            // sendMessageToBackground returns response.data on success — for this
            // action that's `null`. Lacking a tri-state, fall back to refreshing.
            void r;
            setMessage(t('backupImported', 'Backup imported'));
            await refreshStatus();
        } catch (err: any) {
            setMessage(err?.message || t('syncStatusFailed', 'Sync failed'));
        } finally {
            setBusy(false);
        }
    };

    const isGdriveActive = status.activeId === SYNC_PROVIDER_ID.GDRIVE && status.authenticated;
    const isWebdavActive = status.activeId === SYNC_PROVIDER_ID.WEBDAV && status.authenticated;

    return (
        <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
            <SettingRow
                label={t('syncProvider', 'Sync provider')}
                hint={status.description ?? undefined}
                control={
                    <div className="flex items-center gap-2">
                        {(isGdriveActive || isWebdavActive) && (
                            <Button size="sm" onClick={onSyncNow} disabled={busy}>
                                {t('syncNow', 'Sync now')}
                            </Button>
                        )}
                        {status.activeId && (
                            <Button variant="outline" size="sm" onClick={onDisconnect} disabled={busy}>
                                {t('syncDisconnect', 'Disconnect')}
                            </Button>
                        )}
                    </div>
                }
            />

            {/* Google Drive row */}
            <SettingRow
                label={t('syncProviderGoogleDrive', 'Google Drive')}
                hint={isGdriveActive ? t('syncConnected', 'Connected') : t('syncNotConnected', 'Not connected')}
                control={
                    !isGdriveActive ? (
                        <Button variant="outline" size="sm" onClick={onConnectGdrive} disabled={busy}>
                            {t('syncConnect', 'Connect')}
                        </Button>
                    ) : null
                }
            />

            {/* WebDAV row */}
            <SettingRow
                label={t('syncProviderWebdav', 'WebDAV')}
                hint={isWebdavActive ? t('syncConnected', 'Connected') : t('syncNotConnected', 'Not connected')}
                control={
                    !isWebdavActive ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setWebdavOpen((v) => !v)}
                            disabled={busy}
                        >
                            {webdavOpen ? t('collapse', 'Collapse') : t('syncConnect', 'Connect')}
                        </Button>
                    ) : null
                }
            />
            {webdavOpen && !isWebdavActive && (
                <div className="space-y-2 border-t border-line/50 px-4 py-3">
                    <div>
                        <label className="text-[12px] text-ink-soft">
                            {t('webdavServerUrl', 'Server URL')}
                        </label>
                        <Input
                            type="url"
                            value={wdUrl}
                            onChange={(e) => setWdUrl(e.target.value)}
                            placeholder="https://dav.example.com/dav/"
                            className="mt-1"
                        />
                        <div className="mt-1 text-[11px] text-ink-mute">
                            {t('webdavServerUrlHint', '')}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[12px] text-ink-soft">
                                {t('webdavUsername', 'Username')}
                            </label>
                            <Input
                                value={wdUser}
                                onChange={(e) => setWdUser(e.target.value)}
                                autoComplete="username"
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <label className="text-[12px] text-ink-soft">
                                {t('webdavPassword', 'Password')}
                            </label>
                            <Input
                                type="password"
                                value={wdPass}
                                onChange={(e) => setWdPass(e.target.value)}
                                autoComplete="current-password"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[12px] text-ink-soft">
                            {t('webdavPath', 'Path (optional)')}
                        </label>
                        <Input
                            value={wdPath}
                            onChange={(e) => setWdPath(e.target.value)}
                            placeholder="DuoTranslator/"
                            className="mt-1"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-[12px] text-ink-soft">
                        <input
                            type="checkbox"
                            checked={wdAllowInsecure}
                            onChange={(e) => setWdAllowInsecure(e.target.checked)}
                        />
                        {t('webdavAllowInsecure', '')}
                    </label>
                    <div className="pt-1">
                        <Button size="sm" onClick={onConnectWebdav} disabled={busy || !wdUrl || !wdUser}>
                            {t('syncConnect', 'Connect')}
                        </Button>
                    </div>
                </div>
            )}

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
                            {t('backupIncludeSecrets', 'Include AI API keys')}
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
                        <RadioGroup
                            value={importMode}
                            onValueChange={(v: string) =>
                                setImportMode(v === 'replace' ? 'replace' : 'merge')
                            }
                            className="flex flex-col items-end"
                        >
                            <RadioGroupItem
                                value="merge"
                                label={t('backupImportModeMerge', 'Merge')}
                            />
                            <RadioGroupItem
                                value="replace"
                                label={t('backupImportModeReplace', 'Replace')}
                            />
                        </RadioGroup>
                    </div>
                }
            />

            {message && (
                <div className="border-t border-line/50 px-4 py-2 text-[12px] text-ink-soft">
                    {message}
                </div>
            )}
        </div>
    );
}
