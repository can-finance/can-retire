import { FinancialInput } from './FinancialInput';
import { Toggle } from '../ui/Toggle';
import { HelpTooltip } from '../ui/HelpTooltip';
import { PROVINCES } from '../../constants/provinces';
import type { SimulationInputs } from '../../engine/types';

/**
 * The persisted assumptions inputs (province, inflation, return rates, and the
 * two strategy toggles), extracted from Dashboard so the onboarding wizard can
 * reuse them. View-only toggles (Monte Carlo, Real Dollars) stay in Dashboard.
 */
export function AssumptionsFields({ inputs, onChange }: {
    inputs: SimulationInputs;
    onChange: (partial: Partial<SimulationInputs>) => void;
}) {
    return (
        <>
            <div className="flex flex-col gap-1.5">
                <HelpTooltip
                    text="Determines provincial income tax rates, brackets, surtaxes (e.g. Ontario Health Premium), and tax credits used in the simulation."
                    className="w-fit"
                >
                    <label className="text-sm font-medium text-slate-700 cursor-help border-b border-dashed border-slate-300 w-fit">
                        Province
                    </label>
                </HelpTooltip>
                <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    value={inputs.province}
                    onChange={(e) => onChange({ province: e.target.value })}
                >
                    {PROVINCES.map((p) => (
                        <option key={p.code} value={p.code}>{p.name}</option>
                    ))}
                </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <FinancialInput
                    label="Inflation Rate"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number((inputs.inflationRate * 100).toFixed(1))}
                    onChange={(e) => onChange({ inflationRate: Number(e.target.value) / 100 })}
                />
                <FinancialInput
                    label="RRSP Return"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number(((inputs.returnRates.rrspGrowth ?? inputs.returnRates.capitalGrowth) * 100).toFixed(1))}
                    onChange={(e) => onChange({
                        returnRates: { ...inputs.returnRates, rrspGrowth: Number(e.target.value) / 100 }
                    })}
                    tooltip="Whole-account annual return on RRSP/RRIF balances (growth is tax-sheltered, so no yield/gains split is needed)."
                />
                <FinancialInput
                    label="TFSA Return"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number(((inputs.returnRates.tfsaGrowth ?? inputs.returnRates.capitalGrowth) * 100).toFixed(1))}
                    onChange={(e) => onChange({
                        returnRates: { ...inputs.returnRates, tfsaGrowth: Number(e.target.value) / 100 }
                    })}
                    tooltip="Whole-account annual return on TFSA balances (growth is tax-free, so no yield/gains split is needed)."
                />
                <FinancialInput
                    label="Non-Reg Growth"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number((inputs.returnRates.capitalGrowth * 100).toFixed(1))}
                    onChange={(e) => onChange({
                        returnRates: { ...inputs.returnRates, capitalGrowth: Number(e.target.value) / 100 }
                    })}
                    tooltip="Price appreciation of the Equity (Growth) share of the non-registered mix. The other mix slices earn their yield inputs instead."
                />
                <FinancialInput
                    label="Cdn Dividend Yield"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number((inputs.returnRates.dividend * 100).toFixed(1))}
                    onChange={(e) => onChange({
                        returnRates: { ...inputs.returnRates, dividend: Number(e.target.value) / 100 }
                    })}
                    tooltip="Yield on the Cdn Dividends slice of the non-registered mix. Eligible dividends: 38% gross-up plus dividend tax credit."
                />
                <FinancialInput
                    label="Foreign Yield"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number(((inputs.returnRates.foreignYield ?? inputs.returnRates.dividend) * 100).toFixed(1))}
                    onChange={(e) => onChange({
                        returnRates: { ...inputs.returnRates, foreignYield: Number(e.target.value) / 100 }
                    })}
                    tooltip="Yield on the Foreign Dividends slice of the non-registered mix (e.g. US ETFs). Taxed as ordinary income."
                />
                <FinancialInput
                    label="Interest Rate"
                    prefix="%"
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    value={Number((inputs.returnRates.interest * 100).toFixed(1))}
                    onChange={(e) => onChange({
                        returnRates: { ...inputs.returnRates, interest: Number(e.target.value) / 100 }
                    })}
                />
            </div>

            <Toggle
                checked={inputs.useIncomeSplitting ?? true}
                onChange={(val) => onChange({ useIncomeSplitting: val })}
                label="Pension Income Splitting"
            />

            <Toggle
                checked={inputs.withdrawalStrategy === 'rrsp-first'}
                onChange={(val) => onChange({ withdrawalStrategy: val ? 'rrsp-first' : 'tax-efficient' })}
                label="Withdraw from RRSP First"
                tooltip="If off, withdrawals come from Non-Registered accounts first (Tax-Efficient strategy), then TFSA, then RRSP."
            />
        </>
    );
}
