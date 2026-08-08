import type { SimulationResult, NonRegMix } from '../../engine/types';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { formatCurrencyCAD } from '../../utils/formatters';
import { usePersistentState } from '../../hooks/usePersistentState';
import { HelpTooltip } from '../ui/HelpTooltip';
import {
    COLUMN_GROUPS,
    COLUMN_GROUPS_STORAGE_KEY,
    DEFAULT_COLUMN_GROUPS,
    averageTaxRate,
    formatPercent1,
    reinvestedTotal,
    sanitizeColumnGroups,
    type ColumnGroup,
} from './yearlyBreakdownColumns';

/**
 * Every currency figure in this table passes through one of these, so a cell and
 * the tooltip that annotates it can never disagree about which dollars they are
 * in. Same convention as computeSummaryMetrics and the charts:
 * `isInflationAdjusted ? value / inflationFactor : value`.
 *
 * Materiality guards (`> 1`) deliberately stay on the NOMINAL figures — whether
 * a line is worth showing is a property of the projection, not of the display
 * units the reader happens to have selected.
 */
type Adjust = (value: number) => number;

const makeAdjust = (row: SimulationResult, inflationAdjusted: boolean): Adjust =>
    inflationAdjusted ? (v: number) => v / row.inflationFactor : (v: number) => v;

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

// Breakdown shown when hovering a Tax Paid cell
function taxBreakdown(row: SimulationResult, hasSpouse: boolean, adj: Adjust): string {
    const parts: string[] = [];
    if (hasSpouse) {
        parts.push(`You: ${formatCurrencyCAD(adj(row.personTaxPaid))} · Spouse: ${formatCurrencyCAD(adj(row.spouseTaxPaid))}`);
    }
    if (row.oasClawbackPaid > 1) {
        parts.push(`Includes OAS clawback of ${formatCurrencyCAD(adj(row.oasClawbackPaid))}`);
    }
    if ((row.taxSavingsFromSplit ?? 0) > 1) {
        parts.push(`Pension splitting saved ${formatCurrencyCAD(adj(row.taxSavingsFromSplit!))}`);
    }
    // Investment tax by source — only lines that are material this year
    const bySource: string[] = [];
    if (row.capGainsTaxPaid > 1) bySource.push(`cap gains ${formatCurrencyCAD(adj(row.capGainsTaxPaid))}`);
    if (Math.abs(row.dividendTaxPaid) > 1) bySource.push(`dividends ${formatCurrencyCAD(adj(row.dividendTaxPaid))}`);
    if (row.interestTaxPaid > 1) bySource.push(`interest/foreign div ${formatCurrencyCAD(adj(row.interestTaxPaid))}`);
    if (bySource.length > 0) {
        parts.push(`Of which (marginal):\n${bySource.map(s => `  ${s}`).join('\n')}`);
    }
    const rate = averageTaxRate(row);
    if (rate !== null) {
        parts.push(`Effective rate: ${formatPercent1(rate)} of taxable income`);
    }
    return parts.join('\n');
}

// Breakdown shown when hovering an RRSP/RRIF Withdrawn cell. The engine
// partitions the total exactly (rrif + voluntary + topUp === total), so the
// sub-lines always add up; only the material ones are listed, as taxBreakdown does.
function withdrawalBreakdown(row: SimulationResult, adj: Adjust): string {
    const lines: string[] = [];
    if (row.rrifMinimumWithdrawal > 1) lines.push(`  Mandatory RRIF minimum: ${formatCurrencyCAD(adj(row.rrifMinimumWithdrawal))}`);
    if (row.voluntaryMeltWithdrawal > 1) lines.push(`  Voluntary meltdown: ${formatCurrencyCAD(adj(row.voluntaryMeltWithdrawal))}`);
    if (row.topUpWithdrawal > 1) lines.push(`  Extra draw to fund spending: ${formatCurrencyCAD(adj(row.topUpWithdrawal))}`);
    const head = 'Gross RRSP/RRIF withdrawn this year (household, before tax).';
    return lines.length > 0 ? `${head}\nMade up of:\n${lines.join('\n')}` : head;
}

function mixTooltip(m: NonRegMix): string {
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return `Mix this year: ${pct(m.capitalGain)} equity · ${pct(m.dividend)} Cdn div · ${pct(m.foreignDividend)} foreign div · ${pct(m.bonds)} bonds · ${pct(m.cash)} cash`;
}

