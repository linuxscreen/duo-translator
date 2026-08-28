import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AirplayIcon, Ban, Check, ChevronDown, Globe, HelpCircle, Monitor, Moon, PenLine, ScanText, Settings as SettingsIcon, Sparkles, Sun } from 'lucide-react';

import {
  ACTION,
  APP_NAME,
  APP_NAME_PASCAL_CASE,
  CONFIG_KEY,
  browserTargetLanguage,
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
import type { AiProvider } from '@/main/aiProvider';
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
import { buildServiceOptions, getAiTranslateService, getTranslateService, resolveActiveService, type ServiceOption } from '@/utils/service';
import { THEME_OPTIONS, useResolvedTheme, useThemeSetting, type ThemeSetting } from '@/utils/theme';

const getConfig = (name: string) =>
  sendMessageToBackground({ action: DB_ACTION.CONFIG_GET, data: { name } });

const setConfig = (name: string, value: unknown) =>
  sendMessageToBackground({ action: DB_ACTION.CONFIG_SET, data: { name, value } });

const sectionLabelCls =
  'flex items-center gap-1.5 px-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mute';

const iconBtnCls =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors duration-150 hover:bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

// Sentinel for "follow the page translation" in the selection-service picker.
// Stored as "" (that is what the selection popup reads), but Radix Select
// refuses an item whose value is the empty string, hence the placeholder.
const FOLLOW_PAGE = '__follow__';

/**
 * Collapse the three "other" services into icon groups for the trigger.
 *
 * Run-length encoding — only ADJACENT equal keys merge, so the icons always
 * read left to right in the panel's own row order and a ×N never claims a
 * service that isn't actually next to its twin
 */
function summarizeServices(keys: string[]): { key: string; count: number }[] {
  const groups: { key: string; count: number }[] = [];
  for (const key of keys) {
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.count += 1;
    else groups.push({ key, count: 1 });
  }
  return groups;
}

export default function App() {
  const { t } = useTranslation();

  const [globalOn, setGlobalOn] = useState(true);
  const [mode, setMode] = useState<VIEW_STRATEGY>(VIEW_STRATEGY.DOUBLE);
  const [targetLanguage, setTargetLanguage] = useState(browserTargetLanguage());
  const [service, setService] = useState<string>();
  const [translateActive, setTranslateActive] = useState(false);
  const [defaultStrategy, setDefaultStrategy] = useState<DEFAULT_STRATEGY>(DEFAULT_STRATEGY.AUTO);
  const [siteRule, setSiteRule] = useState<DOMAIN_STRATEGY>(DOMAIN_STRATEGY.AUTO);
  // Per-domain "translate all elements": drops the user's own exclusions (the
  // no-translate areas and the website rules) for this site.
  const [translateAllElements, setTranslateAllElements] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [domain, setDomain] = useState('');
  const [ready, setReady] = useState(false);
  // Enabled AI providers (filtered by the per-card Use-for-page toggle).
  // Appended below the built-in translation services in the dropdown.
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [translateServices, setTranslateServices] = useState<TranslateServiceMeta[]>([]);
  // Every enabled AI provider, NOT gated on AI_USE_FOR_TRANSLATE_PAGE: that
  // toggle only governs page translation, while the three services below
  // (selection / AI writing / video subtitles) may always route through AI.
  const [otherAiProviders, setOtherAiProviders] = useState<AiProvider[]>([]);
  // "Other translation services" — the three non-page surfaces. Selection
  // stores "" for "follow the page translation"; the other two always hold a
  // concrete service key.
  const [selectionService, setSelectionService] = useState<string>('');
  const [aiWritingService, setAiWritingService] = useState<string>(DEFAULT_VALUE.AI_TRANSLATE_SERVICE);
  const [videoService, setVideoService] = useState<string>(DEFAULT_VALUE.VIDEO_SUBTITLE_TRANSLATE_SERVICE);
  const [otherOpen, setOtherOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  // Reactive theme views — the setting drives the menu check mark, the
  // resolved value picks the sun/moon button icon (system follows the OS).
  const themeSetting = useThemeSetting();
  const resolvedTheme = useResolvedTheme();
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

  // NOTE: the "Other translation services" panel deliberately has NO
  // document-level outside-click listener — its scrim closes it instead. See
  // the scrim in the body for why a document listener cannot work here.

  // Close the theme menu when clicking outside of it.
  useEffect(() => {
    if (!themeMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [themeMenuOpen]);

  const onThemeChange = (v: ThemeSetting) => {
    setThemeMenuOpen(false);
    // The storage change event feeds back through the reactive store and the
    // page-level watcher (initExtensionPageTheme), which restyles this popup
    // and every other open surface — no manual DOM work here.
    void setConfig(CONFIG_KEY.THEME, v);
  };

  // Hydrate from background storage on mount
  useEffect(() => {
    console.log("popup loaded")
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
      const [gs, vs, tl, ts, ds, bh, d, id, selSvc, aiSvc, vidSvc]: [
        boolean, VIEW_STRATEGY, string | undefined, string | undefined, DEFAULT_STRATEGY, boolean,
        string | undefined, number | undefined, string | undefined, string | undefined, string | undefined
      ] = await Promise.all([
        getConfig(CONFIG_KEY.GLOBAL_SWITCH),
        getConfig(CONFIG_KEY.VIEW_STRATEGY),
        getConfig(CONFIG_KEY.TARGET_LANGUAGE),
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
        getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        sendMessageToBackground({ action: TAB_ACTION.TAB_DOMAIN_GET }),
        sendMessageToBackground({ action: TAB_ACTION.ID_GET }),
        getConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE),
      ]);
      tabId = id
      let { activeService, enabledTranslateServices, enabledAiProviders, aiUsedForTranslatePage } = await getTranslateService(ts);
      // Same translators, but every enabled AI provider — the three "other"
      // surfaces are not gated on AI_USE_FOR_TRANSLATE_PAGE.
      const aiCtx = await getAiTranslateService(aiSvc);

      if (cancelled) return;

      setOtherAiProviders(aiCtx.enabledAiProviders);
      // Selection keeps "" (follow the page); the other two are resolved so a
      // deleted provider / disabled translator falls back instead of showing
      // an empty picker.
      setSelectionService(
        selSvc ? resolveActiveService(selSvc, aiCtx.enabledTranslateServices, aiCtx.enabledAiProviders) : '',
      );
      setAiWritingService(aiCtx.activeService);
      setVideoService(resolveActiveService(vidSvc, aiCtx.enabledTranslateServices, aiCtx.enabledAiProviders));

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
      setTargetLanguage(tl || browserTargetLanguage());

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
        if (!cancelled) setTranslateAllElements(!!dom?.translateAllElements);
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

  // The three "other" services. They are plain config writes: every consumer
  // reads them reactively (useConfig / storage.watch), so no tab broadcast.
  const onSelectionServiceChange = (v: string) => {
    const value = v === FOLLOW_PAGE ? '' : v;
    setSelectionService(value);
    void setConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE, value);
  };

  const onAiWritingServiceChange = (v: string) => {
    setAiWritingService(v);
    void setConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE, v);
  };

  const onVideoServiceChange = (v: string) => {
    setVideoService(v);
    void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE, v);
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
      action: DB_ACTION.DOMAIN_UPSERT,
      data: { domain, strategy: v },
    });
    void sendMessageToTab({ action: ACTION.DOMAIN_STRATEGY_CHANGED, data: v });
  };

  const onHighlightToggle = (v: boolean) => {
    setHighlight(v);
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, v);
    void sendMessageToAllTabs({ action: ACTION.CONFIG_CHANGED, data: { [CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH]: v } }, true);
    void sendMessageToTab({ action: ACTION.STYLE_CHANGED });
  };

  const openOptions = () => {
    browser.tabs.create({ url: "options.html" });
  };

  const openAiWorkbench = async () => {
    await sendMessageToTab({ action: ACTION.AI_OPEN_WORKBENCH });
    window.close();
  };

  const onTranslateAllElementsToggle = () => {
    const next = !translateAllElements;
    setTranslateAllElements(next);
    // The menu stays open on purpose: this item is a checkbox, and the check
    // mark appearing is the only feedback the action gives.
    if (!domain) return;
    // Field-aware write: turning it off clears only this field, so the site's
    // Always/Never strategy (and every other per-domain flag) survives.
    void sendMessageToBackground(
      next
        ? { action: DB_ACTION.DOMAIN_UPSERT, data: { domain, translateAllElements: true } }
        : { action: DB_ACTION.DOMAIN_DELETE, data: { domain, field: 'translateAllElements' } },
    ).then(() => {
      // After the write, so a frame that re-reads the doc cannot race it.
      void sendMessageToTab({ action: ACTION.TRANSLATE_ALL_ELEMENTS_CHANGED, data: next });
    });
  };

  const enterSelectionMode = () => {
    setMoreOpen(false);
    // Fire-and-forget: the content handler now awaits a confirmation dialog, so
    // awaiting here would keep the popup open until the user confirms. Close it
    // immediately so the dialog shows on the (unobstructed) page.
    void sendMessageToTab({ action: ACTION.ENTER_SELECTION_MODE });
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
  // use the `ai:<id>` value scheme AiTranslateService resolves.
  const serviceList = buildServiceOptions(translateServices, aiProviders);

  // Picker list for the three "other" surfaces — same translators, but AI
  // providers regardless of the page-translate toggle.
  const otherServiceList = buildServiceOptions(translateServices, otherAiProviders);
  const optionOf = (value: string) => otherServiceList.find((o) => o.value === value);
  const labelOf = (opt: ServiceOption | undefined, fallback: string) =>
    opt ? (opt.i18nKey ? t(opt.i18nKey, opt.label) : opt.label) : fallback;

  /**
   * One service row (icon + name) for both the dropdown items and — via
   * SelectValue, which re-renders the selected item's children — the trigger.
   *
   * `min-w-0` on the flex box and `truncate` on the text are what make a name
   * too long for its trigger end in an ellipsis instead of being cut mid-glyph:
   * the ellipsis is drawn by the element that actually holds the text, and the
   * `truncate` SelectTrigger/SelectItem put on their outer span cannot reach
   * into this nested flex.
   */
  const serviceLabel = (opt: ServiceOption, size: number, gap: string) => (
    <span className={cn('flex min-w-0 items-center', gap)}>
      <ServiceMark id={opt.iconId} size={size} />
      <span className="truncate">{opt.i18nKey ? t(opt.i18nKey, opt.label) : opt.label}</span>
    </span>
  );
  const pageServiceLabel = labelOf(serviceList.find((o) => o.value === service), service ?? '');

  // The trigger's summary. "Follow the page" resolves to the page service so
  // the default state (selection following + two microsofts) reads as ×3.
  const effectiveOtherServices = [
    selectionService || service || '',
    aiWritingService,
    videoService,
  ];
  const otherGroups = summarizeServices(effectiveOtherServices);

  const selectionExtraOption =
    selectionService && !serviceList.some((o) => o.value === selectionService)
      ? optionOf(selectionService)
      : undefined;

  const otherServiceRows: {
    key: string;
    label: string;
    value: string;
    options: ServiceOption[];
    onChange: (v: string) => void;
    follow?: boolean;
  }[] = [
      {
        key: 'selection',
        label: t('selectionTranslate', 'Selection translation'),
        value: selectionService || FOLLOW_PAGE,
        // The selection popup's own picker is the page-translation list, so
        // this one must be too — offering an AI provider it cannot show would
        // leave the two pickers disagreeing about the same setting. A value
        // already stored but missing from that list (its provider is gated out
        // of page translation) is still listed, so the picker shows the real
        // state and the user can move off it.
        options: selectionExtraOption ? [selectionExtraOption, ...serviceList] : serviceList,
        onChange: onSelectionServiceChange,
        follow: true,
      },
      {
        key: 'aiWriting',
        label: t('aiWritingInputTranslate', 'AI Writing (input box)'),
        value: aiWritingService,
        options: otherServiceList,
        onChange: onAiWritingServiceChange,
      },
      {
        key: 'videoSubtitle',
        label: t('videoSubtitle', 'Video subtitles'),
        value: videoService,
        options: otherServiceList,
        onChange: onVideoServiceChange,
      },
    ];

  const version =
    browser.runtime?.getManifest?.()?.version || '';

  if (!ready) {
    return <div className="w-95 min-h-120 bg-bg" />;
  }

  return (
    <div className="relative w-[380px] overflow-hidden bg-bg text-ink before:pointer-events-none before:absolute before:inset-0 before:opacity-50 before:bg-[radial-gradient(ellipse_80%_30%_at_50%_0%,var(--color-accent-soft),transparent_70%)]">
      {/* Header */}
      {/* z-20 (above the z-10 body): the theme menu drops down over the body,
          and the header's own stacking context caps its children's z-index —
          a later sibling at the same z-10 would otherwise paint over it.
          While the "other services" panel is open it drops below the body's
          stacking context instead, so the body's blur overlay covers it too:
          the panel is the only interactive surface then, and the theme menu
          (the whole reason for z-20) is necessarily closed. */}
      <div
        className={cn(
          'relative flex items-center justify-between border-b border-line bg-surface px-3 py-2',
          otherOpen ? 'z-0' : 'z-20',
        )}
      >
        <button type="button" className="flex items-center gap-2 text-left">
          <img className='w-5 h-5' src={`${APP_NAME_PASCAL_CASE}.svg`}></img>
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
          {/* Theme switcher — sun/moon reflects the resolved theme; the menu
              picks the setting (System / Light / Dark). */}
          <div ref={themeMenuRef} className="relative">
            <button
              type="button"
              className={iconBtnCls}
              onClick={() => setThemeMenuOpen((v) => !v)}
              title={t('theme', 'Theme')}
            >
              {resolvedTheme === 'light' ? (
                <Sun className="h-4 w-4" strokeWidth={1.6} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.6} />
              )}
            </button>
            {themeMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 min-w-[150px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.value === 'system' ? Monitor : opt.value === 'light' ? Sun : Moon;
                  const active = themeSetting === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-hover',
                        active ? 'text-accent' : 'text-ink-soft hover:text-ink',
                      )}
                      onClick={() => onThemeChange(opt.value)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                      <span className="flex-1">{t(opt.i18nKey, opt.fallback)}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
        {/* Scrim behind the open "other services" panel: dims + blurs the rest
            of the popup AND is what closes the panel when clicked. It lives
            inside the body (z-10 at the root), so the header and footer are
            pushed below that context while open — see their comments.

            The close MUST hang off this element rather than a document-level
            "clicked outside" listener. Radix Select sets
            `pointer-events: none` on <body> while its dropdown is open and
            dismisses on `pointerdown` via flushSync — so by the time the
            following `mousedown` fires, the dropdown's DOM is already gone
            while the body is still inert, and the event arrives with
            `target` = <html> no matter where the pointer really was. A
            document listener reads that as "outside" and closes the panel:
            that is exactly the bug where a second click in a dropdown took the
            whole panel down. The scrim cannot misread it, because an inert
            body means the scrim never receives the event at all — that click
            just closes the dropdown, which is what the user asked for. */}
        {otherOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/25 backdrop-blur-[2px]"
            onMouseDown={() => setOtherOpen(false)}
          />
        )}

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

        {/* Services — page translation on the left, the three other surfaces
            behind the panel on the right. Both halves are the same width. */}
        <div className="flex items-center gap-4 justify-between">
          <div className="w-1/2" title={t('pageTranslationService', 'Page translation service')}>
            <Select value={service} onValueChange={onServiceChange}>
              <SelectTrigger className='items-center justify-center'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serviceList.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {serviceLabel(s, 24, 'gap-3')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* z-30 while open so the trigger and its panel stay sharp above the
              blur overlay (which sits at z-20 inside this same body). */}
          <div className={cn('relative w-1/2', otherOpen && 'z-30')}>
            <button
              type="button"
              title={t('otherTranslationServices', 'Other translation services')}
              onClick={() => setOtherOpen((v) => !v)}
              className={cn(
                'flex h-9 w-full items-center gap-2 rounded-lg border bg-surface px-2.5 text-[13px] text-ink',
                'cursor-pointer transition-colors duration-150 ease-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                otherOpen ? 'border-accent' : 'border-line',
              )}
            >
              <span className="flex flex-1 items-center gap-2 overflow-hidden">
                {otherGroups.map((g, i) => {
                  const opt = optionOf(g.key);
                  // Index key: run-length groups repeat (微软 / 谷歌 / 微软),
                  // so the service key alone is not unique any more.
                  return (
                    <span key={i} className="flex shrink-0 items-center gap-0.5">
                      {opt ? (
                        <ServiceMark id={opt.iconId} />
                      ) : (
                        <Globe className="h-6 w-6 text-ink-soft" strokeWidth={1.6} />
                      )}
                      {g.count > 1 && (
                        <span className="font-mono text-[11px] text-ink-soft">×{g.count}</span>
                      )}
                    </span>
                  );
                })}
              </span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 text-ink-soft transition-transform duration-150',
                  otherOpen && 'rotate-180',
                )}
              />
            </button>

            {otherOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-[340px] rounded-lg border border-line bg-surface p-2.5 shadow-lg">
                <div className="mb-2 px-0.5 text-[11px] text-ink-mute">
                  {t('otherTranslationServices', 'Other translation services')}
                </div>
                <div className="flex flex-col gap-2">
                  {otherServiceRows.map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{row.label}</span>
                      <div className="w-[150px] shrink-0">
                        <Select value={row.value} onValueChange={row.onChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          {/* SelectContent grows past the 150px trigger on
                              its own (min-w + max-w in components/ui/select),
                              which is what keeps "Follow page (Microsoft
                              Translate)" — the longest label here — intact. */}
                          <SelectContent>
                            {row.follow && (
                              <SelectItem value={FOLLOW_PAGE}>
                                <span className="truncate">
                                  {t('selectionFollowWeb', 'Follow page ({{name}})').replace(
                                    '{{name}}',
                                    pageServiceLabel,
                                  )}
                                </span>
                              </SelectItem>
                            )}
                            {row.options.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {serviceLabel(s, 18, 'gap-2')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
              translateActive ? 'text-ink-soft' : 'text-accent-ink',
            )}
            onClick={() => onTranslateToggle(false)}
          >
            {t('original', 'Original')}
          </button>
          <button
            type="button"
            className={cn(
              'relative z-10 cursor-pointer rounded-md text-[12.5px] font-medium transition-colors duration-200',
              translateActive ? 'text-accent-ink' : 'text-ink-soft',
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
                key={opt.value}
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
            'bg-gradient-to-br from-banner-1 to-banner-2',
            'transition-[transform,box-shadow,border-color] duration-200',
            'hover:-translate-y-px hover:border-accent hover:shadow-[0_0_0_1px_var(--color-accent-soft),0_8px_24px_-8px_var(--color-accent-glow)]',
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(circle at 90% 50%, var(--color-accent-glow), transparent 50%), radial-gradient(circle at 10% 100%, var(--color-banner-glow-2), transparent 55%)',
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(var(--color-banner-grid) 1px, transparent 1px), linear-gradient(90deg, var(--color-banner-grid) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
              maskImage: 'linear-gradient(135deg, transparent 50%, #000 100%)',
              WebkitMaskImage: 'linear-gradient(135deg, transparent 50%, #000 100%)',
            }}
          />
          <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-banner-chip text-accent">
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
        </button>
      </div>

      {/* Footer */}
      {/* Same-z siblings paint in DOM order, so at z-10 the footer would sit
          ON TOP of the body's blur overlay — it drops below with the header. */}
      <div
        className={cn(
          'relative flex justify-between border-t border-line bg-surface px-3.5 py-2 font-mono text-[10px] tracking-[0.04em] text-ink-mute',
          otherOpen ? 'z-0' : 'z-10',
        )}
      >
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
            <div className="absolute bottom-full right-0 z-20 mb-1.5 min-w-[210px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-[12px] tracking-normal transition-colors hover:bg-hover',
                  translateAllElements ? 'text-accent' : 'text-ink-soft hover:text-accent',
                )}
                onClick={onTranslateAllElementsToggle}
                title={t(
                  'translateAllElementsHint',
                  'Ignore the website rules and no-translate areas on this site',
                )}
              >
                <ScanText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                <span className="flex-1">{t('translateAllElements', 'Translate all elements')}</span>
                {translateAllElements && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-[12px] tracking-normal text-ink-soft transition-colors hover:bg-hover hover:text-accent"
                onClick={enterSelectionMode}
              >
                <Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                <span className="flex-1">{t('setNoTranslateArea', 'Set no-translate area')}</span>
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
