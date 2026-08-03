import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { browser } from 'wxt/browser';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { SiteRule, SiteRuleBundle, SiteRuleSubscription } from '@/main/siteRules/types';
import { refKey, subSource } from '@/main/siteRules/types';
import { RuleTable } from './RuleTable';

type Props = {
  subscriptions: SiteRuleSubscription[];
  packages: Record<string, SiteRuleBundle>;
  disabledIds: string[];
  busy: boolean;
  onSave: (next: SiteRuleSubscription[]) => void;
  onRefresh: (url?: string) => void;
  onToggleRule: (key: string, enabled: boolean) => void;
  onDetail: (rule: SiteRule) => void;
};

/**
 * Ask for host permission for the subscription's origin before adding it.
 *
 * A background `fetch` is still subject to CORS for origins we hold no
 * permission for; with the permission it bypasses CORS entirely. This must run
 * inside the click handler and before any `await` — `permissions.request`
 * requires a live user gesture (and, on Firefox, an options page in its own
 * tab, which `open_in_tab: true` gives us). A denial is not fatal: the fetch is
 * attempted anyway and works for CORS-enabled hosts such as
 * raw.githubusercontent.com.
 */
function requestOriginPermission(url: string): Promise<boolean> {
  try {
    const origin = `${new URL(url).origin}/*`;
    return browser.permissions.request({ origins: [origin] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function SubscriptionsTab({
  subscriptions,
  packages,
  disabledIds,
  busy,
  onSave,
  onRefresh,
  onToggleRule,
  onDetail,
}: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const disabled = new Set(disabledIds);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (value === '') return;
    if (!/^https?:\/\//i.test(value)) {
      setError(t('subscriptionErrorScheme', 'The subscription URL must start with http:// or https://'));
      return;
    }
    if (subscriptions.some((s) => s.url === value)) {
      setError(t('subscriptionErrorDuplicate', 'That URL is already subscribed'));
      return;
    }
    setError('');
    // Fire the permission prompt synchronously, then persist regardless.
    void requestOriginPermission(value).then(() => {
      onSave([...subscriptions, { url: value, enabled: true, addedAt: Date.now() }]);
      onRefresh(value);
    });
    setUrl('');
  };

  const patch = (target: string, change: Partial<SiteRuleSubscription>) =>
    onSave(subscriptions.map((s) => (s.url === target ? { ...s, ...change } : s)));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <div className="border-b border-line px-4 py-3">
          <div className="text-[13.5px] font-semibold text-ink">
            {t('ruleSubscriptions', 'Rule subscriptions')}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-soft">
            {t(
              'ruleSubscriptionsHint',
              'Rule packages fetched from a URL and refreshed daily. The URL must be reachable from the browser — a raw.githubusercontent.com link works.',
            )}
          </div>
        </div>

        <form className="flex items-center gap-2 border-b border-line px-4 py-3" onSubmit={add}>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/user/repo/main/rules.json"
            className="h-8"
          />
          <Button size="sm" type="submit" disabled={busy}>
            {t('add', 'Add')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onRefresh()} disabled={busy}>
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} strokeWidth={1.8} />
            {t('refreshAll', 'Refresh all')}
          </Button>
        </form>
        {error && <div className="px-4 py-2 text-[12px] text-danger">{error}</div>}

        {subscriptions.length === 0 && (
          <div className="px-4 py-8 text-center text-[12.5px] text-ink-mute">
            {t('noSubscriptions', 'No subscriptions yet')}
          </div>
        )}

        {subscriptions.map((sub) => {
          const bundle = packages[sub.url];
          const open = expanded === sub.url;
          return (
            <div key={sub.url} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : sub.url)}
                  className="text-ink-mute hover:text-ink"
                  aria-label={open ? t('collapse', 'Collapse') : t('browse', 'Browse')}
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{sub.name || sub.url}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-ink-soft">{sub.url}</div>
                  {sub.lastError ? (
                    <div className="mt-0.5 text-[11.5px] text-danger">{sub.lastError}</div>
                  ) : (
                    <div className="mt-0.5 text-[11.5px] text-ink-mute">
                      {t('subscriptionMeta', {
                        count: bundle?.rules.length ?? 0,
                        when: sub.lastFetchAt ? new Date(sub.lastFetchAt).toLocaleString() : '—',
                        defaultValue: '{{count}} rules · updated {{when}}',
                      })}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRefresh(sub.url)}
                  disabled={busy}
                  title={t('refresh', 'Refresh')}
                  aria-label={t('refresh', 'Refresh')}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => onSave(subscriptions.filter((s) => s.url !== sub.url))}
                  title={t('delete', 'Delete')}
                  aria-label={t('delete', 'Delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
                <Switch
                  checked={sub.enabled}
                  onCheckedChange={(v) => patch(sub.url, { enabled: v })}
                  size="sm"
                />
              </div>

              {open && (
                <div className="border-t border-line bg-surface-2/40">
                  <RuleTable
                    rules={bundle?.rules ?? []}
                    keyOf={(r) => refKey(subSource(sub.url), r.id)}
                    isEnabled={(r) => r.enabled && !disabled.has(refKey(subSource(sub.url), r.id))}
                    onToggle={(r, v) => onToggleRule(refKey(subSource(sub.url), r.id), v)}
                    onDetail={onDetail}
                    emptyText={t('subscriptionNotFetched', 'Nothing fetched yet — hit refresh')}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
