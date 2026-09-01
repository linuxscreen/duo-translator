import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { PreviewSection } from './PreviewSection';
import { SelectionPopupPreview } from './SelectionPopupPreview';
import { CONFIG_KEY, configDefault } from '@/main/constants';
import { setConfig } from '@/utils/db';
import { useConfig } from '@/utils/reactiveConfig';
import { SELECTION_POPUP_UI_KEYS } from '@/main/aiWriting/selectionPopupPrefs';

/**
 * Every key "Restore defaults" covers — i.e. the card's own settings, NOT the
 * card's master switch in the header. Resetting that would switch the feature
 * off from inside itself, which is a different action than "put these options
 * back", and the user is standing in the open card when they press it.
 *
 * Shared with Options › Selection translation, whose "Restore default
 * interface" button puts back the same keys (and then switches the card off) —
 * two buttons claiming to restore the same card must restore the same keys.
 */
const OPTION_KEYS: CONFIG_KEY[] = SELECTION_POPUP_UI_KEYS;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Restore defaults" as a hook, because the button that drives it lives in the
 * CARD HEADER — rendered by CustomizationPage, next to the master switch —
 * while the keys and the comparison belong here with the settings themselves.
 */
export function useSelectionPopupDefaults(): { dirty: boolean; restore: () => void } {
  const current: Record<string, unknown> = {
    [CONFIG_KEY.SELECTION_POPUP_DICT]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT),
    [CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES),
    [CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL),
    [CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS),
    [CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY),
    [CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS),
    [CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY),
    [CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG),
  };
  return {
    // Compared against the shipped defaults rather than a second hardcoded
    // list: a default edited in constants.ts must not leave this button
    // asserting the old one. It also drives `disabled` — a reset that would
    // change nothing is better greyed out than silently inert.
    dirty: OPTION_KEYS.some((k) => !sameValue(current[k], configDefault(k))),
    restore: () => {
      for (const key of OPTION_KEYS) void setConfig(key, configDefault(key));
    },
  };
}

/** One switch. The divider is on the row so a list never ends with a dangling line. */
function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-ink-soft">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function SelectionPopupCard() {
  const { t } = useTranslation();

  const dict = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT);
  const dictExamples = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES);
  const showOriginal = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL);
  const translationTts = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS);
  const translationCopy = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY);
  const originalTts = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS);
  const originalCopy = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY);
  const hideHeaderConfig = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG);

  return (
    <div className="flex flex-col gap-5">
      <Row
        label={t('selectionPopupHideHeaderConfig', 'Hide the header pickers')}
        hint={t(
          'selectionPopupHideHeaderConfigHint',
          'Translate service and target language move to the settings button left of the pin',
        )}
        checked={hideHeaderConfig}
        onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG, v)}
      />

      {/* Dependent switches are not greyed out — they are simply absent while
          their section head is off. A disabled ghost row reads as "broken"
          rather than "not applicable", and the section heading already says
          what the rows below it belong to. */}
      <Section title={t('selectionPopupSectionOriginal', 'Original text')}>
        <Row
          label={t('selectionPopupShowOriginal', 'Show original text')}
          checked={showOriginal}
          onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL, v)}
        />
        {showOriginal && (
          <>
            <Row
              label={t('selectionPopupPlayButton', 'Play button')}
              checked={originalTts}
              onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS, v)}
            />
            <Row
              label={t('selectionPopupCopyButton', 'Copy button')}
              checked={originalCopy}
              onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY, v)}
            />
          </>
        )}
      </Section>

      <Section title={t('selectionPopupSectionTranslation', 'Translation')}>
        <Row
          label={t('selectionPopupPlayButton', 'Play button')}
          checked={translationTts}
          onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS, v)}
        />
        <Row
          label={t('selectionPopupCopyButton', 'Copy button')}
          checked={translationCopy}
          onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY, v)}
        />
      </Section>

      <Section title={t('selectionPopupDict', 'Dictionary')}>
        <Row
          label={t('selectionPopupShowDict', 'Show dictionary')}
          checked={dict}
          onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_DICT, v)}
        />
        {dict && (
          <Row
            label={t('dictExamples', 'Examples')}
            checked={dictExamples}
            onChange={(v) => void setConfig(CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES, v)}
          />
        )}
      </Section>

      <PreviewSection>
        <SelectionPopupPreview />
      </PreviewSection>
    </div>
  );
}
