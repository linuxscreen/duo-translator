import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import {
  browserTargetLanguage,
  CONFIG_KEY,
  DEFAULT_VALUE,
  LANGUAGES,
  VIDEO_SUBTITLE_DISPLAY_MODE,
  VIDEO_SUBTITLE_SOURCE_POLICY,
} from '@/main/constants';
import {
  DEFAULT_VIDEO_SUBTITLE_STYLE,
  normalizeVideoSubtitleStyle,
  type VideoSubtitleStyle,
} from '@/main/videoSubtitle/types';
import { getConfig, setConfig } from '@/utils/db';
import { buildServiceOptions, getAiTranslateService, type ServiceOption } from '@/utils/service';
import type { AiProvider } from '@/main/aiProvider';
import { SettingRow } from '@/components/options/SettingRow';
import { ColorPicker } from '@/components/options/ColorPicker';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ServiceMark } from '@/components/ui/service-mark';

const FONT_COLOR_PRESETS = ['#ffffff', '#d8d8d8', '#ffd500', '#7fdcff', '#9dff8a'];
const BG_COLOR_PRESETS = ['#000000', '#1c1c1c', '#0b2a45', '#2a0b45', '#452a0b'];
const FONT_WEIGHTS = ['300', '400', '500', '600', '700'];

/**
 * Sentinel for "follow AI writing" in the AI-service picker. The key stores
 * `''` for that, but Radix's Select reads the empty string as "no value" and
 * would render a blank trigger — same trick as the selection-translate page.
 */
const FOLLOW_AI_WRITING = '__follow_ai_writing__';

/** Resolve a hex color to (presetIndex | customIndex) for the ColorPicker. */
function presetIndexOf(presets: string[], color: string): number {
  const idx = presets.indexOf(color.toLowerCase());
  return idx >= 0 ? idx : presets.length;
}

