import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACTION,
  CONFIG_KEY,
  INTERFACE_LANGUAGES,
  TB_ACTION,
  type InterfaceLang,
} from '@/main/constants';
import { sendMessageToBackground } from '@/utils/message';
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

export function SettingsPage() {
  const { t, i18n } = useTranslation();

  const detectInterfaceLang = (): InterfaceLang =>
    (i18n.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

  const [interfaceLang, setInterfaceLang] = useState<InterfaceLang>(detectInterfaceLang);
  const [globalSwitch, setGlobalSwitch] = useState(true);
  const [contextMenu, setContextMenu] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [il, gs, cm] = await Promise.all([
        getConfig(CONFIG_KEY.INTERFACE_LANG),
        getConfig(CONFIG_KEY.GLOBAL_SWITCH),
        getConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH),
      ]);
      if (cancelled) return;
      if (il === 'en' || il === 'zh-CN') setInterfaceLang(il);
      setGlobalSwitch(gs === undefined ? true : gs);
      setContextMenu(cm === undefined ? true : cm);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onInterfaceLang = (v: string) => {
    if (v !== 'en' && v !== 'zh-CN') return;
    setInterfaceLang(v);
    void setConfig(CONFIG_KEY.INTERFACE_LANG, v);
    void i18n.changeLanguage(v);
    void sendMessageToBackground({ action: ACTION.INTERFACE_LANG_CHANGE, data: v });
  };

  const onGlobalSwitch = (v: boolean) => {
    setGlobalSwitch(v);
    void setConfig(CONFIG_KEY.GLOBAL_SWITCH, v);
  };

  const onContextMenu = (v: boolean) => {
    setContextMenu(v);
    void setConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH, v);
    void sendMessageToBackground({
      action: TB_ACTION.CONTEXT_MENU_SWITCH,
      data: { contextMenuSwitch: v },
    });
  };

  if (!ready) {
    return <div className="h-60 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  return (
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
        label={t('globalSwitch', 'Global switch')}
        control={<Switch checked={globalSwitch} onCheckedChange={onGlobalSwitch} />}
      />
      <SettingRow
        label={t('contextMenu', 'Context menu')}
        control={<Switch checked={contextMenu} onCheckedChange={onContextMenu} />}
      />
    </div>
  );
}
