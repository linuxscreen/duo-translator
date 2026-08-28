import { ExternalLink, Globe, KeyRound, Languages, SlidersHorizontal, Sparkles, Component, Captions, Wand2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Translation, useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SettingsPage } from './pages/SettingsPage';
import { ShortcutsPage } from './pages/ShortcutsPage';
import { TranslationPage } from './pages/TranslationPage';
import { SiteRulesPage } from './pages/SiteRulesPage';
import { AiWritingPage } from './pages/AiWritingPage';
import { VideoSubtitlePage } from './pages/VideoSubtitlePage';
import { browser } from 'wxt/browser';
import { ServicesPage } from './pages/ServicesPage';
import { CustomizationPage } from './pages/CustomizationPage';
import { APP_NAME, APP_NAME_PASCAL_CASE } from '@/main/constants';

type TabId = 'settings' | 'services' | 'translation' | 'aiWriting' | 'videoSubtitle' | 'shortcuts' | 'customization';

type Tab = {
  id: TabId;
  label: string;
  icon: ReactNode;
};

const VALID_TABS: TabId[] = ['settings', 'services', 'translation', 'aiWriting', 'videoSubtitle', 'shortcuts', 'customization'];

/** Sub-pages, addressed as `#<tab>/<sub>`. Only the Translation tab has one so far. */
type SubId = 'siteRules';
const VALID_SUBS: SubId[] = ['siteRules'];

type Route = { tab: TabId; sub: SubId | null };

/**
 * Two-segment hash route. The first segment is still the sidebar tab, so every
 * existing `#services`-style link keeps working; a second segment opens a
 * sub-page inside that tab.
 */
function parseRoute(): Route {
  const [rawTab, rawSub] = window.location.hash.replace(/^#/, '').split('/');
  const tab = (VALID_TABS as string[]).includes(rawTab) ? (rawTab as TabId) : 'settings';
  const sub = (VALID_SUBS as string[]).includes(rawSub) ? (rawSub as SubId) : null;
  return { tab, sub };
}

export default function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<Route>(parseRoute);
  const { tab, sub } = route;

  // The hash is the single source of truth for where we are, so browser Back /
  // Forward just work: every navigation writes a real history entry (assigning
  // `location.hash`, NOT history.replaceState — replaceState overwrites the
  // current entry, which is exactly why Back used to leave the page), and this
  // listener is the ONLY thing that moves the React state. Back/Forward and an
  // in-page click therefore travel the identical path.
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: Route) => {
    const hash = `#${next.tab}${next.sub ? `/${next.sub}` : ''}`;
    if (window.location.hash === hash) {
      // No hashchange will fire; nothing to navigate to either.
      setRoute(next);
      return;
    }
    window.location.hash = hash;
  };

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
      id: 'videoSubtitle',
      label: t('videoSubtitle', 'Video Subtitles'),
      icon: <Captions className="h-4 w-4" strokeWidth={1.6} />,
    },
    {
      id: 'shortcuts',
      label: t('shortcuts', 'Shortcuts'),
      icon: <KeyRound className="h-4 w-4" strokeWidth={1.6} />,
    },
    {
      id: 'customization',
      label: t('customization', 'Customization'),
      icon: <Wand2 className="h-4 w-4" strokeWidth={1.6} />,
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
          <img src={`${APP_NAME_PASCAL_CASE}.svg`} alt="" className="h-5 w-5" />
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-ink">DUO</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">
              Translator
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openUrl(import.meta.env.VITE_WEBSITE)}>
            <Globe className="h-3.5 w-3.5" strokeWidth={1.6} />
            {t('officialWebsite', 'Website')}
          </Button>
          <Button
            size="sm"
            onClick={() => openUrl(import.meta.env.VITE_GITHUB_URL)}
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
                  onClick={() => navigate({ tab: it.id, sub: null })}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px]',
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
            {sub === 'siteRules'
              ? t('websiteTranslationRules', 'Website translation rules')
              : tabs.find((x) => x.id === tab)?.label}
          </h1>
          {tab === 'settings' && <SettingsPage />}
          {tab === 'services' && <ServicesPage />}
          {tab === 'translation' &&
            (sub === 'siteRules' ? (
              <SiteRulesPage onBack={() => navigate({ tab: 'translation', sub: null })} />
            ) : (
              <TranslationPage onOpenSiteRules={() => navigate({ tab: 'translation', sub: 'siteRules' })} />
            ))}
          {tab === 'aiWriting' && <AiWritingPage />}
          {tab === 'videoSubtitle' && <VideoSubtitlePage />}
          {tab === 'shortcuts' && <ShortcutsPage />}
          {tab === 'customization' && <CustomizationPage />}
        </main>
      </div>
    </div>
    </TooltipProvider>
  );
}
