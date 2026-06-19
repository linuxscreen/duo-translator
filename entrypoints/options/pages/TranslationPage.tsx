import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  ACTION,
  CONFIG_KEY,
  DB_ACTION,
  DEFAULT_STRATEGY,
  DEFAULT_VALUE,
  DOMAIN_STRATEGY,
  HIGHLIGHT_COLORS,
  LANGUAGES,
  TB_ACTION,
  TRANSLATION_BG_COLORS,
  TRANSLATION_FONT_COLORS,
  STYLE_GROUPS,
  STYLE_NONE,
  VIEW_STRATEGIES,
  DEFAULT_STRATEGY_OPTIONS,
} from '@/main/constants';
import {
  sendMessageToAllTabs,
  sendMessageToBackground,
} from '@/utils/message';
import { getConfig, setConfig, clearTranslationCache, getTranslationCacheSize } from '@/utils/db';
import { SettingRow } from '@/components/options/SettingRow';
import { ColorPicker } from '@/components/options/ColorPicker';
import { NumberInputWithReset } from '@/components/options/NumberInputWithReset';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DomainListSection, type DomainItem } from '@/components/options/DomainListSection';
import { buildStylePreview, styleHasBorder } from '@/utils/translationStyle';
import { ServiceMark } from '@/components/ui/service-mark';
import { buildServiceOptions, getTranslateService, type ServiceOption } from '@/utils/service';

const MIN_SENTENCES_MIN = 1;
const MIN_SENTENCES_MAX = 99;
const clampMinSentences = (n: number) =>
  Math.min(MIN_SENTENCES_MAX, Math.max(MIN_SENTENCES_MIN, Math.floor(n)));

const LINE_BREAK_MIN = 0;
const LINE_BREAK_MAX = 9999;
const clampLineBreak = (n: number) =>
  Math.min(LINE_BREAK_MAX, Math.max(LINE_BREAK_MIN, Math.floor(n)));

