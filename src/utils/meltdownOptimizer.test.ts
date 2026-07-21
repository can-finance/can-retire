import { describe, it, expect } from 'vitest';
import type { Person, NonRegisteredAccount, SimulationInputs } from '../engine/types';
import { runSimulation } from '../engine/projection';
import { computeSummaryMetrics } from './summaryMetrics';
import {
    optimizeMeltdown,
    buildCppCandidates,
    buildOasCandidates,
    buildMeltGrid,
    applyMeltdownRecommendation,
} from './meltdownOptimizer';

// --- Fixtures (mirror engine test helpers) --------------------------------

const nonReg = (over: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0, receivesSurplus: true,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
    ...over,
});

const person = (over: Partial<Person> = {}): Person => ({
    age: 60, retirementAge: 60, lifeExpectancy: 90,
    currentIncome: 0, cppStartAge: 65, cppContributedYears: 35, oasStartAge: 65,
    rrsp: { type: 'RRSP', balance: 0 },
    tfsa: { type: 'TFSA', balance: 0 },
    nonRegisteredAccounts: [nonReg()],
    ...over,
});

const inputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => ({
    person: person(), province: 'ON', inflationRate: 0.02,
    preRetirementSpend: 0, postRetirementSpend: 40_000,
    oneTimeExpenses: [], useIncomeSplitting: false, withdrawalStrategy: 'tax-efficient',
    returnRates: {
        bondReturn: 0.03, cashInterest: 0.02, dividend: 0.03,
        capitalGrowth: 0.05, rrspGrowth: 0.05, tfsaGrowth: 0.05, volatility: 0.08,
    },
    ...over,
});

// A retired single with a large RRSP and modest spending — the classic meltdown
// candidate: the RRSP balloons and its terminal tax dominates the estate.
const bigRrspInputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 900_000 },
        tfsa: { type: 'TFSA', balance: 50_000 },
        nonRegisteredAccounts: [nonReg({ balance: 150_000, adjustedCostBase: 120_000 })],
    }),
    postRetirementSpend: 40_000,
    ...over,
});

const OPTS = { mcIterations: 15 } as const;

describe('optimizeMeltdown', () => {
    it('(a) recommends a meltdown that strictly improves net estate for a large RRSP', async () => {
        const res = await optimizeMeltdown(bigRrspInputs(), OPTS);
        expect(res.improved).toBe(true);
        expect(res.decisions[0].meltAmount).toBeGreaterThan(0);
        expect(res.recommendedMetrics.netEstateValue).toBeGreaterThan(res.baselineMetrics.netEstateValue);
        expect(res.netEstateDelta).toBeGreaterThan(0);
    }, 30_000);

    it('(b) recommends melt 0 for a person with no RRSP', async () => {
        const noRrsp = inputs({
            person: person({
                rrsp: { type: 'RRSP', balance: 0 },
                tfsa: { type: 'TFSA', balance: 300_000 },
                nonRegisteredAccounts: [nonReg({ balance: 400_000, adjustedCostBase: 300_000 })],
                rrspMeltAmount: 0,
            }),
        });
        const res = await optimizeMeltdown(noRrsp, OPTS);
        expect(res.recommendedInputs.person.rrspMeltAmount ?? 0).toBe(0);
    }, 30_000);

    it('(c) leaves CPP/OAS untouched when considerCppOas is false', async () => {
        const base = bigRrspInputs();
        const res = await optimizeMeltdown(base, { ...OPTS, considerCppOas: false });
        expect(res.recommendedInputs.person.cppStartAge).toBe(base.person.cppStartAge);
        expect(res.recommendedInputs.person.oasStartAge).toBe(base.person.oasStartAge);
    }, 30_000);

    it('(d) recommended inputs are feasible (shortfall within tolerance)', async () => {
        const res = await optimizeMeltdown(bigRrspInputs(), OPTS);
        // The stored metric is nominal; re-run independently to be sure.
        const metrics = computeSummaryMetrics(
            runSimulation(res.recommendedInputs),
            res.recommendedInputs,
            false,
        );
        expect(metrics.totalShortfall).toBeLessThanOrEqual(1000);
    }, 30_000);

    it('(f) rejects with an AbortError when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            optimizeMeltdown(bigRrspInputs(), { ...OPTS, signal: controller.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('reports progress and finishes at 100%', async () => {
        let last = { done: 0, total: 0 };
        await optimizeMeltdown(bigRrspInputs(), {
            ...OPTS,
            onProgress: (done, total) => { last = { done, total }; },
        });
        expect(last.total).toBeGreaterThan(0);
        expect(last.done).toBe(last.total);
    }, 30_000);
});

