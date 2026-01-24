import { FinancialInput } from './FinancialInput';

interface AssetMixInputProps {
    mix: {
        interest: number;
        dividend: number;
        capitalGain: number;
    };
    onChange: (newMix: { interest: number; dividend: number; capitalGain: number }) => void;
}

export function AssetMixInput({ mix, onChange }: AssetMixInputProps) {
    const handleChange = (field: keyof typeof mix, val: number) => {
        // Simple update, not enforcing 100% sum strictly here, relying on user or normalization later
        // But for UI, let's just let them set % and show total.
        onChange({
            ...mix,
            [field]: val / 100
        });
    };

    const total = (mix.interest + mix.dividend + mix.capitalGain) * 100;

    return (
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Non-Registered Asset Mix</h3>
            <div className="grid grid-cols-3 gap-2">
                <FinancialInput
                    label="Interest"
                    value={Math.round(mix.interest * 100)}
                    onChange={(e) => handleChange('interest', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={100}
                />
                <FinancialInput
                    label="Dividends"
                    value={Math.round(mix.dividend * 100)}
                    onChange={(e) => handleChange('dividend', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={100}
                />
                <FinancialInput
                    label="Equity"
                    value={Math.round(mix.capitalGain * 100)}
                    onChange={(e) => handleChange('capitalGain', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={100}
                />
            </div>
            <div className="flex justify-between items-center text-xs">
                <span className={total !== 100 ? "text-amber-600 font-medium" : "text-green-600 font-medium"}>
                    Total: {Math.round(total)}%
                </span>
                <span className="text-slate-400">Affects tax efficiency</span>
            </div>
        </div>
    );
}
