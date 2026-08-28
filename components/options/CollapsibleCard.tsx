import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Switch } from '@/components/ui/switch';

type Props = {
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  /** The card's own feature switch. */
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** Collapsed unless told otherwise — the Customization cards all start closed. */
  defaultOpen?: boolean;
  /**
   * Control shown in the header, left of the switch, ONLY while the card is
   * open. Meant for actions that operate on what the card contains (e.g.
   * "Restore defaults"): offering one next to a collapsed card would ask the
   * user to act on settings they cannot see.
   */
  action?: ReactNode;
  children: ReactNode;
};

/**
 * A settings card that collapses, with its own feature switch in the header.
 *
 * The open/closed state is component state, not config: "collapsed by default"
 * is meant to keep a long page scannable on arrival, and persisting it would
 * make the page look different for every visit without the user ever having
 * asked for that.
 *
 * The switch and the body are independent: turning the feature off leaves its
 * settings editable, so a user can set a gesture up first and arm it after —
 * and, more importantly, so switching off never looks like it erased anything.
 */
export function CollapsibleCard({
  title,
  hint,
  icon,
  enabled,
  onEnabledChange,
  defaultOpen = false,
  action,
  children,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          title={t(open ? 'collapse' : 'expand', open ? 'Collapse' : 'Expand')}
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-ink-mute transition-transform duration-150 group-hover:text-ink',
              open && 'rotate-180',
            )}
            strokeWidth={1.8}
          />
          {icon && <span className="shrink-0 text-ink-soft">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-ink">{title}</span>
            {hint && <span className="mt-0.5 block text-[12px] text-ink-soft">{hint}</span>}
          </span>
        </button>
        {/* A sibling of the toggle button, not inside it — nesting an action in
            the header's own <button> would make every click on it collapse the
            card as well. */}
        {open && action}
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {open && (
        <div id={bodyId} className="border-t border-line px-4 py-3.5">
          {children}
        </div>
      )}
    </section>
  );
}
