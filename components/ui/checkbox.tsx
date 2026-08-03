import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Themed checkbox.
 *
 * A native `<input type="checkbox">` with `accent-color` rather than a Radix
 * primitive: it is the one control where the platform widget already gives us
 * keyboard behaviour, the indeterminate state and the focus ring for free, and
 * `accent-color` is enough to make it follow the theme. Adding
 * @radix-ui/react-checkbox for this would be a dependency for nothing.
 */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm border-line-strong bg-surface',
        'accent-[var(--color-accent)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
