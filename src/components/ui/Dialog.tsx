import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
    /** When false, nothing renders. */
    open: boolean;
    /** Called on Escape, backdrop click, or a footer close action. */
    onClose: () => void;
    title: string;
    children?: ReactNode;
    /** Actions row (buttons). Rendered right-aligned below the body. */
    footer?: ReactNode;
    /** Width cap for the card — defaults to max-w-md. */
    maxWidth?: string;
}

/**
 * Small reusable modal. Sits at z-[150] — above the app (sticky header z-50,
 * tooltips z-[100]) but independent of the onboarding overlay's z-[200], so the
 * two never fight. Escape and backdrop clicks close it; on open, focus moves to
 * the element marked data-autofocus (the least-destructive action) or the card.
 */
export function Dialog({ open, onClose, title, children, footer, maxWidth = 'max-w-md' }: DialogProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const titleId = useId();

    // Escape closes, regardless of where focus sits.
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    // Move focus into the dialog on open — the least-destructive action if one is
    // marked, otherwise the card itself so keyboard/Escape work immediately.
    useEffect(() => {
        if (!open) return;
        const card = cardRef.current;
        if (!card) return;
        const target = card.querySelector<HTMLElement>('[data-autofocus]') ?? card;
        try {
            target.focus({ preventScroll: true });
        } catch {
            target.focus();
        }
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 px-4 py-6"
            onClick={onClose}
        >
            <div
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                className={`w-full ${maxWidth} bg-white rounded-2xl shadow-xl border border-slate-100 p-6 outline-none`}
            >
                <h2 id={titleId} className="text-lg font-bold text-slate-900">
                    {title}
                </h2>
                {children && <div className="mt-3 text-sm text-slate-600">{children}</div>}
                {footer && <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>}
            </div>
        </div>
    );
}
