// Engine-backed tests for the savings-needed ("How much do I need to retire?")
// objective.
//
// By default these run the REAL Monte Carlo (unseeded, modest iterations), so
// every assertion about the MC answer is one MC wobble can't flip: plans sit
// far from the bar on whichever side matters, and exact checks are kept to the
// deterministic parts (the det search, allocation, at-retirement figures).
// Tests that need to drive the step-up exactly swap in a deterministic stand-in
// via mcHooks.rate. The step-up's decision logic is covered MC-free in
// savingsSearch.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NonRegisteredAccount, Person, SimulationInputs, MonteCarloResult } from '../engine/types';
import { runSimulation } from '../engine/projection';
import { computeSummaryMetrics } from './summaryMetrics';
import { INITIAL_INPUTS, createDefaultPerson, DEFAULT_SPEND } from './inputSanitizer';
import {
    optimizeMeltdown,
    applyMeltdownRecommendation,
    buildHouseholdMeltGrids,
    buildCppCandidates,
    buildOasCandidates,
    EARLIEST_AGE_MELT_STEPS,
} from './meltdownOptimizer';
import type { MeltdownResult, OptimizeMeltdownOptions } from './meltdownOptimizer';
import {
    allocateSavings,
    householdSavings,
    householdSavingsAtRetirement,
    tfsaRoomAccumulated,
    savingsSearchCap,
    preRetirementSpendYears,
    SAVINGS_DET_PRECISION_ABS,
    SAVINGS_DET_PRECISION_REL,
    SAVINGS_MC_PRECISION_ABS,
    SAVINGS_MC_PRECISION_REL,
    PER_YEAR_PRECISION_ABS,
    PER_YEAR_PRECISION_REL,
} from './savingsSearch';
import { planAgeShift, applyRetirementShift, personOf } from './retirementAgeSearch';

const mcHooks = vi.hoisted(() => ({
    rate: null as null | ((inputs: SimulationInputs) => number),
    calls: 0,
}));

vi.mock('../engine/projection', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../engine/projection')>();
    const runMonteCarlo = (inputs: SimulationInputs, iterations?: number): MonteCarloResult => {
        mcHooks.calls++;
        if (!mcHooks.rate) return actual.runMonteCarlo(inputs, iterations);
        // Stand-in: the deterministic path as every percentile band, and the
        // test's success rate.
        const results = actual.runSimulation(inputs);
        return {
            percentiles: results.map(r => ({
                year: r.year, age: r.age,
                p5: r.totalAssets, p25: r.totalAssets, p50: r.totalAssets, p75: r.totalAssets, p95: r.totalAssets,
            })),
            successRate: mcHooks.rate(inputs),
            medianEndOfPlanAssets: results.length ? results[results.length - 1].totalAssets : 0,
        };
    };
    return { ...actual, runMonteCarlo: vi.fn(runMonteCarlo) };
});

afterEach(() => {
    mcHooks.rate = null;
    mcHooks.calls = 0;
});

// --- Fixtures ---------------------------------------------------------------

const nonReg = (over: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0, receivesSurplus: true,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
    ...over,
});

const person = (over: Partial<Person> = {}): Person => ({
    age: 50, retirementAge: 60, lifeExpectancy: 90,
    currentIncome: 90_000, cppStartAge: 65, cppContributedYears: 35, oasStartAge: 65,
    rrsp: { type: 'RRSP', balance: 300_000 },
    tfsa: { type: 'TFSA', balance: 80_000 },
    nonRegisteredAccounts: [nonReg({ balance: 100_000, adjustedCostBase: 80_000 })],
    ...over,
});

const inputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => ({
    person: person(), province: 'ON', inflationRate: 0.02,
    preRetirementSpend: 55_000, postRetirementSpend: 50_000,
    oneTimeExpenses: [], useIncomeSplitting: false, withdrawalStrategy: 'tax-efficient',
    returnRates: {
        bondReturn: 0.03, cashInterest: 0.02, dividend: 0.03,
        capitalGrowth: 0.05, rrspGrowth: 0.05, tfsaGrowth: 0.05, volatility: 0.1,
    },
    ...over,
});

const noSavings = {
    rrsp: { type: 'RRSP' as const, balance: 0 },
    tfsa: { type: 'TFSA' as const, balance: 0 },
    nonRegisteredAccounts: [nonReg()],
};

// $480k saved, retiring at 60 on $65k a year: needs far more (the plan as
// entered clears the bar only ~1 time in 5).
const needsMore = () => inputs({ postRetirementSpend: 65_000 });
// $1M saved, $40k a year: needs well under half of it.
const hasEnough = () => inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 600_000 },
        tfsa: { type: 'TFSA', balance: 150_000 },
        nonRegisteredAccounts: [nonReg({ balance: 250_000, adjustedCostBase: 150_000 })],
    }),
    postRetirementSpend: 40_000,
});
const defaultCouple = (): SimulationInputs => ({
    ...structuredClone(INITIAL_INPUTS),
    spouse: createDefaultPerson(true),
    preRetirementSpend: DEFAULT_SPEND.couple.pre,
    postRetirementSpend: DEFAULT_SPEND.couple.post,
});

const defaultSingle = (): SimulationInputs => structuredClone(INITIAL_INPUTS);

// The lump-sum answer alone: the per-year framing and the age rows are opted
// out here and switched on by the tests about them (SN_FULL), for speed.
const SN: OptimizeMeltdownOptions = {
    objective: 'savings-needed', mcIterations: 100, mcSuccessTarget: 85,
    savingsPerYear: false, savingsAgeRows: 'none',
};
const SN_PER_YEAR: OptimizeMeltdownOptions = { ...SN, savingsPerYear: true };
const SN_ROWS: OptimizeMeltdownOptions = { ...SN, savingsAgeRows: 'all' };
const SN_FULL: OptimizeMeltdownOptions = { ...SN, savingsPerYear: true, savingsAgeRows: 'all' };

