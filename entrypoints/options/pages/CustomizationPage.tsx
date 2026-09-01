import { AppWindow, Keyboard, MousePointerClick, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/options/CollapsibleCard';
import { CustomShortcutCard } from '@/components/options/customization/CustomShortcutCard';
import {
  SelectionPopupCard,
  useSelectionPopupDefaults,
} from '@/components/options/customization/SelectionPopupCard';
import { PopupCard, usePopupDefaults } from '@/components/options/customization/PopupCard';
import { CONFIG_KEY } from '@/main/constants';
import { setConfig } from '@/utils/db';
import { useConfig, useConfigHydrated } from '@/utils/reactiveConfig';

/**
 * Customization — opt-in surfaces that change how the extension is *driven*,
 * rather than what it translates. Every card here ships collapsed and switched
 * off: each one claims input the page might want for itself.
 */
export function CustomizationPage() {
  const { t } = useTranslation();
  // The three switches are the only thing on this page whose first paint could
  // be wrong — everything else here is static until a card is expanded, by
  // which time config has long landed. See useConfigHydrated.
  const switchesReady = useConfigHydrated(
    CONFIG_KEY.CUSTOM_SHORTCUT_SWITCH,
    CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH,
    CONFIG_KEY.CUSTOM_POPUP_SWITCH,
  );
  const shortcutsOn = useConfig<boolean>(CONFIG_KEY.CUSTOM_SHORTCUT_SWITCH);
  const selectionPopupOn = useConfig<boolean>(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH);
  const selectionPopupDefaults = useSelectionPopupDefaults();
  const popupOn = useConfig<boolean>(CONFIG_KEY.CUSTOM_POPUP_SWITCH);
  const popupDefaults = usePopupDefaults();

  /** The header action shared by the cards that have restorable settings. */
  function restoreButton({ dirty, restore }: { dirty: boolean; restore: () => void }) {
    return (
      <Button variant="outline" size="sm" onClick={restore} disabled={!dirty}>
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('restoreDefaults', 'Restore defaults')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-ink-soft">
        {t('customizationPageHint', 'Advanced features and UI customization')}
      </p>

      <CollapsibleCard
        // Not `shortcuts`: that label belongs to the sidebar page for the
        // BROWSER shortcuts, and two settings entries with the same name is
        // the confusion this card kept causing. "Function" is the word the
        // bindings table below already uses for what a gesture triggers.
        title={t('functionShortcuts', 'Function shortcuts')}
        hint={t('customShortcutsCardHint', 'Trigger actions with a single press, a long press or a multi-press')}
        icon={<Keyboard className="h-3.5 w-3.5" strokeWidth={1.6} />}
        enabled={shortcutsOn}
        pending={!switchesReady}
        onEnabledChange={(v) => void setConfig(CONFIG_KEY.CUSTOM_SHORTCUT_SWITCH, v)}
      >
        <CustomShortcutCard />
      </CollapsibleCard>

      <CollapsibleCard
        title={t('customSelectionPopup', 'Selection translate popup')}
        // hint={t('customSelectionPopupHint', 'Customize the card shown after selecting text')}
        icon={<MousePointerClick className="h-3.5 w-3.5" strokeWidth={1.6} />}
        enabled={selectionPopupOn}
        pending={!switchesReady}
        onEnabledChange={(v) => void setConfig(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH, v)}
        action={restoreButton(selectionPopupDefaults)}
      >
        <SelectionPopupCard />
      </CollapsibleCard>

      <CollapsibleCard
        title={t('customPopup', 'Extension popup')}
        hint={t('customPopupHint', 'The panel that opens when you click the extension icon')}
        icon={<AppWindow className="h-3.5 w-3.5" strokeWidth={1.6} />}
        enabled={popupOn}
        pending={!switchesReady}
        onEnabledChange={(v) => void setConfig(CONFIG_KEY.CUSTOM_POPUP_SWITCH, v)}
        action={restoreButton(popupDefaults)}
      >
        <PopupCard />
      </CollapsibleCard>
    </div>
  );
}
