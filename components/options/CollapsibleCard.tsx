import { ChevronDown, Info } from 'lucide-react';
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
  /**
   * `enabled` is not known yet — the switch is rendered hidden rather than in
   * whatever state the default happens to be.
   *
   * Config reads are async, so a switch bound to one paints OFF (the shipped
   * default for every card here) and then snaps ON for anyone who had turned it
   * on: on load the setting looks like it flips itself. Holding back the switch
   * alone, rather than the whole page, keeps the titles and hints painting
   * immediately and leaves the layout identical — the switch keeps its box.
   */
  pending?: boolean;
  /** Collapsed unless told otherwise — the Customization cards all start closed. */
  defaultOpen?: boolean;
  /**
   * Control shown in the header, left of the switch, ONLY while the card is
   * open. Meant for actions that operate on what the card contains (e.g.
   * "Restore defaults"): offering one next to a collapsed card would ask the
   * user to act on settings they cannot see.
   */
  action?: ReactNode;
  /**
   * Rendered below the body and OUTSIDE its deactivated group, so the switch
   * does not reach it. For the live previews: a preview shows what the surface
   * looks like right now, and this switch does not change that — dimming it
   * would say the previewed thing is off, which it is not.
   */
  footer?: ReactNode;
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
 * The switch gates the body: while it is off the settings are shown, greyed
 * out and inert, under a line saying which switch turns them on. Shown rather
 * than hidden because switching off must never look like it erased anything —
 * and inert rather than editable because every one of these settings does
 * nothing until the switch is on, so a control that accepts an edit and changes
 * nothing is the worse half of both options.
 */
/**
 * How a deactivated group looks: dimmed as ONE surface, so labels and controls
 * fade together.
 *
 * The `!opacity-100` is what makes that true. Every control here carries its
 * own `disabled:opacity-50`, which multiplies with the container's — a button
 * would land at 25% and all but disappear against the dark theme, while the
 * label beside it stayed at 50%. Overriding it needs `!important` rather than
 * ordering: the two selectors have equal specificity, so which one wins would
 * otherwise depend on the order Tailwind happens to emit them in.
 */
const DEACTIVATED = 'pointer-events-none select-none opacity-50 [&_:disabled]:!opacity-100';

export function CollapsibleCard({
  title,
  hint,
  icon,
  enabled,
  onEnabledChange,
  pending = false,
  defaultOpen = false,
  action,
  footer,
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
            card as well. Deactivated along with the body: it acts on the body's
            settings, and "Restore defaults" for a feature that is off would
            rewrite storage with nothing to show for it. */}
        {open && action && (
          <fieldset disabled={!enabled} className={cn(!enabled && DEACTIVATED)}>
            {action}
          </fieldset>
        )}
        <Switch
          // Remounted when `pending` clears, so the switch is CREATED in its
          // stored state. Without that it would be a live element changing from
          // off to on, and the thumb's transition would play the flip in front
          // of the user — the same wrong story, just animated.
          key={pending ? 'pending' : 'ready'}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          // Hidden rather than unmounted: the header must not reflow when the
          // switch arrives.
          className={cn(pending && 'invisible')}
        />
      </div>

      {open && (
        <div id={bodyId} className="border-t border-line px-4 py-3.5">
          {!enabled && (
            <div className="mb-3.5 flex items-start gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-ink-soft">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
              <span>{t('cardDisabledHint', 'Turn on the switch above to change these settings')}</span>
            </div>
          )}
          {/* <fieldset disabled> rather than a prop threaded through every
              control: it disables descendant form controls natively, so nothing
              can be missed and nothing new has to be wired. `pointer-events`
              covers what it cannot reach — click handlers on plain elements —
              and `min-w-0` undoes the UA's `min-width: min-content`, which
              would otherwise stop flex children shrinking (an ordinary <div>
              here does not do that). */}
          <fieldset disabled={!enabled} className={cn('min-w-0', !enabled && DEACTIVATED)}>
            {children}
          </fieldset>
          {footer}
        </div>
      )}
    </section>
  );
}
