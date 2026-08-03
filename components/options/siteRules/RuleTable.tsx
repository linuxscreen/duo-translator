import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { SiteRule } from '@/main/siteRules/types';

type Props = {
  rules: SiteRule[];
  /** refKey of each row, parallel to `rules`. */
  keyOf: (rule: SiteRule) => string;
  /** Effective on/off state of a row (author default AND not user-disabled). */
  isEnabled: (rule: SiteRule) => boolean;
  onToggle: (rule: SiteRule, enabled: boolean) => void;
  onDetail: (rule: SiteRule) => void;
  /** Editable tiers (user rules) pass these; read-only tiers omit them. */
  onEdit?: (rule: SiteRule) => void;
  onDelete?: (rule: SiteRule) => void;
  /** Multi-select, user rules only. */
  selection?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  emptyText: string;
};

/**
 * The rule list shared by all three tiers.
 *
 * One component rather than three: the tiers differ only in which affordances
 * they pass (edit/delete/multi-select), and the search box, empty/no-match
 * states and row layout are identical. Follows the list shape already
 * established by AiProvidersCard.
 */
export function RuleTable({
  rules,
  keyOf,
  isEnabled,
  onToggle,
  onDetail,
  onEdit,
  onDelete,
  selection,
  onSelectionChange,
  emptyText,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) =>
      [r.name, r.id, r.description, ...r.includeUrls].some((s) => s.toLowerCase().includes(q)),
    );
  }, [rules, query]);

  const selectable = !!selection && !!onSelectionChange;
  const allSelected = selectable && filtered.length > 0 && filtered.every((r) => selection!.has(keyOf(r)));

  const toggleAll = () => {
    const next = new Set(selection);
    for (const r of filtered) {
      if (allSelected) next.delete(keyOf(r));
      else next.add(keyOf(r));
    }
    onSelectionChange!(next);
  };

  const toggleOne = (key: string) => {
    const next = new Set(selection);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange!(next);
  };

  if (rules.length === 0) {
    return <div className="px-4 py-8 text-center text-[12.5px] text-ink-mute">{emptyText}</div>;
  }

  return (
    <div>
      <div className="border-b border-line px-4 py-2.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('typeToSearch', 'Type to search')}
          className="h-8"
        />
      </div>

      <div
        className={cn(
          'grid items-center gap-3 border-b border-line px-4 py-2.5',
          'font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute',
          selectable ? 'grid-cols-[auto_1.4fr_1.2fr_auto]' : 'grid-cols-[1.4fr_1.2fr_auto]',
        )}
      >
        {selectable && (
          <Checkbox checked={allSelected} onChange={toggleAll} aria-label={t('selectAll', 'Select all')} />
        )}
        <span>{t('ruleName', 'Rule')}</span>
        <span>{t('ruleMatchUrls', 'Matches')}</span>
        <span className="justify-self-end">{t('status', 'Status')}</span>
      </div>

      {filtered.length === 0 && (
        <div className="px-4 py-8 text-center text-[12.5px] text-ink-mute">
          {t('noMatchingRules', 'No rules match your search')}
        </div>
      )}

      {filtered.map((rule) => {
        const key = keyOf(rule);
        const enabled = isEnabled(rule);
        return (
          <div
            key={key}
            className={cn(
              'grid items-center gap-3 border-b border-line px-4 py-3 last:border-b-0',
              selectable ? 'grid-cols-[auto_1.4fr_1.2fr_auto]' : 'grid-cols-[1.4fr_1.2fr_auto]',
            )}
          >
            {selectable && (
              <Checkbox checked={selection!.has(key)} onChange={() => toggleOne(key)} aria-label={rule.name} />
            )}
            <div className="min-w-0">
              <div className={cn('truncate text-[13px] font-medium', enabled ? 'text-ink' : 'text-ink-mute')}>
                {rule.name}
              </div>
              {rule.description && (
                <div className="mt-0.5 truncate text-[11.5px] text-ink-soft">{rule.description}</div>
              )}
            </div>
            <div className="min-w-0 truncate font-mono text-[11px] text-ink-soft" title={rule.includeUrls.join('\n')}>
              {rule.includeUrls.join(', ') || '—'}
            </div>
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDetail(rule)}
                aria-label={t('details', 'Details')}
                title={t('details', 'Details')}
              >
                <Info className="h-3.5 w-3.5" strokeWidth={1.8} />
              </Button>
              {onEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(rule)}
                  aria-label={t('edit', 'Edit')}
                  title={t('edit', 'Edit')}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => onDelete(rule)}
                  aria-label={t('delete', 'Delete')}
                  title={t('delete', 'Delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
              )}
              <Switch checked={enabled} onCheckedChange={(v) => onToggle(rule, v)} size="sm" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
