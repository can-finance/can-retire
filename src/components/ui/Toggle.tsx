interface ToggleProps {
    checked: boolean;
    onChange: (val: boolean) => void;
    label: string;
    tooltip?: string;
    badge?: React.ReactNode;
}

import React from 'react';
import { HelpTooltip } from './HelpTooltip';

export function Toggle({ checked, onChange, label, tooltip, badge }: ToggleProps) {
    const labelEl = (
        <label
            className={`text-sm font-medium text-slate-700 flex items-center gap-2 ${tooltip ? 'cursor-help border-b border-dashed border-slate-300 w-fit' : ''}`}
        >
            {label}
            {badge}
        </label>
    );

    return (
        <div className="flex items-center justify-between py-2 border-t border-slate-100">
            {tooltip ? <HelpTooltip text={tooltip} className="w-fit">{labelEl}</HelpTooltip> : labelEl}
            <button
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 flex-shrink-0 ${
                    checked ? 'bg-brand-500' : 'bg-slate-200'
                }`}
            >
                <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${
                        checked ? 'translate-x-5' : 'translate-x-0'
                    }`}
                />
            </button>
        </div>
    );
}
