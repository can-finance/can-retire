import { describe, it, expect } from 'vitest';
import type { NonRegisteredAccount, Person, SimulationInputs, SimulationResult } from '../engine/types';
import { runSimulation } from '../engine/projection';
import {
    householdSavings,
    savingsBasis,
    tfsaAnnualLimit,
    tfsaRoomAccumulated,
    allocateSavings,
    savingsBreakdown,
    savingsSearchCap,
    savingsSearchScale,
    planSavingsBisection,
    savingsStepFractionForGap,
    planSavingsStepUp,
    planSavingsFraming,
    householdSavingsAtRetirement,
    preRetirementSpendYears,
    savingsPerYearScale,
    savingsPerYearHint,
    savingsPerYearBisectionPlan,
    savingsPerYearStepUpPlan,
    savingsAgeRowDeltas,
    reconcileRowNeed,
    reconcileSavingsAgeRows,
    SAVINGS_CAP_MIN,
    SAVINGS_DET_PRECISION_ABS,
    SAVINGS_DET_PRECISION_REL,
    SAVINGS_MC_PRECISION_ABS,
    SAVINGS_MC_PRECISION_REL,
    SAVINGS_GRANULARITY,
    DEFAULT_MAX_SAVINGS_STEPUP_PROBES,
    SAVINGS_ROW_MAX_STEPUP_PROBES,
    PER_YEAR_GRANULARITY,
    PER_YEAR_PRECISION_ABS,
    PER_YEAR_PRECISION_REL,
    PER_YEAR_DET_PRECISION_ABS,
    PER_YEAR_DET_PRECISION_REL,
    PER_YEAR_SCALE_MIN,
} from './savingsSearch';
import type {
    SavingsBisectionAction,
    SavingsBisectionPlan,
    SavingsFeasibilityProbe,
    SavingsProbeResult,
    SavingsRowDraft,
    SavingsRowNeed,
    SavingsStepUpAction,
    SavingsStepUpPlan,
} from './savingsSearch';

// --- Fixtures ---------------------------------------------------------------

const nonReg = (over: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0, receivesSurplus: true,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
    ...over,
});

const person = (over: Partial<Person> = {}): Person => ({
    age: 50, retirementAge: 60, lifeExpectancy: 90,
    currentIncome: 80_000, cppStartAge: 65, cppContributedYears: 35, oasStartAge: 65,
    rrsp: { type: 'RRSP', balance: 0 },
    tfsa: { type: 'TFSA', balance: 0 },
    nonRegisteredAccounts: [nonReg()],
    ...over,
});

const inputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => ({
    person: person(), province: 'ON', inflationRate: 0.02,
    preRetirementSpend: 50_000, postRetirementSpend: 40_000,
    oneTimeExpenses: [], useIncomeSplitting: false, withdrawalStrategy: 'tax-efficient',
    returnRates: {
        bondReturn: 0.03, cashInterest: 0.02, dividend: 0.03,
        capitalGrowth: 0.05, rrspGrowth: 0.05, tfsaGrowth: 0.05, volatility: 0.1,
    },
    ...over,
});

// A couple holding every kind of account, two non-reg accounts each, with
// contribution room recorded — the shape proportional scaling must preserve.
const richCouple = (): SimulationInputs => inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 400_000, contributionRoom: 25_000 },
        tfsa: { type: 'TFSA', balance: 90_000, contributionRoom: 12_000 },
        nonRegisteredAccounts: [
            nonReg({ id: 'a', balance: 150_000, adjustedCostBase: 100_000 }),
            nonReg({ id: 'b', balance: 50_000, adjustedCostBase: 60_000, receivesSurplus: false }),
        ],
    }),
    spouse: person({
        age: 47,
        rrsp: { type: 'RRSP', balance: 200_000 },
        tfsa: { type: 'TFSA', balance: 60_000 },
        nonRegisteredAccounts: [
            nonReg({ id: 'c', balance: 30_000, adjustedCostBase: 10_000 }),
            nonReg({ id: 'd', balance: 20_000, adjustedCostBase: 20_000, receivesSurplus: false }),
        ],
    }),
});
const RICH_TOTAL = 400_000 + 90_000 + 150_000 + 50_000 + 200_000 + 60_000 + 30_000 + 20_000; // 1,000,000

const zeroSingle = (age = 48): SimulationInputs => inputs({ person: person({ age, retirementAge: 65 }) });
const zeroCouple = (age = 48, spouseAge = 30): SimulationInputs => inputs({
    person: person({ age, retirementAge: 65 }),
    spouse: person({ age: spouseAge, retirementAge: 65 }),
});

// Every balance of a plan, in a fixed order, for monotonicity checks.
const balancesOf = (i: SimulationInputs): number[] => {
    const one = (p: Person) => [p.rrsp.balance, p.tfsa.balance, ...p.nonRegisteredAccounts.map(a => a.balance)];
    return [...one(i.person), ...(i.spouse ? one(i.spouse) : [])];
};

// --- Household savings ------------------------------------------------------

describe('householdSavings / savingsBasis', () => {
    it('sums RRSP, TFSA and every non-registered account, both people', () => {
        expect(householdSavings(richCouple())).toBe(RICH_TOTAL);
        const single = inputs({ person: person({ rrsp: { type: 'RRSP', balance: 1 }, tfsa: { type: 'TFSA', balance: 2 } }) });
        expect(householdSavings(single)).toBe(3);
    });

    it('scales the mix when there is one; the default mix when nothing is saved', () => {
        expect(savingsBasis(richCouple())).toBe('proportional');
        expect(savingsBasis(zeroSingle())).toBe('default');
        expect(savingsBasis(zeroCouple())).toBe('default');
    });
});

// --- TFSA room --------------------------------------------------------------

describe('tfsaAnnualLimit', () => {
    it('matches the published limits', () => {
        expect(tfsaAnnualLimit(2009)).toBe(5_000);
        expect(tfsaAnnualLimit(2012)).toBe(5_000);
        expect(tfsaAnnualLimit(2013)).toBe(5_500);
        expect(tfsaAnnualLimit(2015)).toBe(10_000);
        expect(tfsaAnnualLimit(2016)).toBe(5_500);
        expect(tfsaAnnualLimit(2019)).toBe(6_000);
        expect(tfsaAnnualLimit(2023)).toBe(6_500);
        expect(tfsaAnnualLimit(2024)).toBe(7_000);
        expect(tfsaAnnualLimit(2026)).toBe(7_000);
    });

    it('is 0 before TFSAs existed and holds the last published limit after it', () => {
        expect(tfsaAnnualLimit(2008)).toBe(0);
        expect(tfsaAnnualLimit(2030)).toBe(7_000);
    });
});

