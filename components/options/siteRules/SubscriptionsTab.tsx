import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { browser } from 'wxt/browser';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { SiteRule, SiteRuleBundle, SiteRuleSubscription } from '@/main/siteRules/types';
import { refKey, subSource } from '@/main/siteRules/types';
import { RuleTable } from './RuleTable';
import { hostPermissionPattern } from '@/utils/url';

type Props = {
  subscriptions: SiteRuleSubscription[];
  packages: Record<string, SiteRuleBundle>;
  disabledIds: string[];
  busy: boolean;
  /** The built-in official package, which is NOT subscribable — see `add`. */
  officialUrl: string;
  /** Resolves once the list is persisted — `add` has to await it, see there. */
  onSave: (next: SiteRuleSubscription[]) => Promise<void>;
  onRefresh: (url?: string) => void;
  /**
   * Enable/disable rules by refKey. Takes a list so a batch is ONE write —
   * calling a single-key setter N times would have each call start from the
   * same stale `disabledIds` and keep only the last one.
   */
  onToggleRules: (keys: string[], enabled: boolean) => void;
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
  // Port-less pattern (see hostPermissionPattern): a self-hosted subscription
  // served on a non-default port would otherwise throw here on Safari and be
  // granted-but-inert on Firefox.
  const origin = hostPermissionPattern(url);
  if (!origin) return Promise.resolve(false);
  return browser.permissions.request({ origins: [origin] }).catch(() => false);
}

export function SubscriptionsTab({
  subscriptions,
  packages,
  disabledIds,
  busy,
  officialUrl,
  onSave,
  onRefresh,
  onToggleRules,
  onDetail,
}: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteRuleSubscription | null>(null);
  // Multi-select for the rules of the expanded package. Only one package is
  // ever open, and keys are refKeys (`sub:<url>#<id>`) so they can't collide
  // across packages — but reset on collapse anyway, so reopening starts clean.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const disabled = new Set(disabledIds);

  const expand = (next: string | null) => {
    setExpanded(next);
    setSelection(new Set());
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (value === '') return;
    if (!/^https?:\/\//i.test(value)) {
      setError(t('subscriptionErrorScheme', 'The subscription URL must start with http:// or https://'));
      return;
    }
    // The official package is not a subscription: it feeds the System tier and
    // is refreshed from the System tab. `getSubscriptions()` filters it out on
    // read, so without this the row would be accepted and then silently vanish.
    if (value === officialUrl) {
      setError(
        t(
          'subscriptionErrorOfficial',
          'This is the built-in official rule source. It already powers System rules and refreshes automatically — there is nothing to subscribe to.',
        ),
      );
      return;
    }
    if (subscriptions.some((s) => s.url === value)) {
      setError(t('subscriptionErrorDuplicate', 'That URL is already subscribed'));
      return;
    }
    setError('');
    // Fire the permission prompt synchronously, then persist regardless.
    void requestOriginPermission(value).then(async () => {
      // The save MUST land before the refresh is dispatched. Background decides
      // what to fetch by reading the stored subscription list, and the two are
      // separate messages handled concurrently — firing both at once means the
      // refresh routinely reads the list from before the add and fetches
      // nothing, leaving a subscription with no rules behind it.
      await onSave([...subscriptions, { url: value, enabled: true, addedAt: Date.now() }]);
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

        {/* nowrap + a shrinkable input: the buttons keep their intrinsic width
            and the URL field gives way, so the row never wraps. */}
        <form className="flex flex-nowrap items-center gap-2 border-b border-line px-4 py-3" onSubmit={add}>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/user/repo/main/rules.json"
            className="h-8 min-w-0 flex-1"
          />
          <Button className="shrink-0" size="sm" type="submit" disabled={busy}>
            {t('add', 'Add')}
          </Button>
          <Button
            className="shrink-0 whitespace-nowrap"
            variant="outline"
            size="sm"
            onClick={() => onRefresh()}
            disabled={busy}
          >
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
                  onClick={() => expand(open ? null : sub.url)}
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
                  onClick={() => setPendingDelete(sub)}
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
                    onToggle={(r, v) => onToggleRules([refKey(subSource(sub.url), r.id)], v)}
                    onDetail={onDetail}
                    selection={selection}
                    onSelectionChange={setSelection}
                    // No batch delete: these records belong to the package, not
                    // to us — disabling by refKey is the only thing we own.
                    onBatchToggle={(rules, enabled) =>
                      onToggleRules(rules.map((r) => refKey(subSource(sub.url), r.id)), enabled)
                    }
                    emptyText={t('subscriptionNotFetched', 'Nothing fetched yet — hit refresh')}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('deleteSubscriptionTitle', 'Remove subscription?')}
        description={t('deleteSubscriptionDesc', {
          defaultValue: 'Its rules stop applying immediately.',
        })}
        onConfirm={() => {
          void onSave(subscriptions.filter((s) => s.url !== pendingDelete?.url));
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
