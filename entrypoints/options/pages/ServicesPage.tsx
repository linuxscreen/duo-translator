import { Pencil, Loader2, FlaskConical } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ACTION, CONFIG_KEY, STATUS_SUCCESS, TRANSLATE_SERVICE, TRANSLATE_SERVICES } from '@/main/constants';
import { getConfig, setConfig } from '@/utils/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog } from '@/components/ui/dialog';
import { TestResultBadge } from '@/components/ui/test-result-badge';
import { AiProvidersCard } from './AiProvidersCard';
import { notifyUpdateActiveTranslateService } from '@/utils/service';

type Row = {
    value: string;
    name: string;
    description: string;
    editable: boolean;
    enabled: boolean;
};

type TestState =
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok' }
    | { kind: 'fail'; message: string };

export function ServicesPage() {
    const { t } = useTranslation();
    const [rows, setRows] = useState<Row[]>([]);
    const [disabled, setDisabled] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [ready, setReady] = useState(false);

    // Per-service connection-test results, keyed by service value.
    const [testStates, setTestStates] = useState<Record<string, TestState>>({});

    // DeepL API key + edit dialog state.
    const [deeplApiKey, setDeeplApiKey] = useState<string>('');
    const [deeplDialogOpen, setDeeplDialogOpen] = useState(false);
    const [deeplKeyDraft, setDeeplKeyDraft] = useState('');
    const [dialogTest, setDialogTest] = useState<TestState>({ kind: 'idle' });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [ds, dpKey] = await Promise.all([
                getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES),
                getConfig(CONFIG_KEY.DEEPL_API_KEY),
            ]);
            if (cancelled) return;
            const set = new Set(Array.isArray(ds) ? ds : []);
            setDisabled(set);
            setDeeplApiKey(typeof dpKey === 'string' ? dpKey : '');
            setRows(
                Array.from(TRANSLATE_SERVICES.values()).map((svc) => ({
                    value: svc.value,
                    name: t(svc.name, svc.name),
                    description: t(svc.description, svc.description),
                    editable: svc.editable,
                    enabled: !set.has(svc.value),
                })),
            );
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    // Test a built-in translation service through the background bridge.
    const runTest = async (value: string) => {
        setTestStates((s) => ({ ...s, [value]: { kind: 'pending' } }));
        try {
            const resp: any = await browser.runtime.sendMessage({
                action: ACTION.TRANSLATE_SERVICE_TEST,
                data: { service: value, targetLang: 'zh-CN' },
            });
            if (resp?.status === STATUS_SUCCESS) {
                setTestStates((s) => ({ ...s, [value]: { kind: 'ok' } }));
            } else {
                setTestStates((s) => ({ ...s, [value]: { kind: 'fail', message: resp?.data?.message || 'Failed' } }));
            }
        } catch (e: any) {
            setTestStates((s) => ({ ...s, [value]: { kind: 'fail', message: e?.message || String(e) } }));
        }
    };

    const openEdit = (value: string) => {
        if (value !== TRANSLATE_SERVICE.DEEPL) return;
        setDeeplKeyDraft(deeplApiKey);
        setDialogTest({ kind: 'idle' });
        setDeeplDialogOpen(true);
    };

    // Test the key currently in the dialog draft (not yet persisted).
    const runDialogTest = async () => {
        setDialogTest({ kind: 'pending' });
        try {
            const resp: any = await browser.runtime.sendMessage({
                action: ACTION.TRANSLATE_SERVICE_TEST,
                data: { service: TRANSLATE_SERVICE.DEEPL, targetLang: 'zh-CN', apiKey: deeplKeyDraft.trim() },
            });
            if (resp?.status === STATUS_SUCCESS) {
                setDialogTest({ kind: 'ok' });
            } else {
                setDialogTest({ kind: 'fail', message: resp?.data?.message || 'Failed' });
            }
        } catch (e: any) {
            setDialogTest({ kind: 'fail', message: e?.message || String(e) });
        }
    };

    const saveDeeplKey = async () => {
        const key = deeplKeyDraft.trim();
        setDeeplApiKey(key);
        await setConfig(CONFIG_KEY.DEEPL_API_KEY, key);
        // Saving a key clears any stale DeepL test result.
        setTestStates((s) => ({ ...s, [TRANSLATE_SERVICE.DEEPL]: { kind: 'idle' } }));
        setDeeplDialogOpen(false);
    };

    const filtered = useMemo(
        () => rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
        [rows, search],
    );

    const toggleService = async (row: Row, next: boolean) => {
        // Enabling DeepL requires an API key — prompt for it first.
        if (next && row.value === TRANSLATE_SERVICE.DEEPL && !deeplApiKey.trim()) {
            alert(t('deeplApiKeyRequired', 'Please configure the DeepL API Key first.'));
            openEdit(TRANSLATE_SERVICE.DEEPL);
            return;
        }
        if (!next) {
            const enabledCount = rows.filter((r) => r.enabled).length;
            if (enabledCount <= 1) {
                alert(t('keepAtLeastOneTranslationService', 'Keep at least one translation service'));
                return;
            }
            // const current = (await getConfig(CONFIG_KEY.TRANSLATE_SERVICE)) as string | undefined;
            // if (current && current.includes(row.value)) {
            //     alert(
            //         t('useTranslationServiceCannotBeDisabled', 'The translation service in use cannot be disabled'),
            //     );
            //     return;
            // }
        }

        const nextDisabled = new Set(disabled);
        if (next) nextDisabled.delete(row.value);
        else nextDisabled.add(row.value);
        setDisabled(nextDisabled);
        setRows((prev) => prev.map((r) => (r.value === row.value ? { ...r, enabled: next } : r)));
        await setConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES, Array.from(nextDisabled));
        await notifyUpdateActiveTranslateService();
    };

    if (!ready) {
        return <div className="h-[260px] rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
                {/* Header / search */}
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-mute">
                        {t('translationService', 'Translation service')}
                    </div>
                    {/* <div className="relative w-64">
                    <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
                        strokeWidth={1.6}
                    />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('typeToSearch', 'Type to search')}
                        className="pl-8"
                    />
                </div> */}
                </div>

                {/* Column header */}
                <div className="grid grid-cols-[1fr_2fr_auto] items-center gap-4 border-b border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                    <div>{t('name', 'Name')}</div>
                    <div>{t('description', 'Description')}</div>
                    <div className="w-[260px] text-right">{/* Actions */}</div>
                </div>

                {/* Rows */}
                {filtered.length === 0 ? (
                    <div className="px-4 py-10 text-center text-[13px] text-ink-soft">—</div>
                ) : (
                    filtered.map((row) => {
                        const ts = testStates[row.value] ?? { kind: 'idle' };
                        return (
                            <div
                                key={row.value}
                                className="grid grid-cols-[1fr_2fr_auto] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0"
                            >
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <div className="flex items-center gap-2.5">
                                        <img
                                            src={`/services/${row.value}.svg`}
                                            alt=""
                                            className="h-6 w-6 shrink-0 rounded-sm object-contain"
                                            onError={(e) => {
                                                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                                            }}
                                        />
                                        <span className="truncate text-[13px] font-medium text-ink">{row.name}</span>
                                    </div>
                                    {ts.kind === 'ok' && (
                                        <TestResultBadge kind="ok" okLabel={t('translateServiceTestOk', 'OK')} />
                                    )}
                                    {ts.kind === 'fail' && (
                                        <TestResultBadge kind="fail" message={ts.message} />
                                    )}
                                </div>
                                <div className="text-[12.5px] text-ink-soft">{row.description}</div>
                                <div className="flex w-[260px] items-center justify-end gap-2">
                                    <Switch
                                        checked={row.enabled}
                                        onCheckedChange={(v) => void toggleService(row, v)}
                                        size="sm"
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void runTest(row.value)}
                                        disabled={ts.kind === 'pending'}
                                    >
                                        <FlaskConical className="h-3 w-3" strokeWidth={2} />
                                        {ts.kind === 'pending' ? (
                                            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                                        ) : (
                                            t('translateServiceTest', 'Test')
                                        )}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!row.editable}
                                        onClick={() => openEdit(row.value)}
                                    >
                                        <Pencil className="h-3 w-3" strokeWidth={2} />
                                        {t('edit', 'Edit')}
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <AiProvidersCard />

            <Dialog
                open={deeplDialogOpen}
                onClose={() => setDeeplDialogOpen(false)}
                widthClass="w-[480px]"
                title={t('deeplApiKeyDialogTitle', 'Edit DeepL API Key')}
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setDeeplDialogOpen(false)}>
                            {t('aiCancel', 'Cancel')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void runDialogTest()}
                            disabled={!deeplKeyDraft.trim() || dialogTest.kind === 'pending'}
                        >
                            {dialogTest.kind === 'pending' ? (
                                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('aiTest', 'Test')}
                        </Button>
                        <Button size="sm" onClick={() => void saveDeeplKey()}>
                            {t('aiSave', 'Save')}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                        {t('deeplApiKey', 'DeepL API Key')}
                    </label>
                    <Input
                        type="text"
                        value={deeplKeyDraft}
                        onChange={(e) => {
                            setDeeplKeyDraft(e.target.value);
                            setDialogTest({ kind: 'idle' });
                        }}
                        placeholder={t('deeplApiKeyPlaceholder', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx')}
                        autoComplete="off"
                    />
                    <p className="text-[11px] text-ink-mute">
                        {t('deeplApiKeyHint', 'Free-tier keys end with ":fx". Get one from your DeepL account.')}
                    </p>
                    {dialogTest.kind === 'ok' && (
                        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] text-emerald-600">
                            {t('translateServiceTestOk', 'OK')}
                        </div>
                    )}
                    {dialogTest.kind === 'fail' && (
                        <div className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-600">
                            {dialogTest.message.slice(0, 240)}
                        </div>
                    )}
                </div>
            </Dialog>
        </div>
    );
}