// Small helper: a currency figure with a dashed underline and a hover tooltip,
// matching the existing inline-tooltip treatment used by the Non-Reg / CPP / OAS
// / Pension / Tax cells.
function TipValue({ tip, border, children }: { tip: string; border: string; children: React.ReactNode }) {
    return (
        <HelpTooltip text={tip}>
            <span className={`cursor-help border-b border-dashed ${border}`}>{children}</span>
        </HelpTooltip>
    );
}

// ---------------------------------------------------------------------------
// Column definitions — ONE list, consumed by both <thead> and <tbody>
// ---------------------------------------------------------------------------

/*
 * A column is defined exactly once: its label, tooltip, alignment, group, cell
 * colour and its render function all live in the same object, and the header row
 * and the body rows are both derived from the same filtered array. The previous
 * shape — a header list plus a hand-maintained parallel run of <td>s — could
 * silently drift out of alignment, and with groups switching columns on and off
 * that drift would have been a matter of time.
 *
 * `group: undefined` means "always visible": Year / Age / Sp Age are the frozen
 * row anchors and are never part of a toggleable group. They are also always the
 * FIRST columns in this list, which is what lets the frozen-column logic below
 * stay a simple index comparison no matter which groups are on.
 */
interface ColumnDef {
    key: string;
    label: string;
    tooltip: string;
    align: 'left' | 'right';
    group?: ColumnGroup;
    /*
     * Headers are `whitespace-nowrap` by default, which makes a long label set the
     * column's minimum width all on its own. "Surplus / Shortfall" is the one label
     * long enough for that to matter: at 163px it was wider than any figure it ever
     * shows, and on its own it pushed the default column selection 23px past the
     * scroll box. Letting just this one wrap to two lines when space is tight buys
     * ~70px without shrinking the type or the cell padding, which for this audience
     * is the wrong place to economise.
     */
    wrapHeader?: boolean;
    /** Static classes, or per-row classes when the colour depends on the value. */
    className?: string | ((row: SimulationResult) => string);
    cell: (row: SimulationResult, adj: Adjust) => React.ReactNode;
}

const money = (v: number) => formatCurrencyCAD(v);
const DASH = '—';