describe('tfsaRoomAccumulated', () => {
    it('anyone 18 or older in 2009 has every year since 2009 ($109,000 by 2026)', () => {
        expect(tfsaRoomAccumulated(48, 2026)).toBe(109_000);
        expect(tfsaRoomAccumulated(35, 2026)).toBe(109_000); // turned 18 in 2009
    });

    it('a younger person starts the year they turned 18', () => {
        expect(tfsaRoomAccumulated(34, 2026)).toBe(104_000); // from 2010
        expect(tfsaRoomAccumulated(26, 2026)).toBe(57_000);  // from 2018: 5,500 + 24,000 + 6,500 + 21,000
        expect(tfsaRoomAccumulated(20, 2026)).toBe(21_000);  // 2024-2026
        expect(tfsaRoomAccumulated(18, 2026)).toBe(7_000);   // this year only
        expect(tfsaRoomAccumulated(17, 2026)).toBe(0);
    });

    it('follows the calendar year, holding the last limit for unpublished years', () => {
        expect(tfsaRoomAccumulated(48, 2025)).toBe(102_000);
        expect(tfsaRoomAccumulated(60, 2028)).toBe(123_000);
    });

    it('defaults to the engine’s clock (this calendar year)', () => {
        expect(tfsaRoomAccumulated(40)).toBe(tfsaRoomAccumulated(40, new Date().getFullYear()));
    });
});

// --- Allocation -------------------------------------------------------------

describe('allocateSavings (proportional)', () => {
    it('scales every balance of both people — each non-reg account and its ACB — to hit the total', () => {
        const base = richCouple();
        const { inputs: out, basis } = allocateSavings(base, 1_500_000);
        expect(basis).toBe('proportional');
        expect(householdSavings(out)).toBeCloseTo(1_500_000, 6);

        expect(out.person.rrsp.balance).toBeCloseTo(600_000, 6);
        expect(out.person.tfsa.balance).toBeCloseTo(135_000, 6);
        expect(out.spouse!.rrsp.balance).toBeCloseTo(300_000, 6);
        expect(out.spouse!.tfsa.balance).toBeCloseTo(90_000, 6);
        const accounts = [...out.person.nonRegisteredAccounts, ...out.spouse!.nonRegisteredAccounts];
        const before = [...base.person.nonRegisteredAccounts, ...base.spouse!.nonRegisteredAccounts];
        accounts.forEach((a, i) => {
            expect(a.balance).toBeCloseTo(before[i].balance * 1.5, 6);
            expect(a.adjustedCostBase).toBeCloseTo(before[i].adjustedCostBase * 1.5, 6);
            // The unrealized-gain ratio is unchanged.
            expect(a.adjustedCostBase / a.balance).toBeCloseTo(before[i].adjustedCostBase / before[i].balance, 12);
        });
    });

    it('scales down too, and to zero', () => {
        const base = richCouple();
        const half = allocateSavings(base, 250_000).inputs;
        expect(householdSavings(half)).toBeCloseTo(250_000, 6);
        expect(half.person.rrsp.balance).toBeCloseTo(100_000, 6);
        const none = allocateSavings(base, 0).inputs;
        expect(balancesOf(none).every(b => b === 0)).toBe(true);
        expect(none.person.nonRegisteredAccounts[0].adjustedCostBase).toBe(0);
    });

    it('clamps a negative total to zero', () => {
        expect(householdSavings(allocateSavings(richCouple(), -5).inputs)).toBe(0);
    });

    it('changes nothing but balances and ACB — contribution room included', () => {
        const base = richCouple();
        const out = allocateSavings(base, 3_000_000).inputs;
        expect(out.person.rrsp.contributionRoom).toBe(25_000);
        expect(out.person.tfsa.contributionRoom).toBe(12_000);
        // Put the balances back and the plans are identical.
        const restored = structuredClone(out);
        const copyBalances = (to: Person, from: Person) => {
            to.rrsp.balance = from.rrsp.balance;
            to.tfsa.balance = from.tfsa.balance;
            to.nonRegisteredAccounts.forEach((a, i) => {
                a.balance = from.nonRegisteredAccounts[i].balance;
                a.adjustedCostBase = from.nonRegisteredAccounts[i].adjustedCostBase;
            });
        };
        copyBalances(restored.person, base.person);
        copyBalances(restored.spouse!, base.spouse!);
        expect(restored).toEqual(base);
    });

    it('at the current total, reproduces the plan exactly', () => {
        const base = richCouple();
        expect(allocateSavings(base, RICH_TOTAL).inputs).toEqual(base);
    });

    it('is pure: returns a deep clone and leaves its input alone', () => {
        const base = richCouple();
        const snapshot = structuredClone(base);
        const out = allocateSavings(base, 2_000_000).inputs;
        expect(base).toEqual(snapshot);
        out.person.nonRegisteredAccounts[0].balance = -1;
        out.spouse!.rrsp.balance = -1;
        expect(base).toEqual(snapshot);
    });
});

describe('allocateSavings (default mix, nothing saved today)', () => {
    it('single: TFSA up to the room built up by now, the rest to RRSP', () => {
        const base = zeroSingle(48); // room 109,000 in 2026
        const small = allocateSavings(base, 60_000, { currentYear: 2026 });
        expect(small.basis).toBe('default');
        expect(small.inputs.person.tfsa.balance).toBe(60_000);
        expect(small.inputs.person.rrsp.balance).toBe(0);

        const big = allocateSavings(base, 500_000, { currentYear: 2026 }).inputs;
        expect(big.person.tfsa.balance).toBe(109_000);
        expect(big.person.rrsp.balance).toBe(391_000);
        expect(big.person.nonRegisteredAccounts[0].balance).toBe(0);
        expect(householdSavings(big)).toBe(500_000);
    });

    it('TFSA room depends on age and year', () => {
        const young = allocateSavings(zeroSingle(20), 100_000, { currentYear: 2026 }).inputs;
        expect(young.person.tfsa.balance).toBe(21_000);
        expect(young.person.rrsp.balance).toBe(79_000);
        // The same person a year on (21 in 2027) has one more year of room.
        const later = allocateSavings(zeroSingle(21), 100_000, { currentYear: 2027 }).inputs;
        expect(later.person.tfsa.balance).toBe(28_000);
    });

    it('couple: half each, then TFSA-then-RRSP within each person', () => {
        const base = zeroCouple(48, 26); // rooms 109,000 and 57,000 in 2026
        const out = allocateSavings(base, 300_000, { currentYear: 2026 }).inputs;
        expect(out.person.tfsa.balance).toBe(109_000);
        expect(out.person.rrsp.balance).toBe(41_000);
        // The younger spouse's TFSA room runs out sooner: their remainder goes to
        // their OWN RRSP, not to the other person.
        expect(out.spouse!.tfsa.balance).toBe(57_000);
        expect(out.spouse!.rrsp.balance).toBe(93_000);
        expect(householdSavings(out)).toBe(300_000);

        const small = allocateSavings(base, 80_000, { currentYear: 2026 }).inputs;
        expect(small.person.tfsa.balance).toBe(40_000);
        expect(small.spouse!.tfsa.balance).toBe(40_000);
        expect(small.person.rrsp.balance + small.spouse!.rrsp.balance).toBe(0);
    });

    it('is monotone: more savings never lowers any balance', () => {
        for (const base of [zeroSingle(48), zeroSingle(22), zeroCouple(48, 26), zeroCouple(19, 60)]) {
            let prev = balancesOf(allocateSavings(base, 0, { currentYear: 2026 }).inputs);
            for (let total = 5_000; total <= 600_000; total += 5_000) {
                const out = allocateSavings(base, total, { currentYear: 2026 }).inputs;
                const now = balancesOf(out);
                now.forEach((b, i) => expect(b).toBeGreaterThanOrEqual(prev[i]));
                expect(householdSavings(out)).toBeCloseTo(total, 9);
                prev = now;
            }
        }
    });

    it('is pure', () => {
        const base = zeroCouple();
        const snapshot = structuredClone(base);
        allocateSavings(base, 400_000, { currentYear: 2026 });
        expect(base).toEqual(snapshot);
    });
});

