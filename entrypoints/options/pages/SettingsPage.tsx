import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CONFIG_KEY,
  DEFAULT_VALUE,
  LANGUAGES,
  TB_ACTION,
  TRANSLATE_SERVICES,
  VIEW_STRATEGIES,
  type TranslateServiceMeta,
} from '@/main/constants';
import {
  getConfig,
  sendMessageToAllTabs,
  sendMessageToBackground,
  setConfig,
} from '@/utils/message';
import { SettingRow } from '@/components/options/SettingRow';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export function SettingsPage() {
  const { t } = useTranslation();

  const [globalSwitch, setGlobalSwitch] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [floatBall, setFloatBall] = useState(true);
  const [contextMenu, setContextMenu] = useState(true);
  const [viewStrategy, setViewStrategy] = useState<string>(DEFAULT_VALUE.VIEW_STRATEGY);
  const [targetLang, setTargetLang] = useState<string>(DEFAULT_VALUE.TARGET_LANG);
  const [translateService, setTranslateService] = useState<string>(DEFAULT_VALUE.TRANSLATE_SERVICE);
  const [services, setServices] = useState<TranslateServiceMeta[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [gs, bh, fb, cm, vs, tl, ts, disabled] = await Promise.all([
        getConfig(CONFIG_KEY.GLOBAL_SWITCH),
        getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        getConfig(CONFIG_KEY.FLOAT_BALL_SWITCH),
        getConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH),
        getConfig(CONFIG_KEY.VIEW_STRATEGY),
        getConfig(CONFIG_KEY.TARGET_LANG),
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE),
      ]);
      if (cancelled) return;
      setGlobalSwitch(gs === undefined ? true : gs);
      setHighlight(bh === undefined ? true : bh);
      setFloatBall(fb === undefined ? true : fb);
      setContextMenu(cm === undefined ? true : cm);
      setViewStrategy(vs === undefined ? DEFAULT_VALUE.VIEW_STRATEGY : vs);
      setTargetLang(tl === undefined ? DEFAULT_VALUE.TARGET_LANG : tl);
      setTranslateService(ts === undefined ? DEFAULT_VALUE.TRANSLATE_SERVICE : ts);

      const disabledSet = new Set<string>(Array.isArray(disabled) ? disabled : []);
      setServices(
        Array.from(TRANSLATE_SERVICES.values()).filter((s) => !disabledSet.has(s.value)),
      );
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onGlobalSwitch = (v: boolean) => {
    setGlobalSwitch(v);
    void setConfig(CONFIG_KEY.GLOBAL_SWITCH, v);
  };

  const onHighlight = (v: boolean) => {
    setHighlight(v);
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, v);
  };

  const onFloatBall = (v: boolean) => {
    setFloatBall(v);
    void setConfig(CONFIG_KEY.FLOAT_BALL_SWITCH, v);
    void sendMessageToAllTabs({ action: TB_ACTION.FLOAT_BALL_SWITCH, data: v });
  };

  const onContextMenu = (v: boolean) => {
    setContextMenu(v);
    void setConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH, v);
    void sendMessageToBackground({
      action: TB_ACTION.CONTEXT_MENU_SWITCH,
      data: { contextMenuSwitch: v },
    });
  };

  const onViewStrategy = (v: string) => {
    setViewStrategy(v);
    void setConfig(CONFIG_KEY.VIEW_STRATEGY, v);
  };

  const onTargetLang = (v: string) => {
    setTargetLang(v);
    void setConfig(CONFIG_KEY.TARGET_LANG, v);
  };

  const onTranslateService = (v: string) => {
    setTranslateService(v);
    void setConfig(CONFIG_KEY.TRANSLATE_SERVICE, v);
  };

  if (!ready) {
    return <div className="h-[480px] rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  return (
    <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
      <SettingRow
        label={t('globalSwitch', 'Global switch')}
        control={<Switch checked={globalSwitch} onCheckedChange={onGlobalSwitch} />}
      />
      <SettingRow
        label={t('bilingualHighlighting', 'Bilingual highlighting')}
        control={<Switch checked={highlight} onCheckedChange={onHighlight} />}
      />
      <SettingRow
        label={t('floatBall', 'Float ball')}
        control={<Switch checked={floatBall} onCheckedChange={onFloatBall} />}
      />
      <SettingRow
        label={t('contextMenu', 'Context menu')}
        control={<Switch checked={contextMenu} onCheckedChange={onContextMenu} />}
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
    </div>
  );
}