function buildColumns(hasSpouse: boolean, showMixDrift: boolean): ColumnDef[] {
    const columns: ColumnDef[] = [
        // --- Always visible: the frozen row anchors -------------------------
        {
            key: 'year', label: 'Year', tooltip: 'Calendar year of the simulation', align: 'left',
            className: 'text-slate-700', cell: row => row.year
        },
        {
            key: 'age', label: 'Age', tooltip: 'Your age at the start of this year', align: 'left',
            className: 'text-slate-700', cell: row => row.age
        },
    ];

    if (hasSpouse) {
        columns.push({
            key: 'spouseAge', label: 'Sp Age', tooltip: "Spouse's age at the start of this year", align: 'left',
            className: 'text-slate-700', cell: row => row.spouseAge ?? '-'
        });
    }

    // --- Balances -----------------------------------------------------------
    columns.push(
        {
            key: 'rrsp', label: 'RRSP', group: 'balances', align: 'right', className: 'text-sky-600',
            tooltip: 'Your RRSP balance after contributions, withdrawals, and growth. Withdrawals are fully taxable.',
            cell: (row, adj) => money(adj(row.accounts.rrsp))
        },
        {
            key: 'tfsa', label: 'TFSA', group: 'balances', align: 'right', className: 'text-emerald-600',
            tooltip: 'Your TFSA balance after contributions, withdrawals, and growth. Withdrawals are tax-free.',
            cell: (row, adj) => money(adj(row.accounts.tfsa))
        },
        {
            key: 'nonReg', label: 'Non-Reg', group: 'balances', align: 'right', className: 'text-amber-600',
            tooltip: 'Your Non-registered balance. Capital gains are calculated against your adjusted cost base (ACB); only 50% of gains are taxable.',
            cell: (row, adj) => showMixDrift && row.nonRegMix && row.accounts.nonRegistered > 1
                ? <TipValue tip={mixTooltip(row.nonRegMix)} border="border-amber-200">{money(adj(row.accounts.nonRegistered))}</TipValue>
                : money(adj(row.accounts.nonRegistered))
        },
    );

    if (hasSpouse) {
        columns.push(
            {
                key: 'spRrsp', label: 'Sp RRSP', group: 'balances', align: 'right', className: 'text-sky-400',
                tooltip: "Spouse's RRSP balance",
                cell: (row, adj) => row.spouseAccounts ? money(adj(row.spouseAccounts.rrsp)) : '-'
            },
            {
                key: 'spTfsa', label: 'Sp TFSA', group: 'balances', align: 'right', className: 'text-emerald-400',
                tooltip: "Spouse's TFSA balance",
                cell: (row, adj) => row.spouseAccounts ? money(adj(row.spouseAccounts.tfsa)) : '-'
            },
            {
                key: 'spNonReg', label: 'Sp Non-Reg', group: 'balances', align: 'right', className: 'text-amber-400',
                tooltip: "Spouse's Non-registered balance",
                cell: (row, adj) => showMixDrift && row.spouseNonRegMix && row.spouseAccounts && row.spouseAccounts.nonRegistered > 1
                    ? <TipValue tip={mixTooltip(row.spouseNonRegMix)} border="border-amber-200">{money(adj(row.spouseAccounts.nonRegistered))}</TipValue>
                    : row.spouseAccounts ? money(adj(row.spouseAccounts.nonRegistered)) : '-'
            },
        );
    }

    columns.push(
        {
            key: 'total', label: 'Total Assets', group: 'balances', align: 'right', className: 'font-medium text-slate-900',
            tooltip: 'Sum of all account balances (yours + spouse if applicable)',
            cell: (row, adj) => money(adj(row.totalAssets))
        },
        {
            key: 'rrspWithdrawn', label: 'RRSP Drawn', group: 'balances', align: 'right',
            className: row => row.totalRRSPWithdrawal > 1 ? 'text-sky-700' : 'text-slate-300',
            tooltip: 'Gross RRSP/RRIF withdrawn this year (household, before tax) — the mandatory RRIF minimum plus any voluntary meltdown plus any extra draw taken to fund spending. Hover a figure for the split.',
            cell: (row, adj) => row.totalRRSPWithdrawal > 1
                ? <TipValue tip={withdrawalBreakdown(row, adj)} border="border-sky-200">{money(adj(row.totalRRSPWithdrawal))}</TipValue>
                : DASH
        },

        // --- Income ---------------------------------------------------------
        {
            key: 'netCPP', label: 'Net CPP', group: 'income', align: 'right', className: 'text-blue-600',
            tooltip: 'Combined Canada Pension Plan benefits (Net of Tax).',
            cell: (row, adj) => hasSpouse && row.netCPPIncome > 1
                ? <TipValue tip={`You: ${money(adj(row.personNetCPP))}\nSpouse: ${money(adj(row.spouseNetCPP))}`} border="border-blue-200">{money(adj(row.netCPPIncome))}</TipValue>
                : money(adj(row.netCPPIncome))
        },
        {
            key: 'netOAS', label: 'Net OAS', group: 'income', align: 'right', className: 'text-blue-600',
            tooltip: 'Combined Old Age Security benefits (Net of Tax).',
            cell: (row, adj) => hasSpouse && row.netOASIncome > 1
                ? <TipValue tip={`You: ${money(adj(row.personNetOAS))}\nSpouse: ${money(adj(row.spouseNetOAS))}`} border="border-blue-200">{money(adj(row.netOASIncome))}</TipValue>
                : money(adj(row.netOASIncome))
        },
        {
            key: 'netPension', label: 'Net Pension', group: 'income', align: 'right', className: 'text-blue-600',
            tooltip: 'Combined workplace defined-benefit pension income, including any bridge benefit (Net of Tax).',
            cell: (row, adj) => hasSpouse && row.netPensionIncome > 1
                ? <TipValue tip={`You: ${money(adj(row.personNetPension))}\nSpouse: ${money(adj(row.spouseNetPension))}`} border="border-blue-200">{money(adj(row.netPensionIncome))}</TipValue>
                : money(adj(row.netPensionIncome))
        },
        {
            key: 'netIncome', label: 'Total Spend', group: 'income', align: 'right', className: 'text-green-600',
            tooltip: "What the household actually spent this year. Equals your spending target unless accounts ran short.",
            cell: (row, adj) => money(adj(row.netIncome))
        },
        {
            key: 'surplusShortfall', label: 'Surplus / Shortfall', group: 'income', align: 'right', wrapHeader: true,
            tooltip: 'Green (+): income exceeded the spending target; the excess was reinvested into TFSA/RRSP/Non-Reg. Red (−): spending that could NOT be funded after draining all accounts.',
            className: row => row.shortfall > 1 ? 'font-bold text-red-600' : reinvestedTotal(row) > 1 ? 'text-emerald-600' : 'text-slate-300',
            cell: (row, adj) => {
                if (row.shortfall > 1) return `−${money(adj(row.shortfall))}`;
                const reinvested = reinvestedTotal(row);
                return reinvested > 1 ? `+${money(adj(reinvested))}` : DASH;
            }
        },

        // --- Tax ------------------------------------------------------------
        {
            key: 'taxableIncome', label: 'Taxable Income', group: 'tax', align: 'right', className: 'text-slate-700',
            tooltip: 'Household taxable income for the year, before tax: employment, CPP, OAS, pension and RRSP/RRIF withdrawals plus the taxable portion of investment income (grossed-up dividends, the taxable half of realized capital gains), less deductions. This is the figure the tax brackets are applied to.',
            cell: (row, adj) => money(adj(row.grossIncome))
        },
        {
            key: 'taxPaid', label: 'Tax Paid', group: 'tax', align: 'right', className: 'text-red-500',
            tooltip: 'Combined household taxes = Federal + Provincial + OAS Clawback',
            cell: (row, adj) => row.taxPaid > 1
                ? <TipValue tip={taxBreakdown(row, hasSpouse, adj)} border="border-red-200">{money(adj(row.taxPaid))}</TipValue>
                : money(adj(row.taxPaid))
        },
        {
            key: 'oasClawback', label: 'OAS Clawback', group: 'tax', align: 'right',
            // Deliberately a lighter red than Tax Paid: this is a slice OF that
            // number, not another charge sitting beside it.
            className: row => row.oasClawbackPaid > 1 ? 'text-red-400' : 'text-slate-300',
            tooltip: 'Part of Tax Paid, not a charge on top of it. This is how much of that same tax bill is OAS being clawed back (the OAS recovery tax). Adding this column to Tax Paid would count it twice.',
            cell: (row, adj) => row.oasClawbackPaid > 1 ? money(adj(row.oasClawbackPaid)) : DASH
        },
        {
            key: 'avgTaxRate', label: 'Avg Tax Rate', group: 'tax', align: 'right',
            className: row => averageTaxRate(row) !== null ? 'text-red-500' : 'text-slate-300',
            tooltip: 'Tax Paid divided by Taxable Income — the average rate across all of this year\'s income, not the top bracket you touch. The same figure appears as "Effective rate" in the Tax Paid tooltip. Unaffected by the today\'s-dollars toggle.',
            cell: row => {
                const rate = averageTaxRate(row);
                return rate === null ? DASH : formatPercent1(rate);
            }
        },
        {
            key: 'estateTax', label: 'Estate Tax', group: 'tax', align: 'right',
            className: row => (row.totalTerminalTax ?? 0) > 1 ? 'font-bold text-red-600' : 'text-slate-300',
            tooltip: 'Terminal tax at death: deemed disposition of RRSP/RRIF plus unrealized capital gains. Already deducted from the account balances shown on this row.',
            cell: (row, adj) => (row.totalTerminalTax ?? 0) > 1 ? money(adj(row.totalTerminalTax!)) : DASH
        },
    );

    return columns;
}

