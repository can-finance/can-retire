import React, { useRef, useState } from 'react';

interface HelpTooltipProps {
    text: string;
    children: React.ReactNode;
    className?: string;
}

const TOOLTIP_WIDTH = 320;

/**
 * Instant, styled hover tooltip — replaces native `title` attributes, which
 * require a long hover on the exact text and never appear on touch devices.
 * Rendered with position:fixed so it escapes overflow-hidden card containers.
 */
export function HelpTooltip({ text, children, className = '' }: HelpTooltipProps) {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

    const show = () => {
        const r = anchorRef.current?.getBoundingClientRect();
        if (!r) return;
        let x = r.left + r.width / 2 - TOOLTIP_WIDTH / 2;
        x = Math.max(8, Math.min(x, window.innerWidth - TOOLTIP_WIDTH - 8));
        // Flip above the label when there's little room below
        const above = r.bottom > window.innerHeight - 120;
        setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above });
    };

    const hide = () => setPos(null);

    return (
        <span
            ref={anchorRef}
            className={`inline-block ${className}`}
            onMouseEnter={show}
            onMouseLeave={hide}
        >
            {children}
            {pos && (
                <span
                    role="tooltip"
                    style={{
                        position: 'fixed',
                        left: pos.x,
                        top: pos.y,
                        width: TOOLTIP_WIDTH,
                        transform: pos.above ? 'translateY(-100%)' : undefined,
                    }}
                    className="z-[100] pointer-events-none block whitespace-pre-line rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-xl"
                >
                    {text}
                </span>
            )}
        </span>
    );
}
