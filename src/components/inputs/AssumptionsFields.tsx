import { FinancialInput } from './FinancialInput';
import { Toggle } from '../ui/Toggle';
import { HelpTooltip } from '../ui/HelpTooltip';
import { PROVINCES } from '../../constants/provinces';
import { CHART_COLORS } from '../../constants/chartColors';
import type { SimulationInputs } from '../../engine/types';

/**
 * The persisted assumptions inputs (province, inflation, return rates, and the
 * two strategy toggles), extracted from Dashboard so the onboarding wizard can
 * reuse them. View-only toggles (Monte Carlo, Real Dollars) stay in Dashboard.
 *
 * Split into SettingsFields (province/inflation/strategy toggles) and
 * ReturnsFields (the per-account return-rate grid) so Dashboard can render them
 * in separate boxes; AssumptionsFields is a thin wrapper of both for the
 * onboarding wizard, which still wants them together as one step.
 */
export function SettingsFields({ inputs, onChange }: {
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

            <FinancialInput
                label="Inflation Rate"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                value={Number((inputs.inflationRate * 100).toFixed(1))}
                onChange={(e) => onChange({ inflationRate: Number(e.target.value) / 100 })}
            />

            <Toggle
                checked={inputs.useIncomeSplitting ?? true}
                onChange={(val) => onChange({ useIncomeSplitting: val })}
                label="Pension Income Splitting"
                tooltip={'ON = the engine calculates the optimal pension income split of up to 50%.\nOFF = each spouse is taxed on their own income with no splitting.'}
            />

            <Toggle
                checked={inputs.withdrawalStrategy === 'rrsp-first'}
                onChange={(val) => onChange({ withdrawalStrategy: val ? 'rrsp-first' : 'tax-efficient' })}
                label="Withdraw from RRSP First"
                tooltip={'ON = RRSP First (early melt): drain the RRSP first.\nOFF = RRSP Last (defer taxes): Non-Registered first, then TFSA, then RRSP. Deferring can raise estate and lifetime tax.'}
            />
        </>
    );
}

export function ReturnsFields({ inputs, onChange }: {
    inputs: SimulationInputs;
    onChange: (partial: Partial<SimulationInputs>) => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-4">
            <FinancialInput
                label="RRSP Return"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.rrsp}
                value={Number(((inputs.returnRates.rrspGrowth ?? inputs.returnRates.capitalGrowth) * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, rrspGrowth: Number(e.target.value) / 100 }
                })}
                tooltip="Whole-account annual return on RRSP/RRIF balances — tax-sheltered, so no yield/gains split."
            />
            <FinancialInput
                label="TFSA Return"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.tfsa}
                value={Number(((inputs.returnRates.tfsaGrowth ?? inputs.returnRates.capitalGrowth) * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, tfsaGrowth: Number(e.target.value) / 100 }
                })}
                tooltip="Whole-account annual return on TFSA balances — tax-free, so no yield/gains split."
            />
            <FinancialInput
                label="Non-Reg Growth"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.nonReg}
                value={Number((inputs.returnRates.capitalGrowth * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, capitalGrowth: Number(e.target.value) / 100 }
                })}
                tooltip="Price appreciation of the Equity (Growth) share of the non-registered mix. The other mix slices earn their yield inputs instead."
            />
            <FinancialInput
                label="Non-Reg Bonds Total Return"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.nonReg}
                value={Number((inputs.returnRates.bondReturn * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, bondReturn: Number(e.target.value) / 100 }
                })}
                tooltip="Total annual return on the Bonds slice of the non-registered mix; taxed as ordinary income."
            />
            <FinancialInput
                label="Non-Reg Cdn Dividend Yield"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.nonReg}
                value={Number((inputs.returnRates.dividend * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, dividend: Number(e.target.value) / 100 }
                })}
                tooltip="Yield on the Cdn Dividends slice of the non-registered mix. Eligible dividends: 38% gross-up plus dividend tax credit."
            />
            <FinancialInput
                label="Non-Reg Foreign Yield"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.nonReg}
                value={Number(((inputs.returnRates.foreignYield ?? inputs.returnRates.dividend) * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, foreignYield: Number(e.target.value) / 100 }
                })}
                tooltip="Yield on the Foreign Dividends slice of the non-registered mix (e.g. US ETFs). Taxed as ordinary income."
            />
            <FinancialInput
                label="Non-Reg Cash Interest"
                prefix="%"
                minFractionDigits={1}
                maxFractionDigits={1}
                accentColor={CHART_COLORS.nonReg}
                value={Number((inputs.returnRates.cashInterest * 100).toFixed(1))}
                onChange={(e) => onChange({
                    returnRates: { ...inputs.returnRates, cashInterest: Number(e.target.value) / 100 }
                })}
                tooltip="Interest on the Cash slice (HISA/GICs); taxed as ordinary income."
            />
        </div>
    );
}

export function AssumptionsFields({ inputs, onChange }: {
    inputs: SimulationInputs;
    onChange: (partial: Partial<SimulationInputs>) => void;
}) {
    return (
        <>
            <SettingsFields inputs={inputs} onChange={onChange} />
            <ReturnsFields inputs={inputs} onChange={onChange} />
        </>
    );
}
