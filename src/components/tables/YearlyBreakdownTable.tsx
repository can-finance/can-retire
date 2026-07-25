import type { SimulationResult, NonRegMix } from '../../engine/types';
import React from 'react';
import { formatCurrencyCAD } from '../../utils/formatters';
import { HelpTooltip } from '../ui/HelpTooltip';

// Breakdown shown when hovering a Tax Paid cell
function taxBreakdown(row: SimulationResult, hasSpouse: boolean): string {
    const parts: string[] = [];
    if (hasSpouse) {
        parts.push(`You: ${formatCurrencyCAD(row.personTaxPaid)} · Spouse: ${formatCurrencyCAD(row.spouseTaxPaid)}`);
    }
    if (row.oasClawbackPaid > 1) {
        parts.push(`Includes OAS clawback of ${formatCurrencyCAD(row.oasClawbackPaid)}`);
    }
    if ((row.taxSavingsFromSplit ?? 0) > 1) {
        parts.push(`Pension splitting saved ${formatCurrencyCAD(row.taxSavingsFromSplit!)}`);
    }
    // Investment tax by source — only lines that are material this year
    const bySource: string[] = [];
    if (row.capGainsTaxPaid > 1) bySource.push(`cap gains ${formatCurrencyCAD(row.capGainsTaxPaid)}`);
    if (Math.abs(row.dividendTaxPaid) > 1) bySource.push(`dividends ${formatCurrencyCAD(row.dividendTaxPaid)}`);
    if (row.interestTaxPaid > 1) bySource.push(`interest/foreign div ${formatCurrencyCAD(row.interestTaxPaid)}`);
    if (bySource.length > 0) {
        parts.push(`Of which (marginal):\n${bySource.map(s => `  ${s}`).join('\n')}`);
    }
    if (row.grossIncome > 0 && row.taxPaid > 0) {
        parts.push(`Effective rate: ${((row.taxPaid / row.grossIncome) * 100).toFixed(1)}% of taxable income`);
    }
    return parts.join('\n');
}

interface YearlyBreakdownTableProps {
    data: SimulationResult[];
    hasSpouse?: boolean;
    // When annual rebalancing is off, non-reg cells show the drifted composition on hover
    showMixDrift?: boolean;
    // When provided, rows become clickable/keyboard-operable and open the Year Audit drawer.
    onSelectYear?: (year: number) => void;
}

function mixTooltip(m: NonRegMix): string {
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return `Mix this year: ${pct(m.capitalGain)} equity · ${pct(m.dividend)} Cdn div · ${pct(m.foreignDividend)} foreign div · ${pct(m.bonds)} bonds · ${pct(m.cash)} cash`;
}

