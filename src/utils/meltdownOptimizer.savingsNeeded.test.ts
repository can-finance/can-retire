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
    buildMeltGrid,
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
    SAVINGS_DET_PRECISION_ABS,
    SAVINGS_DET_PRECISION_REL,
    SAVINGS_MC_PRECISION_ABS,
    SAVINGS_MC_PRECISION_REL,
} from './savingsSearch';

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

const SN: OptimizeMeltdownOptions = { objective: 'savings-needed', mcIterations: 100, mcSuccessTarget: 85 };

// --- Oracles ----------------------------------------------------------------

const shortfallOf = (i: SimulationInputs): number =>
    computeSummaryMetrics(runSimulation(i), i, false).totalShortfall;

// Brute force over the SAME candidate space the inner check searches (exported
// builders, the earliest-age melt density, both withdrawal orders): is any
// strategy deterministically feasible on these inputs? Re-implements the
// optimizer's private applyChoice so the oracle stays independent of it.
function anyStrategyFeasible(base: SimulationInputs): boolean {
    type Choice = { melt: number; cpp: number; oas: number };
    const choicesFor = (p: Person): Choice[] => {
        const out: Choice[] = [];
        for (const melt of buildMeltGrid(p, EARLIEST_AGE_MELT_STEPS)) {
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
    const pcs = choicesFor(base.person);
    const scs: (Choice | null)[] = base.spouse ? choicesFor(base.spouse) : [null];
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
