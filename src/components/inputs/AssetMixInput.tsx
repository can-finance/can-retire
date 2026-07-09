import { FinancialInput } from './FinancialInput';
import { HelpTooltip } from '../ui/HelpTooltip';

interface Mix {
    interest: number;
    dividend: number;
    foreignDividend?: number;
    capitalGain: number;
}

interface AssetMixInputProps {
    mix: Mix;
    turnoverRate?: number;
    onChange: (newMix: Mix) => void;
    onTurnoverChange: (rate: number) => void;
}

const MIX_FIELDS = ['interest', 'dividend', 'foreignDividend', 'capitalGain'] as const;
type MixField = typeof MIX_FIELDS[number];

export function AssetMixInput({ mix, turnoverRate = 0, onChange, onTurnoverChange }: AssetMixInputProps) {
    const share = (f: MixField) => mix[f] || 0;

    // A field can only grow into the headroom the others leave, so the shares
    // never sum above 100% (a sum below 100% is allowed and flagged by the
    // total indicator — the remainder acts as uninvested cash). FinancialInput
    // clamps to [0, headroom] on commit; the cap here is a safety net.
    const sum = MIX_FIELDS.reduce((acc, f) => acc + share(f), 0);
    const headroom = (field: MixField) =>
        Math.max(0, Math.round((1 - (sum - share(field))) * 100));

    const handleChange = (field: MixField, val: number) => {
        const capped = Math.max(0, Math.min(val, headroom(field)));
        onChange({
            ...mix,
            [field]: capped / 100
        });
    };

    const total = sum * 100;

    return (
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-slate-900">Non-Registered Asset Mix</h3>
                <p className="text-[10px] text-slate-400">Applies to both your and your spouse's non-registered accounts</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <FinancialInput
                    label="Interest"
                    value={Math.round(share('interest') * 100)}
                    onChange={(e) => handleChange('interest', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={headroom('interest')}
                />
                <FinancialInput
                    label="Cdn Dividends"
                    value={Math.round(share('dividend') * 100)}
                    onChange={(e) => handleChange('dividend', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={headroom('dividend')}
                />
                <FinancialInput
                    label="Foreign Dividends"
                    value={Math.round(share('foreignDividend') * 100)}
                    onChange={(e) => handleChange('foreignDividend', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={headroom('foreignDividend')}
                />
                <FinancialInput
                    label="Equity (Growth)"
                    value={Math.round(share('capitalGain') * 100)}
                    onChange={(e) => handleChange('capitalGain', Number(e.target.value))}
                    prefix="%"
                    min={0}
                    max={headroom('capitalGain')}
                />
            </div>
            <div className="flex justify-between items-center text-xs">
                <span className={total !== 100 ? "text-amber-600 font-medium" : "text-green-600 font-medium"}>
                    Total: {Math.round(total)}%
                </span>
                <HelpTooltip text="Cdn Dividends get the eligible dividend gross-up and tax credit. Foreign Dividends (e.g. US ETFs) are fully taxed as regular income with no credit.">
                    <span className="text-slate-400 cursor-help border-b border-dashed border-slate-300">Affects tax efficiency</span>
                </HelpTooltip>
            </div>
            <div className="pt-2 border-t border-slate-200">
                <div className="grid grid-cols-2 gap-2 items-end">
                    <FinancialInput
                        label="Equity Turnover"
                        value={Math.round(turnoverRate * 100)}
                        onChange={(e) => onTurnoverChange(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                        prefix="%"
                        min={0}
                        max={100}
                    />
                    <HelpTooltip text="Share of unrealized gains your funds realize and distribute each year (0% for buy-and-hold index ETFs; ~10–30% for typical mutual funds). Taxed annually as capital gains and reinvested, raising the cost base — the yearly tax drag of active funds.">
                        <span className="text-xs text-slate-400 cursor-help border-b border-dashed border-slate-300 pb-1 inline-block">What is this?</span>
                    </HelpTooltip>
                </div>
            </div>
        </div>
    );
}
