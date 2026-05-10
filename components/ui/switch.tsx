import * as SwitchPrimitive from '@radix-ui/react-switch';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md';

type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  size?: Size;
};

const sizeRoot: Record<Size, string> = {
  sm: 'h-4 w-7',
  md: 'h-5 w-[34px]',
};

const sizeThumb: Record<Size, string> = {
  sm: 'h-3 w-3 data-[state=checked]:translate-x-3',
  md: 'h-4 w-4 data-[state=checked]:translate-x-[14px]',
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(({ className, size = 'md', ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-[background-color,box-shadow] duration-200',
      'data-[state=unchecked]:bg-toggle-off',
      'data-[state=checked]:bg-accent data-[state=checked]:shadow-[0_0_12px_var(--color-accent-glow)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      'disabled:cursor-not-allowed disabled:opacity-50',
      sizeRoot[size],
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,.18)]',
        'translate-x-0 transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
        sizeThumb[size],
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
