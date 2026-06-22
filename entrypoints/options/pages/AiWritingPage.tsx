import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_TASK,
  CONFIG_KEY,
  DB_ACTION,
  DEFAULT_VALUE,
  LANGUAGES,
} from '@/main/constants';
import { getConfig, setConfig } from '@/utils/db';
import { sendMessageToBackground } from '@/utils/message';
import { type AiProvider } from '@/main/aiService';
import { buildServiceOptions, getAiTranslateService, type ServiceOption } from '@/utils/service';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingRow } from '@/components/options/SettingRow';
import {
  DomainListSection,
  type DomainItem,
} from '@/components/options/DomainListSection';
import { ServiceMark } from '@/components/ui/service-mark';

const ENHANCE_MODES: { value: AI_TASK; label: string }[] = [
  { value: AI_TASK.GRAMMAR, label: 'aiGrammar' },
  { value: AI_TASK.POLISH, label: 'aiPolish' },
  { value: AI_TASK.FORMAL, label: 'aiFormal' },
  { value: AI_TASK.CASUAL, label: 'aiCasual' },
];

export function AiWritingPage() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [targetLang, setTargetLang] = useState<string>(DEFAULT_VALUE.AI_TARGET_LANGUAGE);
  const [defaultMode, setDefaultMode] = useState<string>(DEFAULT_VALUE.AI_DEFAULT_ENHANCE_MODE);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [hasConfiguredProviders, setHasConfiguredProviders] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [enhanceProviderId, setEnhanceProviderId] = useState<string>('');
  const [translateServiceKey, setTranslateServiceKey] = useState<string>(
    String(DEFAULT_VALUE.AI_TRANSLATE_SERVICE),
  );
  // Flat (ungrouped) translate-with options — translators + AI providers,
  // built the same way as the popup so every picker stays consistent.
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);

  const [whitelistMode, setWhitelistMode] = useState<boolean>(false);
  const [disabledList, setDisabledList] = useState<DomainItem[]>([]);
  const [enabledList, setEnabledList] = useState<DomainItem[]>([]);
  const [listOpen, setListOpen] = useState(false);

  const refreshDomainLists = async () => {
    const [disabled, enabled] = await Promise.all([
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { aiWritingDisabled: true },
      }),
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { aiWritingEnabled: true },
      }),
    ]);
    setDisabledList(Array.isArray(disabled) ? disabled : []);
    setEnabledList(Array.isArray(enabled) ? enabled : []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sw, lang, mode, activeId, transKey, wlMode] = await Promise.all([
        getConfig(CONFIG_KEY.AI_WRITING_SWITCH),
        getConfig(CONFIG_KEY.AI_TARGET_LANGUAGE),
        getConfig(CONFIG_KEY.AI_DEFAULT_ENHANCE_MODE),
        getConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID),
        getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.AI_WRITING_WHITELIST_MODE),
      ]);
      if (cancelled) return;
      setEnabled(sw === undefined ? true : !!sw);
      setTargetLang(lang || DEFAULT_VALUE.AI_TARGET_LANGUAGE);
      setDefaultMode(mode || DEFAULT_VALUE.AI_DEFAULT_ENHANCE_MODE);
      // Shared loader: enabled translators + enabled AI providers + the
      // resolved active translate service (falls back if the saved one is gone).
      const { activeService, enabledTranslateServices, enabledAiProviders, totalAiProviders } =
        await getAiTranslateService(transKey);
      if (cancelled) return;
      setProviders(enabledAiProviders);
      setHasConfiguredProviders(totalAiProviders > 0);
      setServiceOptions(buildServiceOptions(enabledTranslateServices, enabledAiProviders));
      setActiveProviderId(typeof activeId === 'string' ? activeId : '');
      // Fallback chain mirrors the floating dot's resolution order.
      const resolvedEnhance =
        enabledAiProviders.find((p: AiProvider) => p.id === activeId)?.id ||
        enabledAiProviders[0]?.id ||
        '';
      setEnhanceProviderId(resolvedEnhance);
      setTranslateServiceKey(activeService);
      setWhitelistMode(!!wlMode);
      await refreshDomainLists();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleEnabled = async (v: boolean) => {
    setEnabled(v);
    await setConfig(CONFIG_KEY.AI_WRITING_SWITCH, v);
  };
  const changeTargetLang = async (v: string) => {
    setTargetLang(v);
    await setConfig(CONFIG_KEY.AI_TARGET_LANGUAGE, v);
  };
  const changeDefaultMode = async (v: string) => {
    setDefaultMode(v);
    await setConfig(CONFIG_KEY.AI_DEFAULT_ENHANCE_MODE, v);
  };
  const changeEnhanceProvider = async (v: string) => {
    setEnhanceProviderId(v);
    await setConfig(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID, v);
  };
  const changeTranslateService = async (v: string) => {
    setTranslateServiceKey(v);
    await setConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE, v);
  };
  const toggleWhitelistMode = async (v: boolean) => {
    setWhitelistMode(v);
    await setConfig(CONFIG_KEY.AI_WRITING_WHITELIST_MODE, v);
  };

  if (!ready) {
    return <div className="h-60 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        {/* <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Sparkles className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.8} />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-mute">
            {t('aiWriting', 'AI Writing')}
          </span>
        </div> */}

        <SettingRow
          label={t('aiEnable', 'Enable')}
          hint={t(
            'aiEnableHint',
            'Show small dot on the right of the input box',
          )}
          control={<Switch checked={enabled} onCheckedChange={(v) => void toggleEnabled(v)} />}
        />

        <SettingRow
          label={t('aiBetterWritingWith', 'Better writing with')}
          control={
            providers.length === 0 ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface/60 px-2.5 py-1.5">
                <span className="text-[12px] text-ink-soft">
                  {hasConfiguredProviders
                    ? t('aiNoProviderEnabled', 'No AI provider enabled')
                    : t('aiNoProviderConfigured', 'No AI provider configured')}
                </span>
                <button
                  type="button"
                  onClick={() => { window.location.hash = '#services'; }}
                  className="shrink-0 text-[12px] text-accent hover:underline"
                >
                  {t('aiConfigure', 'Configure')}
                </button>
              </div>
            ) : (
              <Select
                value={enhanceProviderId || activeProviderId || providers[0]?.id || ''}
                onValueChange={(v) => void changeEnhanceProvider(v)}
              >
                <SelectTrigger className="min-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-1">
                        {<ServiceMark id={p.type} />}
                        {p.getTitle()}
                        </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        />

        <SettingRow
          label={t('aiDefaultEnhanceMode', 'Default enhance mode')}
          control={
            <Select value={defaultMode} onValueChange={(v) => void changeDefaultMode(v)}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENHANCE_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {t(m.label, m.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <SettingRow
          label={t('aiTargetLang', 'Translate to')}
          control={
            <Select value={targetLang} onValueChange={(v) => void changeTargetLang(v)}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {t(l.title, l.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <SettingRow
          label={t('aiTranslateWith', 'Translate with')}
          control={
            <Select
              value={translateServiceKey}
              onValueChange={(v) => void changeTranslateService(v)}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serviceOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <span className="flex items-center gap-1">
                      <ServiceMark id={s.iconId} />
                      {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <SettingRow
          label={t('aiWhitelistMode', 'Whitelist mode')}
          hint={t('aiWhitelistModeHint', 'Only enabled on designated websites')}
          control={
            <Switch
              checked={whitelistMode}
              onCheckedChange={(v) => void toggleWhitelistMode(v)}
            />
          }
        />
      </div>

      {whitelistMode ? (
        <DomainListSection
          title={t('aiEnabledWebsites', 'Enabled websites')}
          emptyHint={t('noDomainsConfigured', 'No websites configured.')}
          open={listOpen}
          onToggle={() => setListOpen((o) => !o)}
          items={enabledList}
          kind={{ field: 'aiWritingEnabled' }}
          onChanged={refreshDomainLists}
        />
      ) : (
        <DomainListSection
          title={t('aiDisabledWebsites', 'Disabled websites')}
          emptyHint={t('noDomainsConfigured', 'No websites configured.')}
          open={listOpen}
          onToggle={() => setListOpen((o) => !o)}
          items={disabledList}
          kind={{ field: 'aiWritingDisabled' }}
          onChanged={refreshDomainLists}
        />
      )}
    </div>
  );
}
