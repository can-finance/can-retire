import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { usePersistentState } from '../../hooks/usePersistentState';
import { FinancialInput } from '../inputs/FinancialInput';
import { SectionCard } from '../ui/SectionCard';
import { Toggle } from '../ui/Toggle';
import { formatCurrencyCAD, formatCurrencyShort } from '../../utils/formatters';
import {
    calculateDetailedCPP,
    calculateAtAllStartAges,
    generateEarningsFromSimple,
    parseStatementEarnings,
    maxAnnualBenefitAt65,
    ympeFor,
    LATEST_DATA_YEAR,
} from '../../engine/cppDetailed';
import { sanitizeSimulationInputs, INITIAL_INPUTS } from '../../utils/inputSanitizer';
import { SIM_KEY } from '../../utils/onboarding';
import type { SimulationInputs } from '../../engine/types';
import { CPP_CALCULATOR_FAQ_ITEMS } from './cpp-calculator-faq';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type InputMode = 'simple' | 'blocks' | 'exact';

interface CareerBlock {
    id: string;
    fromYear: number;
    toYear: number;
    salary: number; // nominal for past years, today's dollars for future years
}

interface CppCalcState {
    currentAge: number;
    startAge: number;
    mode: InputMode;
    simple: { workStartAge: number; workEndAge: number; avgSalary: number };
    blocks: CareerBlock[];
    exactEarnings: Record<number, number>;
    useChildRearing: boolean;
    childBirthYears: string; // raw text, e.g. "1998, 2001"
}

const DEFAULT_STATE: CppCalcState = {
    currentAge: 48,
    startAge: 65,
    mode: 'simple',
    simple: { workStartAge: 22, workEndAge: 60, avgSalary: 85000 },
    blocks: [],
    exactEarnings: {},
    useChildRearing: false,
    childBirthYears: '',
};

const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function sanitizeCppCalcState(raw: unknown): CppCalcState | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const simple = (typeof r.simple === 'object' && r.simple !== null ? r.simple : {}) as Record<string, unknown>;

    const blocks: CareerBlock[] = Array.isArray(r.blocks)
        ? r.blocks
            .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
            .map(b => ({
                id: typeof b.id === 'string' ? b.id : crypto.randomUUID(),
                fromYear: num(b.fromYear, LATEST_DATA_YEAR),
                toYear: num(b.toYear, LATEST_DATA_YEAR),
                salary: num(b.salary, 0),
            }))
        : [];

    const exactEarnings: Record<number, number> = {};
    if (typeof r.exactEarnings === 'object' && r.exactEarnings !== null) {
        for (const [k, v] of Object.entries(r.exactEarnings)) {
            const year = Number(k);
            if (Number.isInteger(year) && typeof v === 'number' && Number.isFinite(v)) {
                exactEarnings[year] = v;
            }
        }
    }

    return {
        currentAge: num(r.currentAge, DEFAULT_STATE.currentAge),
        startAge: num(r.startAge, DEFAULT_STATE.startAge),
        mode: r.mode === 'blocks' || r.mode === 'exact' ? r.mode : 'simple',
        simple: {
            workStartAge: num(simple.workStartAge, DEFAULT_STATE.simple.workStartAge),
            workEndAge: num(simple.workEndAge, DEFAULT_STATE.simple.workEndAge),
            avgSalary: num(simple.avgSalary, DEFAULT_STATE.simple.avgSalary),
        },
        blocks,
        exactEarnings,
        useChildRearing: r.useChildRearing === true,
        childBirthYears: typeof r.childBirthYears === 'string' ? r.childBirthYears : '',
    };
}

// ---------------------------------------------------------------------------
// Earnings assembly per mode
// ---------------------------------------------------------------------------

function earningsFromBlocks(blocks: CareerBlock[]): Record<number, number> {
    const result: Record<number, number> = {};
    for (const b of blocks) {
        const from = Math.min(b.fromYear, b.toYear);
        const to = Math.max(b.fromYear, b.toYear);
        for (let y = from; y <= to; y++) result[y] = b.salary;
    }
    return result;
}