/** Human-readable byte size, e.g. 0 B / 12.3 KB / 4.5 MB. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function broadcastStyleChange() {
  void sendMessageToAllTabs({ action: ACTION.STYLE_CHANGE });
}

export function TranslationPage() {
  const { t } = useTranslation();

  // Settings (migrated from SettingsPage)
  const [highlight, setHighlight] = useState(true);
  // Raw input string so the user can transiently clear the field while typing.
  // The committed numeric is persisted on blur / Enter via onMinSentencesCommit.
  const [minSentencesInput, setMinSentencesInput] = useState<string>(
    String(DEFAULT_VALUE.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES),
  );
  const [lineBreakInput, setLineBreakInput] = useState<string>(
    String(DEFAULT_VALUE.TRANSLATION_LINE_BREAK_MIN_CHARS),
  );
  const [floatBall, setFloatBall] = useState(true);
  const [translationCache, setTranslationCache] = useState(true);
  // Transient "cleared" state for the clear-cache button (resets after ~1.5s).
  const [cacheCleared, setCacheCleared] = useState(false);
  // Clear-cache confirmation dialog.
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0);
  const [viewStrategy, setViewStrategy] = useState<string>(DEFAULT_VALUE.VIEW_STRATEGY);
  const [targetLang, setTargetLang] = useState<string>(navigator.language.split('-')[0]);
  const [translateService, setTranslateService] = useState<string>();
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [defaultStrategy, setDefaultStrategy] = useState<DEFAULT_STRATEGY>(DEFAULT_STRATEGY.AUTO);

  // Translation style
  const [style, setStyle] = useState<string>(STYLE_NONE);
  const [bgColor, setBgColor] = useState('');
  const [bgColorIndex, setBgColorIndex] = useState(0);
  const [fontColor, setFontColor] = useState('');
  const [fontColorIndex, setFontColorIndex] = useState(0);
  const [borderColor, setBorderColor] = useState('');
  const [borderColorIndex, setBorderColorIndex] = useState(0);

  // Bilingual highlighting style (unified for both original + translation)
  const [highlightBg, setHighlightBg] = useState('');
  const [highlightBgIndex, setHighlightBgIndex] = useState(0);
  const [highlightFontColor, setHighlightFontColor] = useState('');
  const [highlightFontColorIndex, setHighlightFontColorIndex] = useState(0);
  const [highlightStyle, setHighlightStyle] = useState<string>(STYLE_NONE);
  const [highlightBorderColor, setHighlightBorderColor] = useState('');
  const [highlightBorderColorIndex, setHighlightBorderColorIndex] = useState(0);

  // Preview hover state
  const [hoverPart, setHoverPart] = useState<1 | 2 | null>(null);

  // Domain lists
  const [alwaysList, setAlwaysList] = useState<DomainItem[]>([]);
  const [neverList, setNeverList] = useState<DomainItem[]>([]);
  const [floatBallDisabledList, setFloatBallDisabledList] = useState<DomainItem[]>([]);
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [neverOpen, setNeverOpen] = useState(false);
  const [floatBallDisabledOpen, setFloatBallDisabledOpen] = useState(false);
  // Style section expanded by default; only the chevron button on the right
  // toggles — not the header text — to avoid accidental collapse.
  const [styleOpen, setStyleOpen] = useState(true);

  const [ready, setReady] = useState(false);

  const refreshDomains = async () => {
    const [a, n, fb] = await Promise.all([
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { strategy: DOMAIN_STRATEGY.ALWAYS },
      }),
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { strategy: DOMAIN_STRATEGY.NEVER },
      }),
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_LIST,
        data: { floatBallDisabled: true },
      }),
    ]);
    setAlwaysList(Array.isArray(a) ? a : []);
    setNeverList(Array.isArray(n) ? n : []);
    setFloatBallDisabledList(Array.isArray(fb) ? fb : []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [
        bh, fb, vs, tl, ts, ds, ms, lb, tc,
        styleCfg, bgCfg, bgIdxCfg, fcCfg, fcIdxCfg, bcCfg, bcIdxCfg,
        hbCfg, hbIdxCfg, hfCfg, hfIdxCfg, hsCfg, hbcCfg, hbcIdxCfg,
      ] = await Promise.all([
        getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
        getConfig(CONFIG_KEY.FLOAT_BALL_SWITCH),
        getConfig(CONFIG_KEY.VIEW_STRATEGY),
        getConfig(CONFIG_KEY.TARGET_LANGUAGE),
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.DEFAULT_STRATEGY),
        getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES),
        getConfig(CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS),
        getConfig(CONFIG_KEY.TRANSLATION_CACHE_SWITCH),
        getConfig(CONFIG_KEY.STYLE),
        getConfig(CONFIG_KEY.BG_COLOR),
        getConfig(CONFIG_KEY.BG_COLOR_INDEX),
        getConfig(CONFIG_KEY.FONT_COLOR),
        getConfig(CONFIG_KEY.FONT_COLOR_INDEX),
        getConfig(CONFIG_KEY.BORDER_COLOR),
        getConfig(CONFIG_KEY.BORDER_COLOR_INDEX),
        getConfig(CONFIG_KEY.HIGHLIGHT_BG_COLOR),
        getConfig(CONFIG_KEY.HIGHLIGHT_BG_COLOR_INDEX),
        getConfig(CONFIG_KEY.HIGHLIGHT_FONT_COLOR),
        getConfig(CONFIG_KEY.HIGHLIGHT_FONT_COLOR_INDEX),
        getConfig(CONFIG_KEY.HIGHLIGHT_STYLE),
        getConfig(CONFIG_KEY.HIGHLIGHT_BORDER_COLOR),
        getConfig(CONFIG_KEY.HIGHLIGHT_BORDER_COLOR_INDEX),
      ]);
      if (cancelled) return;
      setHighlight(bh === undefined ? true : bh);
      const initialMs =
        typeof ms === 'number' && Number.isFinite(ms)
          ? clampMinSentences(ms)
          : Number(DEFAULT_VALUE.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES);
      setMinSentencesInput(String(initialMs));
      const initialLb =
        typeof lb === 'number' && Number.isFinite(lb)
          ? clampLineBreak(lb)
          : Number(DEFAULT_VALUE.TRANSLATION_LINE_BREAK_MIN_CHARS);
      setLineBreakInput(String(initialLb));
      setFloatBall(fb === undefined ? true : fb);
      setTranslationCache(tc === undefined ? true : tc);
      setViewStrategy(vs === undefined ? DEFAULT_VALUE.VIEW_STRATEGY : vs);
      tl && setTargetLang(tl);
      // Same flat list (translators + AI providers) and active-service
      // resolution the popup uses, so Options stays consistent with it.
      const { activeService, enabledTranslateServices, enabledAiProviders } = await getTranslateService(ts);
      if (cancelled) return;
      setServiceOptions(buildServiceOptions(enabledTranslateServices, enabledAiProviders));
      setTranslateService(activeService);
      if (ds === DEFAULT_STRATEGY.ALWAYS || ds === DEFAULT_STRATEGY.NEVER || ds === DEFAULT_STRATEGY.AUTO) {
        setDefaultStrategy(ds);
      }
      setStyle(typeof styleCfg === 'string' && styleCfg ? styleCfg : STYLE_NONE);
      setBgColor(typeof bgCfg === 'string' ? bgCfg : '');
      setBgColorIndex(typeof bgIdxCfg === 'number' ? bgIdxCfg : 0);
      setFontColor(typeof fcCfg === 'string' ? fcCfg : '');
      setFontColorIndex(typeof fcIdxCfg === 'number' ? fcIdxCfg : 0);
      setBorderColor(typeof bcCfg === 'string' ? bcCfg : '');
      setBorderColorIndex(typeof bcIdxCfg === 'number' ? bcIdxCfg : 0);
      setHighlightBg(typeof hbCfg === 'string' ? hbCfg : '');
      setHighlightBgIndex(typeof hbIdxCfg === 'number' ? hbIdxCfg : 0);
      setHighlightFontColor(typeof hfCfg === 'string' ? hfCfg : '');
      setHighlightFontColorIndex(typeof hfIdxCfg === 'number' ? hfIdxCfg : 0);
      setHighlightStyle(typeof hsCfg === 'string' && hsCfg ? hsCfg : DEFAULT_VALUE.HIGHLIGHT_STYLE);
      setHighlightBorderColor(typeof hbcCfg === 'string' ? hbcCfg : '');
      setHighlightBorderColorIndex(typeof hbcIdxCfg === 'number' ? hbcIdxCfg : 0);
      await refreshDomains();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onHighlight = (v: boolean) => {
    setHighlight(v);
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, v);
    broadcastStyleChange();
  };

  const onMinSentencesInput = (raw: string) => {
    // Permit transient empty / non-numeric input while typing; commit on blur.
    if (raw === '' || /^\d{1,2}$/.test(raw)) setMinSentencesInput(raw);
  };

  const onMinSentencesCommit = () => {
    const parsed = Number.parseInt(minSentencesInput, 10);
    const next = Number.isFinite(parsed)
      ? clampMinSentences(parsed)
      : Number(DEFAULT_VALUE.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES);
    setMinSentencesInput(String(next));
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES, next);
  };

  const onMinSentencesReset = () => {
    const def = Number(DEFAULT_VALUE.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES);
    setMinSentencesInput(String(def));
    void setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES, def);
  };

  const onLineBreakInput = (raw: string) => {
    if (raw === '' || /^\d{1,4}$/.test(raw)) setLineBreakInput(raw);
  };

  const onLineBreakCommit = () => {
    const parsed = Number.parseInt(lineBreakInput, 10);
    const next = Number.isFinite(parsed)
      ? clampLineBreak(parsed)
      : Number(DEFAULT_VALUE.TRANSLATION_LINE_BREAK_MIN_CHARS);
    setLineBreakInput(String(next));
    void setConfig(CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS, next);
  };

  const onLineBreakReset = () => {
    const def = Number(DEFAULT_VALUE.TRANSLATION_LINE_BREAK_MIN_CHARS);
    setLineBreakInput(String(def));
    void setConfig(CONFIG_KEY.TRANSLATION_LINE_BREAK_MIN_CHARS, def);
  };

  const onTranslationCache = (v: boolean) => {
    setTranslationCache(v);
    void setConfig(CONFIG_KEY.TRANSLATION_CACHE_SWITCH, v);
    void sendMessageToAllTabs({ action: ACTION.TRANSLATION_CACHE_SWITCH_CHANGE, data: v });
  };

  const onClearCacheClick = async () => {
    const size = await getTranslationCacheSize();
    setCacheSizeBytes(size);
    setClearCacheOpen(true);
  };

  const onConfirmClearCache = async () => {
    setClearCacheOpen(false);
    await clearTranslationCache();
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 1500);
  };

  const onFloatBall = (v: boolean) => {
    setFloatBall(v);
    void setConfig(CONFIG_KEY.FLOAT_BALL_SWITCH, v);
    void sendMessageToAllTabs({ action: TB_ACTION.FLOAT_BALL_SWITCH, data: v });
  };

  const onViewStrategy = (v: string) => {
    setViewStrategy(v);
    void setConfig(CONFIG_KEY.VIEW_STRATEGY, v);
    void sendMessageToAllTabs({ action: ACTION.VIEW_STRATEGY_CHANGE, data: v });
  };

  const onTargetLang = (v: string) => {
    setTargetLang(v);
    void setConfig(CONFIG_KEY.TARGET_LANGUAGE, v);
    void sendMessageToAllTabs({ action: ACTION.TARGET_LANG_CHANGE, data: v });
  };

  const onTranslateService = (v: string) => {
    setTranslateService(v);
    void setConfig(CONFIG_KEY.TRANSLATE_SERVICE, v);
    void sendMessageToAllTabs({ action: ACTION.TRANSLATE_SERVICE_CHANGE, data: v });
  };

  const onDefaultStrategyChange = (v: DEFAULT_STRATEGY) => {
    setDefaultStrategy(v);
    void setConfig(CONFIG_KEY.DEFAULT_STRATEGY, v);
    void sendMessageToAllTabs({ action: ACTION.DEFAULT_STRATEGY_CHANGE, data: v });
  };

  // Per-key debounce. Color-picker drag fires many onChange events per second;
  // writing to db and broadcasting to every tab on each one causes UI lag.
  // We update React state immediately (for in-page preview) and trail the
  // persistence + cross-tab broadcast by ~120 ms.
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persistColorDebounced = (
    colorKey: CONFIG_KEY,
    indexKey: CONFIG_KEY,
    color: string,
    index: number,
  ) => {
    const id = `${colorKey}::${indexKey}`;
    if (persistTimers.current[id]) clearTimeout(persistTimers.current[id]);
    persistTimers.current[id] = setTimeout(() => {
      void setConfig(colorKey, color);
      void setConfig(indexKey, index);
      broadcastStyleChange();
    }, 120);
  };
  useEffect(() => {
    return () => {
      Object.values(persistTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // ─── Style change handlers ────────────────────────────────────────────────
  const onStyle = (v: string) => {
    setStyle(v);
    void setConfig(CONFIG_KEY.STYLE, v);
    broadcastStyleChange();
  };
  const onBgColor = (c: string, i: number) => {
    setBgColor(c);
    setBgColorIndex(i);
    persistColorDebounced(CONFIG_KEY.BG_COLOR, CONFIG_KEY.BG_COLOR_INDEX, c, i);
  };
  const onFontColor = (c: string, i: number) => {
    setFontColor(c);
    setFontColorIndex(i);
    persistColorDebounced(CONFIG_KEY.FONT_COLOR, CONFIG_KEY.FONT_COLOR_INDEX, c, i);
  };
  const onBorderColor = (c: string, i: number) => {
    setBorderColor(c);
    setBorderColorIndex(i);
    persistColorDebounced(CONFIG_KEY.BORDER_COLOR, CONFIG_KEY.BORDER_COLOR_INDEX, c, i);
  };

  const onHighlightBg = (c: string, i: number) => {
    setHighlightBg(c);
    setHighlightBgIndex(i);
    persistColorDebounced(CONFIG_KEY.HIGHLIGHT_BG_COLOR, CONFIG_KEY.HIGHLIGHT_BG_COLOR_INDEX, c, i);
  };
  const onHighlightFont = (c: string, i: number) => {
    setHighlightFontColor(c);
    setHighlightFontColorIndex(i);
    persistColorDebounced(
      CONFIG_KEY.HIGHLIGHT_FONT_COLOR,
      CONFIG_KEY.HIGHLIGHT_FONT_COLOR_INDEX,
      c,
      i,
    );
  };
  const onHighlightStyle = (v: string) => {
    setHighlightStyle(v);
    void setConfig(CONFIG_KEY.HIGHLIGHT_STYLE, v);
    broadcastStyleChange();
  };
  const onHighlightBorderColor = (c: string, i: number) => {
    setHighlightBorderColor(c);
    setHighlightBorderColorIndex(i);
    persistColorDebounced(
      CONFIG_KEY.HIGHLIGHT_BORDER_COLOR,
      CONFIG_KEY.HIGHLIGHT_BORDER_COLOR_INDEX,
      c,
      i,
    );
  };

  // ─── Preview text + computed style ────────────────────────────────────────
  const originalText1 = targetLang.startsWith('en')
    ? 'Donner de la civilisation aux années et non des années à la civilisation.'
    : 'Make time for civilization, for civilization won\'t make time.';
  const originalText2 = targetLang.startsWith('en')
    ? 'Nous sommes tous des vers dans les égouts, mais certains doivent encore lever les yeux vers le ciel étoilé.'
    : 'We are all worms in the gutter, while some of us are always looking at the stars.';
  const translatedText1 = t('makeTimeForCivilization', {
    defaultValue: '',
    lng: targetLang,
  }) as string;
  const translatedText2 = t('wereAllWorms', {
    defaultValue: '',
    lng: targetLang,
  }) as string;

  const translationStyle = useMemo(
    () =>
      buildStylePreview({ style, bgColor, fontColor, borderColor }),
    [style, bgColor, fontColor, borderColor],
  );
  const highlightCss = useMemo(
    () =>
      buildStylePreview({
        style: highlightStyle,
        bgColor: highlightBg,
        fontColor: highlightFontColor,
        borderColor: highlightBorderColor,
      }),
    [highlightStyle, highlightBg, highlightFontColor, highlightBorderColor],
  );

  if (!ready) {
    return <div className="h-[480px] rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  const renderStyleSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STYLE_GROUPS.map((group, gi) => (
          <SelectGroup key={group.groupTitle ?? `__plain_${gi}`}>
            {group.groupTitle && (
              <SelectLabel>{t(group.groupTitle, group.groupTitle)}</SelectLabel>
            )}
            {group.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.title, opt.title)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <SettingRow
          label={t('floatBall', 'Floating ball')}
          control={<Switch checked={floatBall} onCheckedChange={onFloatBall} />}
        />
        <SettingRow
          label={t('displayMode', 'Display mode')}
          control={
            <Select value={viewStrategy} onValueChange={onViewStrategy}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEW_STRATEGIES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {t(item.title, item.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('targetLanguage', 'Target language')}
          control={
            <Select value={targetLang} onValueChange={onTargetLang}>
              <SelectTrigger className="min-w-[200px]">
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
          }
        />
        <SettingRow
          label={t('translateService', 'Translate service')}
          control={
            <Select value={translateService} onValueChange={onTranslateService}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serviceOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <span className="flex items-center gap-3">
                      <ServiceMark id={s.iconId} />
                      {s.i18nKey ? t(s.i18nKey, s.label) : s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('defaultTranslateStrategy', 'Default translate strategy')}
          control={
            <Select
              value={defaultStrategy}
              onValueChange={(v) => onDefaultStrategyChange(v as DEFAULT_STRATEGY)}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_STRATEGY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.title, opt.fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t(
            'translationLineBreakMinChars',
            'Minimum characters for translation line break',
          )}
          hint={t('translationLineBreakMinCharsHint', 'Set to 0 to always wrap')}
          control={
            <NumberInputWithReset
              value={lineBreakInput}
              min={LINE_BREAK_MIN}
              max={LINE_BREAK_MAX}
              defaultValue={Number(DEFAULT_VALUE.TRANSLATION_LINE_BREAK_MIN_CHARS)}
              onChange={onLineBreakInput}
              onCommit={onLineBreakCommit}
              onReset={onLineBreakReset}
            />
          }
        />
        <SettingRow
          label={t('enableTranslationCache', 'Enable translation cache')}
          hint={t(
            'enableTranslationCacheHint',
            'Cache translation results to skip repeated requests',
          )}
          control={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClearCacheClick}
                title={t('clearTranslationCache', 'Clear cache')}
                className={cn(
                  'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors',
                  cacheCleared
                    ? 'text-emerald-500'
                    : 'text-ink-soft hover:bg-hover hover:text-ink',
                )}
              >
                {cacheCleared ? (
                  <Check className="h-4 w-4" strokeWidth={1.8} />
                ) : (
                  <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                )}
              </button>
              <Switch checked={translationCache} onCheckedChange={onTranslationCache} />
            </div>
          }
        />
      </div>

      {/* Bilingual highlighting */}
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <div className="border-b border-line px-4 py-3 ">
          <div className='text-[13.5px] font-semibold text-ink'>
            {t('bilingualHighlighting', 'Bilingual sentence-by-sentence highlighting')}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-soft">
            {t('bilingualHighlightingHint', 'Highlight original and translation sentence by sentence')}
          </div>
        </div>
        <SettingRow
          label={t('enable', 'Enable')}
          hint={t('bilingualHighlightingEnableHint', 'Hover over original or translation to trigger')}
          control={<Switch checked={highlight} onCheckedChange={onHighlight} />}
        />
        <SettingRow
          label={t('bilingualHighlightingMinSentences', 'Minimum number of sentences')}
          hint={t(
            'bilingualHighlightingMinSentencesHint',
            'Not effective if the number of sentences is less than the value',
          )}
          control={
            <NumberInputWithReset
              value={minSentencesInput}
              min={MIN_SENTENCES_MIN}
              max={MIN_SENTENCES_MAX}
              defaultValue={Number(DEFAULT_VALUE.BILINGUAL_HIGHLIGHTING_MIN_SENTENCES)}
              onChange={onMinSentencesInput}
              onCommit={onMinSentencesCommit}
              onReset={onMinSentencesReset}
            />
          }
        />
      </div>

      {/* Style */}
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <div
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3 text-[13.5px] font-semibold text-ink',
            styleOpen && 'border-b border-line',
          )}
        >
          <div className="flex-1">{t('style', 'Style')}</div>
          <button
            type="button"
            onClick={() => setStyleOpen((o) => !o)}
            title={t(styleOpen ? 'collapse' : 'expand', styleOpen ? 'Collapse' : 'Expand')}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-ink"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-150',
                styleOpen && 'rotate-180',
              )}
              strokeWidth={1.6}
            />
          </button>
        </div>
        {styleOpen && <>
        <SettingRow className=' border-line border-b'
          label={t('translationStyle', 'Translation style')}
          control
        />
        <SettingRow
          label={t('border', 'border')}
          control={renderStyleSelect(style, onStyle)}
        />
        <SettingRow
          label={t('backgroundColor', 'background color')}
          control={
            <ColorPicker
              value={bgColor}
              selectedIndex={bgColorIndex}
              presets={TRANSLATION_BG_COLORS}
              onChange={onBgColor}
            />
          }
        />
        <SettingRow
          label={t('fontColor', 'font color')}
          control={
            <ColorPicker
              value={fontColor}
              selectedIndex={fontColorIndex}
              presets={TRANSLATION_FONT_COLORS}
              onChange={onFontColor}
            />
          }
        />
        {styleHasBorder(style) && (
          <SettingRow
            label={t('borderColor', 'border color')}
            control={
              <ColorPicker
                value={borderColor}
                selectedIndex={borderColorIndex}
                presets={TRANSLATION_BG_COLORS}
                onChange={onBorderColor}
              />
            }
          />
        )}

        <SettingRow className=' border-line border-b border-t'
          label={t('bilingualHighlightingStyle', 'Highlighting style')}
          control
        />
        <SettingRow
          label={t('border', 'border')}
          control={renderStyleSelect(highlightStyle, onHighlightStyle)}
        />
        <SettingRow
          label={t('backgroundColor', 'background color')}
          control={
            <ColorPicker
              value={highlightBg}
              selectedIndex={highlightBgIndex}
              presets={HIGHLIGHT_COLORS}
              onChange={onHighlightBg}
            />
          }
        />
        <SettingRow
          label={t('fontColor', 'font color')}
          control={
            <ColorPicker
              value={highlightFontColor}
              selectedIndex={highlightFontColorIndex}
              presets={TRANSLATION_FONT_COLORS}
              onChange={onHighlightFont}
            />
          }
        />
        {styleHasBorder(highlightStyle) && (
          <SettingRow
            label={t('borderColor', 'border color')}
            control={
              <ColorPicker
                value={highlightBorderColor}
                selectedIndex={highlightBorderColorIndex}
                presets={TRANSLATION_BG_COLORS}
                onChange={onHighlightBorderColor}
              />
            }
          />
        )}
        <SettingRow className=' border-line border-b border-t'
          label={t('stylePreview', 'Style preview')}
          control
        />
        <div className="flex flex-col gap-2 text-[14px] leading-7 px-4 py-4">
          <p>
            <span
              className="cursor-pointer rounded-[2px] px-0.5 transition-colors"
              style={hoverPart === 1 ? highlightCss : undefined}
              onMouseEnter={() => highlight && setHoverPart(1)}
              onMouseLeave={() => setHoverPart(null)}
            >
              {originalText1}
            </span>{' '}
            <span
              className="cursor-pointer rounded-[2px] px-0.5 transition-colors"
              style={hoverPart === 2 ? highlightCss : undefined}
              onMouseEnter={() => highlight && setHoverPart(2)}
              onMouseLeave={() => setHoverPart(null)}
            >
              {originalText2}
            </span>
          </p>
          <p style={translationStyle} className="inline-block rounded px-1 py-0.5">
            <span
              className="cursor-pointer rounded-[2px] px-0.5 transition-colors"
              style={hoverPart === 1 ? highlightCss : undefined}
              onMouseEnter={() => highlight && setHoverPart(1)}
              onMouseLeave={() => setHoverPart(null)}
            >
              {translatedText1}
            </span>{!targetLang.startsWith('zh') && ' '}
            <span
              className="cursor-pointer rounded-[2px] px-0.5 transition-colors"
              style={hoverPart === 2 ? highlightCss : undefined}
              onMouseEnter={() => highlight && setHoverPart(2)}
              onMouseLeave={() => setHoverPart(null)}
            >
              {translatedText2}
            </span>
          </p>
        </div>
        </>}
      </div>

      <DomainListSection
        title={t('alwaysTranslateWebsites', 'Always translate websites')}
        emptyHint={t('noDomainsConfigured', 'No websites configured.')}
        open={alwaysOpen}
        onToggle={() => setAlwaysOpen((o) => !o)}
        items={alwaysList}
        otherItems={neverList}
        kind={{ field: 'strategy', strategy: DOMAIN_STRATEGY.ALWAYS }}
        onChanged={refreshDomains}
      />

      <DomainListSection
        title={t('neverTranslateWebsites', 'Never translate websites')}
        emptyHint={t('noDomainsConfigured', 'No websites configured.')}
        open={neverOpen}
        onToggle={() => setNeverOpen((o) => !o)}
        items={neverList}
        otherItems={alwaysList}
        kind={{ field: 'strategy', strategy: DOMAIN_STRATEGY.NEVER }}
        onChanged={refreshDomains}
      />

      <DomainListSection
        title={t('floatBallDisabledWebsites', 'Floating ball disabled websites')}
        emptyHint={t('noDomainsConfigured', 'No websites configured.')}
        open={floatBallDisabledOpen}
        onToggle={() => setFloatBallDisabledOpen((o) => !o)}
        items={floatBallDisabledList}
        kind={{ field: 'floatBallDisabled' }}
        onChanged={refreshDomains}
      />

      <Dialog
        open={clearCacheOpen}
        onClose={() => setClearCacheOpen(false)}
        title={t('clearTranslationCache', 'Clear cache')}
        widthClass="w-[400px]"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setClearCacheOpen(false)}>
              {t('cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={onConfirmClearCache}>
              {t('confirm', 'Confirm')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-6 text-ink">
          {t('clearTranslationCacheConfirm', {
            size: formatBytes(cacheSizeBytes),
            defaultValue: 'The cache currently uses {{size}}. Clear it?',
          })}
        </p>
      </Dialog>
    </div>
  );
}
