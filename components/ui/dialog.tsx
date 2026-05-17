import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    children: React.ReactNode;
    /** Optional footer (action buttons). */
    footer?: React.ReactNode;
    /** Tailwind width class — defaults to a comfortable form width. */
    widthClass?: string;
}

/**
 * Minimal modal: portal-rendered overlay + centered panel. ESC to close,
 * backdrop click to close. Body scroll is locked while open.
 */
export function Dialog({ open, onClose, title, children, footer, widthClass = 'w-[480px]' }: DialogProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, onClose]);

    if (!open) return null;
    return createPortal(
        <div
            className="fixed inset-0 z-[2147483600] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className={`${widthClass} max-w-[92vw] max-h-[88vh] flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl`}>
                {(title || onClose) && (
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                        <div className="font-medium text-[14px] text-ink">{title}</div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-mute hover:bg-line/60 hover:text-ink"
                        >
                            <X className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
                {footer && (
                    <div className="flex items-center justify-end gap-2 border-t border-line bg-surface/80 px-4 py-3">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
