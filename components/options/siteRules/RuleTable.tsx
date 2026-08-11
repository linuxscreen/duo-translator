import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/ui/search-input';
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
  /** Opting in to multi-select also renders the batch bar above the list. */
  selection?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  /** Batch enable/disable of the selected rows. */
  onBatchToggle?: (rules: SiteRule[], enabled: boolean) => void;
  /** Batch delete. Only tiers we own the records of (user rules) pass this. */
  onBatchDelete?: (rules: SiteRule[]) => void;
  emptyText: string;
};

/**
 * How many rows to render before the "load more" button.
 *
 * A rendering budget, NOT a filter: the official package alone is ~440 rules,
 * and rendering them all makes the page scroll for screens on end. Search still
 * runs over every rule, and select-all/batch still act on every search match —
 * only the DOM is capped.
 */
const PAGE_SIZE = 50;

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
  onBatchToggle,
  onBatchDelete,
  emptyText,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) =>
      [r.name, r.id, r.description, ...r.includeUrls].some((s) => s.toLowerCase().includes(q)),
    );
  }, [rules, query]);

  // A new search or a different package starts over — otherwise a slice grown
  // to 400 rows would carry into the next result set.
  useEffect(() => setLimit(PAGE_SIZE), [query, rules]);

  const visible = filtered.slice(0, limit);
  const remaining = filtered.length - visible.length;

  const selectable = !!selection && !!onSelectionChange;
  const allSelected = selectable && filtered.length > 0 && filtered.every((r) => selection!.has(keyOf(r)));
  // Batch actions act on what is selected AND matches the current search —
  // acting on rows the search filtered out would be a nasty surprise. Rows
  // merely beyond the render limit DO count: the counter says "438 selected",
  // so quietly disabling only the first 50 would be the bigger surprise.
  const selected = selectable ? filtered.filter((r) => selection!.has(keyOf(r))) : [];

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
      <div className="flex flex-nowrap items-center gap-2 border-b border-line px-4 py-2.5">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('typeToSearch', 'Type to search')}
          className="min-w-0 flex-1"
        />
        {/* Batch actions live here rather than in each tab's header, so every
            tier that opts into multi-select gets the same bar. */}
        {selectable && selected.length > 0 && (
          <>
            <span className="shrink-0 whitespace-nowrap text-[12px] text-ink-soft">
              {t('selectedCount', { count: selected.length, defaultValue: '{{count}} selected' })}
            </span>
            {onBatchToggle && (
              <>
                <Button
                  className="shrink-0"
                  variant="outline"
                  size="sm"
                  onClick={() => onBatchToggle(selected, true)}
                >
                  {t('enable', 'Enable')}
                </Button>
                <Button
                  className="shrink-0"
                  variant="outline"
                  size="sm"
                  onClick={() => onBatchToggle(selected, false)}
                >
                  {t('disable', 'Disable')}
                </Button>
              </>
            )}
            {onBatchDelete && (
              <Button
                className="shrink-0"
                variant="destructive"
                size="sm"
                onClick={() => onBatchDelete(selected)}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('delete', 'Delete')}
              </Button>
            )}
          </>
        )}
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
        <span>{t('name', 'Name')}</span>
        <span>{t('ruleMatchUrls', 'Matches')}</span>
        <span className="justify-self-end">{t('status', 'Status')}</span>
      </div>

      {filtered.length === 0 && (
        <div className="px-4 py-8 text-center text-[12.5px] text-ink-mute">
          {t('noMatchingRules', 'No rules match your search')}
        </div>
      )}

      {visible.map((rule) => {
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

      {remaining > 0 && (
        <div className="flex items-center justify-center gap-3 border-t border-line px-4 py-3">
          <span className="text-[12px] text-ink-soft">
            {t('showingOfTotal', {
              shown: visible.length,
              total: filtered.length,
              defaultValue: 'Showing {{shown}} of {{total}}',
            })}
          </span>
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {t('loadMore', 'Load more')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLimit(filtered.length)}>
            {t('showAll', 'Show all')}
          </Button>
        </div>
      )}
    </div>
  );
}