// --- Oracles ----------------------------------------------------------------

const shortfallOf = (i: SimulationInputs): number =>
    computeSummaryMetrics(runSimulation(i), i, false).totalShortfall;

// Brute force over the SAME candidate space the inner check searches (exported
// builders, the earliest-age melt density, both withdrawal orders): is any
// strategy deterministically feasible on these inputs? Re-implements the
// optimizer's private applyChoice so the oracle stays independent of it.
function anyStrategyFeasible(base: SimulationInputs): boolean {
    type Choice = { melt: number; cpp: number; oas: number };
    // Melt grids anchor on each person's projected balance at melt start.
    const meltGrids = buildHouseholdMeltGrids(base, EARLIEST_AGE_MELT_STEPS);
    const choicesFor = (p: Person, meltGrid: number[]): Choice[] => {
        const out: Choice[] = [];
        for (const melt of meltGrid) {
            for (const cpp of buildCppCandidates(p, true)) {
                for (const oas of buildOasCandidates(p, true)) out.push({ melt, cpp, oas });
            }
        }
        return out;
    };
    const apply = (p: Person, c: Choice) => {
        p.rrspMeltAmount = c.melt;
        p.rrspMeltStartAge = undefined;
        p.cppStartAge = c.cpp;
        p.oasStartAge = c.oas;
    };
    const pcs = choicesFor(base.person, meltGrids.person);
    const scs: (Choice | null)[] = base.spouse ? choicesFor(base.spouse, meltGrids.spouse) : [null];
    for (const strategy of ['tax-efficient', 'rrsp-first'] as const) {
        for (const pc of pcs) {
            for (const sc of scs) {
                const trial = structuredClone(base);
                trial.withdrawalStrategy = strategy;
                apply(trial.person, pc);
                if (trial.spouse && sc) apply(trial.spouse, sc);
                if (shortfallOf(trial) <= 1000) return true;
            }
        }
    }
    return false;
}

// An MC stand-in rate with no noise: clears exactly when the plan is funded on
// average returns, so every MC answer equals its deterministic one.
const averageReturnsRate = (i: SimulationInputs): number => (shortfallOf(i) > 1000 ? 0 : 100);

const detPrecision = (hi: number) => Math.max(SAVINGS_DET_PRECISION_ABS, SAVINGS_DET_PRECISION_REL * hi);
const mcPrecision = (clear: number) => Math.max(SAVINGS_MC_PRECISION_ABS, SAVINGS_MC_PRECISION_REL * clear);

// The contract for any 'found' answer, whatever MC did.
function expectFoundInvariants(base: SimulationInputs, res: MeltdownResult): void {
    const s = res.savingsNeeded!;
    expect(res.objective).toBe('savings-needed');
    expect(s.status).toBe('found');
    expect(s.currentSavings).toBe(householdSavings(base));
    expect(s.searchCap).toBe(savingsSearchCap(base));
    expect(s.neededSavings!).toBeGreaterThanOrEqual(s.deterministicSavings!);
    expect(s.savingsGap).toBeCloseTo(s.neededSavings! - s.currentSavings, 6);
    expect(s.haveEnough).toBe(s.neededSavings! <= s.currentSavings);
    expect(s.needIsZero).toBe(s.neededSavings === 0);
    expect(res.improved).toBe(s.neededSavings! > s.currentSavings);
    expect(res.mcWarning).toBe(false);
    // The answer's balances add up to the answer, and so does the breakdown.
    expect(householdSavings(res.recommendedInputs)).toBeCloseTo(s.neededSavings!, 4);
    expect(s.neededAccounts.reduce((t, a) => t + a.total, 0)).toBeCloseTo(s.neededSavings!, 4);
    expect(s.neededAccounts.map(a => a.who)).toEqual(base.spouse ? ['person', 'spouse'] : ['person']);
    // Feasible on average returns, with ages and spending exactly as entered.
    expect(shortfallOf(res.recommendedInputs)).toBeLessThanOrEqual(1000);
    expect(res.recommendedInputs.person.retirementAge).toBe(base.person.retirementAge);
    expect(res.recommendedInputs.person.cppContributedYears).toBe(base.person.cppContributedYears);
    expect(res.recommendedInputs.postRetirementSpend).toBe(base.postRetirementSpend);
    expect(res.recommendedInputs.preRetirementSpend).toBe(base.preRetirementSpend);
    expect(s.postRetirementSpend).toBe(base.postRetirementSpend);
    // Top-level fields: baseline = the plan as entered, recommended = the answer.
    expect(res.baselineInputs).toEqual(base);
    expect(res.baselineSuccessRate).toBe(res.baselineMonteCarlo!.successRate);
    expect(res.recommendedSuccessRate).toBe(s.achievedSuccessRate);
    expect(res.recommendedMonteCarlo!.successRate).toBe(s.achievedSuccessRate);
    expect(res.recommendedInputs.withdrawalStrategy).toBe(s.withdrawalStrategy);
    expect(s.strategyChanged).toBe(s.withdrawalStrategy !== (base.withdrawalStrategy ?? 'tax-efficient'));
    expect(res.decisions).toHaveLength(base.spouse ? 2 : 1);
    if (!s.haveEnough) expect(s.strategyChangeNeeded).toBe(false);
}

// --- Tests ------------------------------------------------------------------

