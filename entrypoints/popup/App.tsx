import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AirplayIcon, Ban, Globe, HelpCircle, PenLine, Settings as SettingsIcon, Sparkles } from 'lucide-react';

import {
  ACTION,
  APP_NAME,
  CONFIG_KEY,
  DB_ACTION,
  DEFAULT_STRATEGY,
  DEFAULT_STRATEGY_OPTIONS,
  DEFAULT_VALUE,
  DOMAIN_STRATEGY,
  LANGUAGES,
  STORAGE_ACTION,
  TAB_ACTION,
  TRANSLATE_ACTION,
  TRANSLATE_SERVICES,
  TRANSLATE_STATUS_KEY,
  TranslateServiceMeta,
  VIEW_STRATEGY,
} from '@/main/constants';
import type { AiProvider } from '@/main/aiService';
import { sendMessageToAllTabs, sendMessageToBackground, sendMessageToTab } from '@/utils/message';
import { cn } from '@/lib/cn';
import { Card, CardDivider, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ServiceMark } from '@/components/ui/service-mark';
import { Switch } from '@/components/ui/switch';
import { Browser, browser } from 'wxt/browser';
import { Button } from '@/components/ui/button';
import { use } from 'i18next';
import { buildServiceOptions, getTranslateService } from '@/utils/service';

const getConfig = (name: string) =>
  sendMessageToBackground({ action: DB_ACTION.CONFIG_GET, data: { name } });

const setConfig = (name: string, value: unknown) =>
  sendMessageToBackground({ action: DB_ACTION.CONFIG_SET, data: { name, value } });

const sectionLabelCls =
  'flex items-center gap-1.5 px-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mute';

const iconBtnCls =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors duration-150 hover:bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

