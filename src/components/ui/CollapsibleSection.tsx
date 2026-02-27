import { useState } from 'react';
import React from 'react';

type AccentColor = 'sky' | 'purple' | 'emerald' | 'amber' | 'slate' | 'indigo' | 'rose' | 'teal' | 'orange' | 'violet' | 'cyan' | 'none';

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
    none:    '',
};

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    accent?: AccentColor;
    className?: string;
    /** Optional custom content to replace the title in the header button */
    headerContent?: React.ReactNode;
    /** Optional extra element rendered to the left of the chevron (e.g. a Remove button) */
    headerExtra?: React.ReactNode;
}

export function CollapsibleSection({
    title,
    children,
    defaultOpen = true,
    accent = 'none',
    className = '',
    headerContent,
    headerExtra,
}: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className={`rounded-2xl shadow-sm border border-slate-100 bg-white overflow-hidden ${ACCENT_CLASSES[accent]} ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 text-left"
            >
                {headerContent ?? <h2 className="text-xl font-bold text-slate-900">{title}</h2>}
                <div className="flex items-center gap-2">
                    {headerExtra}
                    <svg
                        className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>
            <div className={`transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                <div className="p-4 pt-0">
                    {children}
                </div>
            </div>
        </section>
    );
}
