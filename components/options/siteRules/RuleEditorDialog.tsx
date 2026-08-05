import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { isValidPattern } from '@/main/siteRules/urlMatch';
import type { SiteRule } from '@/main/siteRules/types';

type Props = {
  open: boolean;
  /** `null` = create a new rule. */
  rule: SiteRule | null;
  onClose: () => void;
  onSave: (rule: SiteRule) => void;
};

/** One line per entry. Matches how the fields are edited and how they are stored. */
const toLines = (values: string[]) => values.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');

function newId(): string {
  return crypto.randomUUID?.() ?? `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type FormProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  /** Renders the red asterisk. Mark a field only if Save actually rejects it empty. */
  required?: boolean;
};

function FormField({ label, hint, value, onChange, placeholder, rows, required }: FormProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {hint && <span className="text-[11.5px] text-ink-soft">{hint}</span>}
      {rows ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          required={required}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
    </label>
  );
}

/**
 * Create / edit one user rule.
 *
 * Validation is live rather than on-submit, because it gates the Save button.
 * It names the offending entry instead of a generic "invalid": URL patterns go
 * through the same `compilePattern` the matcher uses, and selectors through
 * `document.querySelector`.
 */
export function RuleEditorDialog({ open, rule, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includeUrls, setIncludeUrls] = useState('');
  const [excludeUrls, setExcludeUrls] = useState('');
  const [matchSelectors, setMatchSelectors] = useState('');
  const [includeSelectors, setIncludeSelectors] = useState('');
  const [excludeSelectors, setExcludeSelectors] = useState('');
  const [injectCss, setInjectCss] = useState('');
  // Has the user edited anything yet? Gates the "required field is empty"
  // message so a freshly opened blank form is not greeted with red text.
  const [touched, setTouched] = useState(false);

  /** Wrap a setter so any edit marks the form touched. */
  const edit = (set: (v: string) => void) => (v: string) => {
    setTouched(true);
    set(v);
  };

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setName(rule?.name ?? '');
    setDescription(rule?.description ?? '');
    setIncludeUrls(toLines(rule?.includeUrls ?? []));
    setExcludeUrls(toLines(rule?.excludeUrls ?? []));
    setMatchSelectors(toLines(rule?.matchSelectors ?? []));
    setIncludeSelectors(toLines(rule?.includeSelectors ?? []));
    setExcludeSelectors(toLines(rule?.excludeSelectors ?? []));
    setInjectCss(rule?.injectCss.join('\n') ?? '');
  }, [open, rule]);

  /**
   * Live validation — it gates the Save button, so it cannot wait for a click.
   *
   * `missing` and `error` are reported separately on purpose. An empty required
   * field is not a mistake the user made, it is a form they have not finished:
   * the red asterisk plus a disabled Save already say so, and greeting a
   * freshly opened blank form with red text would be nagging. `error` is only
   * ever the result of something actually typed.
   */
  const { missing, error } = useMemo(() => {
    const include = fromLines(includeUrls);
    if (include.length === 0) return { missing: true, error: '' };

    const badUrl = [...include, ...fromLines(excludeUrls)].find((p) => !isValidPattern(p));
    if (badUrl) {
      return {
        missing: false,
        error: t('ruleErrorBadUrl', { pattern: badUrl, defaultValue: 'Invalid URL pattern: {{pattern}}' }),
      };
    }
    // document.querySelector is the only honest test of selector syntax, and it
    // is available here because Options has a document (the service worker does
    // not, which is why normalizeBundle skips selectors).
    const selectors = [
      ...fromLines(matchSelectors),
      ...fromLines(includeSelectors),
      ...fromLines(excludeSelectors),
    ];
    for (const selector of selectors) {
      try {
        document.querySelector(selector);
      } catch {
        return {
          missing: false,
          error: t('ruleErrorBadSelector', { selector, defaultValue: 'Invalid CSS selector: {{selector}}' }),
        };
      }
    }
    return { missing: false, error: '' };
  }, [includeUrls, excludeUrls, matchSelectors, includeSelectors, excludeSelectors, t]);

  const canSave = !missing && error === '';
  // The asterisk marking the required field scrolls out of view on a form this
  // tall, so once the user has started filling it in, say what is still needed
  // in the pinned strip rather than leaving a disabled Save unexplained.
  const shownError =
    error ||
    (missing && touched
      ? t('ruleErrorNoIncludeUrl', 'Add at least one URL pattern — a rule with none never matches')
      : '');

  const submit = () => {
    // Guarded as well as disabled: the button is not the only way in.
    if (!canSave) return;
    const include = fromLines(includeUrls);

    onSave({
      id: rule?.id ?? newId(),
      name: name.trim() || include[0],
      description: description.trim(),
      enabled: rule?.enabled ?? true,
      includeUrls: include,
      excludeUrls: fromLines(excludeUrls),
      matchSelectors: fromLines(matchSelectors),
      includeSelectors: fromLines(includeSelectors),
      excludeSelectors: fromLines(excludeSelectors),
      injectCss: injectCss.trim() === '' ? [] : [injectCss.trim()],
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? t('editRule', 'Edit rule') : t('addRule', 'Add rule')}
      widthClass="w-[620px]"
      // A misclick outside must not discard a half-filled rule form.
      dismissOnBackdrop={false}
      // Pinned above the footer — the form is taller than the panel, so an
      // error inside the scrolling body would sit below the fold.
      error={shownError || undefined}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSave}>
            {t('save', 'Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <FormField label={t('name', 'Name')} value={name} onChange={edit(setName)} placeholder="GitHub" />
        <FormField
          label={t('ruleDescription', 'Description')}
          value={description}
          onChange={edit(setDescription)}
          placeholder={t('optional', 'Optional')}
        />
        <FormField
          label={t('ruleIncludeUrls', 'Include URLs')}
          hint={t(
            'ruleUrlSyntaxHint',
            'One per line. Glob by default (* matches anything); the scheme may be omitted, e.g. github.com/*. Wrap in slashes for a regex, e.g. /github\\.com\\/\\w+/i',
          )}
          value={includeUrls}
          onChange={edit(setIncludeUrls)}
          placeholder={'github.com/*'}
          rows={3}
          required
        />
        <FormField
          label={t('ruleExcludeUrls', 'Exclude URLs')}
          value={excludeUrls}
          onChange={edit(setExcludeUrls)}
          placeholder={'github.com/settings/*'}
          rows={2}
        />
        <FormField
          label={t('ruleMatchSelectors', 'Only on pages matching')}
          hint={t(
            'ruleMatchSelectorsHint',
            'One CSS selector per line; the rule applies only when at least one matches. Point these at page-identity markers in the server-rendered shell — html/body classes, <meta> tags — not at content that JavaScript renders later. Leave empty to always apply.',
          )}
          value={matchSelectors}
          onChange={edit(setMatchSelectors)}
          placeholder={'meta[name="route-pattern"][content$="/issues(.:format)"]'}
          rows={2}
        />
        <FormField
          label={t('ruleIncludeSelectors', 'Translate only')}
          hint={t(
            'ruleIncludeSelectorsHint',
            'One CSS selector per line. Leave empty to translate the whole page. When set, nothing outside these areas is translated — point them at containers, not inline text.',
          )}
          value={includeSelectors}
          onChange={edit(setIncludeSelectors)}
          placeholder={'article'}
          rows={2}
        />
        <FormField
          label={t('ruleExcludeSelectors', 'Never translate')}
          hint={t('ruleExcludeSelectorsHint', 'One CSS selector per line.')}
          value={excludeSelectors}
          onChange={edit(setExcludeSelectors)}
          placeholder={'.sidebar, .comments'}
          rows={2}
        />
        <FormField
          label={t('ruleInjectCss', 'Inject CSS')}
          hint={t(
            'ruleInjectCssHint',
            'Applied only while the page is translated, and removed when you restore the original. Useful to lift line clamps that would cut the translation off.',
          )}
          value={injectCss}
          onChange={edit(setInjectCss)}
          placeholder={'.card-title { -webkit-line-clamp: unset !important; }'}
          rows={3}
        />
      </div>
    </Dialog>
  );
}