describe('candidate builders', () => {
    it('(e) a 68-year-old never gets a CPP-start-60 candidate', () => {
        const p = person({ age: 68, cppStartAge: 70 });
        const cands = buildCppCandidates(p, true);
        expect(cands).not.toContain(60);
        expect(cands.every(a => a >= 68)).toBe(true);
    });

    it('locks CPP/OAS to the current value when already started before now', () => {
        const p = person({ age: 68, cppStartAge: 65, oasStartAge: 65 });
        expect(buildCppCandidates(p, true)).toEqual([65]);
        expect(buildOasCandidates(p, true)).toEqual([65]);
    });

    it('returns only the current value when CPP/OAS search is disabled', () => {
        const p = person({ age: 60, cppStartAge: 62, oasStartAge: 67 });
        expect(buildCppCandidates(p, false)).toEqual([62]);
        expect(buildOasCandidates(p, false)).toEqual([67]);
    });

    it('includes the current start age as a candidate alongside the standard ages', () => {
        const p = person({ age: 60, cppStartAge: 63, oasStartAge: 68 });
        expect(buildCppCandidates(p, true)).toContain(63);
        expect(buildCppCandidates(p, true)).toEqual([60, 63, 65, 70]);
        expect(buildOasCandidates(p, true)).toEqual([65, 68, 70]);
    });

    it('gives a zero-RRSP person a melt grid of [0]; a funded RRSP gets 0 plus positive steps', () => {
        expect(buildMeltGrid(person({ rrsp: { type: 'RRSP', balance: 0 } }))).toEqual([0]);
        const grid = buildMeltGrid(person({ rrsp: { type: 'RRSP', balance: 600_000 } }));
        expect(grid[0]).toBe(0);
        expect(grid.filter(v => v > 0).length).toBeGreaterThan(4);
    });
});

describe('applyMeltdownRecommendation', () => {
    const recommendedPerson = person({
        rrspMeltAmount: 25_000, rrspMeltStartAge: undefined, cppStartAge: 70, oasStartAge: 70,
    });
    const recommendedSpouse = person({
        rrspMeltAmount: 15_000, rrspMeltStartAge: undefined, cppStartAge: 65, oasStartAge: 70,
    });

    it('copies the four searched fields for person and spouse', () => {
        const current = inputs({
            person: person({ rrspMeltAmount: 0, cppStartAge: 65, oasStartAge: 65 }),
            spouse: person({ rrspMeltAmount: 0, cppStartAge: 60, oasStartAge: 65 }),
        });
        const recommended = inputs({ person: recommendedPerson, spouse: recommendedSpouse });

        const result = applyMeltdownRecommendation(current, recommended);

        expect(result.person.rrspMeltAmount).toBe(25_000);
        expect(result.person.rrspMeltStartAge).toBeUndefined();
        expect(result.person.cppStartAge).toBe(70);
        expect(result.person.oasStartAge).toBe(70);

        expect(result.spouse?.rrspMeltAmount).toBe(15_000);
        expect(result.spouse?.rrspMeltStartAge).toBeUndefined();
        expect(result.spouse?.cppStartAge).toBe(65);
        expect(result.spouse?.oasStartAge).toBe(70);
    });

    it('leaves everything else from current — user edits made while the optimizer was open survive', () => {
        const current = inputs({
            postRetirementSpend: 55_000,
            person: person({ rrsp: { type: 'RRSP', balance: 777_000 }, currentIncome: 12_345 }),
        });
        const recommended = inputs({ person: recommendedPerson });

        const result = applyMeltdownRecommendation(current, recommended);

        expect(result.postRetirementSpend).toBe(55_000);
        expect(result.person.rrsp.balance).toBe(777_000);
        expect(result.person.currentIncome).toBe(12_345);
    });

    it('clears rrspMeltStartAge when the recommendation has it undefined', () => {
        const current = inputs({ person: person({ rrspMeltStartAge: 62 }) });
        const recommended = inputs({ person: recommendedPerson });

        const result = applyMeltdownRecommendation(current, recommended);

        expect(result.person.rrspMeltStartAge).toBeUndefined();
    });

    it('no-spouse case: does not throw and does not add a spouse', () => {
        const current = inputs({ person: recommendedPerson, spouse: undefined });
        const recommended = inputs({ person: recommendedPerson, spouse: recommendedSpouse });

        expect(() => applyMeltdownRecommendation(current, recommended)).not.toThrow();
        const result = applyMeltdownRecommendation(current, recommended);
        expect(result.spouse).toBeUndefined();
    });

    it('spouse-removed-since-recommendation case: recommended has a spouse, current does not — no throw, no spouse added', () => {
        const current = inputs({ spouse: undefined });
        const recommended = inputs({ spouse: recommendedSpouse });

        const result = applyMeltdownRecommendation(current, recommended);

        expect(result.spouse).toBeUndefined();
    });

    it('does not mutate its arguments', () => {
        const current = inputs({ person: person({ rrspMeltAmount: 0 }) });
        const recommended = inputs({ person: recommendedPerson });
        const currentSnapshot = structuredClone(current);
        const recommendedSnapshot = structuredClone(recommended);

        applyMeltdownRecommendation(current, recommended);

        expect(current).toEqual(currentSnapshot);
        expect(recommended).toEqual(recommendedSnapshot);
    });
});