describe('savingsBreakdown', () => {
    it('one row per person, summing to the household total', () => {
        const rows = savingsBreakdown(richCouple());
        expect(rows).toEqual([
            { who: 'person', label: 'You', rrsp: 400_000, tfsa: 90_000, nonReg: 200_000, total: 690_000 },
            { who: 'spouse', label: 'Spouse', rrsp: 200_000, tfsa: 60_000, nonReg: 50_000, total: 310_000 },
        ]);
        expect(rows.reduce((s, r) => s + r.total, 0)).toBe(RICH_TOTAL);
        expect(savingsBreakdown(zeroSingle())).toHaveLength(1);
    });
});

// --- Search scale -----------------------------------------------------------

describe('savingsSearchCap / savingsSearchScale', () => {
    it('is 20× current savings or 50 years of spending, whichever is larger, rounded up to $10k', () => {
        // 20 × 1,000,000 beats 50 × 40,000.
        expect(savingsSearchCap(richCouple())).toBe(20_000_000);
        // Nothing saved: 50 × 81,234 = 4,061,700 → 4,070,000.
        expect(savingsSearchCap(inputs({ postRetirementSpend: 81_234 }))).toBe(4_070_000);
    });

    it('never falls below the floor (a plan with almost no spending)', () => {
        expect(savingsSearchCap(inputs({ postRetirementSpend: 0 }))).toBe(SAVINGS_CAP_MIN);
    });

    it('scale: ten years of spending, with a floor', () => {
        expect(savingsSearchScale(55_000)).toBe(550_000);
        expect(savingsSearchScale(0)).toBe(100_000);
    });
});

// --- Deterministic search ---------------------------------------------------

const CAP = 5_000_000;
const detPlan = (start: number, over: Partial<SavingsBisectionPlan> = {}): SavingsBisectionPlan =>
    ({ start, cap: CAP, expandFloor: 400_000, ...over });

// Drive the planner against a monotone threshold: feasible iff total ≥ threshold.
function runBisection(plan: SavingsBisectionPlan, threshold: number) {
    const probes: SavingsFeasibilityProbe[] = [];
    let action: SavingsBisectionAction = planSavingsBisection(plan, probes);
    while (action.kind === 'probe') {
        probes.push({ total: action.total, feasible: action.total >= threshold });
        if (probes.length > 60) throw new Error('bisection did not terminate');
        action = planSavingsBisection(plan, probes);
    }
    return { action, probes };
}

const detPrecision = (hi: number) => Math.max(SAVINGS_DET_PRECISION_ABS, SAVINGS_DET_PRECISION_REL * hi);

describe('planSavingsBisection', () => {
    it('probes the current savings first, exactly (k = 1 is the plan as entered)', () => {
        expect(planSavingsBisection(detPlan(847_312.55), [])).toEqual({ kind: 'probe', total: 847_312.55 });
        expect(planSavingsBisection(detPlan(0), [])).toEqual({ kind: 'probe', total: 0 });
        expect(planSavingsBisection(detPlan(9_000_000), [])).toEqual({ kind: 'probe', total: CAP });
    });

    it('current feasible: tries 0 next — and reports 0 when that is feasible too', () => {
        expect(planSavingsBisection(detPlan(800_000), [{ total: 800_000, feasible: true }]))
            .toEqual({ kind: 'probe', total: 0 });
        expect(planSavingsBisection(detPlan(800_000), [
            { total: 800_000, feasible: true }, { total: 0, feasible: true },
        ])).toEqual({ kind: 'found', total: 0 });
    });

    it('nothing saved and 0 feasible: found 0 on the first probe', () => {
        expect(planSavingsBisection(detPlan(0), [{ total: 0, feasible: true }])).toEqual({ kind: 'found', total: 0 });
    });

    it('current infeasible: expands ×2, at least to the floor, at most to the cap', () => {
        expect(planSavingsBisection(detPlan(800_000), [{ total: 800_000, feasible: false }]))
            .toEqual({ kind: 'probe', total: 1_600_000 });
        // ×2 of a small total is below the floor: the floor wins.
        expect(planSavingsBisection(detPlan(50_000), [{ total: 50_000, feasible: false }]))
            .toEqual({ kind: 'probe', total: 400_000 });
        // Nothing saved: 0 infeasible → the floor.
        expect(planSavingsBisection(detPlan(0), [{ total: 0, feasible: false }]))
            .toEqual({ kind: 'probe', total: 400_000 });
        // Expansion is capped.
        expect(planSavingsBisection(detPlan(800_000), [
            { total: 800_000, feasible: false }, { total: 1_600_000, feasible: false }, { total: 3_200_000, feasible: false },
        ])).toEqual({ kind: 'probe', total: CAP });
        // Expansions round up to the granularity.
        expect(planSavingsBisection(detPlan(123_456.78, { expandFloor: 0 }), [{ total: 123_456.78, feasible: false }]))
            .toEqual({ kind: 'probe', total: 247_000 });
    });

    it('reports unreachable once the cap itself is infeasible', () => {
        expect(planSavingsBisection(detPlan(800_000), [
            { total: 800_000, feasible: false }, { total: CAP, feasible: false },
        ])).toEqual({ kind: 'unreachable' });
        const { action, probes } = runBisection(detPlan(800_000), CAP + 1);
        expect(action).toEqual({ kind: 'unreachable' });
        expect(probes.map(p => p.total)).toEqual([800_000, 1_600_000, 3_200_000, CAP]);
    });

    it('a zero floor out of zero jumps to the cap rather than stalling', () => {
        expect(planSavingsBisection(detPlan(0, { expandFloor: 0 }), [{ total: 0, feasible: false }]))
            .toEqual({ kind: 'probe', total: CAP });
    });

    it('bisects the bracket on the $1,000 grid and stops within max($5k, 2.5%) of the threshold', () => {
        const { action, probes } = runBisection(detPlan(800_000), 612_345);
        expect(probes.slice(0, 3).map(p => p.total)).toEqual([800_000, 0, 400_000]);
        expect(action.kind).toBe('found');
        const found = (action as { total: number }).total;
        expect(found).toBeGreaterThanOrEqual(612_345);
        expect(found - 612_345).toBeLessThanOrEqual(detPrecision(found));
        for (const p of probes.slice(1)) expect(p.total % SAVINGS_GRANULARITY).toBe(0);
    });

    it('finds the threshold of every monotone feasibility curve, never re-probing, in a bounded count', () => {
        for (const start of [0, 37_500, 800_000, 2_400_000]) {
            for (let t = 0; t <= CAP; t += 61_111) {
                const threshold = t === 0 ? 0 : t;
                const { action, probes } = runBisection(detPlan(start), threshold);
                const totals = probes.map(p => p.total);
                expect(new Set(totals).size).toBe(totals.length);
                expect(probes.length).toBeLessThanOrEqual(16);
                expect(totals.every(v => v >= 0 && v <= CAP)).toBe(true);
                expect(action.kind).toBe('found');
                const found = (action as { total: number }).total;
                expect(found).toBeGreaterThanOrEqual(threshold);
                expect(found - threshold).toBeLessThanOrEqual(detPrecision(found));
                // A feasible current total is always followed by the 0 probe.
                if (start > 0 && start >= threshold) expect(totals[1]).toBe(0);
            }
        }
    });

    it('a stray infeasible probe ABOVE the lowest feasible one does not derail the bracket', () => {
        const action = planSavingsBisection(detPlan(800_000), [
            { total: 800_000, feasible: false },
            { total: 1_600_000, feasible: true },
            { total: 1_200_000, feasible: true },
            { total: 1_400_000, feasible: false }, // noise: above the lowest feasible
            { total: 1_000_000, feasible: false },
        ]);
        // Bracket is (1,000,000, 1,200,000], not anything involving 1,400,000.
        expect(action).toEqual({ kind: 'probe', total: 1_100_000 });
    });
});

