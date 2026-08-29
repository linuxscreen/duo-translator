import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { CONFIG_KEY, configDefault } from '@/main/constants';
import { setConfig } from '@/utils/db';
import { useConfig } from '@/utils/reactiveConfig';
import { POPUP_UI_OPTION_KEYS } from '@/utils/popupUiPrefs';
import { PopupPreview } from './PopupPreview';

/**
 * "Restore defaults" as a hook, because the button that drives it lives in the
 * CARD HEADER — rendered by CustomizationPage, next to the master switch —
 * while the keys and the comparison belong here with the settings themselves.
 * The card's own master switch is deliberately NOT included: resetting it would
 * switch the feature off from inside itself, which is a different action.
 */
export function usePopupUiDefaults(): { dirty: boolean; restore: () => void } {
  const current: Record<string, unknown> = {
    [CONFIG_KEY.POPUP_SHOW_THEME]: useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_THEME),
    [CONFIG_KEY.POPUP_SHOW_HELP]: useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_HELP),
    [CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH]: useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH),
    [CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY]: useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY),
    [CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT]: useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT),
    [CONFIG_KEY.POPUP_SHOW_AI_WRITING]: useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_AI_WRITING),
  };
  return {
    // Compared against the shipped defaults rather than a second hardcoded
    // list, and the same comparison disables the button — a reset that would
    // change nothing is better greyed out than silently inert.
    dirty: POPUP_UI_OPTION_KEYS.some((k) => current[k] !== configDefault(k)),
    restore: () => {
      for (const key of POPUP_UI_OPTION_KEYS) void setConfig(key, configDefault(key));
    },
  };
}

/** One switch. The divider is on the row so the list never ends with a dangling line. */
function Row({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0 text-[13px] text-ink">{label}</div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function PopupUiCard() {
  const { t } = useTranslation();

  const theme = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_THEME);
  const help = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_HELP);
  const globalSwitch = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH);
  const defaultStrategy = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY);
  const bilingualHighlight = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT);
  const aiWriting = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_AI_WRITING);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col">
        <Row
          label={t('theme', 'Theme')}
          checked={theme}
          onChange={(v) => void setConfig(CONFIG_KEY.POPUP_SHOW_THEME, v)}
        />
        <Row
          label={t('helpDocument', 'Help document')}
          checked={help}
          onChange={(v) => void setConfig(CONFIG_KEY.POPUP_SHOW_HELP, v)}
        />
        <Row
          label={t('globalSwitch', 'Global switch')}
          checked={globalSwitch}
          onChange={(v) => void setConfig(CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH, v)}
        />
        <Row
          label={t('defaultTranslateStrategy', 'Default translate strategy')}
          checked={defaultStrategy}
          onChange={(v) => void setConfig(CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY, v)}
        />
        <Row
          label={t('bilingualHighlighting', 'Bilingual highlighting')}
          checked={bilingualHighlight}
          onChange={(v) => void setConfig(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT, v)}
        />
        <Row
          label={t('aiWriting', 'AI Writing')}
          checked={aiWriting}
          onChange={(v) => void setConfig(CONFIG_KEY.POPUP_SHOW_AI_WRITING, v)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-ink">{t('preview', 'Preview')}</span>
        <div className="flex justify-center rounded-lg border border-dashed border-line bg-bg/40 p-4">
          <PopupPreview />
        </div>
      </div>
    </div>
  );
}
