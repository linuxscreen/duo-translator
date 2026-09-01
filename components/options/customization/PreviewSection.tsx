import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The framed "Preview" block at the bottom of a customization card.
 *
 * The master switch reaches it in one way and not the other, and the split is
 * the point:
 *
 *  - WHAT it draws ignores the switch (the `ignoreSwitch` option on the prefs
 *    hooks). The settings above are what the user is adjusting, so the preview
 *    keeps showing them; snapping back to the stock layout the moment the
 *    switch goes off would hide exactly the thing being looked at.
 *  - HOW it draws follows the switch, because it sits inside the card's
 *    deactivated body: greyed out and inert, saying these settings are not in
 *    effect right now — which is the one thing the switch does decide.
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