// --- MC step-up -------------------------------------------------------------

describe('savingsStepFractionForGap', () => {
    it('jumps further the further below the bar', () => {
        expect(savingsStepFractionForGap(1)).toBe(0.04);
        expect(savingsStepFractionForGap(3)).toBe(0.04);
        expect(savingsStepFractionForGap(5)).toBe(0.08);
        expect(savingsStepFractionForGap(12)).toBe(0.15);
        expect(savingsStepFractionForGap(25)).toBe(0.30);
        expect(savingsStepFractionForGap(45)).toBe(0.50);
    });

    it('is monotonically non-decreasing in the gap', () => {
        let prev = 0;
        for (let g = 0; g <= 100; g += 0.5) {
            const f = savingsStepFractionForGap(g);
            expect(f).toBeGreaterThanOrEqual(prev);
            prev = f;
        }
    });
});

const stepPlan = (start: number, over: Partial<SavingsStepUpPlan> = {}): SavingsStepUpPlan =>
    ({ target: 85, start, cap: CAP, minStepBase: 500_000, ...over });

function runStepUp(plan: SavingsStepUpPlan, rate: (total: number) => number) {
    const probes: SavingsProbeResult[] = [];
    let action: SavingsStepUpAction = planSavingsStepUp(plan, probes);
    while (action.kind === 'probe') {
        probes.push({ total: action.total, successRate: rate(action.total) });
        if (probes.length > 60) throw new Error('step-up did not terminate');
        action = planSavingsStepUp(plan, probes);
    }
    return { action, probes };
}

const mcPrecision = (clear: number) => Math.max(SAVINGS_MC_PRECISION_ABS, SAVINGS_MC_PRECISION_REL * clear);

