import { Keyboard, MousePointerClick, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/options/CollapsibleCard';
import { CustomShortcutCard } from '@/components/options/customization/CustomShortcutCard';
import {
  SelectionPopupCard,
  useSelectionPopupDefaults,
} from '@/components/options/customization/SelectionPopupCard';
import { CONFIG_KEY } from '@/main/constants';
import { setConfig } from '@/utils/db';
import { useConfig } from '@/utils/reactiveConfig';

/**
 * Customization — opt-in surfaces that change how the extension is *driven*,
 * rather than what it translates. Every card here ships collapsed and switched
 * off: each one claims input the page might want for itself.
 */
export function CustomizationPage() {
  const { t } = useTranslation();
  const shortcutsOn = useConfig<boolean>(CONFIG_KEY.CUSTOM_SHORTCUT_SWITCH);
  const selectionPopupOn = useConfig<boolean>(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH);
  const selectionPopupDefaults = useSelectionPopupDefaults();

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleCard
        title={t('shortcuts', 'Shortcuts')}
        hint={t('customShortcutsCardHint', 'Trigger actions with a single press, a long press or a multi-press')}
        icon={<Keyboard className="h-3.5 w-3.5" strokeWidth={1.6} />}
        enabled={shortcutsOn}
        onEnabledChange={(v) => void setConfig(CONFIG_KEY.CUSTOM_SHORTCUT_SWITCH, v)}
      >
        <CustomShortcutCard />
      </CollapsibleCard>

      <CollapsibleCard
        title={t('customSelectionPopup', 'Selection translate popup')}
        // hint={t('customSelectionPopupHint', 'Customize the card shown after selecting text')}
        icon={<MousePointerClick className="h-3.5 w-3.5" strokeWidth={1.6} />}
        enabled={selectionPopupOn}
        onEnabledChange={(v) => void setConfig(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH, v)}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={selectionPopupDefaults.restore}
            disabled={!selectionPopupDefaults.dirty}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('restoreDefaults', 'Restore defaults')}
          </Button>
        }
      >
        <SelectionPopupCard />
      </CollapsibleCard>
    </div>
  );
}
