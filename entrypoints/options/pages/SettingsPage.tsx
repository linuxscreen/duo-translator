import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACTION,
  CONFIG_KEY,
  INTERFACE_LANGUAGES,
  TAB_ACTION,
  type InterfaceLang,
} from '@/main/constants';
import { sendMessageToAllTabs, sendMessageToBackground } from '@/utils/message';
import { getConfig, setConfig } from '@/utils/db';
import { SettingRow } from '@/components/options/SettingRow';
import { SyncAndBackupSection } from '@/components/options/SyncAndBackupSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { THEME_OPTIONS, useThemeSetting, type ThemeSetting } from '@/utils/theme';
import { normalizeInterfaceLang } from '@/utils/interfaceLang';

export function SettingsPage() {
  const { t, i18n } = useTranslation();

  const [interfaceLang, setInterfaceLang] = useState<InterfaceLang>(
    () => normalizeInterfaceLang(i18n.language) ?? 'en',
  );
  const [globalSwitch, setGlobalSwitch] = useState(true);
  const [contextMenu, setContextMenu] = useState(true);
  const [ready, setReady] = useState(false);
  // Reactive view — stays in sync if the theme is flipped from the popup
  // while this page is open.
  const theme = useThemeSetting();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [il, gs, cm] = await Promise.all([
        getConfig(CONFIG_KEY.INTERFACE_LANGUAGE),
        getConfig(CONFIG_KEY.GLOBAL_SWITCH),
        getConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH),
      ]);
      if (cancelled) return;
      const lang = normalizeInterfaceLang(il);
      if (lang) setInterfaceLang(lang);
      setGlobalSwitch(gs === undefined ? true : gs);
      setContextMenu(cm === undefined ? true : cm);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onInterfaceLang = (raw: string) => {
    const v = normalizeInterfaceLang(raw);
    if (!v) return;
    setInterfaceLang(v);
    void setConfig(CONFIG_KEY.INTERFACE_LANGUAGE, v);
    void i18n.changeLanguage(v);
    void sendMessageToBackground({ action: ACTION.INTERFACE_LANGUAGE_CHANGED, data: v });
    void sendMessageToAllTabs({ action: ACTION.INTERFACE_LANGUAGE_CHANGED, data: v }, false);
  };

  const onTheme = (v: string) => {
    if (v !== 'system' && v !== 'light' && v !== 'dark') return;
    // The storage change event re-themes this page (and every other open
    // surface) via the watcher installed in initExtensionPageTheme().
    void setConfig(CONFIG_KEY.THEME, v as ThemeSetting);
  };

  const onGlobalSwitch = (v: boolean) => {
    setGlobalSwitch(v);
    void setConfig(CONFIG_KEY.GLOBAL_SWITCH, v);
    let message = { action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.GLOBAL_SWITCH]: v } };
    void sendMessageToAllTabs(message, false);
    void sendMessageToBackground(message);
  };

  const onContextMenu = (v: boolean) => {
    setContextMenu(v);
    void setConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH, v);
    let message = { action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.CONTEXT_MENU_SWITCH]: v } }
    void sendMessageToBackground(message);
    void sendMessageToAllTabs(message, false);
  };

  if (!ready) {
    return <div className="h-60 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <SettingRow
          label={t('interfaceLanguage', 'Interface language')}
          control={
            <Select value={interfaceLang} onValueChange={onInterfaceLang}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERFACE_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('theme', 'Theme')}
          control={
            <Select value={theme} onValueChange={onTheme}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.i18nKey, o.fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('globalSwitch', 'Global switch')}
          control={<Switch checked={globalSwitch} onCheckedChange={onGlobalSwitch} />}
        />
        <SettingRow
          label={t('contextMenu', 'Context menu')}
          control={<Switch checked={contextMenu} onCheckedChange={onContextMenu} />}
        />
      </div>

      <h2 className="text-[14px] font-medium text-ink-soft">
        {t('syncAndBackup', 'Sync & Backup')}
      </h2>
      <SyncAndBackupSection />
    </div>
  );
}
