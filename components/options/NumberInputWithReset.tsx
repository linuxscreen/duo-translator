import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

type Props = {
  value: string;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (raw: string) => void;
  onCommit: () => void;
  onReset: () => void;
  inputClassName?: string;
};

/** Numeric input with a trailing reset-to-default icon button. */
export function NumberInputWithReset({
  value,
  min,
  max,
  defaultValue,
  onChange,
  onCommit,
  onReset,
  inputClassName,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          'w-24 pr-2 text-right tabular-nums [&::-webkit-inner-spin-button]:ml-2 [&::-webkit-outer-spin-button]:ml-2',
          inputClassName,
        )}
      />
      <button
        type="button"
        onClick={onReset}
        title={`${t('reset', 'Reset')} (${defaultValue})`}
        className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:bg-hover hover:text-ink"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
