import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DB_ACTION, DOMAIN_STRATEGY } from '@/main/constants';
import { sendMessageToBackground } from '@/utils/message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export type DomainItem = {
  domain: string;
  strategy?: DOMAIN_STRATEGY;
  aiWritingDisabled?: boolean;
  aiWritingEnabled?: boolean;
};

/**
 * Discriminator for which field on a Domain doc this list manages.
 *  - `strategy`: page-translation Always/Never list (one of NEVER/ALWAYS).
 *  - `aiWritingDisabled`: AI Writing floating dot blacklist (boolean true).
 *  - `aiWritingEnabled`: AI Writing floating dot whitelist (boolean true).
 */
export type DomainListKind =
  | { field: 'strategy'; strategy: DOMAIN_STRATEGY }
  | { field: 'aiWritingDisabled' }
  | { field: 'aiWritingEnabled' };

export function normalizeDomain(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (s.includes('://')) return new URL(s).hostname;
  } catch { /* fall through to manual cleanup */ }
  return s.replace(/^\/+|\/+$/g, '').split('/')[0];
}

type Props = {
  title: string;
  emptyHint: string;
  open: boolean;
  onToggle: () => void;
  items: DomainItem[];
  /** Items in a mutually exclusive list — adding/editing here will refuse if the domain already exists in `otherItems`. */
  otherItems?: DomainItem[];
  kind: DomainListKind;
  onChanged: () => Promise<void> | void;
};

export function DomainListSection({
  title,
  emptyHint,
  open,
  onToggle,
  items,
  otherItems = [],
  kind,
  onChanged,
}: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [query, setQuery] = useState('');

  const otherDomains = useMemo(() => new Set(otherItems.map((d) => d.domain)), [otherItems]);
  const ownDomains = useMemo(() => new Set(items.map((d) => d.domain)), [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.domain.toLowerCase().includes(q));
  }, [items, query]);

  const conflictMsg = t(
    'domainAlreadyInOtherList',
    'This website is already in the other list.',
  );
  const duplicateMsg = t('domainAlreadyExists', 'This website is already in the list.');
  const invalidMsg = t('invalidDomain', 'Invalid website.');

  const buildUpdatePayload = (domain: string): Record<string, unknown> => {
    if (kind.field === 'strategy') return { domain, strategy: kind.strategy };
    if (kind.field === 'aiWritingEnabled') return { domain, aiWritingEnabled: true };
    return { domain, aiWritingDisabled: true };
  };

  const handleAdd = async () => {
    setError(null);
    const d = normalizeDomain(input);
    if (!d) {
      setError(invalidMsg);
      return;
    }
    if (ownDomains.has(d)) {
      setError(duplicateMsg);
      return;
    }
    if (otherDomains.has(d)) {
      setError(conflictMsg);
      return;
    }
    await sendMessageToBackground({
      action: DB_ACTION.DOMAIN_UPDATE,
      data: buildUpdatePayload(d),
    });
    setInput('');
    await onChanged();
  };

  const handleDelete = async (domain: string) => {
    // Field-aware delete: clears only this list's field; doc is removed only
    // when no other fields remain. This keeps the AI-disabled flag intact
    // when removing from Always/Never (and vice versa).
    await sendMessageToBackground({
      action: DB_ACTION.DOMAIN_DELETE,
      data: { domain, field: kind.field },
    });
    await onChanged();
  };

  const beginEdit = (domain: string) => {
    setEditingDomain(domain);
    setEditingValue(domain);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingDomain(null);
    setEditingValue('');
    setError(null);
  };

  const commitEdit = async (oldDomain: string) => {
    const next = normalizeDomain(editingValue);
    if (!next) {
      setError(invalidMsg);
      return;
    }
    if (next === oldDomain) {
      cancelEdit();
      return;
    }
    if (ownDomains.has(next)) {
      setError(duplicateMsg);
      return;
    }
    if (otherDomains.has(next)) {
      setError(conflictMsg);
      return;
    }
    await sendMessageToBackground({
      action: DB_ACTION.DOMAIN_DELETE,
      data: { domain: oldDomain, field: kind.field },
    });
    await sendMessageToBackground({
      action: DB_ACTION.DOMAIN_UPDATE,
      data: buildUpdatePayload(next),
    });
    cancelEdit();
    await onChanged();
  };

  return (
    <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
      <div className="flex w-full items-center gap-3 px-4 py-3.5">
        <div className="flex flex-1 items-center gap-3 text-left">
          <div className="text-[13.5px] font-medium text-ink">
            {title}
            <span className="ml-2 text-[12px] text-ink-soft">({items.length})</span>
          </div>
        </div>
        {open && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('typeToSearch', 'Type to search')}
            className="h-8 w-56"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          title={t(open ? 'collapse' : 'expand', open ? 'Collapse' : 'Expand')}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-ink"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-150',
              open && 'rotate-180',
            )}
            strokeWidth={1.6}
          />
        </button>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
              placeholder={t('websiteDomainPlaceholder', 'e.g. example.com')}
              className="flex-1"
            />
            <Button onClick={() => void handleAdd()} size="md">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('add', 'Add')}
            </Button>
          </div>
          {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}

          <div className="mt-3 flex flex-col gap-1.5">
            {items.length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-soft">
                {emptyHint}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-soft">
                {t('noMatchingDomains', 'No matching websites.')}
              </div>
            ) : (
              filteredItems.map((it) => {
                const isEditing = editingDomain === it.domain;
                return (
                  <div
                    key={it.domain}
                    className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5"
                  >
                    {isEditing ? (
                      <>
                        <Input
                          value={editingValue}
                          autoFocus
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitEdit(it.domain);
                            } else if (e.key === 'Escape') {
                              cancelEdit();
                            }
                          }}
                          className="h-8 flex-1"
                        />
                        <Button size="sm" onClick={() => void commitEdit(it.domain)}>
                          {t('save', 'Save')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-[13px] text-ink">{it.domain}</span>
                        <button
                          type="button"
                          onClick={() => beginEdit(it.domain)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-accent"
                          title={t('edit', 'Edit')}
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(it.domain)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-danger"
                          title={t('delete', 'Delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
