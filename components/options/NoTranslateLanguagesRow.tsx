import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import { LANGUAGES } from '@/main/constants';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
};

/**
 * "Do not translate these languages" — chips for what is chosen, a dialog to
 * change it.
 *
 * Not a plain SettingRow: LANGUAGES is 100+ entries, so the list cannot live in
 * the row, and the chosen few have to stay visible without opening anything —
 * a bare "3 selected" would make the user open a dialog to answer "which
 * three?". The chips carry their own remove button so the common edit (drop
 * one) needs no dialog at all.
 */
export function NoTranslateLanguagesRow({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * Which languages were already on when the dialog opened — the ONLY thing the
   * "chosen first" ordering looks at.
   *
   * Every tick saves immediately, so ordering by the live selection would make
   * the row the user just clicked jump to the top of the list, out from under
   * the cursor, and shove everything else down. Freezing the order at open time
   * keeps the list still while it is being edited; the next open re-sorts.
   */
  const [pinnedTop, setPinnedTop] = useState<Set<string>>(new Set());

  const selected = useMemo(() => new Set(value), [value]);

  const openDialog = () => {
    setQuery('');
    setPinnedTop(new Set(value));
    setOpen(true);
  };

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = LANGUAGES.map((l) => ({
      value: l.value,
      // The localized name is what the user reads; `name` is the English
      // fallback and stays searchable so an English query works in any UI
      // language.
      label: t(l.title, l.name),
      name: l.name,
    }));
    const matched = q === ''
      ? list
      : list.filter(
        (l) =>
          l.label.toLowerCase().includes(q) ||
          l.name.toLowerCase().includes(q) ||
          l.value.toLowerCase().includes(q),
      );
    // Chosen languages float to the top of the UNFILTERED list: with 100+
    // entries the handful that are on would otherwise be scattered out of
    // sight. While filtering, the query is the ordering the user asked for.
    if (q !== '') return matched;
    return [
      ...matched.filter((l) => pinnedTop.has(l.value)),
      ...matched.filter((l) => !pinnedTop.has(l.value)),
    ];
  }, [query, t, pinnedTop]);

  // Saved on every tick — there is no Save button to press. Safe to do without
  // a confirmation step because the change is fully visible (the chips in the
  // row) and reversible by ticking the same box again.
  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  };

  const labelOf = (code: string) => {
    const lang = LANGUAGES.find((l) => l.value === code);
    return lang ? t(lang.title, lang.name) : code;
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink">
            {t('noTranslateLanguages', 'Do not translate these languages')}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-soft">
            {t(
              'noTranslateLanguagesHint',
              'Web pages, paragraphs and YouTube original captions in a selected language are not translated automatically.',
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end">
          <Button variant="outline" size="sm" onClick={openDialog}>
            {t('select', 'Select')}
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </Button>
        </div>
      </div>
      {value.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {value.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-hover px-2 py-0.5 text-[12px] text-ink-soft"
            >
              {labelOf(code)}
              <button
                type="button"
                onClick={() => onChange(value.filter((c) => c !== code))}
                aria-label={t('remove', 'Remove')}
                title={t('remove', 'Remove')}
                className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded text-ink-mute hover:text-ink"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('noTranslateLanguages', 'Do not translate these languages')}
        widthClass="w-[440px]"
        footer={
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={value.length === 0}
              // `text-danger` is the popup/options token set — do NOT copy this
              // className into a Shadow DOM surface, where that token does not
              // exist and would silently render colorless.
              className="cursor-pointer text-[12px] text-danger hover:text-danger/80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-danger"
            >
              {t('clearAll', 'Clear all')}
            </button>
            <span className="text-[12px] text-ink-mute">
              {t('selectedCount', '{{count}} selected', { count: value.length })}
            </span>
          </div>
        }
      >
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('searchLanguage', 'Search language…')}
          className="mb-2"
        />
        <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-line">
          {options.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-ink-mute">
              {t('noResults', 'No results')}
            </div>
          )}
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover"
            >
              <Checkbox
                checked={selected.has(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{opt.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-mute">{opt.value}</span>
            </label>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
