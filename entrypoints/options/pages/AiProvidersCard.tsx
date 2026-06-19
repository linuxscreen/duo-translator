import { Plus, Trash2, Pencil, Loader2, FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ACTION, CONFIG_KEY, DEFAULT_VALUE, STATUS_SUCCESS } from '@/main/constants';
import { AiProvider, normalizeProvider } from '@/main/aiService';
import { getCatalogEntry } from '@/main/aiService';
import { getConfig, setConfig } from '@/utils/db';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TestResultBadge } from '@/components/ui/test-result-badge';
import { ProviderModal } from '../../../components/options/ProviderModal';
import { ServiceMark } from '@/components/ui/service-mark';
import { notifyUpdateActiveTranslateService } from '@/utils/service';

type TestState =
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok'; reply: string }
    | { kind: 'fail'; message: string };

export function AiProvidersCard() {
    const { t } = useTranslation();
    const [ready, setReady] = useState(false);
    const [providers, setProviders] = useState<AiProvider[]>([]);
    const [testStates, setTestStates] = useState<Record<string, TestState>>({});
    const [useForPage, setUseForPage] = useState<boolean>(!!DEFAULT_VALUE.AI_USE_FOR_TRANSLATE_PAGE);

    // Modal state — `editing` is the provider being edited; null when adding.
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<AiProvider | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [list, useAi]: [AiProvider[] | undefined, boolean] = await Promise.all([
                getConfig(CONFIG_KEY.AI_PROVIDERS),
                getConfig(CONFIG_KEY.AI_USE_FOR_TRANSLATE_PAGE),
            ]);
            if (cancelled) return;
            const arr: AiProvider[] = Array.isArray(list) ? list.map(normalizeProvider) : [];
            setProviders(arr);
            setUseForPage(useAi === undefined ? !!DEFAULT_VALUE.AI_USE_FOR_TRANSLATE_PAGE : !!useAi);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Persist the canonical list and update the auto-selected active id
     * (first enabled provider). When the previously-active provider is
     * removed or disabled, the active id silently rolls forward.
     */
    const persistProviders = async (next: AiProvider[]) => {
        setProviders(next);
        await setConfig(CONFIG_KEY.AI_PROVIDERS, next);
        const activeId = (await getConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID)) as string | undefined;
        const stillValid = activeId && next.find((p) => p.id === activeId && p.enabled !== false);
        if (!stillValid) {
            const firstEnabled = next.find((p) => p.enabled !== false);
            await setConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID, firstEnabled?.id ?? '');
        }
    };

    const toggleUseForPage = async (v: boolean) => {
        setUseForPage(v);
        await setConfig(CONFIG_KEY.AI_USE_FOR_TRANSLATE_PAGE, v);
        await notifyUpdateActiveTranslateService();
    };

    const toggleEnabled = async (id: string, enabled: boolean) => {
        let next = providers.map((p) => {
            if (p.id === id) p.enabled = enabled;
            return p;
        });
        await persistProviders(next);
        await notifyUpdateActiveTranslateService();
    };

    const removeProvider = async (id: string) => {
        if (!confirm(t('aiConfirmDeleteProvider', 'Delete this AI provider?'))) return;
        await persistProviders(providers.filter((p) => p.id !== id));
        setTestStates((s) => {
            const next = { ...s };
            delete next[id];
            return next;
        });
        await notifyUpdateActiveTranslateService();
    };

    const testProvider = async (p: AiProvider) => {
        setTestStates((s) => ({ ...s, [p.id]: { kind: 'pending' } }));
        try {
            const resp: any = await browser.runtime.sendMessage({
                action: ACTION.AI_PROVIDER_TEST,
                data: p,
            });
            if (resp?.status === STATUS_SUCCESS) {
                setTestStates((s) => ({ ...s, [p.id]: { kind: 'ok', reply: resp.data?.reply || '' } }));
            } else {
                setTestStates((s) => ({ ...s, [p.id]: { kind: 'fail', message: resp?.data?.message || 'Failed' } }));
            }
        } catch (e: any) {
            setTestStates((s) => ({ ...s, [p.id]: { kind: 'fail', message: e?.message || String(e) } }));
        }
    };

    const openAdd = () => {
        setEditing(undefined);
        setModalOpen(true);
    };
    const openEdit = (p: AiProvider) => {
        setEditing(p);
        setModalOpen(true);
    };
    const onModalSave = async (saved: AiProvider) => {
        const exists = providers.some((p) => p.id === saved.id);
        const next = exists
            ? providers.map((p) => (p.id === saved.id ? saved : p))
            : [...providers, saved];
        await persistProviders(next);
        // Reset stale test result for the saved provider.
        setTestStates((s) => ({ ...s, [saved.id]: { kind: 'idle' } }));
    };

    if (!ready) {
        return <div className="h-50 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
    }

    return (
        <>
            <section className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-mute">
                        {t('aiProviders', 'AI Providers')}
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                            <span>{t('aiUseForTranslatePage', 'Also used for translating pages')}</span>
                            <Switch
                                checked={useForPage}
                                onCheckedChange={(v) => void toggleUseForPage(v)}
                                size="sm"
                            />
                        </label>
                        <Button size="sm" variant="outline" onClick={openAdd}>
                            <Plus className="h-3 w-3" strokeWidth={2} />
                            {t('aiAddProvider', 'Add provider')}
                        </Button>
                    </div>
                </div>

                {/* Column header — mirrors ServicesPage layout. */}
                <div className="grid grid-cols-[1.2fr_0.8fr_1.2fr_auto] items-center gap-4 border-b border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                    <div>{t('aiProviderName', 'Name')}</div>
                    <div>{t('aiProviderType', 'Type')}</div>
                    <div>{t('aiProviderModel', 'Model')}</div>
                    <div className="w-[220px] text-right">{/* Actions */}</div>
                </div>

                {providers.length === 0 ? (
                    <div className="px-4 py-10 text-center text-[13px] text-ink-soft">
                        {t('aiNoProvider', 'No provider configured. Add one to get started.')}
                    </div>
                ) : (
                    providers.map((p) => {
                        const ts = testStates[p.id] ?? { kind: 'idle' };
                        const entry = getCatalogEntry(p.type);
                        return (
                            <div
                                key={p.id}
                                className="grid grid-cols-[1.2fr_0.8fr_1.2fr_auto] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0"
                            >
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <div className="flex items-center gap-2.5">
                                        <ServiceMark id={p.type as string} />
                                        <span className="truncate text-[13px] font-medium text-ink">
                                            {p.name || entry.label}
                                        </span>
                                    </div>
                                    {ts.kind === 'ok' && (
                                        <TestResultBadge kind="ok" okLabel={t('aiTestOk', 'OK')} />
                                    )}
                                    {ts.kind === 'fail' && (
                                        <TestResultBadge kind="fail" message={ts.message} />
                                    )}
                                </div>
                                <div className="text-[12.5px] text-ink-soft truncate">{entry.label}</div>
                                <div className="text-[12.5px] text-ink-soft truncate">{p.model || '—'}</div>
                                <div className="flex w-[220px] items-center justify-end gap-2">
                                    <Switch
                                        checked={p.enabled !== false}
                                        onCheckedChange={(v) => void toggleEnabled(p.id, v)}
                                        size="sm"
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void testProvider(p)}
                                        disabled={ts.kind === 'pending'}
                                    >
                                        <FlaskConical className="h-3 w-3" strokeWidth={2}/>
                                        {ts.kind === 'pending' ? (
                                            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                                        ) : (
                                            t('aiTest', 'Test')
                                        )}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                                        <Pencil className="h-3 w-3" strokeWidth={2} />
                                        {t('edit', 'Edit')}
                                    </Button>
                                    <Button size="sm" variant="destructive" onClick={() => void removeProvider(p.id)}>
                                        <Trash2 className="h-3 w-3" strokeWidth={2} />
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </section>

            <ProviderModal
                open={modalOpen}
                initial={editing}
                onClose={() => setModalOpen(false)}
                onSave={onModalSave}
            />
        </>
    );
}
