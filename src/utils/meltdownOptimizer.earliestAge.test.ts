// Engine-backed tests for the earliest-age ("When can I retire?") objective.
//
// Monte Carlo is replaced by a deterministic stand-in so these tests are exact
// and fast: by default a plan "succeeds" (100%) exactly when it is
// deterministically feasible, and its percentile bands are the deterministic
// balance path. With that stand-in the MC step-up never moves past the
// deterministic answer, so every assertion about ages is exact. Individual
// tests swap in a rate function (mcHooks.rate) to drive the step-up itself.
// The step-up's decision logic is covered MC-free in retirementAgeSearch.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NonRegisteredAccount, Person, SimulationInputs, MonteCarloResult } from '../engine/types';
import { runSimulation, runMonteCarlo } from '../engine/projection';
import { computeSummaryMetrics } from './summaryMetrics';
import { INITIAL_INPUTS, createDefaultPerson, DEFAULT_SPEND } from './inputSanitizer';
import {
    optimizeMeltdown,
    buildHouseholdMeltGrids,
    buildCppCandidates,
    buildOasCandidates,
    EARLIEST_AGE_MELT_STEPS,
    estimateSustainableSpend,
    maxSustainableSpend,
} from './meltdownOptimizer';
import type { MeltdownResult, OptimizeMeltdownOptions } from './meltdownOptimizer';
import { applyRetirementShift, planAgeShift, shiftCppContributedYears } from './retirementAgeSearch';

const mcHooks = vi.hoisted(() => ({
    rate: null as null | ((inputs: SimulationInputs) => number),
    calls: 0,
}));

