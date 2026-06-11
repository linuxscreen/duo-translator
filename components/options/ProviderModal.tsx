import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ACTION, STATUS_SUCCESS } from '@/main/constants';
import { AiProvider, AiProviderType } from '@/main/aiService';
import { PROVIDER_CATALOG, getCatalogEntry } from '@/main/aiService';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ServiceMark } from '@/components/ui/service-mark';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface Props {
    open: boolean;
    /** Initial provider when editing; undefined when adding. */
    initial?: AiProvider;
    onClose: () => void;
    onSave: (p: AiProvider) => void | Promise<void>;
}

const newProviderId = () =>
    globalThis.crypto?.randomUUID?.() ??
    `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function ProviderModal({ open, initial, onClose, onSave }: Props) {
    const { t } = useTranslation();
    const isEdit = !!initial;

    const [type, setType] = useState<AiProviderType>(initial?.type ?? 'openai');
    const [name, setName] = useState(initial?.name ?? getCatalogEntry('openai').label);
    const [url, setUrl] = useState(initial?.url ?? getCatalogEntry('openai').defaultUrl);
    const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
    const [model, setModel] = useState(initial?.model ?? '');
    const [showKey, setShowKey] = useState(false);

    // Tracks whether the user has manually edited `name` / `url`. When they
    // haven't, switching the `type` updates these to the catalog defaults
    // automatically. Once edited, switching type leaves them alone.
    const [nameDirty, setNameDirty] = useState(isEdit);
    const [urlDirty, setUrlDirty] = useState(isEdit);

    const [testing, setTesting] = useState(false);
    const [testReply, setTestReply] = useState<{ ok: boolean; text: string } | null>(null);
    const [saving, setSaving] = useState(false);

    // Reset form whenever the dialog opens (initial may differ across opens).
    useEffect(() => {
        if (!open) return;
        const t0 = initial?.type ?? 'openai';
        const entry = getCatalogEntry(t0);
        setType(t0);
        setName(initial?.name ?? entry.label);
        setUrl(initial?.url ?? entry.defaultUrl);
        setApiKey(initial?.apiKey ?? '');
        setModel(initial?.model ?? '');
        setNameDirty(!!initial);
        setUrlDirty(!!initial);
        setShowKey(false);
        setTesting(false);
        setTestReply(null);
        setSaving(false);
    }, [open, initial]);

    const entry = useMemo(() => getCatalogEntry(type), [type]);

    const onTypeChange = (next: string) => {
        const t1 = next as AiProviderType;
        setType(t1);
        const ent = getCatalogEntry(t1);
        if (!nameDirty) setName(ent.label);
        if (!urlDirty) setUrl(ent.defaultUrl);
        setTestReply(null);
    };

    // Validation. apiKey is required only for catalog entries with
    // requiresApiKey=true (i.e. not Ollama/Custom). url is required except
    // when Custom; model and name are always required.
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedModel = model.trim();
    const trimmedKey = apiKey.trim();
    const apiKeyMissing = entry.requiresApiKey && !trimmedKey;
    const valid =
        !!trimmedName &&
        !!trimmedUrl &&
        !!trimmedModel &&
        !apiKeyMissing;

    const buildProvider = (): AiProvider => new AiProvider(
        initial?.id ?? newProviderId(),
        type,
        trimmedName,
        trimmedUrl,
        trimmedKey,
        trimmedModel,
        initial?.enabled ?? true,
    );

    const runTest = async () => {
        if (!valid) return;
        setTesting(true);
        setTestReply(null);
        try {
            const resp: any = await browser.runtime.sendMessage({
                action: ACTION.AI_PROVIDER_TEST,
                data: buildProvider(),
            });
            if (resp?.status === STATUS_SUCCESS) {
                setTestReply({ ok: true, text: resp.data?.reply || 'OK' });
            } else {
                setTestReply({ ok: false, text: resp?.data?.message || 'Failed' });
            }
        } catch (e: any) {
            setTestReply({ ok: false, text: e?.message || String(e) });
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async () => {
        if (!valid) return;
        setSaving(true);
        try {
            await onSave(buildProvider());
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            widthClass="w-[520px]"
            title={isEdit ? t('aiEditProvider', 'Edit AI provider') : t('aiAddProvider', 'Add provider')}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {t('aiCancel', 'Cancel')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runTest()}
                        disabled={!valid || testing}
                    >
                        {testing ? t('aiTesting', 'Testing...') : t('aiTest', 'Test')}
                    </Button>
                    <Button size="sm" onClick={() => void handleSave()} disabled={!valid || saving}>
                        {isEdit ? t('aiSave', 'Save') : t('aiAdd', 'Add')}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <Field label={t('aiProviderType', 'Type')} required>
                    <Select value={type} onValueChange={onTypeChange}>
                        <SelectTrigger>
                            <SelectValue>
                                <span className="flex items-center gap-2">
                                    <ServiceMark id={type} />
                                    {entry.label}
                                </span>
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {PROVIDER_CATALOG.map((c) => (
                                <SelectItem key={c.type} value={c.type}>
                                    <span className="flex items-center gap-2">
                                        <ServiceMark id={c.type} />
                                        {c.label}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                <Field label={t('aiProviderName', 'Name')} required>
                    <Input
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setNameDirty(true);
                        }}
                        placeholder={entry.label}
                    />
                </Field>

                <Field label={t('aiProviderUrl', 'URL')} required>
                    <Input
                        value={url}
                        onChange={(e) => {
                            setUrl(e.target.value);
                            setUrlDirty(true);
                        }}
                        placeholder={entry.defaultUrl || 'https://...'}
                    />
                    {(type === 'gemini') && (
                        <p className="text-[11px] text-ink-mute">
                            {t('aiUrlTemplateHint', 'Placeholders {model} and {key} are auto-substituted.')}
                        </p>
                    )}
                </Field>

                <Field
                    label={t('aiProviderApiKey', 'API Key')}
                    required={entry.requiresApiKey}
                    hint={
                        !entry.requiresApiKey
                            ? t('aiApiKeyOptionalHint', 'Optional for this provider type.')
                            : undefined
                    }
                >
                    <div className="relative">
                        <Input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={entry.requiresApiKey ? 'sk-...' : ''}
                            autoComplete="off"
                            className="pr-9"
                        />
                        <button
                            type="button"
                            aria-label={showKey ? 'Hide' : 'Show'}
                            onClick={() => setShowKey((v) => !v)}
                            className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-mute hover:bg-line/60 hover:text-ink"
                        >
                            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                    </div>
                </Field>

                <Field label={t('aiProviderModel', 'Model')} required>
                    <Input
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={placeholderModel(type)}
                    />
                </Field>

                {testReply && (
                    <div
                        className={`rounded border px-2.5 py-1.5 text-[12px] ${
                            testReply.ok
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                                : 'border-red-500/40 bg-red-500/10 text-red-600'
                        }`}
                    >
                        {testReply.ok ? `${t('aiTestOk', 'OK')}` : testReply.text.slice(0, 240)}
                    </div>
                )}
            </div>
        </Dialog>
    );
}

function placeholderModel(type: AiProviderType): string {
    switch (type) {
        case 'openai': return 'gpt-4o-mini';
        case 'deepseek': return 'deepseek-chat';
        case 'gemini': return 'gemini-2.0-flash';
        case 'ollama': return 'llama3.1';
        case 'openrouter': return 'openai/gpt-4o-mini';
        case 'claude': return 'claude-sonnet-4-5';
        case 'custom': return '';
    }
}

function Field({
    label,
    required,
    hint,
    children,
}: {
    label: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">
                {label}
                {required && <span className="text-red-500">*</span>}
            </label>
            {children}
            {hint && <p className="text-[11px] text-ink-mute">{hint}</p>}
        </div>
    );
}
