import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

type LabelProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Label>;
export const SelectLabel = forwardRef<ElementRef<typeof SelectPrimitive.Label>, LabelProps>(
  ({ className, ...props }, ref) => (
    <SelectPrimitive.Label
      ref={ref}
      className={cn('px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-soft', className)}
      {...props}
    />
  ),
);
SelectLabel.displayName = 'SelectLabel';

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
        // min-w-0 too: the value span is a flex item, and a flex item's
        // automatic minimum size is its content, so without this it refuses to
        // shrink and `truncate` never gets to draw its ellipsis.
        '[&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left',
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
  ({ className, children, position = 'popper', collisionPadding = 8, ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={4}
        // Keeps the dropdown off the window edge, and — because Radix feeds the
        // same padding into the `size` middleware — is also what the
        // available-width/height caps below are measured against.
        collisionPadding={collisionPadding}
        className={cn(
          // Sits above the Dialog overlay (z=2147483600) — Select renders
          // into its own portal at document.body, so a low z-index would
          // otherwise put the dropdown BEHIND the dialog's dim backdrop.
          'relative z-[2147483700] overflow-hidden rounded-lg border border-line bg-surface p-1 text-ink shadow-[0_12px_28px_-8px_rgba(0,0,0,.6),0_0_0_0.5px_rgba(255,255,255,.04)]',
          // Height capped by what the placement ACTUALLY has room for, not by a
          // fixed 15rem. In the toolbar popup the window is only as tall as its
          // content, so a dropdown that asks for more than fits is not scrolled
          // or flipped — it is painted outside the window and cut off. The
          // fallback covers the frame before Radix has positioned it once.
          'max-h-[min(15rem,var(--radix-select-content-available-height,15rem))]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          // The dropdown grows to fit its longest item rather than being
          // pinned to the trigger's width — a narrow trigger (the popup's
          // half-width pickers) must not force its options to be cut off.
          //
          // The cap is the space this placement really has, NOT the viewport:
          // Radix's popper runs `shift({ mainAxis: true, crossAxis: false })`,
          // so it never slides sideways to make room. With the default
          // `align="start"` the content's left edge is pinned to the trigger's
          // and it grows rightward; anything past the window edge is simply
          // clipped. A viewport-sized cap therefore made wide dropdowns worse
          // rather than better — it let them ask for width that does not exist.
          // `align="end"` at the call site is how a right-hand trigger gets room
          // (it then grows leftward); this var follows whichever was chosen.
          position === 'popper' &&
            'min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width,calc(100vw-16px))]',
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
      <span className="min-w-0 flex-1 truncate text-left">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      </span>
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3 w-3 stroke-[2.5]" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = 'SelectItem';
