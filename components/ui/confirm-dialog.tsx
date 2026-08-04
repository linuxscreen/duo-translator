import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Props = {
    open: boolean;
    title: ReactNode;
    /** What exactly is about to happen. Name the thing, don't just say "are you sure".  */
    description?: ReactNode;
    confirmLabel?: string;
    /** Destructive actions get the red button; reversible ones don't. */
    destructive?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
};

/**
 * Yes/no confirmation for actions that cannot be undone.
 *
 * Backdrop dismissal is off: a confirmation exists precisely because a stray
 * click should not decide the outcome — and here the outcome of a stray click
 * would be ambiguous rather than merely lossy.
 */
export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    destructive = true,
    onConfirm,
    onCancel,
}: Props) {
    const { t } = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            title={title}
            widthClass="w-[420px]"
            dismissOnBackdrop={false}
            footer={
                <>
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        {t('cancel', 'Cancel')}
                    </Button>
                    <Button
                        variant={destructive ? 'destructive' : 'default'}
                        size="sm"
                        onClick={onConfirm}
                    >
                        {confirmLabel ?? t('delete', 'Delete')}
                    </Button>
                </>
            }
        >
            {description && <div className="text-[13px] text-ink-soft">{description}</div>}
        </Dialog>
    );
}
