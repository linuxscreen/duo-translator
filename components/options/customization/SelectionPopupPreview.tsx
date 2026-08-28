import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SelectionCard, type TranslationRun } from '@/main/aiWriting/SelectionCard';
import { loadTailwindIntoShadow } from '@/main/aiWriting/shadowStyle';
import { t } from '@/main/aiWriting/i18n';
import { useSelectionPopupPrefs, resolveSelectionServices } from '@/main/aiWriting/selectionPopupPrefs';
import type { DictEntry } from '@/main/dict/types';
import { bindThemeToElement } from '@/utils/theme';
import { buildServiceOptions, getTranslateService, type ServiceOption } from '@/utils/service';
import { browserTargetLanguage, CONFIG_KEY, LANGUAGES_MAP } from '@/main/constants';
import { getConfig } from '@/utils/db';

/** Width the real card is anchored at. */
const CARD_WIDTH = 460;

/**
 * Live preview of the selection-translate popup.
 *
 * Renders the REAL card (`SelectionCard`, the same component the page mounts),
 * not a mock-up — a mock-up starts lying the first time either side changes,
 * and every setting on this page is about how that card looks.
 *
 * Two consequences make this more than a plain component render:
 *
 *  - It must live in a **Shadow DOM**. The card is styled with the AI-writing
 *    token set (`main/aiWriting/aiWriting.css`: `bg-surface-2`, `text-ink-2`,
 *    `hover:bg-hover-3`, …), which does not exist in the Options stylesheet —
 *    dropped straight into this page it would render with no colours at all.
 *  - It is rendered through a **portal** rather than its own React root, so the
 *    settings above it drive it directly: flipping a switch repaints the
 *    preview in the same commit, with no bridge to keep in sync.
 *
 * Everything the card can DO is inert here: playback, pin, close and the
 * pickers are local or no-ops. The one exception is copy, which is left working
 * because it is harmless on fake text and the check-mark is part of what the
 * preview is showing.
 */
export function SelectionPopupPreview() {
  const prefs = useSelectionPopupPrefs();
  const hostRef = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);

  // Real service list + page defaults, so the preview names the user's own
  // providers instead of inventing some.
  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [pageService, setPageService] = useState('');
  const [pageLang, setPageLang] = useState('');

  // Card state the preview owns locally — none of it is persisted.
  const [pinned, setPinned] = useState(false);
  const [origExpanded, setOrigExpanded] = useState(false);
  const [serviceValue, setServiceValue] = useState('');
  const [langValue, setLangValue] = useState('');
  const [localServices, setLocalServices] = useState<string[] | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // StrictMode runs effects twice in development; a second attachShadow on
    // the same element throws.
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    if (!host.shadowRoot?.firstChild) {
      loadTailwindIntoShadow(shadow);
      const m = document.createElement('div');
      m.className = 'duo-ai-root';
      shadow.appendChild(m);
      setMount(m);
    }
  }, []);

  // Theme is bound separately from the mount so the disposer is not dropped by
  // StrictMode's double-invoke of the effect above.
  useEffect(() => {
    if (!mount) return;
    return bindThemeToElement(mount);
  }, [mount]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [svc, lang] = await Promise.all([
        getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
        getConfig(CONFIG_KEY.TARGET_LANGUAGE),
      ]);
      const { activeService, enabledTranslateServices, enabledAiProviders } = await getTranslateService(
        typeof svc === 'string' ? svc : undefined,
      );
      if (cancelled) return;
      setOptions(buildServiceOptions(enabledTranslateServices, enabledAiProviders));
      setPageService(activeService);
      setPageLang((typeof lang === 'string' && lang) || browserTargetLanguage());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedServices = resolveSelectionServices(prefs, pageService, options, serviceValue || null);
  const selectedServices = localServices ?? resolvedServices;

  const runs: TranslationRun[] = useMemo(() => {
    const sample = t('selectionPreviewTranslation', 'a sample translation');
    return selectedServices.map((key) => {
      const o = options.find((x) => x.value === key);
      return {
        key,
        label: o ? (o.i18nKey ? t(o.i18nKey, o.label) : o.label) : key,
        output: sample,
        running: false,
        error: null,
      };
    });
  }, [selectedServices, options]);

  const dictEntry: DictEntry = useMemo(
    () => ({
      provider: 'microsoft',
      word: 'example',
      query: 'example',
      phonetics: [
        { accent: 'uk', text: 'ɪɡˈzɑːmpl' },
        { accent: 'us', text: 'ɪɡˈzæmpl' },
      ],
      definitions: [{ pos: 'n.', senses: [t('selectionPreviewSense', 'example; instance; sample')] }],
      examples: [
        {
          source: 'This is an example.',
          target: t('selectionPreviewExampleTarget', 'This is a sample sentence.'),
        },
      ],
    }),
    [],
  );

  // Playback is the one action with a real side effect on a settings page, so
  // the preview hands the card a player that does nothing.
  const tts = useMemo(
    () => ({ playingKey: null, toggle: () => {}, toggleUrl: () => {}, stop: () => {} }),
    [],
  );

  const followLangMeta = LANGUAGES_MAP.get(pageLang);
  const followServiceOpt = options.find((o) => o.value === pageService);

  return (
    <div
      ref={hostRef}
      // The card carries its own shadow and rounding; the wrapper only sets the
      // width the real popup is anchored at.
      style={{ width: CARD_WIDTH, maxWidth: '100%' }}
    >
      {mount &&
        createPortal(
          <SelectionCard
            prefs={prefs}
            origText="example"
            origLang="en"
            origExpanded={origExpanded}
            onToggleOrigExpanded={() => setOrigExpanded((v) => !v)}
            runs={runs}
            targetLang={langValue || pageLang}
            dictEntry={dictEntry}
            dictLoading={false}
            dictError={null}
            serviceOptions={options}
            serviceValue={serviceValue}
            onServiceChange={setServiceValue}
            followServiceLabel={
              followServiceOpt
                ? followServiceOpt.i18nKey
                  ? t(followServiceOpt.i18nKey, followServiceOpt.label)
                  : followServiceOpt.label
                : pageService
            }
            selectedServices={selectedServices}
            onToggleService={(key) =>
              setLocalServices((prev) => {
                const base = prev ?? resolvedServices;
                const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
                return next.length === 0 ? base : next;
              })
            }
            langValue={langValue}
            onLangChange={setLangValue}
            followLangLabel={followLangMeta ? t(followLangMeta.title, followLangMeta.name) : pageLang}
            pinned={pinned}
            onTogglePin={() => setPinned((v) => !v)}
            onClose={() => {}}
            tts={tts}
            cardWidth={CARD_WIDTH}
            style={{ maxHeight: 460 }}
          />,
          mount,
        )}
    </div>
  );
}