// ---------------------------------------------------------------------------
// Frozen columns
// ---------------------------------------------------------------------------

/*
 * Frozen leading columns (Year / Age / Sp Age).
 *
 * The sticky `left` offsets have to line the columns up edge to edge, so the
 * widths they are derived from must be exact. Auto table layout treats a
 * specified `width` as a suggestion — spare space gets redistributed — so we pin
 * each frozen column with `min-w-*` instead, which the layout algorithm honours
 * as a hard floor on the column's minimum width.
 *
 * That is enough, because the two regimes are complementary:
 *   - Table wider than its container (the only time you can scroll sideways, and
 *     therefore the only time these offsets are used): every column is laid out
 *     at its minimum width, which for these three is exactly the pinned value,
 *     so 0 / 72 / 136 are correct to the pixel.
 *   - Table fits its container: auto layout hands the spare space around and the
 *     columns come out wider than pinned — but there is no horizontal scroll, so
 *     sticky never engages and the stale offsets are never applied.
 *
 * The pins must be >= the column's natural min-content width or the column comes
 * out wider than its pin and the next one overlaps it. Measured in-browser at
 * 16px Inter incl. the `px-3` padding: Year 65px (driven by "2026"), Age 55px,
 * Sp Age 80px — pinned a shade above each for headroom against font variation,
 * which costs the table only ~16px of extra width.
 *
 * Column groups do not disturb any of this: the three anchors are outside every
 * group, so they are always present and always the leading columns whatever is
 * toggled on.
 */
