import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('rounded-[10px] border border-line bg-surface p-1.5', className)} {...props} />
));
Card.displayName = 'Card';

export const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'px-1.5 pb-1 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mute',
      "before:mr-1 before:text-accent/70 before:content-['▸']",
      className,
    )}
    {...props}
  >
    {children}
  </div>
));
CardTitle.displayName = 'CardTitle';

export const CardDivider = ({ className }: { className?: string }) => (
  <div className={cn('-mx-1.5 my-1 h-px bg-line', className)} />
);