describe('optimizeMeltdown (savings-needed objective)', () => {
    it('needs more: the answer clears the bar, on the plan’s own mix scaled up', async () => {
        const base = needsMore();
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);

        expect(s.basis).toBe('proportional');
        expect(s.currentSavings).toBe(480_000);
        expect(s.haveEnough).toBe(false);
        expect(res.improved).toBe(true);
        expect(s.deterministicSavings!).toBeGreaterThan(s.currentSavings); // even average returns fall short
        expect(s.boundHit).toBe(false);
        expect(s.achievedSuccessRate!).toBeGreaterThanOrEqual(85);
        expect(res.baselineSuccessRate!).toBeLessThan(85);

        // The deterministic answer is the smallest total that ANY strategy can
        // fund on average returns, to the search's precision (single person: the
        // inner check is exhaustive, so the brute-force oracle is exact).
        const det = s.deterministicSavings!;
        expect(anyStrategyFeasible(allocateSavings(base, det).inputs)).toBe(true);
        expect(anyStrategyFeasible(allocateSavings(base, det - detPrecision(det)).inputs)).toBe(false);

        // Proportional: every balance (and the non-reg cost base) scaled by one factor.
        const k = s.neededSavings! / s.currentSavings;
        const rec = res.recommendedInputs.person;
        expect(rec.rrsp.balance).toBeCloseTo(300_000 * k, 4);
        expect(rec.tfsa.balance).toBeCloseTo(80_000 * k, 4);
        expect(rec.nonRegisteredAccounts[0].balance).toBeCloseTo(100_000 * k, 4);
        expect(rec.nonRegisteredAccounts[0].adjustedCostBase).toBeCloseTo(80_000 * k, 4);
        expect(s.neededAccounts[0]).toMatchObject({ who: 'person', label: 'You' });
        expect(s.neededAccounts[0].rrsp).toBeCloseTo(rec.rrsp.balance, 6);
        expect(s.neededAccounts[0].tfsa).toBeCloseTo(rec.tfsa.balance, 6);
        expect(s.neededAccounts[0].nonReg).toBeCloseTo(rec.nonRegisteredAccounts[0].balance, 6);

        // At retirement (10 years out), today's dollars. The current-savings side
        // is the answer's strategy at the plan's own balances, so the two runs
        // differ only by savings.
        expect(s.stillWorking).toBe(true);
        expect(s.reportedWho).toBe('person');
        expect(s.currentAge).toBe(50);
        expect(s.retirementAge).toBe(60);
        expect(s.neededAtRetirement).toBeCloseTo(householdSavingsAtRetirement(res.recommendedResults, 10)!, 6);
        const answerStrategyAtCurrent = applyMeltdownRecommendation(base, res.recommendedInputs, 'savings-needed');
        expect(householdSavings(answerStrategyAtCurrent)).toBe(s.currentSavings);
        expect(s.currentAtRetirement)
            .toBeCloseTo(householdSavingsAtRetirement(runSimulation(answerStrategyAtCurrent), 10)!, 6);
        expect(s.currentAtRetirement!).toBeGreaterThan(0);
        expect(s.neededAtRetirement!).toBeGreaterThan(s.currentAtRetirement!);
        // Ten more years of real growth and saving: more on retirement day than today.
        expect(s.neededAtRetirement!).toBeGreaterThan(s.neededSavings!);

        if (s.badMarketsAge !== null) expect(s.badMarketsAge).toBeGreaterThanOrEqual(60);
    }, 60_000);

    it('has enough: the margin is reported and nothing is "improved"', async () => {
        const base = hasEnough();
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.currentSavings).toBe(1_000_000);
        expect(s.haveEnough).toBe(true);
        expect(s.needIsZero).toBe(false);
        expect(s.neededSavings!).toBeLessThan(s.currentSavings);
        expect(s.savingsGap!).toBeLessThan(0);
        expect(res.improved).toBe(false);
        expect(s.achievedSuccessRate!).toBeGreaterThanOrEqual(85);
        expect(s.currentAtRetirement!).toBeGreaterThan(s.neededAtRetirement!);
    }, 60_000);

    it('guaranteed income covers the spending: the need is $0', async () => {
        const base = inputs({
            person: person({ pension: { annualAmount: 80_000, startAge: 60, indexedToInflation: true } }),
        });
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.deterministicSavings).toBe(0);
        expect(s.neededSavings).toBe(0);
        expect(s.needIsZero).toBe(true);
        expect(s.haveEnough).toBe(true);
        expect(res.improved).toBe(false);
        expect(s.neededAccounts.every(a => a.total === 0)).toBe(true);
        expect(s.achievedSuccessRate!).toBeGreaterThanOrEqual(85);
        // Whatever the working years sweep into accounts is all there is on
        // retirement day.
        expect(s.neededAtRetirement!).toBeLessThan(s.currentAtRetirement!);
    }, 60_000);

    it('nothing saved today: the stated default mix, TFSA up to the room built up, then RRSP', async () => {
        const base = inputs({
            person: person({ age: 30, retirementAge: 65, ...noSavings }),
            preRetirementSpend: 60_000,
            postRetirementSpend: 70_000,
        });
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.basis).toBe('default');
        expect(s.currentSavings).toBe(0);
        expect(s.neededSavings!).toBeGreaterThan(0);
        expect(res.improved).toBe(true);
        const [acc] = s.neededAccounts;
        const room = tfsaRoomAccumulated(30);
        expect(acc.tfsa).toBeCloseTo(Math.min(s.neededSavings!, room), 6);
        expect(acc.rrsp).toBeCloseTo(Math.max(0, s.neededSavings! - room), 6);
        expect(acc.nonReg).toBe(0);
        // With nothing saved, the current side holds only what the working
        // years sweep in.
        expect(s.neededAtRetirement!).toBeGreaterThan(s.currentAtRetirement!);
        expect(s.currentAtRetirement!).toBeGreaterThanOrEqual(0);
    }, 60_000);

    it('nothing saved, couple: the default mix splits evenly between the two', async () => {
        const base = inputs({
            person: person({ age: 40, retirementAge: 65, ...noSavings }),
            spouse: person({ age: 38, retirementAge: 65, currentIncome: 60_000, ...noSavings }),
            preRetirementSpend: 110_000,
            postRetirementSpend: 100_000,
        });
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.basis).toBe('default');
        const [you, spouse] = s.neededAccounts;
        expect(you.total).toBeCloseTo(s.neededSavings! / 2, 6);
        expect(spouse.total).toBeCloseTo(s.neededSavings! / 2, 6);
        expect(you.tfsa).toBeCloseTo(Math.min(s.neededSavings! / 2, tfsaRoomAccumulated(40)), 6);
        expect(spouse.tfsa).toBeCloseTo(Math.min(s.neededSavings! / 2, tfsaRoomAccumulated(38)), 6);
    }, 120_000);

    it('the default couple has enough, with a two-person breakdown', async () => {
        const base = defaultCouple();
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.haveEnough).toBe(true);
        expect(s.neededAccounts).toHaveLength(2);
        // Proportional: each person keeps their share of the household's savings.
        const k = s.neededSavings! / s.currentSavings;
        expect(s.neededAccounts[1].total).toBeCloseTo((300_000 + 100_000 + 100_000) * k, 4);
    }, 120_000);

    it('unreachable: even the search cap cannot fund the spending', async () => {
        const base = needsMore();
        const res = await optimizeMeltdown(base, { ...SN, savingsSearchCap: 100_000 });
        const s = res.savingsNeeded!;
        expect(s.status).toBe('unreachable');
        expect(s.searchCap).toBe(100_000);
        expect(s.neededSavings).toBeNull();
        expect(s.deterministicSavings).toBeNull();
        expect(s.savingsGap).toBeNull();
        expect(s.haveEnough).toBe(false);
        expect(s.needIsZero).toBe(false);
        expect(s.neededAccounts).toEqual([]);
        expect(s.achievedSuccessRate).toBeNull();
        expect(s.badMarketsAge).toBeNull();
        expect(res.improved).toBe(false);
        expect(res.decisions).toEqual([]);
        expect(res.recommendedInputs).toEqual(base);
        // No answer strategy: the at-retirement total is the plan as entered.
        expect(s.neededAtRetirement).toBeNull();
        expect(s.currentAtRetirement).toBeCloseTo(householdSavingsAtRetirement(res.baselineResults, 10)!, 6);
        // Independently: no strategy funds the plan at the cap.
        expect(anyStrategyFeasible(allocateSavings(base, 100_000).inputs)).toBe(false);
    }, 60_000);

    it('already retired: the answer is today’s savings, with no at-retirement figures', async () => {
        const base = inputs({
            person: person({ age: 66, retirementAge: 65, currentIncome: 0, rrsp: { type: 'RRSP', balance: 500_000 } }),
        });
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.stillWorking).toBe(false);
        expect(s.reportedWho).toBe('person');
        expect(s.currentAge).toBe(66);
        expect(s.retirementAge).toBeNull();
        expect(s.neededAtRetirement).toBeNull();
        expect(s.currentAtRetirement).toBeNull();
        if (s.badMarketsAge !== null) expect(s.badMarketsAge).toBeGreaterThanOrEqual(66);
    }, 60_000);

    it('primary retired, spouse still working: framed on the spouse’s retirement', async () => {
        const base = inputs({
            person: person({ age: 63, retirementAge: 60, currentIncome: 0 }),
            spouse: person({ age: 55, retirementAge: 63 }),
            postRetirementSpend: 90_000,
        });
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.reportedWho).toBe('spouse');
        expect(s.currentAge).toBe(55);
        expect(s.retirementAge).toBe(63);
        expect(s.neededAtRetirement).toBeCloseTo(householdSavingsAtRetirement(res.recommendedResults, 8)!, 6);
        expect(res.recommendedInputs.spouse!.retirementAge).toBe(63);
        if (s.badMarketsAge !== null) expect(s.badMarketsAge).toBeGreaterThanOrEqual(63);
    }, 120_000);

    // --- The MC step-up, driven exactly by a stand-in ------------------------

    it('MC step-up: adds savings until the success bar clears, never below the deterministic answer', async () => {
        const base = needsMore();
        mcHooks.rate = () => 100; // everything clears: the answer is the deterministic one
        const plain = (await optimizeMeltdown(base, SN)).savingsNeeded!;
        expect(plain.neededSavings).toBe(plain.deterministicSavings);
        expect(plain.achievedSuccessRate).toBe(100);

        const det = plain.deterministicSavings!;
        const bar = Math.round(det * 1.6);
        mcHooks.rate = (i) => (householdSavings(i) >= bar - 1e-6 ? 90 : 50);
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.deterministicSavings).toBe(det);
        expect(s.neededSavings!).toBeGreaterThanOrEqual(bar);
        expect(s.neededSavings! - bar).toBeLessThanOrEqual(mcPrecision(s.neededSavings!));
        expect(s.achievedSuccessRate).toBe(90);
        expect(s.boundHit).toBe(false);
        expect(s.stepUpCapHit).toBe(false);
    }, 60_000);

    it('MC step-up: flags a bound hit when even the cap misses the bar', async () => {
        // Far below the bar, the steps are big enough to reach the cap
        // (20 × $480k) within the probe budget.
        mcHooks.rate = () => 30;
        const base = needsMore();
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expect(s.status).toBe('found');
        expect(s.boundHit).toBe(true);
        expect(s.stepUpCapHit).toBe(false);
        expect(s.achievedSuccessRate).toBe(30);
        // Every probe ties: the best probe is the smallest, the deterministic answer.
        expect(s.neededSavings).toBe(s.deterministicSavings);
    }, 60_000);

    it('MC step-up: flags a probe-budget cap hit when the bar stays out of reach short of the cap', async () => {
        // 25 pp short: 30% steps run out of probes before reaching the cap.
        mcHooks.rate = () => 60;
        const res = await optimizeMeltdown(needsMore(), SN);
        const s = res.savingsNeeded!;
        expect(s.status).toBe('found');
        expect(s.boundHit).toBe(false);
        expect(s.stepUpCapHit).toBe(true);
        expect(s.achievedSuccessRate).toBe(60);
        expect(s.neededSavings).toBe(s.deterministicSavings);
    }, 60_000);

    // The plan carries an RRSP melt of $12,345 — off every melt grid (multiples
    // of $500), so the answer's strategy always differs from it — which also tags
    // the plan-as-entered run for the stand-in.
    const PLAN_MELT = 12_345;
    const isPlanAsEntered = (i: SimulationInputs) => i.person.rrspMeltAmount === PLAN_MELT;
    const feasibleRate = (i: SimulationInputs) => (shortfallOf(i) > 1000 ? 0 : 100);

    it('has enough, but only with a different strategy: strategyChangeNeeded', async () => {
        mcHooks.rate = (i) => (isPlanAsEntered(i) ? 60 : feasibleRate(i));
        const base = hasEnough();
        base.person.rrspMeltAmount = PLAN_MELT;
        const res = await optimizeMeltdown(base, SN);
        const s = res.savingsNeeded!;
        expect(s.haveEnough).toBe(true);
        expect(res.baselineSuccessRate).toBe(60);
        expect(res.decisions[0].meltAmount).not.toBe(PLAN_MELT);
        expect(s.strategyChangeNeeded).toBe(true);
        expect(res.improved).toBe(false); // savings are fine; nothing to save more of
    }, 60_000);

    it('has enough and the plan as entered clears: no strategy change needed', async () => {
        mcHooks.rate = (i) => (isPlanAsEntered(i) ? 90 : feasibleRate(i));
        const base = hasEnough();
        base.person.rrspMeltAmount = PLAN_MELT;
        const res = await optimizeMeltdown(base, SN);
        expect(res.savingsNeeded!.haveEnough).toBe(true);
        expect(res.decisions[0].meltAmount).not.toBe(PLAN_MELT);
        expect(res.savingsNeeded!.strategyChangeNeeded).toBe(false);
    }, 60_000);

    // --- Plumbing --------------------------------------------------------------

    it('rejects with an AbortError when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(optimizeMeltdown(needsMore(), { ...SN, signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects with an AbortError when aborted mid-run', async () => {
        const controller = new AbortController();
        const run = optimizeMeltdown(needsMore(), {
            ...SN,
            signal: controller.signal,
            onProgress: (done, total) => { if (done / total > 0.1) controller.abort(); },
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    }, 60_000);

    it('reports monotone progress and finishes at 100%', async () => {
        const seen: number[] = [];
        let total = 0;
        await optimizeMeltdown(needsMore(), { ...SN, onProgress: (d, t) => { seen.push(d); total = t; } });
        expect(total).toBeGreaterThan(0);
        expect(seen[seen.length - 1]).toBe(total);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen.slice(0, -1).every(d => d < total)).toBe(true);
        // The deterministic phase alone moves the bar most of the way.
        expect(seen.some(d => d >= 0.5 * total && d < total)).toBe(true);
    }, 60_000);
});