export function VideoSubtitlePage() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(DEFAULT_VALUE.VIDEO_SUBTITLE_SWITCH);
  const [autoEnable, setAutoEnable] = useState<boolean>(DEFAULT_VALUE.VIDEO_SUBTITLE_AUTO_ENABLE);
  const [mode, setMode] = useState<string>(DEFAULT_VALUE.VIDEO_SUBTITLE_DISPLAY_MODE);
  const [serviceKey, setServiceKey] = useState<string>(DEFAULT_VALUE.VIDEO_SUBTITLE_TRANSLATE_SERVICE);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [aiProviderId, setAiProviderId] = useState<string>(
    DEFAULT_VALUE.VIDEO_SUBTITLE_AI_PROVIDER,
  );
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [targetLang, setTargetLang] = useState<string>('');
  const [sourcePolicy, setSourcePolicy] = useState<string>(
    DEFAULT_VALUE.VIDEO_SUBTITLE_SOURCE_POLICY,
  );
  const [aiSegment, setAiSegment] = useState<boolean>(DEFAULT_VALUE.VIDEO_SUBTITLE_AI_SEGMENT);
  const [pauseOnSelect, setPauseOnSelect] = useState<boolean>(
    DEFAULT_VALUE.VIDEO_SUBTITLE_PAUSE_ON_SELECT,
  );
  const [hoverDict, setHoverDict] = useState<boolean>(DEFAULT_VALUE.VIDEO_SUBTITLE_HOVER_DICT);
  const [followNativeCc, setFollowNativeCc] = useState<boolean>(
    DEFAULT_VALUE.VIDEO_SUBTITLE_FOLLOW_NATIVE_CC,
  );
  const [chromeBottomOnly, setChromeBottomOnly] = useState<boolean>(
    DEFAULT_VALUE.YOUTUBE_MINIMAL_PLAYER_UI,
  );
  const [style, setStyle] = useState<VideoSubtitleStyle>(DEFAULT_VIDEO_SUBTITLE_STYLE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sw, auto, m, svc, lang, pageLang, srcPolicy, seg, segProvider, pause, hoverWord, followCc, chromeGate, rawStyle] =
        await Promise.all([
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_SWITCH),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE),
          getConfig(CONFIG_KEY.TARGET_LANGUAGE),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_SOURCE_POLICY),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_AI_SEGMENT),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_AI_PROVIDER),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_HOVER_DICT),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_FOLLOW_NATIVE_CC),
          getConfig(CONFIG_KEY.YOUTUBE_MINIMAL_PLAYER_UI),
          getConfig(CONFIG_KEY.VIDEO_SUBTITLE_STYLE),
        ]);
      if (cancelled) return;
      setEnabled(sw === undefined ? DEFAULT_VALUE.VIDEO_SUBTITLE_SWITCH : !!sw);
      setAutoEnable(auto === undefined ? DEFAULT_VALUE.VIDEO_SUBTITLE_AUTO_ENABLE : !!auto);
      setMode(typeof m === 'string' && m ? m : DEFAULT_VALUE.VIDEO_SUBTITLE_DISPLAY_MODE);
      // Unset subtitle language follows the page-translation target.
      setTargetLang(
        (typeof lang === 'string' && lang ? lang : '') ||
        (typeof pageLang === 'string' && pageLang ? pageLang : '') ||
        browserTargetLanguage(),
      );
      setSourcePolicy(
        typeof srcPolicy === 'string' && srcPolicy
          ? srcPolicy
          : DEFAULT_VALUE.VIDEO_SUBTITLE_SOURCE_POLICY,
      );
      setAiSegment(!!seg);
      setAiProviderId(typeof segProvider === 'string' ? segProvider : '');
      setPauseOnSelect(!!pause);
      setHoverDict(!!hoverWord);
      setFollowNativeCc(!!followCc);
      setChromeBottomOnly(!!chromeGate);
      setStyle(normalizeVideoSubtitleStyle(rawStyle));
      // Same picker context as AI writing: translators + all enabled AI
      // providers, resolved with the shared fallback rules.
      const { activeService, enabledTranslateServices, enabledAiProviders } =
        await getAiTranslateService(
          typeof svc === 'string' && svc ? svc : DEFAULT_VALUE.VIDEO_SUBTITLE_TRANSLATE_SERVICE,
        );
      if (cancelled) return;
      setServiceOptions(buildServiceOptions(enabledTranslateServices, enabledAiProviders));
      setAiProviders(enabledAiProviders);
      setServiceKey(activeService);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistStyle = (next: VideoSubtitleStyle) => {
    setStyle(next);
    void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_STYLE, next);
  };
  const patchStyle = (patch: Partial<VideoSubtitleStyle>) =>
    persistStyle({ ...style, ...patch });

  if (!ready) {
    return <div className="h-60 rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  // Each style control carries a visible caption (and a matching tooltip) —
  // a bare number box / slider gives no clue what it changes.
  const labelled = (label: string, control: React.ReactNode) => (
    <span className="flex items-center gap-1.5">
      {/* nowrap + shrink-0: the paired control (SelectTrigger) is `w-full`, so
          flex would otherwise squeeze the caption down to its min-content —
          one character for CJK text, i.e. a two-line label. */}
      <span className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-soft">{label}</span>
      {control}
    </span>
  );

  const weightSelect = (value: number, onChange: (v: number) => void) =>
    labelled(
      t('videoSubtitleFontWeight', 'Weight'),
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="min-w-[84px]" title={t('videoSubtitleFontWeight', 'Weight')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_WEIGHTS.map((w) => (
            <SelectItem key={w} value={w}>
              {w}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>,
    );

  const sizeInput = (value: number, onChange: (v: number) => void) =>
    labelled(
      t('videoSubtitleFontSize', 'Size'),
      <input
        type="number"
        min={10}
        max={48}
        step={1}
        value={value}
        title={t('videoSubtitleFontSizeHint', 'Font size in pixels (scales with the player)')}
        onChange={(e) => {
          const n = Math.min(48, Math.max(10, Math.floor(Number(e.target.value) || 0)));
          onChange(n);
        }}
        className="h-8 w-[66px] rounded-md border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent"
      />,
    );

  const colorPicker = (
    value: string,
    presets: string[],
    fallback: string,
    onChange: (c: string) => void,
  ) =>
    labelled(
      t('videoSubtitleColor', 'Color'),
      <ColorPicker
        value={value}
        selectedIndex={presetIndexOf(presets, value)}
        presets={presets}
        onChange={(color) => onChange(color || fallback)}
      />,
    );

  // Which lines the preview draws — the same two questions the overlay asks.
  const previewOriginal = mode !== VIDEO_SUBTITLE_DISPLAY_MODE.TRANSLATION;
  const previewTranslation = mode !== VIDEO_SUBTITLE_DISPLAY_MODE.ORIGINAL;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-ink-soft">
        {t('videoSubtitleOnlyYoutubeNote', 'Currently only YouTube is supported. Netflix and more are coming.')}
      </p>

      {/* Basic switches */}
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <SettingRow
          label={t('enable', 'Enable')}
          hint={t('videoSubtitleGlobalSwitchHint', 'Master switch for the whole feature')}
          control={
            <Switch
              checked={enabled}
              onCheckedChange={(v) => {
                setEnabled(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_SWITCH, v);
              }}
            />
          }
        />
        <SettingRow
          label={t('videoSubtitleAutoEnable', 'Auto-enable bilingual subtitles')}
          hint={t('videoSubtitleAutoEnableHint', 'Turn on automatically when a video with captions plays')}
          control={
            <Switch
              checked={autoEnable}
              onCheckedChange={(v) => {
                setAutoEnable(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE, v);
              }}
            />
          }
        />
        <SettingRow
          label={t('videoSubtitleDisplayMode', 'Display mode')}
          control={
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_DISPLAY_MODE, v);
              }}
            >
              <SelectTrigger className="min-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={VIDEO_SUBTITLE_DISPLAY_MODE.BILINGUAL}>
                  {t('videoSubtitleModeBilingual', 'Bilingual')}
                </SelectItem>
                <SelectItem value={VIDEO_SUBTITLE_DISPLAY_MODE.TRANSLATION}>
                  {t('videoSubtitleModeTranslation', 'Translation only')}
                </SelectItem>
                <SelectItem value={VIDEO_SUBTITLE_DISPLAY_MODE.ORIGINAL}>
                  {t('videoSubtitleModeOriginal', 'Original only')}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('translateService', 'Translate service')}
          control={
            <Select
              value={serviceKey}
              onValueChange={(v) => {
                setServiceKey(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE, v);
              }}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serviceOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center gap-1">
                      <ServiceMark id={o.iconId} />
                      {o.i18nKey ? t(o.i18nKey, o.label) : o.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('targetLanguage', 'Target language')}
          control={
            <Select
              value={targetLang}
              onValueChange={(v) => {
                setTargetLang(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE, v);
              }}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {t(l.title, l.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('videoSubtitleSourcePolicy', 'Source language priority')}
          control={
            <Select
              value={sourcePolicy}
              onValueChange={(v) => {
                setSourcePolicy(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_SOURCE_POLICY, v);
              }}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={VIDEO_SUBTITLE_SOURCE_POLICY.CAPTION}>
                  {t('videoSubtitleSourceFollowCaption', 'Follow the native captions')}
                </SelectItem>
                <SelectItem value={VIDEO_SUBTITLE_SOURCE_POLICY.AUDIO}>
                  {t('videoSubtitleSourceFollowAudio', 'Follow the native audio')}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('videoSubtitleAiProvider', 'AI service')}
          hint={t('videoSubtitleAiProviderHint', 'Used by AI sentence segmentation')}
          control={
            <Select
              // A provider that has since been deleted or disabled is shown as
              // "follow AI writing" rather than a blank trigger — Radix has no
              // item for it. The stored id is left alone: re-enabling the
              // provider brings the choice back.
              value={
                aiProviders.some((p) => p.id === aiProviderId)
                  ? aiProviderId
                  : FOLLOW_AI_WRITING
              }
              onValueChange={(v) => {
                const next = v === FOLLOW_AI_WRITING ? '' : v;
                setAiProviderId(next);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_AI_PROVIDER, next);
              }}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_AI_WRITING}>
                  {t('videoSubtitleAiProviderFollowWriting', 'Follow AI writing')}
                </SelectItem>
                {aiProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-1">
                      <ServiceMark id={p.type as string} />
                      {p.getTitle()}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('videoSubtitleAiSegment', 'AI sentence segmentation')}
          hint={t(
            'videoSubtitleAiSegmentHint',
            'Use an AI provider to split auto-generated captions into sentences more accurately',
          )}
          control={
            <Switch
              checked={aiSegment}
              onCheckedChange={(v) => {
                setAiSegment(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_AI_SEGMENT, v);
              }}
            />
          }
        />
        <SettingRow
          label={t('videoSubtitleHoverDict', 'Look up words on hover')}
          hint={t(
            'videoSubtitleHoverDictHint',
            'Look the word under the pointer up in the dictionary and pause the video; playback resumes when the pointer leaves',
          )}
          control={
            <Switch
              checked={hoverDict}
              onCheckedChange={(v) => {
                setHoverDict(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_HOVER_DICT, v);
              }}
            />
          }
        />
        <SettingRow
          label={t('videoSubtitlePauseOnSelect', 'Pause playback when selecting text')}
          hint={t(
            'videoSubtitlePauseOnSelectHint',
            'Pause the video as soon as you select subtitle text, so it stays on screen',
          )}
          control={
            <Switch
              checked={pauseOnSelect}
              onCheckedChange={(v) => {
                setPauseOnSelect(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_PAUSE_ON_SELECT, v);
              }}
            />
          }
        />
        <SettingRow
          label={t('videoSubtitleFollowNativeCc', 'Follow the native caption switch')}
          hint={t(
            'videoSubtitleFollowNativeCcHint',
            "Turning the player's own captions on or off turns bilingual subtitles on or off with them",
          )}
          control={
            <Switch
              checked={followNativeCc}
              onCheckedChange={(v) => {
                setFollowNativeCc(v);
                void setConfig(CONFIG_KEY.VIDEO_SUBTITLE_FOLLOW_NATIVE_CC, v);
              }}
            />
          }
        />
        <SettingRow
          label={t('youtubeMinimalPlayerUi', 'Minimal YouTube player UI')}
          hint={t(
            'youtubeMinimalPlayerUiHint',
            'Show the control bar only when the pointer moves to the bottom of the YouTube player, and hide every other button and label',
          )}
          control={
            <Switch
              checked={chromeBottomOnly}
              onCheckedChange={(v) => {
                setChromeBottomOnly(v);
                void setConfig(CONFIG_KEY.YOUTUBE_MINIMAL_PLAYER_UI, v);
              }}
            />
          }
        />
      </div>

      {/* Style preview + settings */}
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-mute">
            {t('videoSubtitleStyleTitle', 'Subtitle style')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => persistStyle({ ...DEFAULT_VIDEO_SUBTITLE_STYLE })}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('videoSubtitleStyleReset', 'Reset to default')}
          </Button>
        </div>

        {/* Preview — a fake "video" area with the subtitle box near its bottom */}
        <div className="px-4 pt-4">
          <div
            className="relative h-44 w-full overflow-hidden rounded-lg"
            style={{
              background:
                'linear-gradient(160deg, #24313f 0%, #17202a 45%, #0d1218 100%)',
            }}
          >
            <div
              className="absolute left-1/2 -translate-x-1/2 max-w-[90%] rounded-md px-4 py-2 text-center"
              style={{
                bottom: '10%',
                background: hexToRgba(style.bgColor, style.bgOpacity),
                lineHeight: 1.35,
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              }}
            >
              {previewOriginal && (
                <div
                  style={{
                    color: style.originalColor,
                    fontSize: style.originalSize,
                    fontWeight: style.originalWeight,
                  }}
                >
                  This is the original subtitle line
                </div>
              )}
              {previewTranslation && (
                <div
                  style={{
                    color: style.translationColor,
                    fontSize: style.translationSize,
                    fontWeight: style.translationWeight,
                  }}
                >
                  {t('videoSubtitlePreviewTranslation', '这是译文字幕效果预览')}
                </div>
              )}
            </div>
          </div>
        </div>

        <SettingRow
          label={t('videoSubtitleOriginalStyle', 'Original text')}
          control={
            <div className="flex items-center gap-4">
              {colorPicker(
                style.originalColor,
                FONT_COLOR_PRESETS,
                DEFAULT_VIDEO_SUBTITLE_STYLE.originalColor,
                (c) => patchStyle({ originalColor: c }),
              )}
              {sizeInput(style.originalSize, (v) => patchStyle({ originalSize: v }))}
              {weightSelect(style.originalWeight, (v) => patchStyle({ originalWeight: v }))}
            </div>
          }
        />
        <SettingRow
          label={t('videoSubtitleTranslationStyle', 'Translation text')}
          control={
            <div className="flex items-center gap-4">
              {colorPicker(
                style.translationColor,
                FONT_COLOR_PRESETS,
                DEFAULT_VIDEO_SUBTITLE_STYLE.translationColor,
                (c) => patchStyle({ translationColor: c }),
              )}
              {sizeInput(style.translationSize, (v) => patchStyle({ translationSize: v }))}
              {weightSelect(style.translationWeight, (v) => patchStyle({ translationWeight: v }))}
            </div>
          }
        />
        <SettingRow
          label={t('videoSubtitleBgStyle', 'Background')}
          hint={t('videoSubtitleBgStyleHint', 'Color and opacity of the subtitle box')}
          control={
            <div className="flex items-center gap-4">
              {colorPicker(
                style.bgColor,
                BG_COLOR_PRESETS,
                DEFAULT_VIDEO_SUBTITLE_STYLE.bgColor,
                (c) => patchStyle({ bgColor: c }),
              )}
              {labelled(
                t('videoSubtitleOpacity', 'Opacity'),
                <span className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(style.bgOpacity * 100)}
                    title={t('videoSubtitleOpacityHint', 'Background opacity of the subtitle box')}
                    onChange={(e) => patchStyle({ bgOpacity: Number(e.target.value) / 100 })}
                    className="w-[104px] accent-[var(--color-accent)]"
                  />
                  <span className="w-[36px] text-right text-[12px] tabular-nums text-ink-soft">
                    {Math.round(style.bgOpacity * 100)}%
                  </span>
                </span>,
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
