import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  className?: string;
};

/** Label on the left, hint underneath, control on the right. */
export function SettingRow({ label, hint, control, className }: Props) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-6 border-b border-line last:border-b-0',
        'px-4 py-3.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-ink-soft">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center justify-end">{control}</div>
    </div>
  );
}