// --- Follow-ups: the per-year framing and the age rows ---------------------

// Spending nothing before retiring at 60, from 58 on a modest salary, with
// $200k saved and $70k a year to fund: two years of saving can't get there.
const lateStarter = () => inputs({
    person: person({
        age: 58, retirementAge: 60, currentIncome: 60_000,
        rrsp: { type: 'RRSP', balance: 150_000 }, tfsa: { type: 'TFSA', balance: 50_000 },
        nonRegisteredAccounts: [nonReg()],
    }),
    preRetirementSpend: 40_000, postRetirementSpend: 70_000,
});

// The plan with the answer's strategy (as the rows hold it) and its ages moved by Δ.
function heldAt(base: SimulationInputs, res: MeltdownResult, delta: number): SimulationInputs {
    const moved = applyRetirementShift(base, planAgeShift(base), delta).inputs;
    return applyMeltdownRecommendation(moved, res.recommendedInputs, 'savings-needed');
}

// The contract for any table of rows, whatever MC did.
function expectRowInvariants(base: SimulationInputs, res: MeltdownResult): void {
    const s = res.savingsNeeded!;
    const rows = s.ageRows!;
    const target = s.mcSuccessTarget;
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map(r => r.delta)).toEqual([...rows.map(r => r.delta)].sort((a, b) => a - b));
    const plan = rows.filter(r => r.isPlan);
    expect(plan).toHaveLength(1);
    // The plan row IS the headline answer.
    expect(plan[0]).toMatchObject({
        delta: 0, status: 'found',
        neededSavings: s.neededSavings, neededAtRetirement: s.neededAtRetirement,
        currentAtRetirement: s.currentAtRetirement, savingsGap: s.savingsGap, haveEnough: s.haveEnough,
        successRateAtCurrent: res.baselineSuccessRate, stepUpCapHit: s.stepUpCapHit, boundHit: s.boundHit,
    });
    const reported = personOf(base, s.reportedWho);
    for (const r of rows) {
        expect(r.retirementAge).toBe(reported.retirementAge + r.delta);
        expect(r.status === 'unreachable').toBe(r.neededSavings === null);
        if (r.neededSavings !== null) expect(r.savingsGap).toBeCloseTo(r.neededSavings - s.currentSavings, 6);
        if (r.isPlan) continue;
        expect(r.haveEnough).toBe(r.clears && r.neededSavings !== null && r.neededSavings <= s.currentSavings);
        // Each row agrees with its own odds at current savings.
        if (r.successRateAtCurrent >= target) expect(r.haveEnough).toBe(true);
        else expect(r.neededSavings === null || r.neededSavings > s.currentSavings).toBe(true);
    }
}

