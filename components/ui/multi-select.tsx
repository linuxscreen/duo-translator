import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Checkbox } from '@/components/ui/checkbox';

export type MultiSelectOption = {
  value: string;
  /** What the trigger joins into its summary — plain text, not a node. */
  label: string;
  /** Optional leading mark for the list row (the trigger stays text-only). */
  icon?: ReactNode;
};

type Props = {
  options: MultiSelectOption[];
  value: string[];
  /** Called with the clicked key; the caller owns the add/remove. */
  onToggle: (value: string) => void;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /**
   * Give this a DEFINITE width (`w-[200px]`), not a `min-w-`. The trigger's
   * summary grows with the selection, so a content-sized box widens its row on
   * every tick and the label never overflows — meaning it never truncates.
   */
  className?: string;
  /**
   * Refuse to untick the last remaining option. A set that can go empty means
   * a caller has to invent a meaning for "none", and every current caller
   * would just put a default back — so the checkbox would appear to do nothing.
   */
  minSelected?: number;
};

/**
 * A dropdown that takes several values, shaped like the single-value `Select`
 * so the two can sit in the same row without the layout moving.
 *
 * Deliberately NOT Radix: `@radix-ui/react-select` is single-value by
 * construction (it closes on pick and owns one `value`), and the alternative —
 * a Popover holding checkboxes — would pull in another primitive for what is a
 * button and an absolutely-positioned list. The panel is positioned inside a
 * `relative` wrapper rather than a portal, which is fine here because the
 * Options cards set no `overflow` clip; a caller inside a scroll container
 * would need the portal.
 *
 * The trigger summarises the selection as comma-separated NAMES rather than a
 * count: which ones are on is the entire question this control answers, and a
 * number makes the user open it to find out. Overflow truncates to an ellipsis
 * and the full list is on the tooltip.
 */
export function MultiSelect({
  options,
  value,
  onToggle,
  placeholder,
  minSelected = 0,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside press or Escape. `mousedown` rather than `click` so a
  // press that starts outside cannot also activate whatever is under it after
  // the panel has moved out from beneath the cursor.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Names in the order the OPTIONS are listed, not the order they were ticked:
  // the summary has to stay still while the set is edited, or every tick
  // reshuffles the label under the cursor. A stored key the list no longer
  // offers is kept, and shown raw, so a stale entry stays visible.
  const known = new Set(options.map((o) => o.value));
  const summary = [
    ...options.filter((o) => value.includes(o.value)).map((o) => o.label),
    ...value.filter((v) => !known.has(v)),
  ].join(', ');

  const atMinimum = value.length <= minSelected;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={summary || placeholder}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink',
          'cursor-pointer transition-colors duration-150 ease-out',
          open && 'border-accent',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate text-left', !summary && 'text-ink-mute')}>
          {summary || placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-ink-soft transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-[15rem] w-max min-w-full max-w-[320px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-[0_12px_28px_-8px_rgba(0,0,0,.6),0_0_0_0.5px_rgba(255,255,255,.04)]">
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink',
                  // The last remaining pick is not a disabled ROW — it is still
                  // readable and still the thing you would click to keep. Only
                  // its untick is refused, and the cursor says so.
                  on && atMinimum ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover',
                )}
              >
                <Checkbox
                  checked={on}
                  disabled={on && atMinimum}
                  onChange={() => onToggle(o.value)}
                />
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
