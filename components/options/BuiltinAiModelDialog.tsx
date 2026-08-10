import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { CheckCircle2, Download, Loader2, XCircle } from 'lucide-react';
import { ACTION, LANGUAGES, STATUS_SUCCESS } from '@/main/constants';
import type { BuiltinAiDownloadProgress, BuiltinAiPingResponse } from '@/main/builtinAi/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/**
 * Model status + optional pre-download for the on-device translator.
 *
 * Everything here goes through BACKGROUND rather than calling `Translator` in
 * this window, and that is the point: background is where translation actually
 * happens, and the two contexts genuinely differ — a page must have user
 * activation to start a model download, a service worker must not. Asking the
 * page would answer a question nobody has.
 *
 * The download is normally automatic (the first page that needs a pair triggers
 * it). This dialog only exists to see the state and to pre-fetch a pair before
 * you need it.
 */

interface Props {
    open: boolean;
    onClose: () => void;
    /** Current translate target, in config form (e.g. `zh-CN`). */
    targetLang: string;
}

export function BuiltinAiModelDialog({ open, onClose, targetLang }: Props) {
    const { t } = useTranslation();

    const [sourceLang, setSourceLang] = useState('en');
    /**
     * Which target to inspect/download — a DRAFT, not a setting.
     *
     * Seeded from the real `targetLanguage` because that is the pair you almost
     * always want, but changing it here must never write config back: this
     * dialog is a viewfinder onto the model cache ("is de → ja downloaded?"),
     * and silently repointing the user's translation target from a status panel
     * would be a nasty surprise.
     */
    const [targetDraft, setTargetDraft] = useState(targetLang);
    const [check, setCheck] = useState<BuiltinAiPingResponse | null>(null);
    const [checkError, setCheckError] = useState('');
    const [progress, setProgress] = useState<BuiltinAiDownloadProgress | null>(null);
    const [busy, setBusy] = useState(false);

    const samePair = sourceLang === targetDraft;

    const refresh = useCallback(async () => {
        setCheckError('');
        try {
            const resp: any = await browser.runtime.sendMessage({
                action: ACTION.BUILTIN_AI_SELF_CHECK,
                data: samePair ? {} : { sourceLang, targetLang: targetDraft },
            });
            if (resp?.status === STATUS_SUCCESS) setCheck(resp.data as BuiltinAiPingResponse);
            else setCheckError(resp?.data?.message || 'self-check failed');
        } catch (e: any) {
            setCheckError(e?.message || String(e));
        }
    }, [sourceLang, targetDraft, samePair]);

    // Re-seed from the live setting every time the dialog opens, so it always
    // starts on the pair that actually matters even if the target changed
    // since last time.
    useEffect(() => {
        if (!open) return;
        setTargetDraft(targetLang);
        setProgress(null);
    }, [open, targetLang]);

    // Re-check whenever either side of the pair changes (including the re-seed
    // above), not just on open.
    useEffect(() => {
        if (!open) return;
        setCheck(null);
        void refresh();
    }, [open, refresh]);

    // Background broadcasts progress to extension pages too, so the bar here is
    // the same one the page sees — one source of truth, no polling.
    useEffect(() => {
        if (!open) return;
        const onMessage = (message: any) => {
            if (message?.action !== ACTION.BUILTIN_AI_DOWNLOAD_PROGRESS) return;
            const p = message.data as BuiltinAiDownloadProgress;
            // A cancel leaves nothing to show: the panel goes back to its
            // status line, which now reads "not downloaded" — the truth.
            setProgress(p.cancelled ? null : p);
            if (p.done) void refresh();
        };
        browser.runtime.onMessage.addListener(onMessage);
        return () => browser.runtime.onMessage.removeListener(onMessage);
    }, [open, refresh]);

    const startDownload = async () => {
        setBusy(true);
        try {
            await browser.runtime.sendMessage({
                action: ACTION.BUILTIN_AI_ENSURE_MODEL,
                data: { sourceLang, targetLang: targetDraft },
            });
        } finally {
            setBusy(false);
            void refresh();
        }
    };

    /**
     * Stop whatever is downloading — which is not necessarily this dialog's
     * pair, since a page can start one too and this panel reports on it. Cancel
     * what is actually running, named by the same payload that labels the bar.
     */
    const cancelDownload = () => {
        const target = progress;
        setProgress(null);
        setBusy(false);
        void browser.runtime.sendMessage({
            action: ACTION.BUILTIN_AI_CANCEL_DOWNLOAD,
            data: target
                ? { kind: target.kind, sourceLang: target.sourceLang, targetLang: target.targetLang }
                // No broadcast has arrived yet (create() has not reported its
                // first byte), so the only pair we know is the one we asked for.
                : { kind: 'translator', sourceLang, targetLang: targetDraft },
        });
    };

    const statusLabel = (a: string | null | undefined): string => {
        switch (a) {
            case 'available': return t('builtinAiStatusAvailable', 'Model ready');
            case 'downloadable': return t('builtinAiStatusDownloadable', 'Not downloaded yet');
            case 'downloading': return t('builtinAiStatusDownloading', 'Downloading…');
            case 'unavailable': return t('builtinAiStatusUnavailable', 'This language pair is not supported');
            default: return '—';
        }
    };

    const downloading = busy || (!!progress && !progress.done);
    const canDownload = !!check?.supported && !samePair && check.translator === 'downloadable' && !downloading;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            widthClass="w-[520px]"
            title={t('builtinAiModelTitle', 'Built-in AI translation model')}
            error={checkError || progress?.error || undefined}
            footer={
                <Button variant="ghost" size="sm" onClick={onClose}>
                    {t('aiClose', 'Close')}
                </Button>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-[12px] text-ink-soft">
                    {t(
                        'builtinAiIntro',
                        'Translates entirely on your device — no network request, no API key, works offline. Each language pair downloads its model once and is then shared by the whole browser.',
                    )}
                </p>

                {check && !check.supported ? (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-600">
                        {t('builtinAiUnsupported', 'This browser has no built-in AI translator. Chrome 138+ or Edge 148+ on desktop is required.')}
                    </div>
                ) : (
                    <>
                        <p className="text-[11.5px] text-ink-mute">
                            {t('builtinAiAutoDownloadHint', 'Models download automatically the first time a page needs them — you only need this if you want a language ready in advance.')}
                        </p>

                        {/* Language pair */}
                        <div className="flex items-end gap-2">
                            <div className="flex flex-1 flex-col gap-1">
                                <label className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                                    {t('sourceLanguage', 'Source language')}
                                </label>
                                <select
                                    value={sourceLang}
                                    onChange={(e) => setSourceLang(e.target.value)}
                                    className="h-8 rounded border border-line bg-surface px-2 text-[12.5px] text-ink"
                                >
                                    {LANGUAGES.map((l) => (
                                        <option key={l.value} value={l.value}>
                                            {t(l.title, l.name)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="pb-2 text-ink-mute">→</div>
                            <div className="flex flex-1 flex-col gap-1">
                                <label className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                                    {t('targetLanguage', 'Target language')}
                                </label>
                                <select
                                    value={targetDraft}
                                    onChange={(e) => setTargetDraft(e.target.value)}
                                    className="h-8 rounded border border-line bg-surface px-2 text-[12.5px] text-ink"
                                >
                                    {LANGUAGES.map((l) => (
                                        <option key={l.value} value={l.value}>
                                            {t(l.title, l.name)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* This control looks exactly like a setting, so say
                            plainly that it is not one. */}
                        {targetDraft !== targetLang && (
                            <p className="text-[11px] text-ink-mute">
                                {t('builtinAiTargetDraftHint', 'Preview only — this does not change your translation target language.')}
                            </p>
                        )}

                        {/* Status + download */}
                        <div className="flex items-center justify-between gap-3 rounded border border-line px-2.5 py-2">
                            <div className="text-[12.5px] text-ink-soft">
                                {samePair
                                    ? t('builtinAiSamePair', 'Source and target are the same language — nothing to translate.')
                                    : statusLabel(check?.translator)}
                            </div>
                            {downloading ? (
                                <div className="flex shrink-0 items-center gap-2 text-[12px] text-ink-soft">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                                    {progress?.percent ?? 0}%
                                    <Button variant="outline" size="sm" onClick={cancelDownload}>
                                        {t('builtinAiCancelDownload', 'Stop')}
                                    </Button>
                                </div>
                            ) : (
                                <Button size="sm" onClick={() => void startDownload()} disabled={!canDownload}>
                                    <Download className="h-3 w-3" strokeWidth={2} />
                                    {t('builtinAiDownload', 'Download model')}
                                </Button>
                            )}
                        </div>

                        {downloading && (
                            <div className="flex flex-col gap-1">
                                {/* Name the model. A page can start a download
                                    too, so what is running is not necessarily
                                    the pair selected above — and a bare
                                    percentage of an unnamed multi-megabyte
                                    download is not something anyone can judge. */}
                                <div className="text-[11.5px] text-ink-mute">
                                    {t('builtinAiDownloading', 'Downloading')}{' '}
                                    {progress
                                        ? progress.kind === 'detector'
                                            ? t('builtinAiDetectorStatus', 'Language detector')
                                            : `${progress.sourceLang} → ${progress.targetLang}`
                                        : `${sourceLang} → ${targetDraft}`}
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                                    <div
                                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                                        style={{ width: `${progress?.percent ?? 0}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Runtime self-check — reports what BACKGROUND sees. */}
                        <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[11.5px] text-ink-mute">
                            {checkError ? (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2} />
                            ) : check ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} />
                            ) : (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
                            )}
                            <span>
                                {checkError
                                    ? `${t('builtinAiSelfCheckFail', 'Translation runtime unreachable')}: ${checkError.slice(0, 160)}`
                                    : check
                                        ? `${t('builtinAiSelfCheckOk', 'Translation runtime ready')} · ${t('builtinAiDetectorStatus', 'Language detector')}: ${statusLabel(check.detector)}`
                                        : t('builtinAiSelfCheckPending', 'Checking translation runtime…')}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </Dialog>
    );
}