function parseChildBirthYears(text: string): number[] {
    return text
        .split(/[,;\s]+/)
        .map(s => Number(s.trim()))
        .filter(y => Number.isInteger(y) && y >= 1940 && y <= LATEST_DATA_YEAR + 10);
}

/** Each child contributes the 7 calendar years from birth until they turn 7. */
function childRearingYearsFromBirths(births: number[]): number[] {
    const years = new Set<number>();
    for (const b of births) {
        for (let y = b; y <= b + 6; y++) years.add(y);
    }
    return [...years];
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function ModeTab({ active, onClick, title, subtitle }: {
    active: boolean; onClick: () => void; title: string; subtitle: string;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 px-3 py-2 rounded-lg text-left transition-all ${active
                ? 'bg-white shadow-sm'
                : 'hover:bg-white/50'
                }`}
        >
            <span className={`block text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>{title}</span>
            <span className={`block text-xs ${active ? 'text-slate-500' : 'text-slate-400'}`}>{subtitle}</span>
        </button>
    );
}

/** Lightweight money input for the year-by-year grid (FinancialInput is too heavy × 50 rows). */
function YearEarningsInput({ year, age, value, onChange }: {
    year: number; age: number; value: number | undefined; onChange: (val: number | undefined) => void;
}) {
    const isFuture = year > LATEST_DATA_YEAR;
    return (
        <div className="flex flex-col gap-0.5">
            <label className={`text-xs font-medium ${isFuture ? 'text-indigo-400' : 'text-slate-500'}`}>
                {year} <span className="opacity-70">(age {age})</span>
            </label>
            <div className="relative flex items-center">
                <span className="absolute left-2 text-xs text-slate-400">$</span>
                <input
                    type="text"
                    inputMode="numeric"
                    value={value != null ? value.toLocaleString('en-US') : ''}
                    placeholder="0"
                    onChange={(e) => {
                        const raw = e.target.value.replace(/[,$\s]/g, '');
                        if (raw === '') { onChange(undefined); return; }
                        const n = Number(raw);
                        if (Number.isFinite(n) && n >= 0) onChange(n);
                    }}
                    className="w-full rounded-md border border-slate-200 bg-white pl-5 pr-1.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:border-brand-500 focus:ring-brand-500"
                />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CppCalculator() {
    const [state, setState] = usePersistentState<CppCalcState>('cpp_calculator_v1', DEFAULT_STATE, sanitizeCppCalcState);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [appliedTo, setAppliedTo] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);

    const copyShareLink = async () => {
        // The CPP Calculator is a real page at /cpp-calculator/; always share
        // that canonical path (the dashboard links here, it's not a hash route).
        const url = `${window.location.origin}/cpp-calculator/`;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            // Clipboard API can be unavailable (insecure context, unfocused
            // document) — fall back to the legacy execCommand path.
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2500);
    };

    const birthYear = LATEST_DATA_YEAR - state.currentAge;
    const startAge = Math.min(Math.max(state.startAge, 60), 70);

    const update = (patch: Partial<CppCalcState>) => { setAppliedTo(null); setState({ ...state, ...patch }); };

    // --- earnings table for the active mode ---
    const earningsByYear = useMemo(() => {
        if (state.mode === 'simple') {
            return generateEarningsFromSimple({
                birthYear,
                workStartAge: state.simple.workStartAge,
                workEndAge: state.simple.workEndAge,
                avgSalaryTodayDollars: state.simple.avgSalary,
            });
        }
        if (state.mode === 'blocks') return earningsFromBlocks(state.blocks);
        return state.exactEarnings;
    }, [state.mode, state.simple, state.blocks, state.exactEarnings, birthYear]);

    const childRearingYears = useMemo(
        () => state.useChildRearing ? childRearingYearsFromBirths(parseChildBirthYears(state.childBirthYears)) : [],
        [state.useChildRearing, state.childBirthYears]
    );

    // --- results ---
    const result = useMemo(
        () => calculateDetailedCPP({ birthYear, startAge, earningsByYear, childRearingYears }),
        [birthYear, startAge, earningsByYear, childRearingYears]
    );

    const allAges = useMemo(
        () => calculateAtAllStartAges({ birthYear, earningsByYear, childRearingYears }),
        [birthYear, earningsByYear, childRearingYears]
    );

    // Total received by 85 for each start age (today's dollars, no discounting)
    const bestByEightyFive = useMemo(() => {
        let best = allAges[0];
        let bestTotal = -1;
        for (const a of allAges) {
            const total = a.annualBenefit * Math.max(0, 85 - a.startAge);
            if (total > bestTotal) { bestTotal = total; best = a; }
        }
        return best;
    }, [allAges]);

    // --- exact-mode helpers ---
    const exactYearRange = useMemo(() => {
        const from = Math.max(birthYear + 18, 1966);
        const to = birthYear + 69; // earnings up to the year before the latest possible start (70)
        const years: number[] = [];
        for (let y = from; y <= to; y++) years.push(y);
        return years;
    }, [birthYear]);

    const prefillExact = (source: Record<number, number>) => {
        const rounded: Record<number, number> = {};
        for (const [y, v] of Object.entries(source)) rounded[Number(y)] = Math.round(v);
        update({ exactEarnings: rounded });
    };

    const handlePasteImport = () => {
        const parsed = parseStatementEarnings(pasteText);
        if (Object.keys(parsed).length > 0) {
            update({ exactEarnings: { ...state.exactEarnings, ...parsed } });
            setPasteText('');
            setPasteOpen(false);
        }
    };

    // --- apply to plan ---
    const savedPlan = useMemo((): SimulationInputs | null => {
        try {
            const raw = window.localStorage.getItem(SIM_KEY);
            if (!raw) return null;
            return sanitizeSimulationInputs(JSON.parse(raw));
        } catch {
            return null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appliedTo]); // re-read after applying

    const applyToPlan = (target: 'person' | 'spouse') => {
        const plan = savedPlan ?? INITIAL_INPUTS;
        const annual = Math.round(result.annualBenefit);
        const updated: SimulationInputs = { ...plan };
        if (target === 'person') {
            updated.person = { ...plan.person, cppAnnualOverride: annual, cppStartAge: startAge };
        } else {
            if (!plan.spouse) return;
            updated.spouse = { ...plan.spouse, cppAnnualOverride: annual, cppStartAge: startAge };
        }
        window.localStorage.setItem(SIM_KEY, JSON.stringify(updated));
        setAppliedTo(target === 'person' ? 'You' : 'Spouse');
    };

    const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-1 focus:border-brand-500 focus:ring-brand-500 sm:text-sm";

    // Derived figures for the "How this was calculated" walkthrough
    const firstContribYear = Math.max(birthYear + 18, 1966);
    const lastContribYear = birthYear + Math.min(startAge, 65) - 1;
    const countedYears = Math.max(0, result.contributoryYears - result.childRearingDropped.length - result.generalDropoutYears);
    const avgYmpe5 = result.maxAnnualAt65 / 0.25; // five-year average YMPE
    const baseAt65 = result.averageRatio * result.maxAnnualAt65;
    const benefitAt60 = allAges.find(a => a.startAge === 60);
    const benefitAt70 = allAges.find(a => a.startAge === 70);

    // Years with actual earnings feeding the calculation (incl. post-65 substitution years)
    let nonZeroEarningYears = 0;
    for (let y = firstContribYear; y <= birthYear + startAge - 1; y++) {
        if ((earningsByYear[y] ?? 0) > 0) nonZeroEarningYears++;
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="text-center space-y-2 py-2">
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">CPP Retirement Pension Calculator</h1>
                <p className="text-sm text-slate-500 max-w-2xl mx-auto">
                    Estimate your Canada Pension Plan retirement benefit using the real Service Canada method —
                    year-by-year earnings ratios, the general drop-out, and the child-rearing provision.
                    Start simple and add detail as you have it.
                </p>
                <button
                    onClick={copyShareLink}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${linkCopied
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300'
                        }`}
                >
                    {linkCopied ? (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Link copied!
                        </>
                    ) : (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                            </svg>
                            Copy shareable link
                        </>
                    )}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* ------------------------------------------------ Inputs */}
                <div className="lg:col-span-5 space-y-6">
                    <SectionCard accent="sky">
                        <h2 className="text-xl font-bold text-slate-900 mb-1">Earnings History</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            The more detail you provide, the more accurate the estimate. All three levels use the same
                            calculation underneath — each mode uses only its own entries. Your start age defaults to 65;
                            change it by clicking a bar on the chart.
                        </p>

                        <FinancialInput
                            label="Current Age" prefix="" value={state.currentAge}
                            min={18} max={70}
                            className="mb-4 max-w-[180px]"
                            tooltip="Anchors your earnings history to calendar years — the contributory period runs from the year you turned 18."
                            onChange={(e) => update({ currentAge: Number(e.target.value) })}
                        />

                        <div className="flex items-stretch gap-1 bg-slate-100/70 p-1 rounded-xl mb-5">
                            <ModeTab active={state.mode === 'simple'} onClick={() => update({ mode: 'simple' })}
                                title="Simple" subtitle="Average salary" />
                            <ModeTab active={state.mode === 'blocks'} onClick={() => update({ mode: 'blocks' })}
                                title="Career Blocks" subtitle="Salary by period" />
                            <ModeTab active={state.mode === 'exact'} onClick={() => update({ mode: 'exact' })}
                                title="Year by Year" subtitle="Exact earnings" />
                        </div>

                        {/* ---- Simple ---- */}
                        {state.mode === 'simple' && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <FinancialInput
                                        label="Starting Working Age" prefix="" value={state.simple.workStartAge}
                                        min={18} max={70}
                                        onChange={(e) => update({ simple: { ...state.simple, workStartAge: Number(e.target.value) } })}
                                    />
                                    <FinancialInput
                                        label="Ending Working Age" prefix="" value={state.simple.workEndAge}
                                        min={18} max={70}
                                        tooltip="Last age with employment earnings. Retiring years before starting CPP adds zero-earning years that can drag your average down."
                                        onChange={(e) => update({ simple: { ...state.simple, workEndAge: Number(e.target.value) } })}
                                    />
                                </div>
                                <FinancialInput
                                    label="Average Salary (today's dollars)"
                                    value={state.simple.avgSalary}
                                    tooltip={`Your typical career salary expressed in today's dollars. Anything at or above the ${LATEST_DATA_YEAR} earnings ceiling of ${formatCurrencyCAD(ympeFor(LATEST_DATA_YEAR))} counts as maximum pensionable earnings.`}
                                    onChange={(e) => update({ simple: { ...state.simple, avgSalary: Number(e.target.value) } })}
                                />
                            </div>
                        )}

                        {/* ---- Career blocks ---- */}
                        {state.mode === 'blocks' && (
                            <div className="space-y-3">
                                <p className="text-sm text-slate-500">
                                    Enter your career as periods with a typical salary — the amount you actually earned in those years
                                    (as it appeared on your T4, not adjusted for inflation). Leave gaps for years with no earnings.
                                </p>
                                {state.blocks.map((block) => (
                                    <div key={block.id} className="flex items-end gap-2 bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                        <div className="flex flex-col gap-1 w-20">
                                            <label className="text-xs font-medium text-slate-500">From year</label>
                                            <input type="text" inputMode="numeric" className={`${inputClass} !px-2 !py-1.5 !text-xs`}
                                                value={block.fromYear}
                                                onChange={(e) => {
                                                    const v = Number(e.target.value.replace(/\D/g, ''));
                                                    update({ blocks: state.blocks.map(b => b.id === block.id ? { ...b, fromYear: v } : b) });
                                                }} />
                                        </div>
                                        <div className="flex flex-col gap-1 w-20">
                                            <label className="text-xs font-medium text-slate-500">To year</label>
                                            <input type="text" inputMode="numeric" className={`${inputClass} !px-2 !py-1.5 !text-xs`}
                                                value={block.toYear}
                                                onChange={(e) => {
                                                    const v = Number(e.target.value.replace(/\D/g, ''));
                                                    update({ blocks: state.blocks.map(b => b.id === block.id ? { ...b, toYear: v } : b) });
                                                }} />
                                        </div>
                                        <div className="flex flex-col gap-1 flex-1">
                                            <label className="text-xs font-medium text-slate-500">Annual salary</label>
                                            <div className="relative flex items-center">
                                                <span className="absolute left-2 text-xs text-slate-400">$</span>
                                                <input type="text" inputMode="numeric" className={`${inputClass} !pl-5 !pr-2 !py-1.5 !text-xs`}
                                                    value={block.salary.toLocaleString('en-US')}
                                                    onChange={(e) => {
                                                        const v = Number(e.target.value.replace(/[,$\s]/g, ''));
                                                        if (!Number.isFinite(v) || v < 0) return;
                                                        update({ blocks: state.blocks.map(b => b.id === block.id ? { ...b, salary: v } : b) });
                                                    }} />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => update({ blocks: state.blocks.filter(b => b.id !== block.id) })}
                                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                                            title="Remove period"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                                <button
                                    onClick={() => {
                                        const lastEnd = state.blocks.length > 0
                                            ? Math.max(...state.blocks.map(b => b.toYear)) + 1
                                            : Math.max(birthYear + 18, 1966);
                                        update({
                                            blocks: [...state.blocks, {
                                                id: crypto.randomUUID(),
                                                fromYear: lastEnd,
                                                toYear: Math.min(lastEnd + 9, birthYear + 69),
                                                salary: 50000,
                                            }]
                                        });
                                    }}
                                    className="w-full rounded-lg p-2.5 border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition-all text-sm font-medium text-slate-400 hover:text-brand-500"
                                >
                                    + Add career period
                                </button>
                            </div>
                        )}

                        {/* ---- Year by year ---- */}
                        {state.mode === 'exact' && (
                            <div className="space-y-4">
                                <p className="text-sm text-slate-500">
                                    Enter your pensionable earnings for each year — past years in the dollars you actually earned
                                    (your <em>Statement of Contributions</em> from Service Canada lists these exactly),{' '}
                                    <span className="text-indigo-500 font-medium">future years</span> in today's dollars.
                                </p>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => prefillExact(generateEarningsFromSimple({
                                            birthYear,
                                            workStartAge: state.simple.workStartAge,
                                            workEndAge: state.simple.workEndAge,
                                            avgSalaryTodayDollars: state.simple.avgSalary,
                                        }))}
                                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                    >
                                        Prefill from Simple
                                    </button>
                                    {state.blocks.length > 0 && (
                                        <button
                                            onClick={() => prefillExact(earningsFromBlocks(state.blocks))}
                                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                        >
                                            Prefill from Career Blocks
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setPasteOpen(!pasteOpen)}
                                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                                    >
                                        Paste from Statement of Contributions
                                    </button>
                                    <button
                                        onClick={() => update({ exactEarnings: {} })}
                                        className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                                    >
                                        Clear all
                                    </button>
                                </div>

                                {pasteOpen && (
                                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-lg p-3 space-y-2">
                                        <p className="text-sm text-indigo-800">
                                            Sign in to <strong>My Service Canada Account</strong>, open your CPP Statement of
                                            Contributions, and copy the whole earnings table — headers, contribution columns,
                                            and "M" (maximum) markers are handled automatically. Simple lines like
                                            "<code className="bg-white/70 px-1 rounded">2004&nbsp;&nbsp;$39,000</code>" work too.
                                        </p>
                                        <textarea
                                            value={pasteText}
                                            onChange={(e) => setPasteText(e.target.value)}
                                            rows={5}
                                            placeholder={"2003  $38,200\n2004  $39,000\n2005  M"}
                                            className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-1 focus:border-indigo-400 focus:ring-indigo-400"
                                        />
                                        <button
                                            onClick={handlePasteImport}
                                            disabled={Object.keys(parseStatementEarnings(pasteText)).length === 0}
                                            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        >
                                            Import {Object.keys(parseStatementEarnings(pasteText)).length || ''} year{Object.keys(parseStatementEarnings(pasteText)).length === 1 ? '' : 's'}
                                        </button>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 max-h-[420px] overflow-y-auto pr-1">
                                    {exactYearRange.map(year => (
                                        <YearEarningsInput
                                            key={year}
                                            year={year}
                                            age={year - birthYear}
                                            value={state.exactEarnings[year]}
                                            onChange={(val) => {
                                                const next = { ...state.exactEarnings };
                                                if (val == null) delete next[year];
                                                else next[year] = val;
                                                update({ exactEarnings: next });
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </SectionCard>

                    {/* Child-rearing provision */}
                    <SectionCard accent="rose">
                        <h2 className="text-xl font-bold text-slate-900">Child-Rearing Provision</h2>
                        <Toggle
                            checked={state.useChildRearing}
                            onChange={(val) => update({ useChildRearing: val })}
                            label="I was the primary caregiver of young children"
                            tooltip={'ON = years when you were the primary caregiver of a child under 7 and earned less than your career average are excluded from the calculation instead of dragging your average down.\nOFF = all years, including low-earning caregiving years, count normally toward your average.'}
                        />
                        {state.useChildRearing && (
                            <div className="mt-2 space-y-2">
                                <label className="text-sm font-semibold text-slate-700">Children's birth years</label>
                                <input
                                    type="text"
                                    value={state.childBirthYears}
                                    onChange={(e) => update({ childBirthYears: e.target.value })}
                                    placeholder="e.g. 1998, 2001"
                                    className={inputClass}
                                />
                                <p className="text-sm text-slate-400">
                                    Each child protects the 7 years from birth. Only years where your earnings were below
                                    your career average are excluded{result.childRearingDropped.length > 0 && (
                                        <> — currently excluding <strong>{result.childRearingDropped.length}</strong> year{result.childRearingDropped.length === 1 ? '' : 's'} ({result.childRearingDropped.join(', ')})</>
                                    )}.
                                </p>
                            </div>
                        )}
                    </SectionCard>
                </div>

                {/* ------------------------------------------------ Results */}
                <div className="lg:col-span-7 space-y-6">
                    {/* Hero result */}
                    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-6 shadow-sm text-white">
                        <p className="text-sm font-medium text-slate-300">Estimated CPP starting at age {startAge}</p>
                        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mt-1">
                            <span className="text-4xl font-extrabold tracking-tight">
                                {formatCurrencyCAD(result.monthlyBenefit)}<span className="text-xl font-semibold text-slate-300">/month</span>
                            </span>
                            <span className="text-lg font-semibold text-slate-300">
                                {formatCurrencyCAD(result.annualBenefit)}/year
                            </span>
                        </div>
                        <p className="text-sm text-slate-400 mt-2">
                            In today's dollars. You qualify for <strong className="text-slate-200">{(result.percentOfMax * 100).toFixed(0)}%</strong> of
                            the maximum pension{result.adjustmentFactor !== 1 && (
                                <>, {result.adjustmentFactor < 1 ? 'reduced' : 'increased'} by{' '}
                                    <strong className="text-slate-200">{Math.abs((result.adjustmentFactor - 1) * 100).toFixed(1)}%</strong> for
                                    starting {result.adjustmentFactor < 1 ? 'before' : 'after'} 65</>
                            )}. Maximum at 65 is {formatCurrencyCAD(maxAnnualBenefitAt65() / 12)}/month.
                        </p>
                    </div>

                    {/* Start age comparison */}
                    <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                        <h3 className="text-xl font-bold text-slate-900">Benefit by Start Age</h3>
                        <p className="text-sm text-slate-500 mb-4">
                            Click a bar to change your start age. Ignoring investment returns and taxes, total payments to age 85
                            are highest if you start at <strong>{bestByEightyFive.startAge}</strong>.
                        </p>
                        <div className="h-[280px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={allAges} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="startAge" stroke="#64748b" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <YAxis tickFormatter={formatCurrencyShort} stroke="#64748b" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        cursor={{ fill: '#f1f5f9' }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0].payload as { startAge: number; annualBenefit: number; monthlyBenefit: number };
                                            return (
                                                <div className="bg-white rounded-lg shadow-lg border border-slate-100 px-3 py-2 text-xs">
                                                    <p className="font-bold text-slate-900">Start at {d.startAge}</p>
                                                    <p className="text-slate-600">{formatCurrencyCAD(d.monthlyBenefit)}/month</p>
                                                    <p className="text-slate-600">{formatCurrencyCAD(d.annualBenefit)}/year</p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Bar
                                        dataKey="annualBenefit"
                                        radius={[6, 6, 0, 0]}
                                        onClick={(data) => {
                                            const d = data as unknown as { startAge?: number };
                                            if (d?.startAge) update({ startAge: d.startAge });
                                        }}
                                        cursor="pointer"
                                    >
                                        {allAges.map(a => (
                                            <Cell key={a.startAge} fill={a.startAge === startAge ? '#0ea5e9' : '#cbd5e1'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Calculation details */}
                    <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">How This Was Calculated</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-center">
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-2xl font-bold text-slate-900">{result.contributoryYears}</p>
                                <p className="text-xs text-slate-500 font-medium">Contributory years<br />(age 18 → {Math.min(startAge, 65)})</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-2xl font-bold text-slate-900">{nonZeroEarningYears}</p>
                                <p className="text-xs text-slate-500 font-medium">Years with earnings<br />entered</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-2xl font-bold text-slate-900">{result.generalDropoutYears.toFixed(1)}</p>
                                <p className="text-xs text-slate-500 font-medium">Lowest years dropped<br />(17% general drop-out)</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-2xl font-bold text-slate-900">{result.childRearingDropped.length}</p>
                                <p className="text-xs text-slate-500 font-medium">Child-rearing years<br />excluded</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-2xl font-bold text-slate-900">{(result.averageRatio * 100).toFixed(0)}%</p>
                                <p className="text-xs text-slate-500 font-medium">Average earnings<br />(share of yearly max)</p>
                            </div>
                        </div>

                        <ol className="mt-5 space-y-3 text-sm text-slate-600 leading-relaxed list-none">
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                                <span>
                                    <strong className="text-slate-800">Contributory period.</strong>{' '}
                                    Every year from age 18 until your pension starts counts — for you,{' '}
                                    <strong className="text-slate-800">{firstContribYear}–{lastContribYear}</strong> ({result.contributoryYears} years).
                                    You entered earnings in <strong className="text-slate-800">{nonZeroEarningYears}</strong> of them;
                                    the rest count as zeros until step 3.
                                    {startAge > 65 && (
                                        <> Years after 65 aren't added to the window — they can only replace lower years.</>
                                    )}
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                                <span>
                                    <strong className="text-slate-800">Score each year against its YMPE.</strong>{' '}
                                    Each year's score = your earnings ÷ that year's YMPE (the earnings ceiling CPP covers,
                                    currently {formatCurrencyCAD(ympeFor(LATEST_DATA_YEAR))}), capped at 100%. Income above the
                                    ceiling adds nothing. Because the ceiling rises with national wages, each year is judged
                                    against its own era.
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                                <span>
                                    <strong className="text-slate-800">Drop the lowest years.</strong>{' '}
                                    The lowest 17% of the window is dropped — <strong className="text-slate-800">{result.generalDropoutYears.toFixed(1)} years</strong> for you
                                    {result.childRearingDropped.length > 0 && (
                                        <>, plus {result.childRearingDropped.length} child-rearing year{result.childRearingDropped.length === 1 ? '' : 's'} ({result.childRearingDropped.join(', ')})</>
                                    )}. Your best <strong className="text-slate-800">{countedYears.toFixed(1)}</strong> remaining years average{' '}
                                    <strong className="text-slate-800">{(result.averageRatio * 100).toFixed(0)}%</strong> of the ceiling.
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center mt-0.5">4</span>
                                <span>
                                    <strong className="text-slate-800">Apply the 25% replacement rate.</strong>{' '}
                                    Base pension at 65 = {(result.averageRatio * 100).toFixed(0)}% average × 25% × the recent
                                    five-year average YMPE ({formatCurrencyCAD(avgYmpe5)}) ={' '}
                                    <strong className="text-slate-800">{formatCurrencyCAD(baseAt65)}/year</strong>.
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center mt-0.5">5</span>
                                <span>
                                    <strong className="text-slate-800">Adjust for start age.</strong>{' '}
                                    −0.6% per month before 65, +0.7% per month after.
                                    At {startAge}: <strong className="text-slate-800">{formatCurrencyCAD(result.annualBenefit)}/year</strong>
                                    {startAge !== 65 && (
                                        <> ({result.adjustmentFactor < 1 ? '−' : '+'}{Math.abs((result.adjustmentFactor - 1) * 100).toFixed(1)}%)</>
                                    )}.
                                    {benefitAt60 != null && benefitAt70 != null && result.annualBenefit > 0 && (
                                        <span className="mt-2 grid grid-cols-2 gap-2">
                                            <span className={`block rounded-lg px-3 py-2 border ${startAge === 60 ? 'bg-sky-50 border-sky-200' : 'bg-slate-50 border-slate-100'}`}>
                                                <span className="block text-xs font-medium text-slate-500">Earliest — start at 60</span>
                                                <span className="block font-bold text-slate-800">{formatCurrencyCAD(benefitAt60.monthlyBenefit)}/month</span>
                                                <span className="block text-xs text-slate-500">
                                                    {formatCurrencyCAD(benefitAt60.annualBenefit)}/year
                                                    {startAge !== 60 && <> ({(((benefitAt60.annualBenefit / result.annualBenefit) - 1) * 100).toFixed(0)}% vs starting at {startAge})</>}
                                                </span>
                                            </span>
                                            <span className={`block rounded-lg px-3 py-2 border ${startAge === 70 ? 'bg-sky-50 border-sky-200' : 'bg-slate-50 border-slate-100'}`}>
                                                <span className="block text-xs font-medium text-slate-500">Latest — wait until 70</span>
                                                <span className="block font-bold text-slate-800">{formatCurrencyCAD(benefitAt70.monthlyBenefit)}/month</span>
                                                <span className="block text-xs text-slate-500">
                                                    {formatCurrencyCAD(benefitAt70.annualBenefit)}/year
                                                    {startAge !== 70 && <> (+{(((benefitAt70.annualBenefit / result.annualBenefit) - 1) * 100).toFixed(0)}% vs starting at {startAge})</>}
                                                </span>
                                            </span>
                                        </span>
                                    )}
                                </span>
                            </li>
                        </ol>
                    </div>

                    {/* Apply to plan */}
                    <SectionCard accent="emerald">
                        <h3 className="text-xl font-bold text-slate-900 mb-1">Use in Your Retirement Plan</h3>
                        <p className="text-sm text-slate-500 mb-4">
                            Replaces the Dashboard's simple CPP estimate with this result ({formatCurrencyCAD(result.annualBenefit)}/year
                            starting at {startAge}) for the selected person.
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={() => applyToPlan('person')}
                                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                            >
                                Apply to You
                            </button>
                            {savedPlan?.spouse && (
                                <button
                                    onClick={() => applyToPlan('spouse')}
                                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                                >
                                    Apply to Spouse
                                </button>
                            )}
                            {appliedTo && (
                                <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Applied to {appliedTo} —{' '}
                                    <a href="/" className="text-emerald-600 hover:text-emerald-700 underline decoration-dotted">
                                        open the Dashboard
                                    </a>
                                    {' '}to see the impact
                                </span>
                            )}
                        </div>
                    </SectionCard>

                    {/* Assumptions */}
                    <div className="rounded-2xl bg-amber-50/60 border border-amber-100 p-5">
                        <h3 className="text-base font-bold text-amber-900 mb-2">Assumptions & Limitations</h3>
                        <ul className="text-sm text-amber-900/70 space-y-1.5 list-disc pl-4 leading-relaxed">
                            <li>Estimates the <strong>base CPP</strong> only — the post-2019 CPP enhancement is not modelled, so results for people retiring after ~2035 will be slightly understated.</li>
                            <li>Works in whole years; the real calculation uses months. Future earnings are assumed to keep pace with wage growth (enter them in today's dollars).</li>
                            <li>The child-rearing provision applies only to the primary caregiver, and only one parent can claim each period.</li>
                            <li>Disability drop-out and post-retirement benefits (working while collecting CPP) are not modelled.</li>
                            <li>For the definitive number, check your Statement of Contributions in <strong>My Service Canada Account</strong>.</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* FAQ */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
                <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
                <div className="space-y-6">
                    {CPP_CALCULATOR_FAQ_ITEMS.map(({ question, answer }) => (
                        <div key={question} className="space-y-2">
                            <h3 className="font-bold text-slate-900">{question}</h3>
                            <p className="text-slate-600 leading-relaxed">{answer}</p>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
