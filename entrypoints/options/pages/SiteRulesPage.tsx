import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Info, Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SettingRow } from '@/components/options/SettingRow';
import { RuleTable } from '@/components/options/siteRules/RuleTable';
import { RuleDetailDialog } from '@/components/options/siteRules/RuleDetailDialog';
import { RuleEditorDialog } from '@/components/options/siteRules/RuleEditorDialog';
import { SubscriptionsTab } from '@/components/options/siteRules/SubscriptionsTab';
import { APP_NAME_KEBAB_CASE, CONFIG_KEY, SITE_RULE_ACTION } from '@/main/constants';
import { sendMessageToBackground } from '@/utils/message';
import { setConfig } from '@/utils/db';
import { normalizeBundle } from '@/main/siteRules/normalize';
import { parseJsonc } from '@/main/siteRules/jsonc';
import {
    refKey,
    SITE_RULE_SCHEMA_VERSION,
    type SiteRule,
    type SiteRuleSubscription,
} from '@/main/siteRules/types';
import type { SiteRuleOverview } from '@/main/siteRules/siteRuleService';

type TabId = 'system' | 'subscription' | 'user';

type Props = {
    /** Back to the Translation settings page. Routing lives in App.tsx. */
    onBack: () => void;
};

export function SiteRulesPage({ onBack }: Props) {
    const { t } = useTranslation();
    const { show: toast, viewport: toastViewport } = useToast();
    const [tab, setTab] = useState<TabId>('system');
    const [data, setData] = useState<SiteRuleOverview | null>(null);
    const [busy, setBusy] = useState(false);
    const [detail, setDetail] = useState<SiteRule | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<SiteRule | null>(null);
    const [selection, setSelection] = useState<Set<string>>(new Set());
    const [systemSelection, setSystemSelection] = useState<Set<string>>(new Set());
    // Rules awaiting delete confirmation. Always a list, so the single-row
    // trash button and the batch button share one path — and the batch one
    // carries the exact rows RuleTable acted on (selection ∩ current filter),
    // which a re-derivation here would get wrong while a search is active.
    const [pendingDelete, setPendingDelete] = useState<SiteRule[] | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async () => {
        const next = await sendMessageToBackground({ action: SITE_RULE_ACTION.OVERVIEW });
        if (next) setData(next as SiteRuleOverview);
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    // ---- writes -------------------------------------------------------------
    // Every write goes through setConfig (not a direct storage write) so cloud
    // sync's per-key clock bookkeeping stays intact, then re-reads the overview
    // so background stays the single source of truth for the merged view.

    const write = async (key: CONFIG_KEY, value: unknown) => {
        await setConfig(key, value);
        await reload();
    };

    const setDisabledMany = (keys: string[], enabled: boolean) => {
        if (!data) return;
        const next = new Set(data.disabledIds);
        for (const key of keys) {
            if (enabled) next.delete(key);
            else next.add(key);
        }
        void write(CONFIG_KEY.SITE_RULE_DISABLED_IDS, [...next]);
    };

    const setDisabled = (key: string, enabled: boolean) => setDisabledMany([key], enabled);

    const saveUserRules = (rules: SiteRule[]) => write(CONFIG_KEY.SITE_RULE_USER, rules);

    const refreshSubscriptions = async (url?: string) => {
        setBusy(true);
        try {
            await sendMessageToBackground({
                action: SITE_RULE_ACTION.SUBSCRIPTION_REFRESH,
                data: { url },
            });
            await reload();
        } finally {
            setBusy(false);
        }
    };

    // ---- import / export ----------------------------------------------------

    const onExport = () => {
        // Guarded here too, not only by the button's disabled state — a
        // keyboard/programmatic path must not produce an empty download either.
        if (!data || data.user.length === 0) return;
        const payload = {
            schemaVersion: SITE_RULE_SCHEMA_VERSION,
            name: 'My rules',
            updatedAt: new Date().toISOString(),
            rules: data.user,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${APP_NAME_KEBAB_CASE}-rules-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allows re-picking the same file
        if (!file || !data) return;
        try {
            const { bundle, warnings } = normalizeBundle(parseJsonc(await file.text()));
            // Merge by id: an imported rule replaces the local one with the same
            // id, everything else is kept. Nothing is ever deleted by an import.
            const merged = [...data.user];
            for (const rule of bundle.rules) {
                const at = merged.findIndex((r) => r.id === rule.id);
                if (at >= 0) merged[at] = rule;
                else merged.push(rule);
            }
            await saveUserRules(merged);
            toast(
                t('rulesImported', { count: bundle.rules.length, defaultValue: 'Imported {{count}} rules' }),
            );
            if (warnings.length > 0) console.warn(warnings);
        } catch (err: any) {
            toast(err?.message || String(err), 'error');
        }
    };

    // ---- render -------------------------------------------------------------

    if (!data) {
        return <div className="h-40 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
    }

    const disabled = new Set(data.disabledIds);
    const userRules = data.user;

    const tabs = [
        { id: 'system' as const, label: t('ruleTabSystem', 'System'), badge: data.system.rules.length },
        {
            id: 'subscription' as const,
            label: t('ruleTabSubscription', 'Subscriptions'),
            badge: data.subscriptions.length,
        },
        { id: 'user' as const, label: t('ruleTabUser', 'My rules'), badge: userRules.length },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('backToTranslation', 'Back to Translation')}
                </Button>
            </div>

            <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
                <SettingRow
                    label={t('globalSwitch', 'Global switch')}
                    control={
                        <Switch
                            checked={data.switchOn}
                            onCheckedChange={(v) => void write(CONFIG_KEY.SITE_RULE_SWITCH, v)}
                        />
                    }
                />
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-[12px] text-ink-soft">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.8} />
                <span>
                    {t('siteRuleReloadNotice', 'Rule changes take effect after the page is reloaded')}
                </span>
            </div>

            <Tabs items={tabs} value={tab} onChange={setTab} />

            {tab === 'system' && (
                <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
                    <SettingRow
                        className="border-b border-line"
                        label={data.system.name || t('ruleTabSystem', 'System')}
                        hint={
                            data.official?.lastError
                                ? data.official.lastError
                                : t('systemRulesHint', {
                                      when: data.system.updatedAt
                                          ? new Date(data.system.updatedAt).toLocaleDateString()
                                          : '—',
                                      source: data.systemFromSubscription
                                          ? t('systemRulesSourceRemote', 'updated online')
                                          : t('systemRulesSourceBundled', 'bundled with the extension'),
                                      defaultValue: 'Version {{when}} · {{source}}',
                                  })
                        }
                        control={
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => void refreshSubscriptions(data.officialUrl)}
                                >
                                    <RefreshCw
                                        className={cn('h-3.5 w-3.5', busy && 'animate-spin')}
                                        strokeWidth={1.8}
                                    />
                                    {t('refresh', 'Refresh')}
                                </Button>
                                <Switch
                                    checked={data.systemEnabled}
                                    onCheckedChange={(v) =>
                                        void write(CONFIG_KEY.SITE_RULE_SYSTEM_ENABLED, v)
                                    }
                                />
                            </div>
                        }
                    />
                    <RuleTable
                        rules={data.system.rules}
                        keyOf={(r) => refKey('system', r.id)}
                        isEnabled={(r) => r.enabled && !disabled.has(refKey('system', r.id))}
                        onToggle={(r, v) => setDisabled(refKey('system', r.id), v)}
                        onDetail={setDetail}
                        selection={systemSelection}
                        onSelectionChange={setSystemSelection}
                        // System rules are not ours to rewrite — their on/off
                        // state is the disabled-refKey list, so a batch toggle
                        // is one write of that list rather than N record edits.
                        onBatchToggle={(rules, enabled) =>
                            void setDisabledMany(rules.map((r) => refKey('system', r.id)), enabled)
                        }
                        emptyText={t('noRulesConfigured', 'No rules')}
                    />
                </div>
            )}

            {tab === 'subscription' && (
                <SubscriptionsTab
                    subscriptions={data.subscriptions}
                    packages={data.packages}
                    disabledIds={data.disabledIds}
                    busy={busy}
                    officialUrl={data.officialUrl}
                    onSave={(next: SiteRuleSubscription[]) =>
                        void write(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS, next)
                    }
                    onRefresh={(url) => void refreshSubscriptions(url)}
                    onToggleRules={setDisabledMany}
                    onDetail={setDetail}
                />
            )}

            {tab === 'user' && (
                <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                        <div className="text-[13.5px] font-semibold text-ink">
                            {t('ruleTabUser', 'My rules')}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                // Nothing to export: an empty file is not a
                                // useful backup, and downloading one reads as
                                // "the export lost my rules".
                                disabled={data.user.length === 0}
                                onClick={onExport}
                            >
                                {t('backupExport', 'Export JSON')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {t('backupImport', 'Import JSON')}
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,.json,.jsonc"
                                onChange={onImportFile}
                                className="hidden"
                            />
                            <Button
                                size="sm"
                                onClick={() => {
                                    setEditing(null);
                                    setEditorOpen(true);
                                }}
                            >
                                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                                {t('add', 'Add')}
                            </Button>
                        </div>
                    </div>
                    <RuleTable
                        rules={userRules}
                        keyOf={(r) => refKey('user', r.id)}
                        // User rules carry their state in the record itself —
                        // the disabled-refKey list exists for tiers whose
                        // content we do not own and must not rewrite.
                        isEnabled={(r) => r.enabled}
                        onToggle={(r, v) =>
                            void saveUserRules(
                                userRules.map((it) => (it.id === r.id ? { ...it, enabled: v } : it)),
                            )
                        }
                        onDetail={setDetail}
                        onEdit={(r) => {
                            setEditing(r);
                            setEditorOpen(true);
                        }}
                        onDelete={(r) => setPendingDelete([r])}
                        selection={selection}
                        onSelectionChange={setSelection}
                        onBatchToggle={(rules, enabled) => {
                            const keys = new Set(rules.map((r) => r.id));
                            void saveUserRules(
                                userRules.map((r) => (keys.has(r.id) ? { ...r, enabled } : r)),
                            );
                        }}
                        onBatchDelete={(rules) => setPendingDelete(rules)}
                        emptyText={t('noUserRules', 'No rules yet — add one to control a specific site')}
                    />
                </div>
            )}

            <ConfirmDialog
                open={!!pendingDelete}
                title={t('deleteRuleTitle', 'Delete rule?')}
                description={
                    pendingDelete?.length === 1
                        ? t('deleteRuleDesc', {
                              name: pendingDelete[0].name,
                              defaultValue: '"{{name}}" will be deleted. This cannot be undone.',
                          })
                        : t('deleteRulesDesc', {
                              count: pendingDelete?.length ?? 0,
                              defaultValue: '{{count}} rules will be deleted. This cannot be undone.',
                          })
                }
                onConfirm={() => {
                    const ids = new Set((pendingDelete ?? []).map((r) => r.id));
                    void saveUserRules(userRules.filter((r) => !ids.has(r.id)));
                    setSelection((cur) => {
                        const next = new Set(cur);
                        for (const id of ids) next.delete(refKey('user', id));
                        return next;
                    });
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />
            <RuleDetailDialog rule={detail} onClose={() => setDetail(null)} />
            <RuleEditorDialog
                open={editorOpen}
                rule={editing}
                onClose={() => setEditorOpen(false)}
                onSave={(rule) => {
                    const at = userRules.findIndex((r) => r.id === rule.id);
                    const next = at >= 0 ? userRules.map((r) => (r.id === rule.id ? rule : r)) : [...userRules, rule];
                    void saveUserRules(next);
                    setEditorOpen(false);
                }}
            />
            {toastViewport}
        </div>
    );
}
