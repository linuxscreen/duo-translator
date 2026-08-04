import { useEffect, useState } from 'react';
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
};

function FormField({ label, hint, value, onChange, placeholder, rows }: FormProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-ink">{label}</span>
      {hint && <span className="text-[11.5px] text-ink-soft">{hint}</span>}
      {rows ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}

/**
 * Create / edit one user rule.
 *
 * Validation runs on save and reports the offending entry rather than a generic
 * "invalid": URL patterns go through the same `compilePattern` the matcher
 * uses, and selectors through `document.querySelector` — the only honest test
 * of selector syntax, and available here because Options has a document (the
 * service worker does not, which is why normalizeBundle skips selectors).
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
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? '');
    setDescription(rule?.description ?? '');
    setIncludeUrls(toLines(rule?.includeUrls ?? []));
    setExcludeUrls(toLines(rule?.excludeUrls ?? []));
    setMatchSelectors(toLines(rule?.matchSelectors ?? []));
    setIncludeSelectors(toLines(rule?.includeSelectors ?? []));
    setExcludeSelectors(toLines(rule?.excludeSelectors ?? []));
    setInjectCss(rule?.injectCss.join('\n') ?? '');
    setError('');
  }, [open, rule]);

  const submit = () => {
    const include = fromLines(includeUrls);
    if (include.length === 0) {
      setError(t('ruleErrorNoIncludeUrl', 'Add at least one URL pattern — a rule with none never matches'));
      return;
    }
    const badUrl = [...include, ...fromLines(excludeUrls)].find((p) => !isValidPattern(p));
    if (badUrl) {
      setError(t('ruleErrorBadUrl', { pattern: badUrl, defaultValue: 'Invalid URL pattern: {{pattern}}' }));
      return;
    }
    const selectors = [
      ...fromLines(matchSelectors),
      ...fromLines(includeSelectors),
      ...fromLines(excludeSelectors),
    ];
    for (const selector of selectors) {
      try {
        document.querySelector(selector);
      } catch {
        setError(t('ruleErrorBadSelector', { selector, defaultValue: 'Invalid CSS selector: {{selector}}' }));
        return;
      }
    }

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
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={submit}>
            {t('save', 'Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <FormField label={t('ruleName', 'Rule')} value={name} onChange={setName} placeholder="GitHub" />
        <FormField
          label={t('ruleDescription', 'Description')}
          value={description}
          onChange={setDescription}
          placeholder={t('optional', 'Optional')}
        />
        <FormField
          label={t('ruleIncludeUrls', 'Include URLs')}
          hint={t(
            'ruleUrlSyntaxHint',
            'One per line. Glob by default (* matches anything); the scheme may be omitted, e.g. github.com/*. Wrap in slashes for a regex, e.g. /github\\.com\\/\\w+/i',
          )}
          value={includeUrls}
          onChange={setIncludeUrls}
          placeholder={'github.com/*'}
          rows={3}
        />
        <FormField
          label={t('ruleExcludeUrls', 'Exclude URLs')}
          value={excludeUrls}
          onChange={setExcludeUrls}
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
          onChange={setMatchSelectors}
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
          onChange={setIncludeSelectors}
          placeholder={'article'}
          rows={2}
        />
        <FormField
          label={t('ruleExcludeSelectors', 'Never translate')}
          hint={t('ruleExcludeSelectorsHint', 'One CSS selector per line.')}
          value={excludeSelectors}
          onChange={setExcludeSelectors}
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
          onChange={setInjectCss}
          placeholder={'.card-title { -webkit-line-clamp: unset !important; }'}
          rows={3}
        />
        {error && <div className="text-[12px] text-danger">{error}</div>}
      </div>
    </Dialog>
  );
}
