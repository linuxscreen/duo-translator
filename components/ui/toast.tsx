import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Copy, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ToastKind = 'success' | 'error';

type ToastItem = { id: number; text: string; kind: ToastKind; count: number };

const DURATION_MS = 3200;

/**
 * Minimal self-contained toast: a hook that owns the toast list and renders its
 * own portal viewport (top-center). Use the returned `viewport` somewhere in
 * your JSX and call `show(text, kind)` to push a toast.
 *
 * Success and error are deliberately NOT symmetric:
 *
 *   success — auto-dismisses, never interactive, `pointer-events: none` so it
 *             can't swallow a click on whatever it happens to cover.
 *   error   — stays until dismissed, text is selectable, and it carries a copy
 *             button. An error is the one message the user may need to act on:
 *             read it twice, paste it into a search box or a bug report. A
 *             provider failure arrives as a wall of text (status line + host +
 *             response body) that nobody reads in 3.2 seconds, and a toast that
 *             erases itself is how a failure ends up indistinguishable from
 *             nothing having happened.
 */
export function useToast() {
    const { t } = useTranslation();
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [copiedId, setCopiedId] = useState<number | null>(null);

    const dismiss = useCallback((id: number) => {
        setToasts((cur) => cur.filter((it) => it.id !== id));
    }, []);

    const show = useCallback((text: string, kind: ToastKind = 'success') => {
        const id = Date.now() + Math.random();
        setToasts((cur) => {
            // Persistent errors need a cap on repetition: retrying a broken
            // provider four times must not stack four identical walls of text.
            // Counting rather than swallowing keeps "it failed AGAIN" visible.
            const same = kind === 'error' && cur.find((it) => it.kind === kind && it.text === text);
            if (same) {
                return cur.map((it) => (it === same ? { ...it, count: it.count + 1 } : it));
            }
            return [...cur, { id, text, kind, count: 1 }];
        });
        if (kind !== 'error') {
            setTimeout(() => {
                setToasts((cur) => cur.filter((it) => it.id !== id));
            }, DURATION_MS);
        }
    }, []);

    const copy = useCallback(async (it: ToastItem) => {
        try {
            await navigator.clipboard.writeText(it.text);
            setCopiedId(it.id);
            setTimeout(() => setCopiedId((cur) => (cur === it.id ? null : cur)), 1500);
        } catch {
            // Clipboard can be refused when the document isn't focused. The text
            // is selectable either way, so there is still a way out.
        }
    }, []);

    const viewport = createPortal(
        // Top-center, slightly down from the top. z-index above the Dialog
        // (which uses 2147483600) so toasts are never covered by a modal overlay.
        <div className="pointer-events-none fixed top-16 left-1/2 z-[2147483647] flex w-full max-w-[min(680px,92vw)] -translate-x-1/2 flex-col items-center gap-2">
            {toasts.map((it) =>
                it.kind === 'error' ? (
                    <div
                        key={it.id}
                        role="alert"
                        // Opaque, like the success toast: this one sits over the
                        // page until dismissed, and a translucent fill lets the
                        // settings rows underneath bleed through a wall of error
                        // text. Red is carried by the border, icon and text.
                        className="pointer-events-auto flex w-full items-start gap-2 rounded-lg border border-danger bg-surface px-3 py-2 text-[13px] text-danger shadow-lg"
                    >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="max-h-60 flex-1 select-text overflow-y-auto break-words whitespace-pre-wrap">
                            {it.text}
                            {it.count > 1 && <span className="ml-1 opacity-70">×{it.count}</span>}
                        </span>
                        <button
                            type="button"
                            title={copiedId === it.id ? t('copied', 'Copied') : t('copy', 'Copy')}
                            aria-label={t('copy', 'Copy')}
                            onClick={() => copy(it)}
                            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-surface-2"
                        >
                            {copiedId === it.id ? (
                                <Check className="h-3.5 w-3.5" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                        <button
                            type="button"
                            title={t('close', 'Close')}
                            aria-label={t('close', 'Close')}
                            onClick={() => dismiss(it.id)}
                            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-surface-2"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : (
                    <div
                        key={it.id}
                        role="status"
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink shadow-lg"
                    >
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                        <span>{it.text}</span>
                    </div>
                ),
            )}
        </div>,
        document.body,
    );

    return { show, viewport };
}