const FROZEN_WIDTH = ['min-w-[72px]', 'min-w-[64px]', 'min-w-[88px]'];
const FROZEN_LEFT = ['left-0', 'left-[72px]', 'left-[136px]'];
// Hairline rule marking where the frozen region ends, drawn as a shadow so it
// survives the table's collapsed borders and sits above the scrolling cells.
const FROZEN_EDGE = 'shadow-[1px_0_0_0_rgb(226_232_240)]';

function frozenClasses(i: number, last: boolean, z: string) {
    return `sticky ${FROZEN_LEFT[i]} ${FROZEN_WIDTH[i]} ${z} ${last ? FROZEN_EDGE : ''}`;
}

function HeaderCell({ label, tooltip, align, sticky, wrap = false }: { label: string; tooltip: string; align: string; sticky: string; wrap?: boolean }) {
    return (
        <th
            // `sticky top-0` lives on the cells rather than on <thead>/<tr>: cell-level
            // sticky has the broader browser support. The opaque `bg-slate-50` has to
            // live here too — it used to be on <thead>, but body rows scroll *under*
            // the header now and a transparent header cell would show them through.
            className={`sticky top-0 bg-slate-50 px-3 py-2 font-semibold text-slate-600 cursor-help ${wrap ? '' : 'whitespace-nowrap'} ${align === 'right' ? 'text-right' : 'text-left'} ${sticky}`}
            title={tooltip}
        >
            <span className="border-b border-dashed border-slate-400">{label}</span>
        </th>
    );
}

function GroupToggle({ label, hint, active, onToggle }: { label: string; hint: string; active: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={active}
            title={hint}
            // Deliberately large (px-4 py-2, 16px type, a real 20px checkbox): the
            // readers of this table should not have to hunt for a tiny chip.
            className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-semibold transition-colors ${
                active
                    ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700 hover:border-brand-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
            }`}
        >
            <span
                aria-hidden="true"
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 ${active ? 'border-white bg-white/25' : 'border-slate-300 bg-white'}`}
            >
                {active && (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5l4 4 8-9" />
                    </svg>
                )}
            </span>
            {label}
        </button>
    );
}

interface YearlyBreakdownTableProps {
    data: SimulationResult[];
    hasSpouse?: boolean;
    // When annual rebalancing is off, non-reg cells show the drifted composition on hover
    showMixDrift?: boolean;
    // Today's dollars: divide every currency figure by that row's inflationFactor,
    // matching computeSummaryMetrics and the charts. Ages and rates are untouched.
    inflationAdjusted?: boolean;
    // When provided, rows become clickable/keyboard-operable and open the Year Audit drawer.
    onSelectYear?: (year: number) => void;
}