describe('planSavingsStepUp', () => {
    it('probes the deterministic answer first, exactly', () => {
        expect(planSavingsStepUp(stepPlan(612_345.67), [])).toEqual({ kind: 'probe', total: 612_345.67 });
    });

    it('is done at the start when the start already clears (never searches lower)', () => {
        expect(planSavingsStepUp(stepPlan(600_000), [{ total: 600_000, successRate: 92 }]))
            .toEqual({ kind: 'done', total: 600_000, successRate: 92 });
    });

    it('steps up by a gap-scaled share of the probe, rounded up to $1,000', () => {
        // 1 pp short: +4%.
        expect(planSavingsStepUp(stepPlan(1_000_000), [{ total: 1_000_000, successRate: 84 }]))
            .toEqual({ kind: 'probe', total: 1_040_000 });
        // 45 pp short: +50%.
        expect(planSavingsStepUp(stepPlan(1_000_000), [{ total: 1_000_000, successRate: 40 }]))
            .toEqual({ kind: 'probe', total: 1_500_000 });
        expect(planSavingsStepUp(stepPlan(612_345), [{ total: 612_345, successRate: 84 }]))
            .toEqual({ kind: 'probe', total: 637_000 }); // 612,345 + 24,493.8, rounded up
    });

    it('a small or zero start steps from the step base, so $0 can still step up', () => {
        expect(planSavingsStepUp(stepPlan(0), [{ total: 0, successRate: 70 }]))
            .toEqual({ kind: 'probe', total: 75_000 }); // 15% of the 500k base
        expect(planSavingsStepUp(stepPlan(100_000), [{ total: 100_000, successRate: 40 }]))
            .toEqual({ kind: 'probe', total: 350_000 }); // + 50% of 500k
        // A zero base too: nowhere to go but the cap.
        expect(planSavingsStepUp(stepPlan(0, { minStepBase: 0 }), [{ total: 0, successRate: 70 }]))
            .toEqual({ kind: 'probe', total: CAP });
    });

    it('bisects a bracket between the highest miss and the lowest clear', () => {
        expect(planSavingsStepUp(stepPlan(1_000_000), [
            { total: 1_000_000, successRate: 60 }, { total: 1_500_000, successRate: 90 },
        ])).toEqual({ kind: 'probe', total: 1_250_000 });
    });

    it('is done at the lowest clear once the bracket is within max($5k, 2%)', () => {
        expect(planSavingsStepUp(stepPlan(1_000_000), [
            { total: 1_000_000, successRate: 60 }, { total: 1_500_000, successRate: 90 },
            { total: 1_250_000, successRate: 80 }, { total: 1_375_000, successRate: 88 },
            { total: 1_312_000, successRate: 86 }, { total: 1_290_000, successRate: 83 },
        ])).toEqual({ kind: 'done', total: 1_312_000, successRate: 86 }); // 22k ≤ 2% of 1.312M
        // One step wider (31k > 26.2k) and it bisects once more.
        expect(planSavingsStepUp(stepPlan(1_000_000), [
            { total: 1_000_000, successRate: 60 }, { total: 1_312_000, successRate: 86 },
            { total: 1_281_000, successRate: 83 },
        ])).toEqual({ kind: 'probe', total: 1_297_000 }); // 1,296,500 rounds to the $1k grid
        // The $5k floor governs small totals.
        expect(planSavingsStepUp(stepPlan(0), [
            { total: 0, successRate: 80 }, { total: 4_000, successRate: 90 },
        ])).toEqual({ kind: 'done', total: 4_000, successRate: 90 });
    });

    it('never proposes a total past the cap', () => {
        expect(planSavingsStepUp(stepPlan(4_500_000), [{ total: 4_500_000, successRate: 40 }]))
            .toEqual({ kind: 'probe', total: CAP });
    });

    it('reports a bound hit (best probe) when the cap still misses', () => {
        expect(planSavingsStepUp(stepPlan(4_500_000), [
            { total: 4_500_000, successRate: 70 }, { total: CAP, successRate: 79 },
        ])).toEqual({ kind: 'boundHit', total: CAP, successRate: 79 });
        // Best-probe ties go to the smaller total (same odds, less to save).
        expect(planSavingsStepUp(stepPlan(4_500_000), [
            { total: 4_500_000, successRate: 79 }, { total: CAP, successRate: 79 },
        ])).toEqual({ kind: 'boundHit', total: 4_500_000, successRate: 79 });
    });

    it('flags a cap hit when the probe budget runs out — with the clearing total when it has one', () => {
        const plan = stepPlan(1_000_000, { maxProbes: 3 });
        expect(planSavingsStepUp(plan, [
            { total: 1_000_000, successRate: 60 }, { total: 1_500_000, successRate: 70 }, { total: 2_000_000, successRate: 90 },
        ])).toEqual({ kind: 'capHit', total: 2_000_000, successRate: 90, cleared: true });
        expect(planSavingsStepUp(plan, [
            { total: 1_000_000, successRate: 60 }, { total: 1_500_000, successRate: 70 }, { total: 2_000_000, successRate: 75 },
        ])).toEqual({ kind: 'capHit', total: 2_000_000, successRate: 75, cleared: false });
    });

    it('ignores a lucky clear BELOW a larger miss (MC noise) and keeps stepping up', () => {
        const action = planSavingsStepUp(stepPlan(1_000_000), [
            { total: 1_000_000, successRate: 60 },
            { total: 1_500_000, successRate: 86 }, // lucky
            { total: 1_250_000, successRate: 70 }, // fine: a miss below the clear
            { total: 1_375_000, successRate: 89 },
            { total: 1_438_000, successRate: 84 }, // a miss ABOVE the 1.375M clear
        ]);
        // Bracket is now (1,438,000, 1,500,000]: the 1.375M clear doesn't count.
        expect(action).toEqual({ kind: 'probe', total: 1_469_000 });
        // And with no clear above the miss at all, it steps up from the miss.
        expect(planSavingsStepUp(stepPlan(1_000_000), [
            { total: 1_000_000, successRate: 90 }, { total: 1_100_000, successRate: 84 },
        ])).toEqual({ kind: 'probe', total: 1_144_000 });
    });

    it('converges to the smallest clearing total on every monotone success curve, never re-probing or going below the start', () => {
        const start = 700_000;
        for (let x = 650_000; x <= 2_100_000; x += 23_456) {
            // A cliff: misses badly below x, clears above it.
            const { action, probes } = runStepUp(stepPlan(start), t => (t >= x ? 90 : 50));
            const totals = probes.map(p => p.total);
            expect(new Set(totals).size).toBe(totals.length);
            expect(totals.every(t => t >= start)).toBe(true);
            expect(probes.length).toBeLessThanOrEqual(DEFAULT_MAX_SAVINGS_STEPUP_PROBES);
            expect(action.kind).toBe('done');
            const found = (action as { total: number }).total;
            if (x <= start) {
                expect(found).toBe(start);
            } else {
                expect(found).toBeGreaterThanOrEqual(x);
                expect(found - x).toBeLessThanOrEqual(mcPrecision(found));
            }
        }
        // A smooth curve: 40% at the start, +5 pp per 10% more savings.
        const smooth = (t: number) => Math.min(99, 40 + 50 * (t / start - 1));
        const { action } = runStepUp(stepPlan(start), smooth);
        expect(action.kind).toBe('done');
        const found = (action as { total: number }).total;
        expect(smooth(found)).toBeGreaterThanOrEqual(85);
        expect(found - 1.9 * start).toBeLessThanOrEqual(mcPrecision(found));
    });

    it('from a zero start, still steps up to the bar', () => {
        const { action, probes } = runStepUp(stepPlan(0), t => (t >= 180_000 ? 90 : 70));
        expect(probes[0].total).toBe(0);
        expect(action.kind).toBe('done');
        const found = (action as { total: number }).total;
        expect(found).toBeGreaterThanOrEqual(180_000);
        expect(found - 180_000).toBeLessThanOrEqual(mcPrecision(found));
    });

    it('on a pathologically flat curve far from the bar, stops at the budget and flags it rather than guessing', () => {
        const { action, probes } = runStepUp(stepPlan(100_000, { minStepBase: 0 }), t => (t >= 4_000_000 ? 90 : 84));
        expect(probes.length).toBe(DEFAULT_MAX_SAVINGS_STEPUP_PROBES);
        expect(action).toMatchObject({ kind: 'capHit', cleared: false, successRate: 84 });
    });

    it('terminates on a wobbly curve and reports a probed total consistent with its flag', () => {
        let seed = 7;
        const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 8; };
        for (let run = 0; run < 50; run++) {
            const { action, probes } = runStepUp(stepPlan(800_000), t => Math.min(99, 40 + 50 * (t / 800_000 - 1)) + noise());
            expect(probes.length).toBeLessThanOrEqual(DEFAULT_MAX_SAVINGS_STEPUP_PROBES);
            const reported = probes.find(p => p.total === (action as { total: number }).total);
            expect(reported).toBeDefined();
            if (action.kind === 'done' || (action.kind === 'capHit' && action.cleared)) {
                expect(reported!.successRate).toBeGreaterThanOrEqual(85);
            }
        }
    });
});

// --- At-retirement framing --------------------------------------------------

describe('planSavingsFraming', () => {
    it('still-working primary: frames on their retirement', () => {
        expect(planSavingsFraming(inputs({ person: person({ age: 48, retirementAge: 60 }) }))).toEqual({
            stillWorking: true, reportedWho: 'person', currentAge: 48, retirementAge: 60, yearsToRetirement: 12,
        });
    });

    it('primary retired, spouse still working: frames on the spouse', () => {
        const base = inputs({
            person: person({ age: 63, retirementAge: 60 }),
            spouse: person({ age: 55, retirementAge: 63 }),
        });
        expect(planSavingsFraming(base)).toEqual({
            stillWorking: true, reportedWho: 'spouse', currentAge: 55, retirementAge: 63, yearsToRetirement: 8,
        });
    });

    it('both working: the primary person, even when the spouse retires later', () => {
        const base = inputs({ person: person({ age: 50, retirementAge: 60 }), spouse: person({ age: 45, retirementAge: 65 }) });
        expect(planSavingsFraming(base).reportedWho).toBe('person');
    });

    it('everyone retired (retiring this year counts): no at-retirement framing', () => {
        expect(planSavingsFraming(inputs({ person: person({ age: 66, retirementAge: 65 }) }))).toEqual({
            stillWorking: false, reportedWho: 'person', currentAge: 66, retirementAge: null, yearsToRetirement: null,
        });
        expect(planSavingsFraming(inputs({ person: person({ age: 60, retirementAge: 60 }) })).stillWorking).toBe(false);
    });
});