// Column definitions with tooltips
const getColumns = (hasSpouse: boolean) => {
    const baseColumns = [
        { key: 'year', label: 'Year', tooltip: 'Calendar year of the simulation', align: 'left' },
        { key: 'age', label: 'Age', tooltip: 'Your age at the start of this year', align: 'left' },
    ];

    if (hasSpouse) {
        baseColumns.push({ key: 'spouseAge', label: 'Sp Age', tooltip: "Spouse's age at the start of this year", align: 'left' });
    }

    const accountColumns = [
        { key: 'rrsp', label: 'RRSP', tooltip: 'Your RRSP balance after contributions, withdrawals, and growth. Withdrawals are fully taxable.', align: 'right', className: 'text-sky-600' },
        { key: 'tfsa', label: 'TFSA', tooltip: 'Your TFSA balance after contributions, withdrawals, and growth. Withdrawals are tax-free.', align: 'right', className: 'text-emerald-600' },
        { key: 'nonReg', label: 'Non-Reg', tooltip: 'Your Non-registered balance. Capital gains are calculated against your adjusted cost base (ACB); only 50% of gains are taxable.', align: 'right', className: 'text-amber-600' },
    ];

    if (hasSpouse) {
        accountColumns.push(
            { key: 'spRrsp', label: 'Sp RRSP', tooltip: "Spouse's RRSP balance", align: 'right', className: 'text-sky-400' },
            { key: 'spTfsa', label: 'Sp TFSA', tooltip: "Spouse's TFSA balance", align: 'right', className: 'text-emerald-400' },
            { key: 'spNonReg', label: 'Sp Non-Reg', tooltip: "Spouse's Non-registered balance", align: 'right', className: 'text-amber-400' }
        );
    }

    const incomeColumns = [
        { key: 'total', label: 'Total Assets', tooltip: 'Sum of all account balances (yours + spouse if applicable)', align: 'right' },
        { key: 'netCPP', label: 'Net CPP', tooltip: 'Combined Canada Pension Plan benefits (Net of Tax).', align: 'right', color: 'blue' },
        { key: 'netOAS', label: 'Net OAS', tooltip: 'Combined Old Age Security benefits (Net of Tax).', align: 'right', color: 'blue' },
        { key: 'netPension', label: 'Net Pension', tooltip: 'Combined workplace defined-benefit pension income, including any bridge benefit (Net of Tax).', align: 'right', color: 'blue' },
        { key: 'netIncome', label: 'Total Spend', tooltip: "What the household actually spent this year. Equals your spending target unless accounts ran short.", align: 'right', color: 'green' },
        { key: 'surplusShortfall', label: 'Surplus / Shortfall', tooltip: 'Green (+): income exceeded the spending target; the excess was reinvested into TFSA/RRSP/Non-Reg. Red (−): spending that could NOT be funded after draining all accounts.', align: 'right' },
        { key: 'taxPaid', label: 'Tax Paid', tooltip: 'Combined household taxes = Federal + Provincial + OAS Clawback', align: 'right', color: 'red' },
        { key: 'estateTax', label: 'Estate Tax', tooltip: 'Terminal tax at death: deemed disposition of RRSP/RRIF plus unrealized capital gains. Already deducted from the account balances shown on this row.', align: 'right', color: 'red' }
    ];

    return [...baseColumns, ...accountColumns, ...incomeColumns];
};

