import { useState, useEffect } from 'react';
import type { ChangeEvent, FocusEvent as ReactFocusEvent } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface FinancialInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    label: string;
    value: number;
    onChange: (e: { target: { value: string } }) => void;
    prefix?: string;
    suffix?: string;
    helperText?: string;
    minFractionDigits?: number;
    maxFractionDigits?: number;
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
    helperText,
    minFractionDigits = 0,
    maxFractionDigits = 2,
    className,
    ...props
}: FinancialInputProps) {
    // Format initial value
    const [displayValue, setDisplayValue] = useState(() => value ? formatNumber(value, minFractionDigits, maxFractionDigits) : '');

    // Sync with external value updates
    useEffect(() => {
        // Only update if the parsed display value doesn't match the new prop value
        // This prevents cursor jumping when typing if we were to format on every keystroke
        const numericDisplay = parseFloat(displayValue.replace(/,/g, ''));
        if (numericDisplay !== value) {
            setDisplayValue(value ? formatNumber(value, minFractionDigits, maxFractionDigits) : '');
        }
    }, [value, minFractionDigits, maxFractionDigits]); // minimal dependency to avoid loop

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
        const finalValue = isNaN(numericValue) ? 0 : numericValue;

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

    return (
        <div className={clsx("flex flex-col gap-1.5", className)}>
            <label className="text-sm font-medium text-slate-700">
                {label}
            </label>
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
                    className={twMerge(
                        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm",
                        prefix && "pl-7",
                        suffix && "pr-8"
                    )}
                    {...props}
                />
                {suffix && (
                    <span className="absolute right-3 text-slate-500 font-medium">
                        {suffix}
                    </span>
                )}
            </div>
            {helperText && (
                <p className="text-xs text-slate-500">{helperText}</p>
            )}
        </div>
    );
}
