import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONFIG_KEY, TRANSLATE_SERVICES } from '@/main/constants';
import { getConfig, setConfig } from '@/utils/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AiProvidersCard } from './AiProvidersCard';

type Row = {
    value: string;
    name: string;
    description: string;
    editable: boolean;
    enabled: boolean;
};

export function ServicesPage() {
    const { t } = useTranslation();
    const [rows, setRows] = useState<Row[]>([]);
    const [disabled, setDisabled] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const ds = (await getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE)) as string[] | undefined;
            if (cancelled) return;
            const set = new Set(Array.isArray(ds) ? ds : []);
            setDisabled(set);
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

    const filtered = useMemo(
        () => rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
        [rows, search],
    );

    const toggleService = async (row: Row, next: boolean) => {
        if (!next) {
            const enabledCount = rows.filter((r) => r.enabled).length;
            if (enabledCount <= 1) {
                alert(t('keepAtLeastOneTranslationService', 'Keep at least one translation service'));
                return;
            }
            const current = (await getConfig(CONFIG_KEY.TRANSLATE_SERVICE)) as string | undefined;
            if (current && current.includes(row.value)) {
                alert(
                    t('useTranslationServiceCannotBeDisabled', 'The translation service in use cannot be disabled'),
                );
                return;
            }
        }

        const nextDisabled = new Set(disabled);
        if (next) nextDisabled.delete(row.value);
        else nextDisabled.add(row.value);
        setDisabled(nextDisabled);
        setRows((prev) => prev.map((r) => (r.value === row.value ? { ...r, enabled: next } : r)));
        await setConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE, Array.from(nextDisabled));
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
                <div className="w-[180px] text-right">{/* Actions */}</div>
            </div>

            {/* Rows */}
            {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] text-ink-soft">—</div>
            ) : (
                filtered.map((row) => (
                    <div
                        key={row.value}
                        className="grid grid-cols-[1fr_2fr_auto] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0"
                    >
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
                        <div className="text-[12.5px] text-ink-soft">{row.description}</div>
                        <div className="flex w-[180px] items-center justify-end gap-2">
                            <Switch
                                checked={row.enabled}
                                onCheckedChange={(v) => void toggleService(row, v)}
                                size="sm"
                            />
                            <Button size="sm" variant="outline" disabled={!row.editable}>
                                {t('edit', 'Edit')}
                            </Button>
                        </div>
                    </div>
                ))
            )}
            </div>

            <AiProvidersCard />
        </div>
    );
}