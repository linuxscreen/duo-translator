import { ExternalLink, Globe, KeyRound, Languages, SlidersHorizontal, Sparkles, Component } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Translation, useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SettingsPage } from './pages/SettingsPage';
import { ShortcutsPage } from './pages/ShortcutsPage';
import { TranslationPage } from './pages/TranslationPage';
import { AiWritingPage } from './pages/AiWritingPage';
import { browser } from 'wxt/browser';
import { ServicesPage } from './pages/ServicesPage';

type TabId = 'settings' | 'services' | 'translation' | 'aiWriting' | 'shortcuts';

type Tab = {
  id: TabId;
  label: string;
  icon: ReactNode;
};

export default function App() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('settings');

  const tabs: Tab[] = [
    {
      id: 'settings',
      label: t('basicSettings', 'Basic Settings'),
      icon: <SlidersHorizontal className="h-4 w-4" strokeWidth={1.6} />,
    },
    {
      id: 'services',
      label: t('services', 'Services'),
      icon: <Component className="h-4 w-4" strokeWidth={1.6} />,
    },
    {
      id: 'translation',
      label: t('translation', 'Translation'),
      icon: <Languages className="h-4 w-4" strokeWidth={1.6} />,
    },
    {
      id: 'aiWriting',
      label: t('aiWriting', 'AI Writing'),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.6} />,
    },
    {
      id: 'shortcuts',
      label: t('shortcuts', 'Shortcuts'),
      icon: <KeyRound className="h-4 w-4" strokeWidth={1.6} />,
    },
  ];

  const openUrl = (url: string) => {
    browser.tabs.create({ url });
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="min-h-screen w-full">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <img src="/DuoTranslator.svg" alt="" className="h-8 w-8" />
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-ink">DUO</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">
              Translator
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openUrl('https://duo.zeroflx.com/')}>
            <Globe className="h-3.5 w-3.5" strokeWidth={1.6} />
            {t('officialWebsite', 'Official Website')}
          </Button>
          <Button
            size="sm"
            onClick={() => openUrl('https://github.com/linuxscreen/duo-translator')}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
            GitHub
          </Button>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="mx-auto flex w-full max-w-5xl gap-6 px-6 py-8">
        {/* Sidebar */}
        <nav className="w-56 shrink-0">
          <div className="sticky top-20 flex flex-col gap-1 rounded-xl border border-line bg-surface/60 p-2 backdrop-blur-sm">
            {tabs.map((it) => {
              const active = tab === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setTab(it.id)}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px]',
                    'transition-colors duration-150',
                    active
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-soft hover:bg-hover hover:text-ink',
                  )}
                >
                  <span
                    className={cn(
                      'transition-colors',
                      active ? 'text-accent' : 'text-ink-mute group-hover:text-ink',
                    )}
                  >
                    {it.icon}
                  </span>
                  <span className="flex-1 font-medium">{it.label}</span>
                  {active && (
                    <span className="absolute right-2 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent-glow)]" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right content */}
        <main className="min-w-0 flex-1">
          <h1 className="mb-4 text-[18px] font-semibold tracking-tight text-ink">
            {tabs.find((x) => x.id === tab)?.label}
          </h1>
          {tab === 'settings' && <SettingsPage />}
          {tab === 'services' && <ServicesPage />}
          {tab === 'translation' && <TranslationPage />}
          {tab === 'aiWriting' && <AiWritingPage />}
          {tab === 'shortcuts' && <ShortcutsPage />}
        </main>
      </div>
    </div>
    </TooltipProvider>
  );
}