export default function App() {
  const { t } = useTranslation();

  const [globalOn, setGlobalOn] = useState(true);
  const [mode, setMode] = useState<VIEW_STRATEGY>(VIEW_STRATEGY.DOUBLE);
  let lang = navigator.language.split('-')[0];
  const [targetLanguage, setTargetLanguage] = useState(lang);
  const [service, setService] = useState<string>();
  const [translateActive, setTranslateActive] = useState(false);
  const [defaultStrategy, setDefaultStrategy] = useState<DEFAULT_STRATEGY>(DEFAULT_STRATEGY.AUTO);
  const [siteRule, setSiteRule] = useState<DOMAIN_STRATEGY>(DOMAIN_STRATEGY.AUTO);
  const [highlight, setHighlight] = useState(true);
  const [domain, setDomain] = useState('');
  const [ready, setReady] = useState(false);
  // Enabled AI providers (filtered by the per-card Use-for-page toggle).
  // Appended below the built-in translation services in the dropdown.
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [translateServices, setTranslateServices] = useState<TranslateServiceMeta[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  let tabId: number | undefined

  // Close the "More" menu when clicking outside of it.
  useEffect(() => {
    if (!moreOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [moreOpen]);

  // Hydrate from background storage on mount
  useEffect(() => {
    console.log("popup mount")
    let cancelled = false;
    const listener = (message: any, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      if (message.action === TRANSLATE_ACTION.TRANSLATE_STATUS_CHANGED) {
        console.log("receive message:", message, tabId)
        if (tabId !== undefined && message.data.tabId === tabId && typeof message.data.status === 'boolean') {
          setTranslateActive(message.data.status)
        }
      }
    }
    browser.runtime.onMessage.addListener(listener);

    (async () => {
      const [gs, vs, tl, ts, ds, bh, d, id]: [
        boolean, VIEW_STRATEGY, string | undefined, string | undefined, DEFAULT_STRATEGY, boolean,
        string | undefined, number | undefined
      ] = await Promise.all([
        getConfig(CONFIG_KEY.GLOBAL_SWITCH),
        getConfig(CONFIG_KEY.VIEW_STRATEGY),
        getConfig(CONFIG_KEY.TARGET_LANGUAGE),
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
        getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        sendMessageToBackground({ action: TAB_ACTION.TAB_DOMAIN_GET }),
        sendMessageToBackground({ action: TAB_ACTION.ID_GET }),
      ]);
      tabId = id
      let { activeService, enabledTranslateServices, enabledAiProviders, aiUsedForTranslatePage } = await getTranslateService(ts);

      if (cancelled) return;
      console.log("domain: ", d)

      // Surface AI providers in the service dropdown only when:
      //  (a) the global "Also used for translating pages" toggle is on (default true)
      //  (b) the provider itself is enabled (legacy records without `enabled`
      //      are treated as enabled).
      if (aiUsedForTranslatePage) {
        setAiProviders(enabledAiProviders);
      }
      setTranslateServices(enabledTranslateServices);

      setGlobalOn(gs);
      setMode(vs);
      setTargetLanguage(tl || navigator.language.split('-')[0]);

      setService(activeService)
      console.log("service: ", service)
      setDefaultStrategy(ds);
      setHighlight(bh);
      if (typeof d === 'string') setDomain(d);

      if (typeof d === 'string' && d.length > 0) {
        const dom = await sendMessageToBackground({
          action: DB_ACTION.DOMAIN_GET,
          data: { domain: d },
        });
        if (
          !cancelled &&
          (dom?.strategy === DOMAIN_STRATEGY.NEVER || dom?.strategy === DOMAIN_STRATEGY.ALWAYS)
        ) {
          setSiteRule(dom.strategy);
        }
      }

      if (typeof id === 'number') {
        const status = await sendMessageToBackground({
          action: STORAGE_ACTION.SESSION_GET,
          data: { key: TRANSLATE_STATUS_KEY + id },
        });
        if (!cancelled && typeof status === 'boolean') setTranslateActive(status);
      }

      if (!cancelled) setReady(true);
    })();
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      cancelled = true;
    };
  }, []);

  const openHelpPage = () => {
    browser.tabs.create({ url: `${import.meta.env.VITE_WEBSITE}/docs` });
  };

  const aiWritingClick = (e: React.MouseEvent) => {
    openAiWorkbench()
  }

  const onGlobalSwitchToggle = (v: boolean) => {
    setGlobalOn(v);
    void setConfig(CONFIG_KEY.GLOBAL_SWITCH, v);
    let message = { action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.GLOBAL_SWITCH]: v } };
    void sendMessageToAllTabs(message, false)
    void sendMessageToBackground(message);
  };

  const onViewStrategyChange = (v: VIEW_STRATEGY) => {
    setMode(v);
    void setConfig(CONFIG_KEY.VIEW_STRATEGY, v);
    void sendMessageToAllTabs({ action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.VIEW_STRATEGY]: v } });
  };

  const onTargetLanguageChange = (v: string) => {
    setTargetLanguage(v);
    void setConfig(CONFIG_KEY.TARGET_LANGUAGE, v);
    void sendMessageToAllTabs({ action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.TARGET_LANGUAGE]: v } });
  };

  const onServiceChange = (v: string) => {
    setService(v);
    void setConfig(CONFIG_KEY.TRANSLATE_SERVICE, v);
    void sendMessageToAllTabs({ action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.TRANSLATE_SERVICE]: v } });
  };

  const onTranslateToggle = (active: boolean) => {
    setTranslateActive(active);
    void sendMessageToTab({ action: active ? TRANSLATE_ACTION.TRANSLATE : TRANSLATE_ACTION.SHOW_ORIGINAL }).then(() => {
      window.close()
    });
  };

  const onDefaultStrategyChange = (v: DEFAULT_STRATEGY) => {
    setDefaultStrategy(v);
    void setConfig(CONFIG_KEY.DEFAULT_STRATEGY, v);
    void sendMessageToAllTabs({ action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.DEFAULT_STRATEGY]: v } });
  };

  const onDomainStrategyChange = (v: DOMAIN_STRATEGY) => {
    setSiteRule(v);
    if (!domain) return;
    void sendMessageToBackground({
      action: DB_ACTION.DOMAIN_UPDATE,
      data: { domain, strategy: v },
    });
    void sendMessageToTab({ action: ACTION.DOMAIN_STRATEGY_CHANGED, data: v });
  };

  const onHighlightToggle = (v: boolean) => {
    setHighlight(v);
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, v);
    void sendMessageToTab({ action: ACTION.STYLE_CHANGED });
  };

  const openOptions = () => {
    browser.tabs.create({ url: "options.html" });
  };

  const openAiWorkbench = async () => {
    await sendMessageToTab({ action: ACTION.AI_OPEN_WORKBENCH });
    window.close();
  };

  const enterSelectionMode = async () => {
    setMoreOpen(false);
    await sendMessageToTab({ action: ACTION.TOGGLE_SELECTION_MODE });
    // Close the popup so the user can interact with the page to pick regions.
    window.close();
  };

  const openShortcutsPage = () => {
    browser.tabs.create({ url: "options.html#shortcuts" });
  }

  const openFeedbackPage = () => {
    browser.tabs.create({ url: `${import.meta.env.VITE_GITHUB_URL}/issues` });
  }

  // Flat (ungrouped) list of translators + AI providers — shared shape used by
  // every service picker (popup / options / AI writing). AI provider entries
  // use the `ai:<id>` value scheme the background's AI_TRANSLATE port consumes.
  const serviceList = buildServiceOptions(translateServices, aiProviders);

  const version =
    browser.runtime?.getManifest?.()?.version || '';

  if (!ready) {
    return <div className="w-95 min-h-120 bg-bg" />;
  }

  return (
    <div className="relative w-[380px] overflow-hidden bg-bg text-ink before:pointer-events-none before:absolute before:inset-0 before:opacity-50 before:bg-[radial-gradient(ellipse_80%_30%_at_50%_0%,var(--color-accent-soft),transparent_70%)]">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-line bg-surface px-3 py-2">
        <button type="button" className="flex items-center gap-2 text-left">
          <img className='w-5 h-5' src={`${APP_NAME}.svg`}></img>
          <span className='font-bold'>{APP_NAME}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* AI writing workbench button */}
          {/* <button
            type="button"
            className={iconBtnCls}
            onClick={openAiWorkbench}
            title={t('aiWorkbench', 'AI Workbench')}
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.6} />
          </button> */}
          <button type="button" className={iconBtnCls} onClick={openHelpPage} title={t('helpDocument', 'Help')}>
            <HelpCircle className="h-4 w-4" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className={iconBtnCls}
            title={t('settings', 'settings')}
            onClick={openOptions}
          >
            <SettingsIcon className="h-4 w-4" strokeWidth={1.6} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-line-strong" />
          <Switch title={t('globalSwitch', 'global switch')} checked={globalOn} onCheckedChange={onGlobalSwitchToggle} size="sm" />
        </div>
      </div>

      {/* Body */}
      <div
        className={cn(
          'relative z-10 flex flex-col gap-3 px-3 py-2.5 transition-opacity duration-200',
          !globalOn && 'pointer-events-none opacity-40',
        )}
      >
        {/* Mode + Target */}
        <div className="flex items-center gap-4 justify-between">
          <div title={t('displayMode', 'display mode')} className="flex items-center gap-1 w-1/2 justify-center">
            <Select
              value={mode}
              onValueChange={(v) => onViewStrategyChange(v as VIEW_STRATEGY)}>
              <SelectTrigger className=''>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={VIEW_STRATEGY.DOUBLE}>{t('bilingual', 'Bilingual')}</SelectItem>
                <SelectItem value={VIEW_STRATEGY.SINGLE}>{t('translationOnly', 'Translation only')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div title={t('targetLanguage', 'target language')} className="flex items-center gap-1 w-1/2">
            <Select
              value={targetLanguage}
              onValueChange={onTargetLanguageChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {t(l.title, l.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        </div>

        {/* Service */}
        <div className="flex flex-col gap-2" title={t('translationService', 'Translation Service')}>
          <Select value={service} onValueChange={onServiceChange}>
            <SelectTrigger className='items-center justify-center'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {serviceList.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <span className="flex items-center gap-3">
                    <ServiceMark id={s.iconId} />
                    {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Original / Translate segmented control */}
        <div className="relative grid h-9 grid-cols-2 rounded-lg border border-line bg-surface p-[3px]">
          <div
            className={cn(
              'pointer-events-none absolute left-[3px] top-[3px] z-0 h-[calc(100%-6px)] w-[calc(50%-3px)] rounded-md',
              'bg-gradient-to-br from-accent-strong to-accent',
              'shadow-[0_0_16px_var(--color-accent-glow),inset_0_1px_0_rgba(255,255,255,0.3)]',
              'transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
              translateActive ? 'translate-x-full' : 'translate-x-0',
            )}
          />
          <button
            type="button"
            className={cn(
              'relative z-10 cursor-pointer rounded-md text-[12.5px] font-medium transition-colors duration-200',
              translateActive ? 'text-ink-soft' : 'text-[#04060a]',
            )}
            onClick={() => onTranslateToggle(false)}
          >
            {t('original', 'Original')}
          </button>
          <button
            type="button"
            className={cn(
              'relative z-10 cursor-pointer rounded-md text-[12.5px] font-medium transition-colors duration-200',
              translateActive ? 'text-[#04060a]' : 'text-ink-soft',
            )}
            onClick={() => onTranslateToggle(true)}
          >
            {t('translate', 'Translate')}
          </button>
        </div>

        {/* Default translate strategy */}
        <Card>
          <CardTitle>{t('defaultTranslateStrategy', 'Default translate strategy')}</CardTitle>
          <RadioGroup value={defaultStrategy} onValueChange={(v) => onDefaultStrategyChange(v as DEFAULT_STRATEGY)}>
            {DEFAULT_STRATEGY_OPTIONS.map((opt) => (
              <RadioGroupItem
                value={opt.value}
                label={t(opt.title, opt.fallback)}
              />
            )
            )}
          </RadioGroup>
        </Card>

        {/* For this website */}
        <Card>
          {/* <CardTitle>{t('forThisWebsite', 'For this website')}</CardTitle> */}
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <div className="min-w-0 text-[12.5px] text-ink">
              {t('alwaysTranslateThisWebsite', 'Always translate this website')}
            </div>
            <Switch
              checked={siteRule === DOMAIN_STRATEGY.ALWAYS}
              onCheckedChange={(v) =>
                onDomainStrategyChange(v ? DOMAIN_STRATEGY.ALWAYS : DOMAIN_STRATEGY.AUTO)
              }
              size="sm"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <div className="min-w-0 text-[12.5px] text-ink">
              {t('neverTranslateThisWebsite', 'Never translate this website')}
            </div>
            <Switch
              checked={siteRule === DOMAIN_STRATEGY.NEVER}
              onCheckedChange={(v) =>
                onDomainStrategyChange(v ? DOMAIN_STRATEGY.NEVER : DOMAIN_STRATEGY.AUTO)
              }
              size="sm"
            />
          </div>
          <CardDivider />
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <div className="min-w-0">
              <div className="text-[12.5px] text-ink">
                {t('bilingualHighlighting', 'Bilingual sentence-by-sentence highlighting')}
              </div>
              <div className="mt-px text-[11px] text-ink-soft">
                {t('bilingualHighlightingHint', 'Highlight original and translation sentence by sentence')}
              </div>
            </div>
            <Switch checked={highlight} onCheckedChange={onHighlightToggle} size="sm" />
          </div>
        </Card>

        {/* AI Writing */}
        <button
          onClick={aiWritingClick}
          type="button"
          className={cn(
            'group relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-[10px] border border-line-strong px-3 py-2.5 text-left',
            'bg-gradient-to-br from-[oklch(0.22_0.04_230)] to-[oklch(0.16_0.03_245)]',
            'transition-[transform,box-shadow,border-color] duration-200',
            'hover:-translate-y-px hover:border-accent hover:shadow-[0_0_0_1px_var(--color-accent-soft),0_8px_24px_-8px_var(--color-accent-glow)]',
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(circle at 90% 50%, var(--color-accent-glow), transparent 50%), radial-gradient(circle at 10% 100%, oklch(0.6 0.2 290 / 0.3), transparent 55%)',
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
              maskImage: 'linear-gradient(135deg, transparent 50%, #000 100%)',
              WebkitMaskImage: 'linear-gradient(135deg, transparent 50%, #000 100%)',
            }}
          />
          <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-white/5 text-accent">
            <PenLine className="h-3.5 w-3.5" strokeWidth={1.6} />
          </span>
          <span className="relative z-10 flex flex-1 flex-col gap-px">
            <span className="text-[13px] font-semibold tracking-[-0.005em] text-ink">
              {t('aiWriting', 'AI Writing')}
            </span>
            <span className="text-[11px] text-ink-soft">
              {t('aiWritingSub', 'Rewrite, polish, translate as you type')}
            </span>
          </span>
          <span className="relative z-10 rounded border border-accent bg-accent-soft px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-accent">
            {t('newTag', 'New')}
          </span>
        </button>
      </div>

      {/* Footer */}
      <div className="relative z-10 flex justify-between border-t border-line bg-surface px-3.5 py-2 font-mono text-[10px] tracking-[0.04em] text-ink-mute">
        <div className=' flex gap-2'>
          <span>v{version}</span>
          <span className="opacity-50">·</span>
          <a className="cursor-pointer text-ink-soft hover:text-accent" onClick={openShortcutsPage}>
            {t('shortcuts', 'Shortcuts')}
          </a>
          <span className="opacity-50">·</span>
          <a className="cursor-pointer text-ink-soft hover:text-accent" onClick={openFeedbackPage}>
            {t('feedback', 'Feedback')}
          </a>
        </div>
        <div ref={moreRef} className="relative">
          <a
            className="cursor-pointer text-ink-soft hover:text-accent"
            onClick={() => setMoreOpen((v) => !v)}
          >
            {t('more', 'More')}
          </a>
          {moreOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-1.5 min-w-[180px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-[12px] tracking-normal text-ink-soft transition-colors hover:bg-hover hover:text-accent"
                onClick={enterSelectionMode}
              >
                <Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                {t('setNoTranslateArea', 'Set no-translate area')}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