describe('optimizeMeltdown (savings-needed follow-ups)', () => {
    // --- Per-year framing ----------------------------------------------------

    it('per year: spending R less before retiring clears the bar at today’s balances', async () => {
        const base = defaultSingle(); // 48, retiring at 60, $850k saved: needs more
        const res = await optimizeMeltdown(base, SN_PER_YEAR);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.haveEnough).toBe(false);
        expect(s.ageRows).toEqual([]);

        const p = s.perYear!;
        expect(p.status).toBe('found');
        expect(p.clears).toBe(true);
        expect(p.currentPreRetirementSpend).toBe(base.preRetirementSpend);
        expect(p.searchCap).toBe(base.preRetirementSpend);
        expect(p.yearsOfSaving).toBe(12);
        expect(p.yearsOfSaving).toBe(preRetirementSpendYears(base));
        expect(p.extraPerYear!).toBeGreaterThan(0);
        expect(p.extraPerYear!).toBeGreaterThanOrEqual(p.deterministicExtraPerYear!);
        expect(p.newPreRetirementSpend).toBe(base.preRetirementSpend - p.extraPerYear!);
        expect(p.achievedSuccessRate!).toBeGreaterThanOrEqual(85);

        // The plan at the answer: today's balances, the spending cut, ages and
        // retirement spending as entered, funded on average returns.
        const rec = p.recommendedInputs!;
        expect(rec.preRetirementSpend).toBe(p.newPreRetirementSpend);
        expect(householdSavings(rec)).toBe(s.currentSavings);
        expect(rec.person.rrsp).toEqual(base.person.rrsp);
        expect(rec.postRetirementSpend).toBe(base.postRetirementSpend);
        expect(rec.person.retirementAge).toBe(base.person.retirementAge);
        expect(rec.withdrawalStrategy).toBe(p.withdrawalStrategy);
        expect(p.strategyChanged).toBe(p.withdrawalStrategy !== base.withdrawalStrategy);
        expect(p.decisions).toHaveLength(1);
        expect(shortfallOf(rec)).toBeLessThanOrEqual(1000);

        // On retirement day: what the extra saving builds, next to the lump
        // sum's figures. More than the current path; roughly what the lump sum
        // needs then (a different account mix and less pre-retirement market
        // risk, so not equal).
        expect(p.atRetirement).toBeCloseTo(householdSavingsAtRetirement(runSimulation(rec), 12)!, 6);
        expect(p.atRetirement!).toBeGreaterThan(s.currentAtRetirement!);
        expect(p.atRetirement! / s.neededAtRetirement!).toBeGreaterThan(0.7);
        expect(p.atRetirement! / s.neededAtRetirement!).toBeLessThan(1.3);
    }, 60_000);

    it('per year: the MC step-up raises R until the bar clears, and flags a bound hit when even $0 spending misses', async () => {
        const base = needsMore();
        const pre = base.preRetirementSpend;
        // No noise anywhere: every answer is its deterministic one.
        mcHooks.rate = averageReturnsRate;
        const plain = (await optimizeMeltdown(base, SN_PER_YEAR)).savingsNeeded!;
        const p0 = plain.perYear!;
        expect(p0.status).toBe('found');
        expect(p0.deterministicExtraPerYear!).toBeGreaterThan(0);
        expect(p0.extraPerYear).toBe(p0.deterministicExtraPerYear);
        expect(p0.achievedSuccessRate).toBe(100);

        // Cutting spending clears the bar only from `bar` a year up.
        const det = p0.deterministicExtraPerYear!;
        const bar = Math.round((det * 1.5) / 100) * 100;
        expect(bar).toBeLessThan(pre);
        const cut = (i: SimulationInputs) => pre - i.preRetirementSpend;
        mcHooks.rate = (i) => (cut(i) > 0 ? (cut(i) >= bar - 1e-6 ? 90 : 50) : averageReturnsRate(i));
        const p = (await optimizeMeltdown(base, SN_PER_YEAR)).savingsNeeded!.perYear!;
        expect(p.deterministicExtraPerYear).toBe(det);
        expect(p.extraPerYear!).toBeGreaterThanOrEqual(bar);
        expect(p.extraPerYear! - bar).toBeLessThanOrEqual(Math.max(PER_YEAR_PRECISION_ABS, PER_YEAR_PRECISION_REL * p.extraPerYear!));
        expect(p.achievedSuccessRate).toBe(90);
        expect(p.clears).toBe(true);
        expect(p.boundHit).toBe(false);
        expect(p.stepUpCapHit).toBe(false);

        mcHooks.rate = (i) => (cut(i) > 0 ? 50 : averageReturnsRate(i));
        const none = (await optimizeMeltdown(base, SN_PER_YEAR)).savingsNeeded!.perYear!;
        expect(none.status).toBe('found');
        expect(none.boundHit).toBe(true);
        expect(none.clears).toBe(false);
        expect(none.achievedSuccessRate).toBe(50);
    }, 60_000);

    it('per year: unreachable when even spending nothing before retiring fails on average returns', async () => {
        mcHooks.rate = averageReturnsRate;
        const base = lateStarter();
        const res = await optimizeMeltdown(base, SN_PER_YEAR);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expect(s.haveEnough).toBe(false);
        expect(s.perYear).toEqual({
            status: 'unreachable', clears: false,
            extraPerYear: null, deterministicExtraPerYear: null,
            currentPreRetirementSpend: 40_000, newPreRetirementSpend: null,
            yearsOfSaving: 2, searchCap: 40_000,
            achievedSuccessRate: null, stepUpCapHit: false, boundHit: false, atRetirement: null,
            withdrawalStrategy: 'tax-efficient', strategyChanged: false, decisions: [], recommendedInputs: null,
        });
        // Independently: no strategy funds the plan as entered with nothing spent before retiring.
        expect(anyStrategyFeasible({ ...structuredClone(base), preRetirementSpend: 0 })).toBe(false);
    }, 60_000);

    it('per year: null when it does not apply', async () => {
        mcHooks.rate = averageReturnsRate;
        // Has enough.
        expect((await optimizeMeltdown(hasEnough(), SN_PER_YEAR)).savingsNeeded!.perYear).toBeNull();
        // Already retired: no pre-retirement years to save in.
        const retired = inputs({
            person: person({ age: 66, retirementAge: 65, currentIncome: 0 }),
            postRetirementSpend: 80_000,
        });
        const r = (await optimizeMeltdown(retired, SN_PER_YEAR)).savingsNeeded!;
        expect(r.haveEnough).toBe(false);
        expect(r.perYear).toBeNull();
        // Opted out.
        expect((await optimizeMeltdown(needsMore(), SN)).savingsNeeded!.perYear).toBeNull();
        // No lump-sum answer (unreachable), or none that clears the bar.
        expect((await optimizeMeltdown(needsMore(), { ...SN_PER_YEAR, savingsSearchCap: 100_000 }))
            .savingsNeeded!.perYear).toBeNull();
        mcHooks.rate = () => 30;
        const noClear = (await optimizeMeltdown(needsMore(), SN_PER_YEAR)).savingsNeeded!;
        expect(noClear.boundHit).toBe(true);
        expect(noClear.perYear).toBeNull();
    }, 60_000);

    // --- Savings needed at each retirement age -------------------------------

    it('age rows: Δ −3…+3, the plan row is the headline answer, and each row matches the engine on the held strategy', async () => {
        mcHooks.rate = averageReturnsRate;
        const base = needsMore();
        const res = await optimizeMeltdown(base, SN_ROWS);
        const s = res.savingsNeeded!;
        expectFoundInvariants(base, res);
        expectRowInvariants(base, res);
        const rows = s.ageRows!;
        expect(rows.map(r => r.delta)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
        expect(rows.map(r => r.retirementAge)).toEqual([57, 58, 59, 60, 61, 62, 63]);
        expect(rows.every(r => r.otherRetirementAge === undefined)).toBe(true);
        expect(s.perYear).toBeNull(); // opted out
        for (const r of rows) {
            expect(r.clears).toBe(true);
            if (r.isPlan) continue;
            // At-retirement figures: the held strategy's runs at current
            // savings and at the row's need, on the row's own retirement day.
            const held = heldAt(base, res, r.delta);
            const years = 10 + r.delta;
            expect(r.currentAtRetirement).toBeCloseTo(householdSavingsAtRetirement(runSimulation(held), years)!, 6);
            expect(r.neededAtRetirement).toBeCloseTo(
                householdSavingsAtRetirement(runSimulation(allocateSavings(held, r.neededSavings!).inputs), years)!, 6);
            expect(r.successRateAtCurrent).toBe(averageReturnsRate(held));
        }
        // Later retirement: more working years, a shorter retirement — no more needed.
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].neededSavings!).toBeLessThanOrEqual(rows[i - 1].neededSavings!);
        }
        expect(rows[6].neededSavings!).toBeLessThan(rows[0].neededSavings!);
    }, 60_000);

    it('age rows, real MC: later ages need no more, and each row agrees with its odds at current savings', async () => {
        const base = needsMore();
        const res = await optimizeMeltdown(base, SN_ROWS);
        expectRowInvariants(base, res);
        const rows = res.savingsNeeded!.ageRows!;
        expect(rows.map(r => r.delta)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
        // Smoothed where both rows clear (MC wobble can't invert the order).
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].clears && rows[i - 1].clears) {
                expect(rows[i].neededSavings!).toBeLessThanOrEqual(rows[i - 1].neededSavings!);
            }
        }
        // $480k is far short at every one of these ages.
        expect(rows.every(r => !r.haveEnough)).toBe(true);
    }, 60_000);

    it('age rows, real MC: a row that clears at current savings has enough', async () => {
        const base = hasEnough();
        const res = await optimizeMeltdown(base, SN_ROWS);
        expectRowInvariants(base, res);
        const rows = res.savingsNeeded!.ageRows!;
        for (const r of rows.filter(x => !x.isPlan && x.successRateAtCurrent >= 85)) {
            expect(r.haveEnough).toBe(true);
            expect(r.neededSavings!).toBeLessThanOrEqual(res.savingsNeeded!.currentSavings);
            expect(r.savingsGap!).toBeLessThanOrEqual(0);
        }
        // $1M on $40k a year: retiring later than planned has plenty of room.
        expect(rows.filter(r => r.delta > 0).every(r => r.haveEnough)).toBe(true);
    }, 60_000);

    it('age rows: clamped to the age-shift bounds; a couple’s rows move both', async () => {
        mcHooks.rate = averageReturnsRate;
        const soon = inputs({ person: person({ age: 50, retirementAge: 52 }), postRetirementSpend: 45_000 });
        const soonRows = (await optimizeMeltdown(soon, SN_ROWS)).savingsNeeded!.ageRows!;
        expect(soonRows.map(r => r.delta)).toEqual([-2, -1, 0, 1, 2, 3]);
        expect(soonRows[0].retirementAge).toBe(50);
        // Retiring this year: no working year left to end on.
        expect(soonRows[0].neededAtRetirement).toBeNull();
        expect(soonRows[0].currentAtRetirement).toBeNull();

        const late = inputs({ person: person({ age: 64, retirementAge: 74 }), postRetirementSpend: 70_000 });
        expect((await optimizeMeltdown(late, SN_ROWS)).savingsNeeded!.ageRows!.map(r => r.delta))
            .toEqual([-3, -2, -1, 0, 1]); // 75 is the latest age the search moves anyone to

        const couple = inputs({
            person: person({ age: 50, retirementAge: 60 }),
            spouse: person({ age: 48, retirementAge: 62, currentIncome: 60_000 }),
            postRetirementSpend: 95_000,
        });
        const res = await optimizeMeltdown(couple, SN_ROWS);
        expectRowInvariants(couple, res);
        for (const r of res.savingsNeeded!.ageRows!) {
            expect(r.retirementAge).toBe(60 + r.delta);
            expect(r.otherRetirementAge).toBe(62 + r.delta);
        }
    }, 120_000);

    it('age rows: none when nobody is still working, no shared shift exists, the answer is unreachable, or opted out', async () => {
        mcHooks.rate = averageReturnsRate;
        const retired = inputs({ person: person({ age: 66, retirementAge: 65, currentIncome: 0 }) });
        expect((await optimizeMeltdown(retired, SN_ROWS)).savingsNeeded!.ageRows).toEqual([]);
        // Two working spouses whose allowed ranges don't overlap.
        const apart = inputs({
            person: person({ age: 74, retirementAge: 75 }),
            spouse: person({ age: 40, retirementAge: 80 }),
        });
        expect(planAgeShift(apart).available).toBe(false);
        expect((await optimizeMeltdown(apart, SN_ROWS)).savingsNeeded!.ageRows).toEqual([]);
        expect((await optimizeMeltdown(needsMore(), { ...SN_ROWS, savingsSearchCap: 100_000 }))
            .savingsNeeded!.ageRows).toEqual([]);
        expect((await optimizeMeltdown(needsMore(), SN)).savingsNeeded!.ageRows).toEqual([]);
    }, 120_000);

    // --- Plumbing --------------------------------------------------------------

    it('with both follow-ups on, progress stays monotone through every phase and finishes at 100%', async () => {
        const seen: number[] = [];
        let total = 0;
        const res = await optimizeMeltdown(defaultSingle(), { ...SN_FULL, onProgress: (d, t) => { seen.push(d); total = t; } });
        expect(res.savingsNeeded!.perYear).not.toBeNull();
        expect(res.savingsNeeded!.ageRows!.length).toBe(7);
        expect(seen[seen.length - 1]).toBe(total);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen.slice(0, -1).every(d => d < total)).toBe(true);
        // The follow-ups have slices of their own: the bar moves through the
        // last stretch before finishing, rather than jumping from the lump sum to 100%.
        expect(seen.some(d => d >= 0.9 * total && d < total)).toBe(true);
    }, 60_000);

    it('rejects with an AbortError when aborted during the follow-ups', async () => {
        const controller = new AbortController();
        const run = optimizeMeltdown(defaultSingle(), {
            ...SN_FULL,
            signal: controller.signal,
            onProgress: (done, total) => { if (done / total > 0.75) controller.abort(); },
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    }, 60_000);
});

