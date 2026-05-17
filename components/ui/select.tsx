import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

type TriggerProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>;

export const SelectTrigger = forwardRef<ElementRef<typeof SelectPrimitive.Trigger>, TriggerProps>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink',
        'transition-colors duration-150 ease-out',
        'data-[state=open]:border-accent',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&>span]:flex-1 [&>span]:truncate [&>span]:text-left',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-3 w-3 shrink-0 text-ink-soft transition-transform duration-150 data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
);
SelectTrigger.displayName = 'SelectTrigger';

type ContentProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Content>;

export const SelectContent = forwardRef<ElementRef<typeof SelectPrimitive.Content>, ContentProps>(
  ({ className, children, position = 'popper', ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={4}
        className={cn(
          // Sits above the Dialog overlay (z=2147483600) — Select renders
          // into its own portal at document.body, so a low z-index would
          // otherwise put the dropdown BEHIND the dialog's dim backdrop.
          'relative z-[2147483700] max-h-60 overflow-hidden rounded-lg border border-line bg-surface p-1 text-ink shadow-[0_12px_28px_-8px_rgba(0,0,0,.6),0_0_0_0.5px_rgba(255,255,255,.04)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);
SelectContent.displayName = 'SelectContent';

type ItemProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Item>;

export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, ItemProps>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none',
        'data-[highlighted]:bg-hover',
        'data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="flex-1 truncate text-left">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      </span>
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3 w-3 stroke-[2.5]" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = 'SelectItem';
