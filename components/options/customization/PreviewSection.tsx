import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The framed "Preview" block at the bottom of a customization card.
 *
 * Lives outside the card's deactivated body on purpose — see
 * `CollapsibleCard`'s `footer` prop — and reads its settings ungated (the
 * `ignoreSwitch` option on the prefs hooks). The master switch decides whether
 * the real surface obeys these settings; the preview's job is to show what they
 * do, so it keeps drawing them either way. Letting the switch dim it or reset
 * it to the stock layout would hide precisely what the user is adjusting.
 */
export function PreviewSection({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3.5 flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink">{t('preview', 'Preview')}</span>
      <div className="flex justify-center rounded-lg border border-dashed border-line bg-bg/40 p-4">
        {children}
      </div>
    </div>
  );
}