describe('householdSavingsAtRetirement', () => {
    const rows = [100, 200, 300, 400].map((totalAssets, i) =>
        ({ totalAssets, inflationFactor: Math.pow(1.02, i) }) as SimulationResult);

    it('reads the end-of-year balance of the last working year, in today’s dollars', () => {
        // Retiring in 3 years: the row for the third year (index 2) ends on retirement day.
        expect(householdSavingsAtRetirement(rows, 3)).toBeCloseTo(300 / Math.pow(1.02, 2), 12);
        expect(householdSavingsAtRetirement(rows, 1)).toBe(100);
    });

    it('is null when already retired or past the end of the run', () => {
        expect(householdSavingsAtRetirement(rows, null)).toBeNull();
        expect(householdSavingsAtRetirement(rows, 0)).toBeNull();
        expect(householdSavingsAtRetirement(rows, 9)).toBeNull();
        expect(householdSavingsAtRetirement([], 3)).toBeNull();
    });
});

// --- MC step-up: a first-probe hint and handed-in probes ---------------------

describe('planSavingsStepUp (first-probe hint, handed-in probes)', () => {
    it('probes the hint first, rounded up to the grid and kept within [start, cap]', () => {
        expect(planSavingsStepUp(stepPlan(600_000, { firstProbe: 812_345 }), []))
            .toEqual({ kind: 'probe', total: 813_000 });
        expect(planSavingsStepUp(stepPlan(600_000, { firstProbe: 400_000 }), []))
            .toEqual({ kind: 'probe', total: 600_000 });
        expect(planSavingsStepUp(stepPlan(600_000, { firstProbe: 9_000_000 }), []))
            .toEqual({ kind: 'probe', total: CAP });
    });

    it('a hint that misses steps up from it, gap-scaled', () => {
        // 5 pp short: +8% of 813k.
        expect(planSavingsStepUp(stepPlan(600_000, { firstProbe: 812_345 }), [{ total: 813_000, successRate: 80 }]))
            .toEqual({ kind: 'probe', total: 879_000 });
    });

    it('a hint that clears steps DOWN toward the start, gap-scaled, never below it', () => {
        const plan = stepPlan(600_000, { firstProbe: 812_345 });
        // 2 pp over: −4% of 813k (32,520), rounded down to the grid.
        expect(planSavingsStepUp(plan, [{ total: 813_000, successRate: 87 }])).toEqual({ kind: 'probe', total: 780_000 });
        // 14 pp over: −15%.
        expect(planSavingsStepUp(plan, [{ total: 813_000, successRate: 99 }])).toEqual({ kind: 'probe', total: 691_000 });
        // A step past the start lands on the start.
        const near = stepPlan(600_000, { firstProbe: 620_000 });
        expect(planSavingsStepUp(near, [{ total: 620_000, successRate: 95 }])).toEqual({ kind: 'probe', total: 600_000 });
        // The start clears too: done there. It misses: bisect the bracket.
        expect(planSavingsStepUp(near, [{ total: 620_000, successRate: 95 }, { total: 600_000, successRate: 90 }]))
            .toEqual({ kind: 'done', total: 600_000, successRate: 90 });
        expect(planSavingsStepUp(near, [{ total: 620_000, successRate: 95 }, { total: 600_000, successRate: 80 }]))
            .toEqual({ kind: 'probe', total: 610_000 });
    });

    it('a handed-in clear above the start steps down; a handed-in miss steps up from it', () => {
        expect(planSavingsStepUp(stepPlan(400_000), [{ total: 1_000_000, successRate: 97 }]))
            .toEqual({ kind: 'probe', total: 850_000 }); // 12 pp over: −15%
        expect(planSavingsStepUp(stepPlan(400_000), [{ total: 1_000_000, successRate: 60 }]))
            .toEqual({ kind: 'probe', total: 1_300_000 }); // 25 pp short: +30%
    });

    it('consults the hint while it lies inside the bracket, after a handed-in probe', () => {
        const plan = stepPlan(400_000, { firstProbe: 700_000 });
        expect(planSavingsStepUp(plan, [{ total: 1_000_000, successRate: 97 }])).toEqual({ kind: 'probe', total: 700_000 });
        expect(planSavingsStepUp(plan, [{ total: 500_000, successRate: 60 }])).toEqual({ kind: 'probe', total: 700_000 });
        // Below a miss, the hint is already ruled out: step up from the miss.
        expect(planSavingsStepUp(plan, [{ total: 1_000_000, successRate: 60 }])).toEqual({ kind: 'probe', total: 1_300_000 });
    });

    it('flags a cap hit that still clears when the budget runs out stepping down', () => {
        expect(planSavingsStepUp(stepPlan(400_000, { maxProbes: 2 }), [
            { total: 1_000_000, successRate: 97 }, { total: 850_000, successRate: 95 },
        ])).toEqual({ kind: 'capHit', total: 850_000, successRate: 95, cleared: true });
    });

    it('from any reasonable hint, converges to the smallest clearing total, never below the start or re-probing', () => {
        const start = 700_000;
        for (let x = 500_000; x <= 2_100_000; x += 37_777) {
            for (const f of [0.5, 0.8, 0.95, 1, 1.1, 1.3]) {
                const { action, probes } = runStepUp(stepPlan(start, { firstProbe: x * f }), t => (t >= x ? 90 : 50));
                const totals = probes.map(p => p.total);
                expect(new Set(totals).size).toBe(totals.length);
                expect(totals.every(t => t >= start)).toBe(true);
                expect(probes.length).toBeLessThanOrEqual(DEFAULT_MAX_SAVINGS_STEPUP_PROBES);
                expect(action.kind).toBe('done');
                const found = (action as { total: number }).total;
                if (x <= start) {
                    expect(found).toBe(start);
                } else {
                    expect(found).toBeGreaterThanOrEqual(x);
                    expect(found - x).toBeLessThanOrEqual(mcPrecision(found));
                }
            }
        }
    });

    it('a handed-in clear far above a start of 0 finishes at 0, not partway down', () => {
        // The age rows' case: the MC at current savings ($850k) clears at
        // 100%, the row's deterministic answer is 0, six probes in all. At
        // −15% a step the budget would run out at ~$375k; the start is
        // probed directly instead.
        const run = (plan: SavingsStepUpPlan, rate: (t: number) => number) => {
            const probes: SavingsProbeResult[] = [{ total: 850_000, successRate: 100 }];
            let action = planSavingsStepUp(plan, probes);
            while (action.kind === 'probe') {
                probes.push({ total: action.total, successRate: rate(action.total) });
                action = planSavingsStepUp(plan, probes);
            }
            return { action, probes };
        };
        const base = { target: 90, cap: CAP, minStepBase: 100_000, maxProbes: SAVINGS_ROW_MAX_STEPUP_PROBES };
        for (const plan of [{ ...base, start: 0 }, { ...base, start: 0, firstProbe: 0 }]) {
            const { action, probes } = run(plan, () => 100);
            expect(probes[1].total).toBe(0);
            expect(action).toEqual({ kind: 'done', total: 0, successRate: 100 });
        }
        // The start misses: bisect between it and the clear, never reporting a miss.
        const { action, probes } = run({ ...base, start: 0 }, t => (t >= 200_000 ? 95 : 40));
        expect(probes.length).toBeLessThanOrEqual(SAVINGS_ROW_MAX_STEPUP_PROBES);
        expect(action.kind === 'done' || (action.kind === 'capHit' && action.cleared)).toBe(true);
        expect((action as { total: number }).total).toBeGreaterThanOrEqual(200_000);
        expect((action as { total: number }).total).toBeLessThan(375_000);
    });

    it('a wildly high hint still reports a clearing total, flagged when the budget runs out', () => {
        const { action, probes } = runStepUp(stepPlan(700_000, { firstProbe: 4_000_000 }), t => (t >= 800_000 ? 90 : 50));
        expect(probes.length).toBeLessThanOrEqual(DEFAULT_MAX_SAVINGS_STEPUP_PROBES);
        expect(action.kind === 'done' || (action.kind === 'capHit' && action.cleared)).toBe(true);
        expect((action as { total: number }).total).toBeGreaterThanOrEqual(800_000);
    });
});

