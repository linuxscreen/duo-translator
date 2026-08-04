import { type InputHTMLAttributes, forwardRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    value: string;
    onValueChange: (value: string) => void;
    /** Layout classes for the wrapper (width, flex). The input itself fills it. */
    className?: string;
};

/**
 * Search box with a clear button.
 *
 * Every filter input in the app goes through this — a filter that can only be
 * undone by selecting the text and deleting it is a small trap, and doing it
 * per call site guarantees one of them will be forgotten. The button only
 * appears once there is something to clear, so an empty box looks exactly like
 * a plain input.
 *
 * `type="search"` is deliberately NOT used: Chrome's built-in clear affordance
 * is inconsistent across platforms and cannot be styled to match the theme.
 */
export const SearchInput = forwardRef<HTMLInputElement, Props>(
    ({ className, value, onValueChange, ...props }, ref) => {
        const { t } = useTranslation();
        return (
            <div className={cn('relative', className)}>
                <Input
                    ref={ref}
                    value={value}
                    onChange={(e) => onValueChange(e.target.value)}
                    // Room for the button so long queries never run underneath it.
                    className="h-8 w-full pr-7"
                    {...props}
                />
                {value !== '' && (
                    <button
                        type="button"
                        onClick={() => onValueChange('')}
                        aria-label={t('clear', 'Clear')}
                        title={t('clear', 'Clear')}
                        className={cn(
                            'absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center',
                            'cursor-pointer rounded text-ink-mute transition-colors hover:bg-hover hover:text-ink',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        )}
                    >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                )}
            </div>
        );
    },
);
SearchInput.displayName = 'SearchInput';