function HeaderCell({ label, tooltip, align }: { label: string; tooltip: string; align: string }) {
    return (
        <th
            className={`px-3 py-2 font-semibold text-slate-600 cursor-help whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
            title={tooltip}
        >
            <span className="border-b border-dashed border-slate-400">{label}</span>
        </th>
    );
}

export const YearlyBreakdownTable = React.memo(function YearlyBreakdownTable({ data, hasSpouse = false, showMixDrift = false, onSelectYear }: YearlyBreakdownTableProps) {
    const columns = getColumns(hasSpouse);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
                <h2 className="text-xl font-bold text-slate-900">Year-by-Year Breakdown</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Hover over column headers for calculation details.
                    {onSelectYear && ' Click a year for a full breakdown.'}
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                        <tr>
                            {columns.map(col => (
                                <HeaderCell key={col.key} label={col.label} tooltip={col.tooltip} align={col.align} />
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.map((row, idx) => {
                            const reinvested = row.reinvestedTFSA + row.reinvestedRRSP + row.reinvestedNonReg;
                            const clickable = !!onSelectYear;
                            return (
                            <tr
                                key={row.year}
                                className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${clickable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
                                {...(clickable ? {
                                    tabIndex: 0,
                                    'aria-label': `Open ${row.year} breakdown`,
                                    onClick: () => onSelectYear!(row.year),
                                    onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onSelectYear!(row.year);
                                        }
                                    },
                                } : {})}
                            >
                                <td className="px-3 py-2 text-slate-700">{row.year}</td>
                                <td className="px-3 py-2 text-slate-700">{row.age}</td>
                                {hasSpouse && (
                                    <td className="px-3 py-2 text-slate-700">{row.spouseAge ?? '-'}</td>
                                )}
                                <td className="px-3 py-2 text-right text-sky-600">{formatCurrencyCAD(row.accounts.rrsp)}</td>
                                <td className="px-3 py-2 text-right text-emerald-600">{formatCurrencyCAD(row.accounts.tfsa)}</td>
                                <td className="px-3 py-2 text-right text-amber-600">
                                    {showMixDrift && row.nonRegMix && row.accounts.nonRegistered > 1 ? (
                                        <HelpTooltip text={mixTooltip(row.nonRegMix)}>
                                            <span className="cursor-help border-b border-dashed border-amber-200">{formatCurrencyCAD(row.accounts.nonRegistered)}</span>
                                        </HelpTooltip>
                                    ) : formatCurrencyCAD(row.accounts.nonRegistered)}
                                </td>
                                {hasSpouse && (
                                    <>
                                        <td className="px-3 py-2 text-right text-sky-400">{row.spouseAccounts ? formatCurrencyCAD(row.spouseAccounts.rrsp) : '-'}</td>
                                        <td className="px-3 py-2 text-right text-emerald-400">{row.spouseAccounts ? formatCurrencyCAD(row.spouseAccounts.tfsa) : '-'}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">
                                            {showMixDrift && row.spouseNonRegMix && row.spouseAccounts && row.spouseAccounts.nonRegistered > 1 ? (
                                                <HelpTooltip text={mixTooltip(row.spouseNonRegMix)}>
                                                    <span className="cursor-help border-b border-dashed border-amber-200">{formatCurrencyCAD(row.spouseAccounts.nonRegistered)}</span>
                                                </HelpTooltip>
                                            ) : row.spouseAccounts ? formatCurrencyCAD(row.spouseAccounts.nonRegistered) : '-'}
                                        </td>
                                    </>
                                )}
                                <td className="px-3 py-2 text-right font-medium text-slate-900">{formatCurrencyCAD(row.totalAssets)}</td>
                                <td className="px-3 py-2 text-right text-blue-600">
                                    {hasSpouse && row.netCPPIncome > 1 ? (
                                        <HelpTooltip text={`You: ${formatCurrencyCAD(row.personNetCPP)}\nSpouse: ${formatCurrencyCAD(row.spouseNetCPP)}`}>
                                            <span className="cursor-help border-b border-dashed border-blue-200">{formatCurrencyCAD(row.netCPPIncome)}</span>
                                        </HelpTooltip>
                                    ) : formatCurrencyCAD(row.netCPPIncome)}
                                </td>
                                <td className="px-3 py-2 text-right text-blue-600">
                                    {hasSpouse && row.netOASIncome > 1 ? (
                                        <HelpTooltip text={`You: ${formatCurrencyCAD(row.personNetOAS)}\nSpouse: ${formatCurrencyCAD(row.spouseNetOAS)}`}>
                                            <span className="cursor-help border-b border-dashed border-blue-200">{formatCurrencyCAD(row.netOASIncome)}</span>
                                        </HelpTooltip>
                                    ) : formatCurrencyCAD(row.netOASIncome)}
                                </td>
                                <td className="px-3 py-2 text-right text-blue-600">
                                    {hasSpouse && row.netPensionIncome > 1 ? (
                                        <HelpTooltip text={`You: ${formatCurrencyCAD(row.personNetPension)}\nSpouse: ${formatCurrencyCAD(row.spouseNetPension)}`}>
                                            <span className="cursor-help border-b border-dashed border-blue-200">{formatCurrencyCAD(row.netPensionIncome)}</span>
                                        </HelpTooltip>
                                    ) : formatCurrencyCAD(row.netPensionIncome)}
                                </td>
                                <td className="px-3 py-2 text-right text-green-600">{formatCurrencyCAD(row.netIncome)}</td>
                                <td className={`px-3 py-2 text-right ${row.shortfall > 1 ? 'font-bold text-red-600' : reinvested > 1 ? 'text-emerald-600' : 'text-slate-300'}`}>
                                    {row.shortfall > 1 ? `−${formatCurrencyCAD(row.shortfall)}` : reinvested > 1 ? `+${formatCurrencyCAD(reinvested)}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right text-red-500">
                                    {row.taxPaid > 1 ? (
                                        <HelpTooltip text={taxBreakdown(row, hasSpouse)}>
                                            <span className="cursor-help border-b border-dashed border-red-200">{formatCurrencyCAD(row.taxPaid)}</span>
                                        </HelpTooltip>
                                    ) : formatCurrencyCAD(row.taxPaid)}
                                </td>
                                <td className={`px-3 py-2 text-right ${(row.totalTerminalTax ?? 0) > 1 ? 'font-bold text-red-600' : 'text-slate-300'}`}>
                                    {(row.totalTerminalTax ?? 0) > 1 ? formatCurrencyCAD(row.totalTerminalTax!) : '—'}
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