// --- Per-year framing -------------------------------------------------------

describe('preRetirementSpendYears', () => {
    it('counts the years until the last earner retires', () => {
        expect(preRetirementSpendYears(inputs({ person: person({ age: 50, retirementAge: 60 }) }))).toBe(10);
        expect(preRetirementSpendYears(inputs({
            person: person({ age: 50, retirementAge: 60 }),
            spouse: person({ age: 45, retirementAge: 65 }),
        }))).toBe(20);
        // Primary retired, spouse still working: the spouse's years.
        expect(preRetirementSpendYears(inputs({
            person: person({ age: 63, retirementAge: 60 }),
            spouse: person({ age: 55, retirementAge: 63 }),
        }))).toBe(8);
    });

    it('is 0 once everyone has retired (retiring this year counts)', () => {
        expect(preRetirementSpendYears(inputs({ person: person({ age: 66, retirementAge: 65 }) }))).toBe(0);
        expect(preRetirementSpendYears(inputs({ person: person({ age: 60, retirementAge: 60 }) }))).toBe(0);
    });

    it('matches the years the engine actually charges preRetirementSpend', () => {
        // Staggered couple: the household spends at the pre-retirement level
        // until the LATER retiree stops working, not the primary.
        const base = inputs({
            person: person({ age: 50, retirementAge: 55, currentIncome: 90_000 }),
            spouse: person({ age: 48, retirementAge: 58, currentIncome: 60_000 }),
            preRetirementSpend: 70_000, postRetirementSpend: 50_000,
        });
        const rows = runSimulation(base);
        const preYears = rows.map(r => Math.abs(r.spending - 70_000 * r.inflationFactor) < 1e-6);
        expect(preRetirementSpendYears(base)).toBe(10);
        expect(preYears.filter(Boolean)).toHaveLength(10);
        expect(preYears.slice(0, 10).every(Boolean)).toBe(true);
    });
});

describe('savingsPerYearScale / savingsPerYearHint', () => {
    it('scale: the at-retirement gap over the years, rounded up to $100, within [floor, cap]', () => {
        expect(savingsPerYearScale(120_000, 10, 60_000)).toBe(12_000);
        expect(savingsPerYearScale(120_050, 10, 60_000)).toBe(12_100);
        expect(savingsPerYearScale(5_000, 10, 60_000)).toBe(PER_YEAR_SCALE_MIN);
        expect(savingsPerYearScale(-5_000, 10, 60_000)).toBe(PER_YEAR_SCALE_MIN);
        expect(savingsPerYearScale(1_000_000, 5, 60_000)).toBe(60_000);
        expect(savingsPerYearScale(120_000, 0, 60_000)).toBe(60_000);
        expect(savingsPerYearScale(5_000, 10, 500)).toBe(500); // the cap wins over the floor
    });

    it('hint: the gap over the measured slope, at most the cap; none without a usable slope', () => {
        expect(savingsPerYearHint(300_000, 15, 60_000)).toBe(20_000);
        expect(savingsPerYearHint(3_000_000, 15, 60_000)).toBe(60_000);
        expect(savingsPerYearHint(300_000, 0, 60_000)).toBeNull();
        expect(savingsPerYearHint(300_000, -2, 60_000)).toBeNull();
        expect(savingsPerYearHint(0, 15, 60_000)).toBeNull();
    });
});

describe('per-year search plans', () => {
    it('deterministic: from R = 0, up to spending nothing before retiring, on the $100 grid', () => {
        expect(savingsPerYearBisectionPlan(55_000, 12_000)).toEqual({
            start: 0, cap: 55_000, expandFloor: 12_000,
            precisionAbs: PER_YEAR_DET_PRECISION_ABS, precisionRel: PER_YEAR_DET_PRECISION_REL,
            granularity: PER_YEAR_GRANULARITY,
        });
        const detPrecisionR = (hi: number) => Math.max(PER_YEAR_DET_PRECISION_ABS, PER_YEAR_DET_PRECISION_REL * hi);
        for (let threshold = 0; threshold <= 55_000; threshold += 1_234) {
            const { action, probes } = runBisection(savingsPerYearBisectionPlan(55_000, 12_000), threshold);
            expect(probes[0].total).toBe(0);
            expect(probes.every(p => p.total % PER_YEAR_GRANULARITY === 0 && p.total <= 55_000)).toBe(true);
            expect(action.kind).toBe('found');
            const found = (action as { total: number }).total;
            expect(found).toBeGreaterThanOrEqual(threshold);
            expect(found - threshold).toBeLessThanOrEqual(detPrecisionR(found));
        }
        // Even spending nothing before retiring falls short.
        const { action, probes } = runBisection(savingsPerYearBisectionPlan(55_000, 12_000), 60_000);
        expect(action).toEqual({ kind: 'unreachable' });
        expect(probes.map(p => p.total)).toEqual([0, 12_000, 24_000, 48_000, 55_000]);
    });

    it('MC: from the deterministic answer (or the hint), to max($500, 2.5%), never past the spending', () => {
        expect(savingsPerYearStepUpPlan(85, 8_000, 55_000, 12_000, 14_321)).toEqual({
            target: 85, start: 8_000, cap: 55_000, minStepBase: 12_000, firstProbe: 14_321,
            precisionAbs: PER_YEAR_PRECISION_ABS, precisionRel: PER_YEAR_PRECISION_REL,
            granularity: PER_YEAR_GRANULARITY,
        });
        expect(savingsPerYearStepUpPlan(85, 8_000, 55_000, 12_000).firstProbe).toBeUndefined();
        expect(planSavingsStepUp(savingsPerYearStepUpPlan(85, 8_000, 55_000, 12_000, 14_321), []))
            .toEqual({ kind: 'probe', total: 14_400 });

        const precisionR = (clear: number) => Math.max(PER_YEAR_PRECISION_ABS, PER_YEAR_PRECISION_REL * clear);
        for (let x = 8_000; x <= 55_000; x += 2_345) {
            for (const hint of [null, x * 0.8, x * 1.2]) {
                const { action, probes } = runStepUp(savingsPerYearStepUpPlan(85, 8_000, 55_000, 12_000, hint), t => (t >= x ? 90 : 50));
                expect(probes.every(p => p.total >= 8_000 && p.total <= 55_000)).toBe(true);
                expect(action.kind).toBe('done');
                const found = (action as { total: number }).total;
                expect(found).toBeGreaterThanOrEqual(x);
                expect(found - x).toBeLessThanOrEqual(precisionR(found));
            }
        }
        // Even R = the whole pre-retirement spend misses: a bound hit at the cap.
        const { action } = runStepUp(savingsPerYearStepUpPlan(85, 8_000, 55_000, 12_000), () => 60);
        expect(action.kind).toBe('boundHit');
    });
});

