import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastKind = 'success' | 'error';

type ToastItem = { id: number; text: string; kind: ToastKind };

const DURATION_MS = 3200;

/**
 * Minimal self-contained toast: a hook that owns the toast list and renders its
 * own portal viewport (bottom-right, auto-dismiss). Use the returned `viewport`
 * somewhere in your JSX and call `show(text, kind)` to push a toast.
 */
export function useToast() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const show = useCallback((text: string, kind: ToastKind = 'success') => {
        const id = Date.now() + Math.random();
        setToasts((cur) => [...cur, { id, text, kind }]);
        setTimeout(() => {
            setToasts((cur) => cur.filter((it) => it.id !== id));
        }, DURATION_MS);
    }, []);

    const viewport = createPortal(
        // Top-center, slightly down from the top. z-index above the Dialog
        // (which uses 2147483600) so toasts are never covered by a modal overlay.
        <div className="pointer-events-none fixed top-16 left-1/2 z-[2147483647] flex -translate-x-1/2 flex-col items-center gap-2">
            {toasts.map((it) => (
                <div
                    key={it.id}
                    role="status"
                    className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-lg',
                        it.kind === 'error'
                            ? 'border-danger/40 bg-danger/10 text-danger'
                            : 'border-line bg-surface text-ink',
                    )}
                >
                    {it.kind === 'error' ? (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                    ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                    )}
                    <span>{it.text}</span>
                </div>
            ))}
        </div>,
        document.body,
    );

    return { show, viewport };
}
