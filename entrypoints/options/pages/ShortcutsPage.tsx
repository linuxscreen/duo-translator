import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function ShortcutsPage() {
  const { t } = useTranslation();

  const openBrowserShortcuts = () => {
    browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  };

  return (
    <div className="rounded-xl border border-line bg-surface/60 p-6 backdrop-blur-sm">
      <p className="text-[13.5px] text-ink">
        {t('pleaseModifyInBrowserSettings', 'Please modify in browser settings')}
      </p>
      <p className="mt-1 text-[12px] text-ink-soft">
        Chrome / Edge: <span className="font-mono">chrome://extensions/shortcuts</span>
      </p>
      <Button className="mt-5" onClick={openBrowserShortcuts}>
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('settings', 'Open settings')}
      </Button>
    </div>
  );
}