vi.mock('../engine/projection', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../engine/projection')>();
    const deterministicMc = (inputs: SimulationInputs): MonteCarloResult => {
        mcHooks.calls++;
        const results = actual.runSimulation(inputs);
        const shortfall = results.reduce((s, r) => s + r.shortfall, 0);
        const successRate = mcHooks.rate ? mcHooks.rate(inputs) : (shortfall > 1000 ? 0 : 100);
        return {
            percentiles: results.map(r => ({
                year: r.year, age: r.age,
                p5: r.totalAssets, p25: r.totalAssets, p50: r.totalAssets, p75: r.totalAssets, p95: r.totalAssets,
            })),
            successRate,
            medianEndOfPlanAssets: results.length ? results[results.length - 1].totalAssets : 0,
        };
    };
    return { ...actual, runMonteCarlo: vi.fn(deterministicMc) };
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

const defaultSingle = (): SimulationInputs => structuredClone(INITIAL_INPUTS);
const defaultCouple = (): SimulationInputs => ({
    ...structuredClone(INITIAL_INPUTS),
    spouse: createDefaultPerson(true),
    preRetirementSpend: DEFAULT_SPEND.couple.pre,
    postRetirementSpend: DEFAULT_SPEND.couple.post,
});

const EA: OptimizeMeltdownOptions = { objective: 'earliest-age', mcIterations: 10, mcSuccessTarget: 85 };

// --- Oracles ----------------------------------------------------------------

const shortfallOf = (i: SimulationInputs): number =>
    computeSummaryMetrics(runSimulation(i), i, false).totalShortfall;

// Brute force over the SAME candidate space the inner check searches (exported
// builders, the earliest-age melt density, both withdrawal orders): is any
// strategy deterministically feasible on these inputs? Re-implements the
// optimizer's private applyChoice so the oracle stays independent of it.
function anyStrategyFeasible(base: SimulationInputs, considerCppOas: boolean): boolean {
    type Choice = { melt: number; cpp: number; oas: number };
    // Melt grids anchor on each person's projected balance at melt start.
    const meltGrids = buildHouseholdMeltGrids(base, EARLIEST_AGE_MELT_STEPS);
    const choicesFor = (p: Person, meltGrid: number[]): Choice[] => {
        const out: Choice[] = [];
        for (const melt of meltGrid) {
            for (const cpp of buildCppCandidates(p, considerCppOas)) {
                for (const oas of buildOasCandidates(p, considerCppOas)) out.push({ melt, cpp, oas });
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

// The core contract for a 'found' answer: the recommended plan is feasible, and
// (unless the answer is the earliest age the search can test) no strategy at all
// is feasible a year earlier.
// `interior` (default true) also asserts the fixture is non-degenerate — the
// answer is above the lower bound, so the year-earlier oracle actually runs.
function expectEarliest(base: SimulationInputs, res: MeltdownResult, interior = true): void {
    const ea = res.earliestAge!;
    expect(ea.status).toBe('found');
    expect(shortfallOf(res.recommendedInputs)).toBeLessThanOrEqual(1000);
    if (interior) expect(ea.atLowerBound).toBe(false);
    if (!ea.atLowerBound) {
        const plan = planAgeShift(base);
        const yearEarlier = applyRetirementShift(base, plan, ea.deltaYears! - 1).inputs;
        expect(anyStrategyFeasible(yearEarlier, true)).toBe(false);
    }
}

// --- Tests ------------------------------------------------------------------

describe('optimizeMeltdown (earliest-age objective)', () => {
    it('single default plan: earliest feasible age, with CPP years following it', async () => {
        const base = defaultSingle();
        const res = await optimizeMeltdown(base, EA);
        const ea = res.earliestAge!;

        expect(res.objective).toBe('earliest-age');
        expectEarliest(base, res);
        // Deterministic MC stand-in: the step-up has nothing to add.
        expect(ea.answerAge).toBe(ea.deterministicAge);
        expect(ea.reportedWho).toBe('person');
        expect(ea.planAge).toBe(60);
        expect(ea.currentAge).toBe(48);
        expect(ea.deltaYears).toBe(ea.answerAge! - 60);
        expect(res.improved).toBe(ea.answerAge !== 60 || ea.strategyChangeNeeded);
        expect(ea.onTrack).toBe(ea.answerAge === 60);
        if (ea.answerAge !== 60) expect(ea.strategyChangeNeeded).toBe(false);

        // recommendedInputs carry the shifted age and the CPP years that follow it.
        const expectedYears = shiftCppContributedYears(35, 60, ea.answerAge!);
        expect(res.recommendedInputs.person.retirementAge).toBe(ea.answerAge);
        expect(res.recommendedInputs.person.cppContributedYears).toBe(expectedYears);
        expect(ea.people).toEqual([{
            who: 'person', label: 'You', currentAge: 48, planRetirementAge: 60,
            answerRetirementAge: ea.answerAge, planCppYears: 35, answerCppYears: expectedYears,
        }]);
        // Spending is held, not solved for.
        expect(res.recommendedInputs.postRetirementSpend).toBe(base.postRetirementSpend);
        expect(ea.postRetirementSpend).toBe(base.postRetirementSpend);
        // The melt now starts at the new retirement age.
        expect(res.decisions[0].meltStartAge).toBe(ea.answerAge);
        expect(ea.cppOverrideHeld).toBe(false);
        expect(ea.pensionHeld).toBe(false);
    }, 60_000);

    it('trade-off rows: answer − 2 … answer + 4, consistent with the answer', async () => {
        const res = await optimizeMeltdown(defaultSingle(), EA);
        const ea = res.earliestAge!;
        const ages = ea.rows.map(r => r.retirementAge);
        expect(ages).toEqual(Array.from({ length: ages.length }, (_, i) => ages[0] + i));
        expect(ages[0]).toBe(Math.max(ea.minAge, ea.answerAge! - 2));
        expect(ages[ages.length - 1]).toBe(Math.min(ea.maxAge, ea.answerAge! + 4));

        const answerRow = ea.rows.find(r => r.isAnswer)!;
        expect(answerRow.retirementAge).toBe(ea.answerAge);
        expect(answerRow.clearsTarget).toBe(true);
        expect(answerRow.successRate).toBe(ea.achievedSuccessRate);
        // Row estate/tax are in today's dollars: the inflation-adjusted metrics of
        // the answer's run. recommendedMetrics (what the search ranked on) stays
        // nominal, and with inflation > 0 the two differ.
        const real = computeSummaryMetrics(res.recommendedResults, res.recommendedInputs, true);
        const nominal = computeSummaryMetrics(res.recommendedResults, res.recommendedInputs, false);
        expect(res.recommendedMetrics.netEstateValue).toBeCloseTo(nominal.netEstateValue, 5);
        expect(res.recommendedMetrics.lifetimeTaxPaid).toBeCloseTo(nominal.lifetimeTaxPaid, 5);
        expect(answerRow.netEstate).toBeCloseTo(real.netEstateValue, 5);
        expect(answerRow.lifetimeTax).toBeCloseTo(real.lifetimeTaxPaid, 5);
        expect(res.recommendedInputs.inflationRate).toBeGreaterThan(0);
        expect(answerRow.netEstate).toBeLessThan(nominal.netEstateValue);
        expect(answerRow.lifetimeTax).toBeLessThan(nominal.lifetimeTaxPaid);
        for (const r of ea.rows) {
            expect(r.clearsTarget).toBe(r.retirementAge >= ea.answerAge!);
            expect(r.deterministicFeasible).toBe(r.retirementAge >= ea.answerAge!);
            expect(r.isPlan).toBe(r.retirementAge === 60);
            expect(r.otherRetirementAge).toBeUndefined();
        }

        // Every row gets a could-spend value. Clears at the planned spend → could
        // spend at least that; misses → less.
        expect(ea.rows.some(r => !r.clearsTarget)).toBe(true); // fixture has ✗ rows
        for (const r of ea.rows) {
            expect(r.couldSpend).not.toBeNull();
            if (r.clearsTarget) expect(r.couldSpend!).toBeGreaterThanOrEqual(ea.postRetirementSpend);
            else expect(r.couldSpend!).toBeLessThan(ea.postRetirementSpend);
        }

        // The answer row's value is the shared spend estimate on its winning
        // strategy (= recommendedInputs), warm-started from the row's own MC run
        // at the planned spend (= recommendedMonteCarlo).
        expect(res.recommendedMonteCarlo!.successRate).toBe(answerRow.successRate);
        const est = estimateSustainableSpend(res.recommendedInputs, {
            baselineMc: res.recommendedMonteCarlo!, mcIterations: EA.mcIterations!, mcSuccessTarget: 85,
        });
        expect(est.capHit).toBe(false);
        expect(answerRow.couldSpend).toBe(Math.max(est.spend, ea.postRetirementSpend));
        // With the deterministic stand-in nothing steps down: the estimate is the
        // winner's deterministic max, found without re-searching the strategy.
        expect(est.spend).toBe(est.deterministicMax);
        expect(est.deterministicMax).toBe(maxSustainableSpend(res.recommendedInputs).spend);

        // Bad-markets age, if any, comes after retirement.
        if (ea.badMarketsAge !== null) expect(ea.badMarketsAge).toBeGreaterThanOrEqual(ea.answerAge!);
    }, 60_000);

    it('could spend: steps down to the success bar on each row’s own strategy', async () => {
        const base = defaultSingle();
        const planned = base.postRetirementSpend;
        const bar = planned + 5_000;
        // Success clears 85% only at spends up to `bar`; the planned spend clears
        // at every age, so every row is ✓ and the step-down does the work.
        mcHooks.rate = (i) => (i.postRetirementSpend <= bar ? 90 : 60);
        const res = await optimizeMeltdown(base, EA);
        const ea = res.earliestAge!;
        const answerRow = ea.rows.find(r => r.isAnswer)!;

        for (const r of ea.rows) {
            expect(r.clearsTarget).toBe(true);
            expect(r.couldSpend).not.toBeNull();
            expect(r.couldSpend!).toBeGreaterThanOrEqual(planned);
            expect(r.couldSpend!).toBeLessThanOrEqual(bar);
        }
        // The answer row's value is the shared estimate on its winning strategy.
        const est = estimateSustainableSpend(res.recommendedInputs, {
            baselineMc: res.recommendedMonteCarlo!, mcIterations: EA.mcIterations!, mcSuccessTarget: 85,
        });
        expect(est.capHit).toBe(false);
        expect(answerRow.couldSpend).toBe(Math.max(est.spend, planned));

        // On fixed inputs, with the bar well below the deterministic max, the
        // estimate steps down to within one step-down precision ($2,500) of it.
        const detMax = maxSustainableSpend(res.recommendedInputs).spend;
        const lowBar = detMax - 7_000;
        mcHooks.rate = (i) => (i.postRetirementSpend <= lowBar ? 90 : 60);
        const stepped = estimateSustainableSpend(res.recommendedInputs, {
            baselineMc: runMonteCarlo(res.recommendedInputs, 10), mcIterations: EA.mcIterations!, mcSuccessTarget: 85,
        });
        expect(stepped.deterministicMax).toBe(detMax);
        expect(stepped.capHit).toBe(false);
        expect(stepped.spend).toBeGreaterThan(lowBar - 2_500);
        expect(stepped.spend).toBeLessThanOrEqual(lowBar);
        expect(stepped.successRate).toBe(90);
    }, 60_000);

    it('could spend: null when no spend clears the bar', async () => {
        mcHooks.rate = () => 60;
        const res = await optimizeMeltdown(defaultSingle(), EA);
        expect(res.earliestAge!.rows.every(r => r.couldSpend === null)).toBe(true);
    }, 60_000);

    it('couldSpendRows "none" skips the could-spend estimates', async () => {
        const res = await optimizeMeltdown(defaultSingle(), { ...EA, couldSpendRows: 'none' });
        expect(res.earliestAge!.rows.every(r => r.couldSpend === null)).toBe(true);
    }, 60_000);

    it('couple: both still working move together by the same number of years', async () => {
        const base = defaultCouple();
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expectEarliest(base, res);

        const delta = ea.deltaYears!;
        expect(res.recommendedInputs.person.retirementAge).toBe(60 + delta);
        expect(res.recommendedInputs.spouse!.retirementAge).toBe(60 + delta);
        expect(res.recommendedInputs.person.cppContributedYears).toBe(shiftCppContributedYears(35, 60, 60 + delta));
        expect(res.recommendedInputs.spouse!.cppContributedYears).toBe(shiftCppContributedYears(35, 60, 60 + delta));
        expect(ea.people.map(p => p.who)).toEqual(['person', 'spouse']);
        expect(ea.rows.every(r => r.otherRetirementAge === r.retirementAge)).toBe(true); // both planned 60
        expect(res.decisions).toHaveLength(2);
    }, 120_000);

    it('couple with the spouse already retired: only the primary moves', async () => {
        const base = inputs({
            person: person({ age: 52, retirementAge: 62 }),
            spouse: person({ age: 60, retirementAge: 58, currentIncome: 0, cppContributedYears: 30 }),
            postRetirementSpend: 90_000,
        });
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expectEarliest(base, res);
        expect(ea.reportedWho).toBe('person');
        expect(ea.people.map(p => p.who)).toEqual(['person']);
        expect(res.recommendedInputs.spouse!.retirementAge).toBe(58);
        expect(res.recommendedInputs.spouse!.cppContributedYears).toBe(30);
        expect(ea.rows.every(r => r.otherRetirementAge === undefined)).toBe(true);
    }, 120_000);

    it('primary already retired: the spouse moves and the answer is reported in their age', async () => {
        const base = inputs({
            person: person({ age: 63, retirementAge: 60, currentIncome: 0 }),
            spouse: person({ age: 55, retirementAge: 63 }),
            postRetirementSpend: 90_000,
        });
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expectEarliest(base, res);
        expect(ea.reportedWho).toBe('spouse');
        expect(ea.currentAge).toBe(55);
        expect(ea.planAge).toBe(63);
        expect(res.recommendedInputs.spouse!.retirementAge).toBe(ea.answerAge);
        expect(res.recommendedInputs.person.retirementAge).toBe(60);
    }, 120_000);

    it('DB pension: held exactly as entered, and flagged for disclosure', async () => {
        const pension = { annualAmount: 28_000, startAge: 62, indexedToInflation: true };
        const base = inputs({
            person: person({ age: 55, retirementAge: 62, pension }),
            postRetirementSpend: 60_000,
        });
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expectEarliest(base, res);
        expect(ea.pensionHeld).toBe(true);
        expect(res.recommendedInputs.person.pension).toEqual(pension);
    }, 60_000);

    it('a CPP Calculator estimate is held fixed and flagged', async () => {
        const base = inputs({ person: person({ cppAnnualOverride: 11_000, cppOverrideStartAge: 65 }) });
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expectEarliest(base, res);
        expect(ea.cppOverrideHeld).toBe(true);
        expect(res.recommendedInputs.person.cppAnnualOverride).toBe(11_000);
        // The search may move CPP's start age; the estimate's base age stays put
        expect(res.recommendedInputs.person.cppOverrideStartAge).toBe(65);
        expect(res.recommendedInputs.person.cppContributedYears).toBe(35);
    }, 60_000);

    it('"retire now": a well-funded plan clears at today’s age', async () => {
        const base = inputs({
            person: person({
                age: 55, retirementAge: 65,
                rrsp: { type: 'RRSP', balance: 1_500_000 },
                tfsa: { type: 'TFSA', balance: 200_000 },
                nonRegisteredAccounts: [nonReg({ balance: 800_000, adjustedCostBase: 600_000 })],
            }),
            postRetirementSpend: 50_000,
        });
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expectEarliest(base, res, false);
        expect(ea.answerAge).toBe(55);
        expect(ea.retiresNow).toBe(true);
        expect(ea.atLowerBound).toBe(true);
        expect(ea.deltaYears).toBe(-10);
        expect(res.improved).toBe(true);
        expect(ea.rows[0].retirementAge).toBe(55); // clamped at the lower bound
    }, 60_000);

    it('unreachable: spending no age up to the cap can fund', async () => {
        const base = inputs({
            person: person({
                age: 50, retirementAge: 60, currentIncome: 60_000,
                rrsp: { type: 'RRSP', balance: 20_000 }, tfsa: { type: 'TFSA', balance: 0 },
                nonRegisteredAccounts: [nonReg()],
            }),
            preRetirementSpend: 40_000,
            postRetirementSpend: 150_000,
        });
        const res = await optimizeMeltdown(base, EA);
        const ea = res.earliestAge!;
        expect(ea.status).toBe('unreachable');
        expect(ea.answerAge).toBeNull();
        expect(ea.maxAge).toBe(75);
        expect(ea.rows).toEqual([]);
        expect(res.improved).toBe(false);
        expect(res.recommendedInputs).toEqual(base);
        // Independently: even the latest age has no feasible strategy.
        const latest = applyRetirementShift(base, planAgeShift(base), 15).inputs;
        expect(anyStrategyFeasible(latest, true)).toBe(false);
    }, 60_000);

    it('unavailable: nobody is still working', async () => {
        const base = inputs({ person: person({ age: 66, retirementAge: 65, currentIncome: 0 }) });
        const res = await optimizeMeltdown(base, EA);
        const ea = res.earliestAge!;
        expect(ea.status).toBe('unavailable');
        expect(ea.unavailableReason).toBe('nobody-working');
        expect(ea.people).toEqual([]);
        expect(res.improved).toBe(false);
        expect(res.recommendedInputs).toEqual(base);
    });

    it('MC step-up: moves later until the success bar clears', async () => {
        const base = defaultSingle();
        const det = (await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' })).earliestAge!.deterministicAge!;
        // Success only clears the bar three years past the deterministic answer.
        mcHooks.rate = (i) => (i.person.retirementAge >= det + 3 ? 90 : 60);
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expect(ea.deterministicAge).toBe(det);
        expect(ea.answerAge).toBe(det + 3);
        expect(ea.achievedSuccessRate).toBe(90);
        expect(ea.boundHit).toBe(false);
        expect(ea.stepUpCapHit).toBe(false);
        expect(res.recommendedInputs.person.retirementAge).toBe(det + 3);
        expect(shortfallOf(res.recommendedInputs)).toBeLessThanOrEqual(1000);
        for (const r of ea.rows) expect(r.clearsTarget).toBe(r.retirementAge >= det + 3);
    }, 60_000);

    // --- Apply when the plan's own age needs a strategy change ---------------
    //
    // The MC stand-in steers the step-up onto the plan's own age (65): every
    // earlier age misses, 65 and later clear. The plan carries an RRSP melt of
    // $12,345 — off every melt grid (multiples of $500), so the search's pick
    // always differs from it — which also tags the plan-as-entered run for the
    // stand-in, letting each test decide whether the user's own strategy clears.
    const PLAN_MELT = 12_345;
    const atPlanAge = () => inputs({
        person: person({ age: 50, retirementAge: 65, rrspMeltAmount: PLAN_MELT }),
        postRetirementSpend: 50_000,
    });
    const isPlanAsEntered = (i: SimulationInputs) => i.person.rrspMeltAmount === PLAN_MELT;

    it('answer at the plan’s age, but only with a different strategy: improved, with something to apply', async () => {
        mcHooks.rate = (i) => (isPlanAsEntered(i) ? 60 : i.person.retirementAge >= 65 ? 90 : 60);
        const base = atPlanAge();
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;

        // Precondition: the step-up (not the bisection) put the answer on 65.
        expect(ea.deterministicAge!).toBeLessThan(65);
        expect(ea.answerAge).toBe(65);
        expect(ea.deltaYears).toBe(0);
        expect(ea.onTrack).toBe(true);
        // The plan as entered misses the bar; the answer's strategy clears it.
        expect(res.baselineSuccessRate).toBe(60);
        expect(ea.achievedSuccessRate).toBe(90);
        expect(res.decisions[0].meltAmount).not.toBe(PLAN_MELT);

        expect(ea.strategyChangeNeeded).toBe(true);
        expect(res.improved).toBe(true);
        // What Apply would carry: the same age, the answer's strategy.
        expect(res.recommendedInputs.person.retirementAge).toBe(65);
        expect(res.recommendedInputs.person.rrspMeltAmount).toBe(res.decisions[0].meltAmount);
    }, 60_000);

    it('answer at the plan’s age and the plan’s own strategy clears the bar: on track, nothing to apply', async () => {
        mcHooks.rate = (i) => (i.person.retirementAge >= 65 ? 90 : 60);
        const base = atPlanAge();
        const res = await optimizeMeltdown(base, { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;

        expect(ea.deterministicAge!).toBeLessThan(65);
        expect(ea.answerAge).toBe(65);
        expect(ea.onTrack).toBe(true);
        // The search still picked a different strategy (its melt can't be the
        // plan's), but the plan as entered already clears — so it's a
        // preference, not a fix.
        expect(res.decisions[0].meltAmount).not.toBe(PLAN_MELT);
        expect(res.baselineSuccessRate).toBe(90);

        expect(ea.strategyChangeNeeded).toBe(false);
        expect(res.improved).toBe(false);
    }, 60_000);

    it('MC step-up: flags a bound hit when even the latest age misses the bar', async () => {
        mcHooks.rate = () => 60;
        const res = await optimizeMeltdown(defaultSingle(), { ...EA, couldSpendRows: 'none' });
        const ea = res.earliestAge!;
        expect(ea.status).toBe('found');
        expect(ea.boundHit).toBe(true);
        expect(ea.achievedSuccessRate).toBe(60);
        expect(ea.rows.every(r => !r.clearsTarget)).toBe(true);
    }, 60_000);

    it('rejects with an AbortError when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(optimizeMeltdown(defaultSingle(), { ...EA, signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects with an AbortError when aborted mid-run', async () => {
        const controller = new AbortController();
        const run = optimizeMeltdown(defaultSingle(), {
            ...EA,
            signal: controller.signal,
            onProgress: (done, total) => { if (done / total > 0.1) controller.abort(); },
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    }, 60_000);

    it('reports monotone progress and finishes at 100%', async () => {
        const seen: number[] = [];
        let total = 0;
        await optimizeMeltdown(defaultSingle(), {
            ...EA,
            onProgress: (d, t) => { seen.push(d); total = t; },
        });
        expect(total).toBeGreaterThan(0);
        expect(seen[seen.length - 1]).toBe(total);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen.slice(0, -1).every(d => d < total)).toBe(true);
    }, 60_000);
});
