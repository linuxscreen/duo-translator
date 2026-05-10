import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const RadioGroup = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('flex flex-col', className)} {...props} />
));
RadioGroup.displayName = 'RadioGroup';

export const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & { label: string }
>(({ className, label, ...props }, ref) => (
  <label
    className={cn(
      'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-[12.5px] text-ink',
      'transition-colors duration-100 hover:bg-hover',
      className,
    )}
  >
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line-strong',
        'data-[state=checked]:border-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="block h-1.5 w-1.5 rounded-full bg-accent" />
    </RadioGroupPrimitive.Item>
    <span className="flex-1">{label}</span>
  </label>
));
RadioGroupItem.displayName = 'RadioGroupItem';