// --- Savings needed at each retirement age ---------------------------------

describe('savingsAgeRowDeltas', () => {
    it('−3 … +3 around the plan, clamped to the bounds, always including the plan itself', () => {
        expect(savingsAgeRowDeltas(-10, 10)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
        expect(savingsAgeRowDeltas(-2, 10)).toEqual([-2, -1, 0, 1, 2, 3]);
        expect(savingsAgeRowDeltas(-10, 1)).toEqual([-3, -2, -1, 0, 1]);
        expect(savingsAgeRowDeltas(-1, 0)).toEqual([-1, 0]);
        // A plan age past the search's upper bound still gets its own row.
        expect(savingsAgeRowDeltas(-10, -2)).toEqual([-3, -2, 0]);
        expect(savingsAgeRowDeltas(-10, -5)).toEqual([0]);
    });
});

const need = (over: Partial<SavingsRowNeed> = {}): SavingsRowNeed => ({
    status: 'found', neededSavings: 600_000, clears: true, stepUpCapHit: false, boundHit: false, ...over,
});

describe('reconcileRowNeed', () => {
    const CURRENT = 500_000;

    it('clears at current savings: needs no more than current, and clears there', () => {
        expect(reconcileRowNeed(need(), CURRENT, true)).toEqual(need({ neededSavings: CURRENT }));
        const fine = need({ neededSavings: 450_000 });
        expect(reconcileRowNeed(fine, CURRENT, true)).toBe(fine);
        // Even when the step-up found nothing that clears.
        expect(reconcileRowNeed(need({ neededSavings: 2_000_000, clears: false, boundHit: true }), CURRENT, true))
            .toEqual(need({ neededSavings: CURRENT }));
        expect(reconcileRowNeed(need({ status: 'unreachable', neededSavings: null, clears: false }), CURRENT, true))
            .toEqual(need({ neededSavings: CURRENT }));
    });

    it('misses at current savings: needs at least one grid step more than current', () => {
        expect(reconcileRowNeed(need({ neededSavings: 450_000 }), CURRENT, false).neededSavings).toBe(501_000);
        expect(reconcileRowNeed(need({ neededSavings: 450_000 }), 487_654.32, false).neededSavings).toBe(488_000);
        const fine = need();
        expect(reconcileRowNeed(fine, CURRENT, false)).toBe(fine);
        const none = need({ status: 'unreachable', neededSavings: null, clears: false });
        expect(reconcileRowNeed(none, CURRENT, false)).toBe(none);
    });

    it('keeps the rest of the row', () => {
        const row = { ...need({ neededSavings: 450_000 }), delta: 2 };
        expect(reconcileRowNeed(row, CURRENT, false)).toEqual({ ...row, neededSavings: 501_000 });
    });
});

describe('reconcileSavingsAgeRows', () => {
    const CURRENT = 500_000;
    const draft = (delta: number, neededSavings: number | null, heldDeterministic: number | null,
        over: Partial<SavingsRowDraft> = {}): SavingsRowDraft => ({
        delta, isPlan: delta === 0, status: 'found', neededSavings, clears: true,
        stepUpCapHit: false, boundHit: false, clearsAtCurrent: false, heldDeterministic, ...over,
    });
    const needs = (rows: SavingsRowDraft[]) => rows.map(r => r.neededSavings);

    it('smooths MC wobble so a later age needs no more, anchored on the plan row', () => {
        const rows = [
            draft(-2, 900_000, 600_000),
            draft(-1, 780_000, 560_000), // below the plan: raised to it
            draft(0, 800_000, 520_000),
            draft(1, 820_000, 480_000),  // above the plan: lowered to it
            draft(2, 700_000, 440_000),
        ];
        const out = reconcileSavingsAgeRows(rows, CURRENT);
        expect(needs(out)).toEqual([900_000, 800_000, 800_000, 800_000, 700_000]);
        expect(out[2]).toBe(rows[2]); // the plan row is never touched
    });

    it('chains outward from the plan', () => {
        const out = reconcileSavingsAgeRows([
            draft(0, 800_000, 520_000), draft(1, 850_000, 480_000), draft(2, 900_000, 440_000),
        ], CURRENT);
        expect(needs(out)).toEqual([800_000, 800_000, 800_000]);
    });

    it('leaves rows alone where the deterministic answers rise with age (spending more than earning while working)', () => {
        const rising = [draft(-1, 700_000, 400_000), draft(0, 800_000, 500_000), draft(1, 900_000, 600_000)];
        expect(needs(reconcileSavingsAgeRows(rising, CURRENT))).toEqual([700_000, 800_000, 900_000]);
        // …but deterministic answers within the search's precision count as agreeing.
        const flat = [draft(0, 800_000, 500_000), draft(1, 820_000, 510_000)];
        expect(needs(reconcileSavingsAgeRows(flat, CURRENT))).toEqual([800_000, 800_000]);
    });

    it('does not smooth across a row that does not clear', () => {
        const out = reconcileSavingsAgeRows([
            draft(0, 800_000, 520_000),
            draft(1, 2_000_000, 480_000, { clears: false, boundHit: true }),
            draft(2, 850_000, 440_000),
        ], CURRENT);
        expect(needs(out)).toEqual([800_000, 2_000_000, 850_000]);
        expect(out[1].clears).toBe(false);
    });

    it('a row’s own MC at current savings outranks its neighbour', () => {
        // The plan has enough; the next row missed at current savings, so
        // smoothing it down to the plan's amount would contradict it.
        const later = reconcileSavingsAgeRows([
            draft(0, 480_000, 520_000, { clearsAtCurrent: true }),
            draft(1, 530_000, 480_000),
        ], CURRENT);
        expect(needs(later)).toEqual([480_000, 501_000]);
        // An earlier row that cleared at current savings is never raised past them.
        const earlier = reconcileSavingsAgeRows([
            draft(-1, 450_000, 560_000, { clearsAtCurrent: true }),
            draft(0, 600_000, 520_000),
        ], CURRENT);
        expect(needs(earlier)).toEqual([CURRENT, 600_000]);
    });

    it('reconciles every estimated row with its own MC at current savings', () => {
        const out = reconcileSavingsAgeRows([
            draft(-1, 650_000, 560_000, { clearsAtCurrent: true }), // cleared at current: needs current at most
            draft(0, 600_000, 520_000),
            draft(1, null, null, { status: 'unreachable', clears: false }),
        ], CURRENT);
        expect(needs(out)).toEqual([CURRENT, 600_000, null]);
        expect(out[2].status).toBe('unreachable');
    });

    it('is pure', () => {
        const rows = [draft(0, 800_000, 520_000), draft(1, 850_000, 480_000)];
        const snapshot = structuredClone(rows);
        reconcileSavingsAgeRows(rows, CURRENT);
        expect(rows).toEqual(snapshot);
    });
});
