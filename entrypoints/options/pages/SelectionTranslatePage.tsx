import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACTION,
  CONFIG_KEY,
  configDefault,
  DB_ACTION,
  LANGUAGES,
  LANGUAGES_MAP,
  SELECTION_ICON_TRIGGER,
  SELECTION_ICON_TRIGGER_OPTIONS,
  TTS_SERVICE_OPTIONS,
  browserTargetLanguage,
} from '@/main/constants';
import {
  COMPACT_SELECTION_POPUP_UI,
  orderSelectionServices,
  resolveSelectionServices,
  SELECTION_POPUP_UI_KEYS,
  STOCK_SELECTION_POPUP_PREFS,
} from '@/main/aiWriting/selectionPopupPrefs';
import { sendMessageToAllTabs, sendMessageToBackground } from '@/utils/message';
import { setConfig } from '@/utils/db';
import { readConfig, useConfig } from '@/utils/reactiveConfig';
import { SettingRow } from '@/components/options/SettingRow';
import { DomainListSection, type DomainItem } from '@/components/options/DomainListSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MultiSelect } from '@/components/ui/multi-select';
import { Button } from '@/components/ui/button';
import { ServiceMark } from '@/components/ui/service-mark';
import {
  buildServiceOptions,
  getAiTranslateService,
  getTranslateService,
  type ServiceOption,
} from '@/utils/service';

/**
 * Sentinel for "follow the page translation" in the two pickers.
 *
 * Both keys store `''` for that, but Radix's Select treats the empty string as
 * "no value" and would render a blank trigger, so the option carries a
 * placeholder value that is mapped back to `''` on write — the same trick the
 * toolbar popup uses for the very same setting.
 */
const FOLLOW_PAGE = '__follow__';

/** Every config key this page reads, warmed before the first paint. */
const PREFETCH_KEYS: CONFIG_KEY[] = [
  CONFIG_KEY.SELECTION_ICON_SWITCH,
  CONFIG_KEY.SELECTION_ICON_TRIGGER,
  CONFIG_KEY.SELECTION_TRANSLATE_SERVICE,
  CONFIG_KEY.SELECTION_TARGET_LANGUAGE,
  CONFIG_KEY.SELECTION_POPUP_MULTI_SERVICE,
  CONFIG_KEY.SELECTION_POPUP_SERVICES,
  CONFIG_KEY.TTS_SERVICE,
  CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH,
  ...SELECTION_POPUP_UI_KEYS,
];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Props = {
  /** Opens the Customization tab, where the popup's layout is edited. */
  onOpenCustomization: () => void;
};

/**
 * Options › Selection translation.
 *
 * Everything that governs the little icon under a selection and the card it
 * opens: whether it appears, how it fires, what it asks and in which language,
 * plus two one-click presets for the card's layout. The layout itself stays in
 * Customization — this page only offers the two ends of it (compact / stock)
 * and a link to the finer controls.
 */