export const YearlyBreakdownTable = React.memo(function YearlyBreakdownTable({ data, hasSpouse = false, showMixDrift = false, inflationAdjusted = false, onSelectYear }: YearlyBreakdownTableProps) {
    const [groups, setGroups] = usePersistentState<ColumnGroup[]>(COLUMN_GROUPS_STORAGE_KEY, DEFAULT_COLUMN_GROUPS, sanitizeColumnGroups);

    // usePersistentState's setter takes a VALUE, not an updater, so two toggles
    // dispatched in the same tick would both read the same pre-click `groups` and
    // the first would be lost. Mirroring the latest value in a ref keeps each
    // toggle building on the one before it without reaching into the hook. The
    // ref is written in an effect (never during render); toggleGroup writes it
    // eagerly as well, which is what makes a same-tick pair compose.
    const groupsRef = useRef(groups);
    useEffect(() => { groupsRef.current = groups; }, [groups]);

    const toggleGroup = useCallback((id: ColumnGroup) => {
        const cur = groupsRef.current;
        const next = cur.includes(id) ? cur.filter(g => g !== id) : [...cur, id];
        groupsRef.current = next;
        setGroups(next);
    }, [setGroups]);

    // Rebuilt only when the shape of the table changes — not on every render, and
    // notably not when the inflation toggle flips (the adjustment is applied per
    // row at render time, so the definitions stay independent of it).
    const allColumns = useMemo(() => buildColumns(hasSpouse, showMixDrift), [hasSpouse, showMixDrift]);
    const columns = useMemo(
        () => allColumns.filter(c => !c.group || groups.includes(c.group)),
        [allColumns, groups]
    );

    // Year + Age, and Sp Age when there is a spouse. These are never in a group,
    // so this count is independent of which groups are active.
    const frozenCount = hasSpouse ? 3 : 2;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Year-by-Year Breakdown</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Hover over column headers for calculation details.
                        {onSelectYear && ' Click a year for a full breakdown.'}
                    </p>
                </div>
                <div role="group" aria-label="Column groups" className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-600 mr-1">Columns:</span>
                    {COLUMN_GROUPS.map(g => (
                        <GroupToggle
                            key={g.id}
                            label={g.label}
                            hint={g.hint}
                            active={groups.includes(g.id)}
                            onToggle={() => toggleGroup(g.id)}
                        />
                    ))}
                </div>
            </div>
            {/*
              * The scroll box is deliberately bounded in height. A plain
              * `overflow-x-auto` div is already a scroll container on BOTH axes (per
              * spec, once one axis is not `visible` the other computes to `auto`), so
              * `position: sticky; top: 0` inside it resolves against this box, not the
              * viewport — and with no vertical scroll of its own the header could never
              * stick. Giving the box a max-height makes it genuinely scroll vertically,
              * which makes the sticky header work, and as a bonus keeps us clear of the
              * page's two other sticky layers (app header at top-0, SummaryHeader at
              * top-16): in here the header just sticks at top-0 with no offset maths.
              */}
            <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                        <tr>
                            {columns.map((col, i) => (
                                <HeaderCell
                                    key={col.key}
                                    label={col.label}
                                    tooltip={col.tooltip}
                                    align={col.align}
                                    wrap={col.wrapHeader}
                                    // Frozen headers are sticky on both axes and must sit above
                                    // both the scrolling headers (z-20) and the frozen body
                                    // cells (z-10) they cross.
                                    sticky={i < frozenCount ? frozenClasses(i, i === frozenCount - 1, 'z-30') : 'z-20'}
                                />
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.map((row, idx) => {
                            const adj = makeAdjust(row, inflationAdjusted);
                            const clickable = !!onSelectYear;
                            // Zebra striping used to be `bg-slate-50/50`, which is
                            // semi-transparent — fine on a <tr>, useless on a sticky <td>
                            // that has to hide the cells scrolling beneath it. The stripe
                            // is now the opaque `bg-slate-50` (a touch stronger, which
                            // suits the audience) so the frozen cells can repeat it exactly.
                            const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                            // Cell backgrounds paint over the row background, so the frozen
                            // cells also have to reproduce the row's hover state themselves —
                            // hence `group` on the <tr> and `group-hover:` here.
                            const frozenBg = `${rowBg} ${clickable ? 'group-hover:bg-slate-100' : ''}`;
                            return (
                            <tr
                                key={row.year}
                                className={`group ${rowBg} ${clickable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
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
                                {columns.map((col, i) => {
                                    const frozen = i < frozenCount;
                                    const colClass = typeof col.className === 'function' ? col.className(row) : (col.className ?? '');
                                    return (
                                        <td
                                            key={col.key}
                                            className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : ''} ${colClass} ${frozen ? `${frozenClasses(i, i === frozenCount - 1, 'z-10')} ${frozenBg}` : ''}`}
                                        >
                                            {col.cell(row, adj)}
                                        </td>
                                    );
                                })}
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
