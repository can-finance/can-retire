import type { SimulationResult } from '../../engine/types';
import React from 'react';

interface YearlyBreakdownTableProps {
    data: SimulationResult[];
    hasSpouse?: boolean;
}

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);

// Column definitions with tooltips
const getColumns = (hasSpouse: boolean) => {
    const baseColumns = [
        { key: 'year', label: 'Year', tooltip: 'Calendar year of the simulation', align: 'left' },
        { key: 'age', label: 'Age', tooltip: 'Your age at the start of this year', align: 'left' },
    ];

    if (hasSpouse) {
        baseColumns.push({ key: 'spouseAge', label: 'Sp. Age', tooltip: "Spouse's age at the start of this year", align: 'left' });
    }

    const accountColumns = [
        { key: 'rrsp', label: 'RRSP', tooltip: 'Your RRSP balance after contributions, withdrawals, and growth. Withdrawals are fully taxable.', align: 'right', className: 'text-sky-600' },
        { key: 'tfsa', label: 'TFSA', tooltip: 'Your TFSA balance after contributions, withdrawals, and growth. Withdrawals are tax-free.', align: 'right', className: 'text-emerald-600' },
        { key: 'nonReg', label: 'Non-Reg', tooltip: 'Your Non-registered balance. Capital gains calculated using ACB; only 50% taxable.', align: 'right', className: 'text-amber-600' },
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
        { key: 'netIncome', label: 'Total Spend', tooltip: 'Household cash available for spending after taxes (Target Spend)', align: 'right', color: 'green' },
        { key: 'taxPaid', label: 'Tax Paid', tooltip: 'Combined household taxes = Federal + Provincial + OAS Clawback', align: 'right', color: 'red' }
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

export const YearlyBreakdownTable = React.memo(function YearlyBreakdownTable({ data, hasSpouse = false }: YearlyBreakdownTableProps) {
    const columns = getColumns(hasSpouse);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
                <h2 className="text-xl font-bold text-slate-900">Year-by-Year Breakdown</h2>
                <p className="text-xs text-slate-500 mt-1">Hover over column headers for calculation details</p>
            </div>
            <div className="overflow-x-auto max-h-[800px]">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                        <tr>
                            {columns.map(col => (
                                <HeaderCell key={col.key} label={col.label} tooltip={col.tooltip} align={col.align} />
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.map((row, idx) => (
                            <tr key={row.year} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                                <td className="px-3 py-2 text-slate-700">{row.year}</td>
                                <td className="px-3 py-2 text-slate-700">{row.age}</td>
                                {hasSpouse && (
                                    <td className="px-3 py-2 text-slate-700">{row.spouseAge ?? '-'}</td>
                                )}
                                <td className="px-3 py-2 text-right text-sky-600">{formatCurrency(row.accounts.rrsp)}</td>
                                <td className="px-3 py-2 text-right text-emerald-600">{formatCurrency(row.accounts.tfsa)}</td>
                                <td className="px-3 py-2 text-right text-amber-600">{formatCurrency(row.accounts.nonRegistered)}</td>
                                {hasSpouse && (
                                    <>
                                        <td className="px-3 py-2 text-right text-sky-400">{row.spouseAccounts ? formatCurrency(row.spouseAccounts.rrsp) : '-'}</td>
                                        <td className="px-3 py-2 text-right text-emerald-400">{row.spouseAccounts ? formatCurrency(row.spouseAccounts.tfsa) : '-'}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{row.spouseAccounts ? formatCurrency(row.spouseAccounts.nonRegistered) : '-'}</td>
                                    </>
                                )}
                                <td className="px-3 py-2 text-right font-medium text-slate-900">{formatCurrency(row.totalAssets)}</td>
                                <td className="px-3 py-2 text-right text-blue-600">{formatCurrency(row.netCPPIncome)}</td>
                                <td className="px-3 py-2 text-right text-blue-600">{formatCurrency(row.netOASIncome)}</td>
                                <td className="px-3 py-2 text-right text-green-600">{formatCurrency(row.netIncome)}</td>
                                <td className="px-3 py-2 text-right text-red-500">{formatCurrency(row.taxPaid)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
