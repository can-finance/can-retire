import React from 'react';

type AccentColor = 'sky' | 'purple' | 'emerald' | 'amber' | 'slate' | 'indigo' | 'rose' | 'teal' | 'orange' | 'violet' | 'cyan' | 'brand' | 'none';

interface SectionCardProps {
    children: React.ReactNode;
    /** Optional left-border accent colour. Omit or pass 'none' for a plain white card. */
    accent?: AccentColor;
    className?: string;
    /** Extra padding override — defaults to p-6 */
    padding?: string;
}

const ACCENT_CLASSES: Record<AccentColor, string> = {
    sky:     'border-l-4 border-l-sky-400',
    purple:  'border-l-4 border-l-purple-400',
    emerald: 'border-l-4 border-l-emerald-400',
    amber:   'border-l-4 border-l-amber-400',
    slate:   'border-l-4 border-l-slate-400',
    indigo:  'border-l-4 border-l-indigo-400',
    rose:    'border-l-4 border-l-rose-400',
    teal:    'border-l-4 border-l-teal-400',
    orange:  'border-l-4 border-l-orange-400',
    violet:  'border-l-4 border-l-violet-400',
    cyan:    'border-l-4 border-l-cyan-400',
    brand:   'border-l-4 border-l-brand-400',
    none:    '',
};

export function SectionCard({
    children,
    accent = 'none',
    className = '',
    padding = 'p-6',
}: SectionCardProps) {
    return (
        <section
            className={`bg-white rounded-2xl shadow-sm border border-slate-100 ${ACCENT_CLASSES[accent]} ${padding} ${className}`}
        >
            {children}
        </section>
    );
}
