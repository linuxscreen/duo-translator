import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACTION,
  CONFIG_KEY,
  DB_ACTION,
  DEFAULT_STRATEGY,
  DEFAULT_VALUE,
  DOMAIN_STRATEGY,
  LANGUAGES,
  TB_ACTION,
  TRANSLATE_SERVICES,
  VIEW_STRATEGIES,
  type TranslateServiceMeta,
} from '@/main/constants';
import {
  sendMessageToAllTabs,
  sendMessageToBackground,
} from '@/utils/message';
import { getConfig, setConfig } from '@/utils/db';
import { SettingRow } from '@/components/options/SettingRow';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DomainListSection, type DomainItem } from '@/components/options/DomainListSection';

const DEFAULT_STRATEGY_OPTIONS: { value: DEFAULT_STRATEGY; title: string; fallback: string }[] = [
  { value: DEFAULT_STRATEGY.AUTO, title: 'automaticallyDetermine', fallback: 'Automatically determine' },
  { value: DEFAULT_STRATEGY.ALWAYS, title: 'translateAllWebsites', fallback: 'Translate all websites' },
  { value: DEFAULT_STRATEGY.NEVER, title: 'notTranslateAllWebsites', fallback: "Don't translate all websites" },
];

export function TranslationPage() {
  const { t } = useTranslation();

  // Settings (migrated from SettingsPage)
  const [highlight, setHighlight] = useState(true);
  const [floatBall, setFloatBall] = useState(true);
  const [viewStrategy, setViewStrategy] = useState<string>(DEFAULT_VALUE.VIEW_STRATEGY);
  const [targetLang, setTargetLang] = useState<string>(DEFAULT_VALUE.TARGET_LANG);
  const [translateService, setTranslateService] = useState<string>(DEFAULT_VALUE.TRANSLATE_SERVICE);
  const [services, setServices] = useState<TranslateServiceMeta[]>([]);
  const [defaultStrategy, setDefaultStrategy] = useState<DEFAULT_STRATEGY>(DEFAULT_STRATEGY.AUTO);

  // Domain lists
  const [alwaysList, setAlwaysList] = useState<DomainItem[]>([]);
  const [neverList, setNeverList] = useState<DomainItem[]>([]);
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [neverOpen, setNeverOpen] = useState(false);

  const [ready, setReady] = useState(false);

  const refreshDomains = async () => {
    const [a, n] = await Promise.all([
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { strategy: DOMAIN_STRATEGY.ALWAYS },
      }),
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { strategy: DOMAIN_STRATEGY.NEVER },
      }),
    ]);
    setAlwaysList(Array.isArray(a) ? a : []);
    setNeverList(Array.isArray(n) ? n : []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bh, fb, vs, tl, ts, disabled, ds] = await Promise.all([
        getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        getConfig(CONFIG_KEY.FLOAT_BALL_SWITCH),
        getConfig(CONFIG_KEY.VIEW_STRATEGY),
        getConfig(CONFIG_KEY.TARGET_LANG),
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
      ]);
      if (cancelled) return;
      setHighlight(bh === undefined ? true : bh);
      setFloatBall(fb === undefined ? true : fb);
      setViewStrategy(vs === undefined ? DEFAULT_VALUE.VIEW_STRATEGY : vs);
      setTargetLang(tl === undefined ? DEFAULT_VALUE.TARGET_LANG : tl);
      setTranslateService(ts === undefined ? DEFAULT_VALUE.TRANSLATE_SERVICE : ts);
      const disabledSet = new Set<string>(Array.isArray(disabled) ? disabled : []);
      setServices(
        Array.from(TRANSLATE_SERVICES.values()).filter((s) => !disabledSet.has(s.value)),
      );
      if (ds === DEFAULT_STRATEGY.ALWAYS || ds === DEFAULT_STRATEGY.NEVER || ds === DEFAULT_STRATEGY.AUTO) {
        setDefaultStrategy(ds);
      }
      await refreshDomains();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onHighlight = (v: boolean) => {
    setHighlight(v);
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, v);
  };

  const onFloatBall = (v: boolean) => {
    setFloatBall(v);
    void setConfig(CONFIG_KEY.FLOAT_BALL_SWITCH, v);
    void sendMessageToAllTabs({ action: TB_ACTION.FLOAT_BALL_SWITCH, data: v });
  };

  const onViewStrategy = (v: string) => {
    setViewStrategy(v);
    void setConfig(CONFIG_KEY.VIEW_STRATEGY, v);
    void sendMessageToAllTabs({ action: ACTION.VIEW_STRATEGY_CHANGE, data: v });
  };

  const onTargetLang = (v: string) => {
    setTargetLang(v);
    void setConfig(CONFIG_KEY.TARGET_LANG, v);
    void sendMessageToAllTabs({ action: ACTION.TARGET_LANG_CHANGE, data: v });
  };

  const onTranslateService = (v: string) => {
    setTranslateService(v);
    void setConfig(CONFIG_KEY.TRANSLATE_SERVICE, v);
    void sendMessageToAllTabs({ action: ACTION.TRANSLATE_SERVICE_CHANGE, data: v });
  };

  const onDefaultStrategyChange = (v: DEFAULT_STRATEGY) => {
    setDefaultStrategy(v);
    void setConfig(CONFIG_KEY.DEFAULT_STRATEGY, v);
    void sendMessageToAllTabs({ action: ACTION.DEFAULT_STRATEGY_CHANGE, data: v });
  };

  if (!ready) {
    return <div className="h-[480px] rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <SettingRow
          label={t('bilingualComparisonHighlighting', 'Bilingual comparison highlighting')}
          control={<Switch checked={highlight} onCheckedChange={onHighlight} />}
        />
        <SettingRow
          label={t('floatBall', 'Float ball')}
          control={<Switch checked={floatBall} onCheckedChange={onFloatBall} />}
        />
        <SettingRow
          label={t('displayMode', 'Display mode')}
          control={
            <Select value={viewStrategy} onValueChange={onViewStrategy}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEW_STRATEGIES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {t(item.title, item.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('targetLanguage', 'Target language')}
          control={
            <Select value={targetLang} onValueChange={onTargetLang}>
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
          label={t('translateService', 'Translate service')}
          control={
            <Select value={translateService} onValueChange={onTranslateService}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {t(s.title, s.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('defaultTranslateStrategy', 'Default translate strategy')}
          control={
            <Select
              value={defaultStrategy}
              onValueChange={(v) => onDefaultStrategyChange(v as DEFAULT_STRATEGY)}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_STRATEGY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.title, opt.fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      <DomainListSection
        title={t('alwaysTranslateWebsites', 'Always translate websites')}
        emptyHint={t('noDomainsConfigured', 'No websites configured.')}
        open={alwaysOpen}
        onToggle={() => setAlwaysOpen((o) => !o)}
        items={alwaysList}
        otherItems={neverList}
        kind={{ field: 'strategy', strategy: DOMAIN_STRATEGY.ALWAYS }}
        onChanged={refreshDomains}
      />

      <DomainListSection
        title={t('neverTranslateWebsites', 'Never translate websites')}
        emptyHint={t('noDomainsConfigured', 'No websites configured.')}
        open={neverOpen}
        onToggle={() => setNeverOpen((o) => !o)}
        items={neverList}
        otherItems={alwaysList}
        kind={{ field: 'strategy', strategy: DOMAIN_STRATEGY.NEVER }}
        onChanged={refreshDomains}
      />
    </div>
  );
}