describe('applyMeltdownRecommendation (savings-needed)', () => {
    it('never copies balances from a real answer — only the strategy fields', async () => {
        const base = needsMore();
        const res = await optimizeMeltdown(base, SN);
        const rec = res.recommendedInputs;
        // The answer holds different balances…
        expect(householdSavings(rec)).not.toBeCloseTo(householdSavings(base), 0);
        const applied = applyMeltdownRecommendation(base, rec, 'savings-needed');
        // …but applying it keeps the household's own.
        expect(applied.person.rrsp).toEqual(base.person.rrsp);
        expect(applied.person.tfsa).toEqual(base.person.tfsa);
        expect(applied.person.nonRegisteredAccounts).toEqual(base.person.nonRegisteredAccounts);
        expect(applied.person.cppStartAge).toBe(rec.person.cppStartAge);
        expect(applied.person.oasStartAge).toBe(rec.person.oasStartAge);
        expect(applied.person.rrspMeltAmount).toBe(rec.person.rrspMeltAmount);
        expect(applied.withdrawalStrategy).toBe(rec.withdrawalStrategy);
    }, 60_000);

    it('carries exactly what estate mode carries: no balances, ACB, ages or spending', () => {
        const current = inputs({ spouse: person({ age: 48 }) });
        const recommended = structuredClone(current);
        for (const p of [recommended.person, recommended.spouse!]) {
            p.rrsp.balance *= 3;
            p.tfsa.balance *= 3;
            p.nonRegisteredAccounts[0].balance *= 3;
            p.nonRegisteredAccounts[0].adjustedCostBase *= 3;
            p.retirementAge = 55;
            p.cppContributedYears = 30;
            p.cppStartAge = 70;
            p.oasStartAge = 70;
            p.rrspMeltAmount = 15_000;
        }
        recommended.postRetirementSpend = 99_999;
        recommended.withdrawalStrategy = 'rrsp-first';

        const applied = applyMeltdownRecommendation(current, recommended, 'savings-needed');
        expect(applied).toEqual(applyMeltdownRecommendation(current, recommended, 'estate'));
        for (const who of ['person', 'spouse'] as const) {
            const a = who === 'spouse' ? applied.spouse! : applied.person;
            const c = who === 'spouse' ? current.spouse! : current.person;
            expect(a.rrsp).toEqual(c.rrsp);
            expect(a.tfsa).toEqual(c.tfsa);
            expect(a.nonRegisteredAccounts).toEqual(c.nonRegisteredAccounts);
            expect(a.retirementAge).toBe(c.retirementAge);
            expect(a.cppContributedYears).toBe(c.cppContributedYears);
            expect(a.cppStartAge).toBe(70);
            expect(a.rrspMeltAmount).toBe(15_000);
        }
        expect(applied.postRetirementSpend).toBe(current.postRetirementSpend);
        expect(applied.withdrawalStrategy).toBe('rrsp-first');
    });
});
