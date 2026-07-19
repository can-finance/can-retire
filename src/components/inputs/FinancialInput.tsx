import { useState, useEffect } from 'react';
import type { ChangeEvent, FocusEvent as ReactFocusEvent } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { HelpTooltip } from '../ui/HelpTooltip';

interface FinancialInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    label: string;
    value: number;
    onChange: (e: { target: { value: string } }) => void;
    prefix?: string;
    suffix?: string;
    tooltip?: string;
    minFractionDigits?: number;
    maxFractionDigits?: number;
    /** Hex color string — tints the label and left border of the input to match chart colors */
    accentColor?: string;
}

const formatNumber = (num: number, min = 0, max = 2) => {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: min,
        maximumFractionDigits: max
    }).format(num);
};

export function FinancialInput({
    label,
    value,
    onChange,
    prefix = '$',
    suffix,
    tooltip,
    minFractionDigits = 0,
    maxFractionDigits = 2,
    accentColor,
    className,
    min,
    max,
    disabled,
    ...props
}: FinancialInputProps) {
    // Format initial value (0 is a real value and must render as "0", not blank)
    const [displayValue, setDisplayValue] = useState(() => formatNumber(value, minFractionDigits, maxFractionDigits));

    // Sync with external value updates
    useEffect(() => {
        // Only update if the parsed display value doesn't match the new prop value
        // This prevents cursor jumping when typing if we were to format on every keystroke
        const numericDisplay = parseFloat(displayValue.replace(/,/g, ''));
        if (numericDisplay !== value) {
            // Intentionally re-syncs the formatted display when the value prop changes externally.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setDisplayValue(formatNumber(value, minFractionDigits, maxFractionDigits));
        }
    }, [value, minFractionDigits, maxFractionDigits]); // eslint-disable-line react-hooks/exhaustive-deps -- displayValue deliberately omitted to avoid loop

    const handleFocus = (e: ReactFocusEvent<HTMLInputElement>) => {
        // On focus, strip commas for easy editing and select all text
        const rawValue = displayValue.replace(/,/g, '');
        setDisplayValue(rawValue);

        // Wait for state update to complete before selecting
        requestAnimationFrame(() => {
            e.target.select();
        });
    };

    const commitValue = () => {
        const numericValue = parseFloat(displayValue.replace(/,/g, ''));
        let finalValue = isNaN(numericValue) ? 0 : numericValue;

        // min/max don't work on type="text" inputs — enforce them on commit instead
        if (min !== undefined) finalValue = Math.max(Number(min), finalValue);
        if (max !== undefined) finalValue = Math.min(Number(max), finalValue);

        // Only trigger update if the value actually changed from the prop
        if (finalValue !== value) {
            onChange({ target: { value: finalValue.toString() } });
        }

        // Always re-format on commit to ensure proper commas and precision
        setDisplayValue(formatNumber(finalValue, minFractionDigits, maxFractionDigits));
    };

    const handleBlur = () => {
        commitValue();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur(); // Triggers handleBlur -> commitValue
        }
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;

        // Allow digits, one decimal point
        if (!/^[0-9]*\.?[0-9]*$/.test(val.replace(/,/g, ''))) return;

        setDisplayValue(val);
        // Note: We no longer call onChange here to avoid expensive re-simulations on every keypress
    };

    const labelEl = (
        <label
            className={twMerge(
                "text-sm font-semibold",
                tooltip && "cursor-help border-b border-dashed w-fit",
                accentColor ? "" : "text-slate-700",
                tooltip && !accentColor && "border-slate-300",
                disabled && !accentColor && "text-slate-400"
            )}
            style={accentColor ? { color: accentColor, borderColor: accentColor + '80' } : undefined}
        >
            {label}
        </label>
    );

    return (
        <div className={clsx("flex flex-col gap-1.5", className)}>
            {tooltip ? <HelpTooltip text={tooltip} className="w-fit">{labelEl}</HelpTooltip> : labelEl}
            <div className="relative flex items-center">
                {prefix && (
                    <span className="absolute left-3 text-slate-500 font-medium">
                        {prefix}
                    </span>
                )}
                <input
                    type="text"
                    inputMode="decimal"
                    value={displayValue}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    className={twMerge(
                        "w-full rounded-lg border bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 sm:text-sm",
                        accentColor ? "border-slate-200" : "border-slate-300 focus:border-brand-500 focus:ring-brand-500",
                        prefix && "pl-7",
                        suffix && "pr-8",
                        "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    )}
                    style={accentColor ? {
                        borderLeftColor: accentColor,
                        borderLeftWidth: '3px',
                        // focus ring color via box-shadow can't easily be dynamic in Tailwind, handled by focus class below
                    } : undefined}
                    onFocusCapture={(e) => {
                        if (accentColor) e.currentTarget.style.boxShadow = `0 0 0 1px ${accentColor}40`;
                    }}
                    onBlurCapture={(e) => {
                        if (accentColor) e.currentTarget.style.boxShadow = '';
                    }}
                    {...props}
                />
                {suffix && (
                    <span className="absolute right-3 text-slate-500 font-medium">
                        {suffix}
                    </span>
                )}
            </div>

        </div>
    );
}
