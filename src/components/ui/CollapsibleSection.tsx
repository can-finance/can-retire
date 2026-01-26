import { useState } from 'react';

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
    headerClassName?: string;
}

export function CollapsibleSection({
    title,
    children,
    defaultOpen = true,
    className = '',
    headerClassName = ''
}: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className={`rounded-2xl shadow-sm border overflow-hidden ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between p-4 text-left ${headerClassName}`}
            >
                <h2 className="text-lg font-bold text-slate-900">{title}</h2>
                <svg
                    className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <div className={`transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                <div className="p-4 pt-0">
                    {children}
                </div>
            </div>
        </section>
    );
}
