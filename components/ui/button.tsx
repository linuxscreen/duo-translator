import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const variantCls: Record<Variant, string> = {
  default:
    'bg-gradient-to-br from-accent-strong to-accent text-[#04060a] hover:brightness-110 shadow-[0_0_14px_var(--color-accent-glow)]',
  outline:
    'border border-line-strong bg-surface text-ink hover:border-accent hover:text-accent',
  ghost: 'text-ink-soft hover:bg-hover hover:text-accent',
  destructive:
    'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
};

const sizeCls: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-9 px-3.5 text-[13px]',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = 'default', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