export function SelectionTranslatePage({ onOpenCustomization }: Props) {
  const { t } = useTranslation();

  const selectionIcon = useConfig<boolean>(CONFIG_KEY.SELECTION_ICON_SWITCH);
  const trigger = useConfig<SELECTION_ICON_TRIGGER>(CONFIG_KEY.SELECTION_ICON_TRIGGER);
  // `''`/undefined means "follow the page translation" for both of these.
  const service = useConfig<string | undefined>(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE);
  const targetLang = useConfig<string | undefined>(CONFIG_KEY.SELECTION_TARGET_LANGUAGE);
  const multiService = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_MULTI_SERVICE);
  const multiServices = useConfig<string[]>(CONFIG_KEY.SELECTION_POPUP_SERVICES);
  const ttsService = useConfig<string>(CONFIG_KEY.TTS_SERVICE);
  const popupCustomOn = useConfig<boolean>(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH);

  // The card-layout keys, read as one record so the two buttons below can
  // compare against the compact preset / the shipped defaults.
  const uiValues: Record<string, unknown> = {
    [CONFIG_KEY.SELECTION_POPUP_DICT]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT),
    [CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES),
    [CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL),
    [CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS),
    [CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY),
    [CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS),
    [CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY),
    [CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG]: useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG),
  };

  // The page-translation service + language, only so the "follow" entries can
  // name what they follow ("Follow page (Microsoft)").
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  // Every AI provider, ungated by AI_USE_FOR_TRANSLATE_PAGE — only so a value
  // already stored but missing from `serviceOptions` can still be named.
  const [allServiceOptions, setAllServiceOptions] = useState<ServiceOption[]>([]);
  const [pageService, setPageService] = useState('');
  const [pageLang, setPageLang] = useState(browserTargetLanguage());

  const [disabledList, setDisabledList] = useState<DomainItem[]>([]);
  const [disabledOpen, setDisabledOpen] = useState(false);

  // Gate the first paint on the service list AND on storage hydration: every
  // `useConfig` above reads the same cache `readConfig` fills, so warming the
  // keys here means the selects render their stored value straight away rather
  // than flashing the default (see utils/reactiveConfig).
  const [ready, setReady] = useState(false);

  const refreshDomains = async () => {
    const list = await sendMessageToBackground({
      action: DB_ACTION.DOMAIN_LIST,
      data: { selectionIconDisabled: true },
    });
    setDisabledList(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ctx, aiCtx, lang] = await Promise.all([
        getTranslateService(undefined),
        getAiTranslateService(undefined),
        readConfig<string | undefined>(CONFIG_KEY.TARGET_LANGUAGE),
        Promise.all(PREFETCH_KEYS.map((k) => readConfig(k))),
      ]);
      if (cancelled) return;
      setServiceOptions(buildServiceOptions(ctx.enabledTranslateServices, ctx.enabledAiProviders));
      setAllServiceOptions(
        buildServiceOptions(aiCtx.enabledTranslateServices, aiCtx.enabledAiProviders),
      );
      setPageService(ctx.activeService ?? '');
      if (lang) setPageLang(lang);
      await refreshDomains();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allServiceKeys = useMemo(() => serviceOptions.map((o) => o.value), [serviceOptions]);

  const onSelectionIcon = (v: boolean) => {
    void setConfig(CONFIG_KEY.SELECTION_ICON_SWITCH, v);
    void sendMessageToAllTabs({
      action: ACTION.CONFIG_CHANGED,
      data: { [CONFIG_KEY.SELECTION_ICON_SWITCH]: v },
    });
  };

  // No CONFIG_CHANGED fan-out below this line: every remaining key on this page
  // is read through the reactive store (`useConfig` / `readConfig`), which is
  // driven by `storage.watch` and so refreshes every open tab off the write.
  const onTrigger = (v: string) => {
    if (!Object.values(SELECTION_ICON_TRIGGER).includes(v as SELECTION_ICON_TRIGGER)) return;
    void setConfig(CONFIG_KEY.SELECTION_ICON_TRIGGER, v as SELECTION_ICON_TRIGGER);
  };

  const onService = (v: string) => {
    void setConfig(CONFIG_KEY.SELECTION_TRANSLATE_SERVICE, v === FOLLOW_PAGE ? '' : v);
  };

  const onTargetLang = (v: string) => {
    void setConfig(CONFIG_KEY.SELECTION_TARGET_LANGUAGE, v === FOLLOW_PAGE ? '' : v);
  };

  /**
   * Turning multi-service on with nothing chosen seeds it with EVERY enabled
   * service.
   *
   * Without this the resolver falls back to the single page-translation service
   * and the card looks exactly as it did — the switch would appear to do
   * nothing, and the only place to fix that is the popup's own picker, which
   * the user has to go find on some page. "Show every enabled service" is also
   * what the setting promises, so the seed is the honest default rather than a
   * convenience.
   */
  const onMultiService = (v: boolean) => {
    void setConfig(CONFIG_KEY.SELECTION_POPUP_MULTI_SERVICE, v);
    if (v && (!Array.isArray(multiServices) || multiServices.length === 0) && allServiceKeys.length > 0) {
      void setConfig(CONFIG_KEY.SELECTION_POPUP_SERVICES, allServiceKeys);
    }
  };

  const onTtsService = (v: string) => {
    void setConfig(CONFIG_KEY.TTS_SERVICE, v);
  };

  /**
   * The multi-service set as the CARD resolves it, not the raw stored array —
   * an empty or stale list means "the user has not picked yet" there and falls
   * back to the page service, so reading the array directly would show this
   * picker as empty while the card was answering with one service.
   */
  const selectedServices = resolveSelectionServices(
    { ...STOCK_SELECTION_POPUP_PREFS, multiService: true, services: Array.isArray(multiServices) ? multiServices : [] },
    pageService,
    serviceOptions,
    null,
  );

  const onToggleSelectedService = (key: string) => {
    // Stored in the picker's order rather than the order ticked — that is the
    // order the card answers in, and the two must not disagree.
    const next = orderSelectionServices(
      selectedServices.includes(key)
        ? selectedServices.filter((k) => k !== key)
        : [...selectedServices, key],
      serviceOptions,
    );
    // Same refusal as the card's own checklist: a set with nothing in it would
    // be put straight back by the resolver, so the tick would look inert.
    if (next.length === 0) return;
    void setConfig(CONFIG_KEY.SELECTION_POPUP_SERVICES, next);
  };

  // ─── The two card-layout presets ──────────────────────────────────────────
  // Both are disabled when pressing them would change nothing: a button that
  // accepts a click and does nothing is worse than one that says it is spent.
  const compactApplied =
    popupCustomOn && COMPACT_SELECTION_POPUP_UI.every(([k, v]) => uiValues[k] === v);

  const uiAllDefault = SELECTION_POPUP_UI_KEYS.every((k) => sameValue(uiValues[k], configDefault(k)));

  const onCompact = () => {
    // The master switch first: every key below is inert without it, so a
    // preset that set them and left the switch off would look like a no-op.
    void setConfig(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH, true);
    for (const [key, value] of COMPACT_SELECTION_POPUP_UI) void setConfig(key, value);
  };

  const onRestoreUi = () => {
    for (const key of SELECTION_POPUP_UI_KEYS) void setConfig(key, configDefault(key));
    void setConfig(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH, false);
  };

  const uiHint = t(
    'selectionPopupUiHint',
    'To adjust the card further, go to {{link}} → Selection translate popup',
  );
  const [hintBefore, hintAfter] = uiHint.split('{{link}}');

  if (!ready) {
    return <div className="h-[420px] rounded-xl border border-line bg-surface/60 backdrop-blur-sm" />;
  }

  const serviceLabel = (opt: ServiceOption | undefined, fallback: string) =>
    opt ? (opt.i18nKey ? t(opt.i18nKey, opt.label) : opt.label) : fallback;
  const followWith = (name: string) =>
    t('selectionFollowWeb', 'Follow page ({{name}})').replace('{{name}}', name);
  const pageServiceName = serviceLabel(
    serviceOptions.find((o) => o.value === pageService),
    pageService,
  );
  const pageLangName = t(LANGUAGES_MAP.get(pageLang)?.title ?? pageLang, pageLang);

  // A stored service the picker no longer offers (an AI provider gated out of
  // page translation) is still listed, so the row shows the real state instead
  // of an empty trigger the user cannot move off.
  const extraServiceOption =
    service && !serviceOptions.some((o) => o.value === service)
      ? allServiceOptions.find((o) => o.value === service)
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <SettingRow
          label={t('enable', 'Enable')}
          hint={t('selectionTranslateIconHint', 'Show a translate icon after selecting text')}
          control={<Switch checked={selectionIcon} onCheckedChange={onSelectionIcon} />}
        />
        <SettingRow
          label={t('translateService', 'Translate service')}
          control={
            // Multi-service mode swaps the control rather than greying it out:
            // the row still answers "which service(s)", it just takes a set
            // now, and a disabled picker would leave no way to edit that set
            // outside the card itself. Same width either way so the row does
            // not jump when the switch below is flipped.
            multiService ? (
              <MultiSelect
                // Fixed, not `min-w-`: the summary grows with every service
                // ticked, and a min-width box is still content-sized, so the
                // control would widen the whole row tick by tick and `truncate`
                // would never have an overflow to draw an ellipsis for.
                className="w-[200px]"
                options={serviceOptions.map((s) => ({
                  value: s.value,
                  label: serviceLabel(s, s.label),
                  icon: <ServiceMark id={s.iconId} />,
                }))}
                value={selectedServices}
                onToggle={onToggleSelectedService}
                minSelected={1}
              />
            ) : (
              <Select value={service || FOLLOW_PAGE} onValueChange={onService}>
                <SelectTrigger className="min-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_PAGE}>{followWith(pageServiceName)}</SelectItem>
                  {(extraServiceOption ? [extraServiceOption, ...serviceOptions] : serviceOptions).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className="flex items-center gap-3">
                        <ServiceMark id={s.iconId} />
                        {serviceLabel(s, s.label)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        />
        <SettingRow
          label={t('targetLanguage', 'Target language')}
          control={
            <Select value={targetLang || FOLLOW_PAGE} onValueChange={onTargetLang}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_PAGE}>{followWith(pageLangName)}</SelectItem>
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
          label={t('selectionIconTriggerMode', 'Trigger mode')}
          control={
            <Select value={trigger} onValueChange={onTrigger} disabled={!selectionIcon}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SELECTION_ICON_TRIGGER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.title, opt.fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('selectionPopupMultiService', 'Multiple translate services')}
          hint={t('selectionPopupMultiServiceHint', 'Show every chosen service’s translation at once')}
          control={<Switch checked={multiService} onCheckedChange={onMultiService} />}
        />
        <SettingRow
          label={t('ttsService', 'Text-to-speech (TTS) service')}
          hint={t('ttsServiceHint', 'Voice provider for reading original / translated text aloud')}
          control={
            <Select value={ttsService} onValueChange={onTtsService}>
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_SERVICE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label={t('selectionPopupInterface', 'Popup interface')}
          hint={
            <>
              {hintBefore}
              <button
                type="button"
                onClick={onOpenCustomization}
                className="cursor-pointer text-accent underline-offset-2 hover:underline"
              >
                {t('customization', 'Customization')}
              </button>
              {hintAfter}
            </>
          }
          control={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onCompact} disabled={compactApplied}>
                {t('selectionPopupCompactUi', 'Compact interface')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onRestoreUi}
                disabled={!popupCustomOn || uiAllDefault}
              >
                {t('selectionPopupRestoreUi', 'Restore default interface')}
              </Button>
            </div>
          }
        />
      </div>

      <DomainListSection
        title={t('disabledWebsites', 'Disabled websites')}
        emptyHint={t('noDomainsConfigured', 'No websites configured.')}
        open={disabledOpen}
        onToggle={() => setDisabledOpen((o) => !o)}
        items={disabledList}
        kind={{ field: 'selectionIconDisabled' }}
        onChanged={refreshDomains}
      />
    </div>
  );
}
