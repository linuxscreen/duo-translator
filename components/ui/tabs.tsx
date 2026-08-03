import { type ReactNode, useRef } from 'react';
import { cn } from '@/lib/cn';

export type TabItem<T extends string> = {
  id: T;
  label: string;
  /** Optional count badge, e.g. how many rules the tier holds. */
  badge?: ReactNode;
};

type Props<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
};

/**
 * Controlled tab strip.
 *
 * Hand-rolled rather than @radix-ui/react-tabs: the repo pulls in exactly four
 * Radix packages, all for controls with real accessibility complexity
 * (select/switch/radio/tooltip). A tablist is a roving-tabindex button row, and
 * writing the 20 lines here beats adding a dependency and a bundle chunk.
 *
 * Roving tabindex + arrow keys per the ARIA tabs pattern: only the active tab
 * is in the tab order, Left/Right move between tabs and wrap, Home/End jump to
 * the ends.
 */
export function Tabs<T extends string>({ items, value, onChange, className }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = (index: number) => {
    const wrapped = (index + items.length) % items.length;
    onChange(items[wrapped].id);
    refs.current[wrapped]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(items.length - 1);
        break;
    }
  };

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-line bg-surface/60 p-1 backdrop-blur-sm',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium',
              'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-hover hover:text-ink',
            )}
          >
            {item.label}
            {item.badge !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 font-mono text-[10px]',
                  active ? 'bg-accent/20 text-accent' : 'bg-surface-hi text-ink-mute',
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
