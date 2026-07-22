import { describe, it, expect } from 'vitest';
import type { Person, NonRegisteredAccount, SimulationInputs } from '../engine/types';
import { runSimulation } from '../engine/projection';
import { computeSummaryMetrics } from './summaryMetrics';
import {
    optimizeMeltdown,
    buildCppCandidates,
    buildOasCandidates,
    buildMeltGrid,
    maxSustainableSpend,
    applyMeltdownRecommendation,
    stepDownStepForGap,
    planStepDownProbe,
    initialStepDownSpend,
} from './meltdownOptimizer';
import type { StepDownProbeResult } from './meltdownOptimizer';

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
        // bigRrspInputs doesn't set rrspMeltAmount, so the "original" (current
        // plan) melt fields should reflect the engine's zero/default fixture.
        expect(res.decisions[0].originalMeltAmount).toBe(0);
        expect(res.decisions[0].originalMeltStartAge).toBe(60); // retirementAge === age === 60
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

// --- Max-spend fixtures ---------------------------------------------------

// Deep pockets, modest planned spend — the sustainable spend should land well
// above what's planned.
const wealthyInputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 1_200_000 },
        tfsa: { type: 'TFSA', balance: 200_000 },
        nonRegisteredAccounts: [nonReg({ balance: 300_000, adjustedCostBase: 250_000 })],
    }),
    postRetirementSpend: 30_000,
    ...over,
});

// Thin assets, ambitious planned spend — the plan can't fund it; sustainable
// spend comes out below planned.
const overstretchedInputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => inputs({
    person: person({
        rrsp: { type: 'RRSP', balance: 120_000 },
        tfsa: { type: 'TFSA', balance: 0 },
        nonRegisteredAccounts: [nonReg({ balance: 30_000, adjustedCostBase: 25_000 })],
    }),
    postRetirementSpend: 70_000,
    ...over,
});

const MS_OPTS = { objective: 'max-spend', mcIterations: 12, mcSuccessTarget: 75 } as const;

describe('optimizeMeltdown (max-spend objective)', () => {
    it('(g) a wealthy plan sustains materially more than planned, and recommendedInputs matches', async () => {
        const base = wealthyInputs();
        const res = await optimizeMeltdown(base, MS_OPTS);
        expect(res.objective).toBe('max-spend');
        expect(res.maxSpend).toBeDefined();
        const ms = res.maxSpend!;
        expect(ms.sustainableSpend).toBeGreaterThan(base.postRetirementSpend);
        expect(ms.spendDelta).toBeGreaterThan(0);
        expect(res.recommendedInputs.postRetirementSpend).toBe(ms.sustainableSpend);
        expect(res.improved).toBe(true);
    }, 60_000);

    it('(h) an overstretched plan reports a sustainable spend below planned but still recommends', async () => {
        const base = overstretchedInputs();
        const res = await optimizeMeltdown(base, MS_OPTS);
        const ms = res.maxSpend!;
        expect(ms.sustainableSpend).toBeLessThan(base.postRetirementSpend);
        expect(ms.spendDelta).toBeLessThan(0);
        expect(res.improved).toBe(true);
        expect(res.recommendedInputs.postRetirementSpend).toBe(ms.sustainableSpend);
    }, 60_000);

    it('(i) estate mode carries objective="estate", no maxSpend, and ignores the max-spend-only knob', async () => {
        const base = bigRrspInputs();
        const a = await optimizeMeltdown(base, OPTS);
        const b = await optimizeMeltdown(base, { ...OPTS, mcSuccessTarget: 95 });
        expect(a.objective).toBe('estate');
        expect(a.maxSpend).toBeUndefined();
        // The deterministic winner is unaffected by a max-spend-only option.
        expect(b.recommendedMetrics.netEstateValue).toBe(a.recommendedMetrics.netEstateValue);
        expect(b.decisions[0].meltAmount).toBe(a.decisions[0].meltAmount);
        expect(b.decisions[0].cppStartAge).toBe(a.decisions[0].cppStartAge);
    }, 60_000);

    it('(j) the MC step-down never returns a spend above the deterministic max', async () => {
        const res = await optimizeMeltdown(wealthyInputs(), MS_OPTS);
        const ms = res.maxSpend!;
        expect(ms.sustainableSpend).toBeLessThanOrEqual(ms.deterministicMax);
    }, 60_000);
});

describe('maxSustainableSpend', () => {
    it('returns a feasible spend that becomes infeasible well above it', () => {
        const base = wealthyInputs();
        const { spend, runs } = maxSustainableSpend(base);
        expect(spend).toBeGreaterThan(0);
        expect(runs).toBeGreaterThan(0);

        const shortfallAt = (s: number) =>
            computeSummaryMetrics(
                runSimulation({ ...base, postRetirementSpend: s }),
                { ...base, postRetirementSpend: s },
                false,
            ).totalShortfall;

        expect(shortfallAt(spend)).toBeLessThanOrEqual(1000);
        expect(shortfallAt(spend + 10_000)).toBeGreaterThan(1000);
    });
});

// --- Adaptive MC step-down (pure helpers — MC-free, no flake) -------------

describe('stepDownStepForGap', () => {
    it('scales the step up with the distance from the bar, floored at $2,500', () => {
        // Near the bar: keep ~$2,500 precision.
        expect(stepDownStepForGap(0)).toBe(2_500);
        expect(stepDownStepForGap(3)).toBe(2_500);
        // Progressive tiers as the gap widens.
        expect(stepDownStepForGap(3.1)).toBe(5_000);
        expect(stepDownStepForGap(7)).toBe(5_000);
        expect(stepDownStepForGap(7.1)).toBe(10_000);
        expect(stepDownStepForGap(15)).toBe(10_000);
        expect(stepDownStepForGap(15.1)).toBe(15_000);
        expect(stepDownStepForGap(45)).toBe(15_000);
        expect(stepDownStepForGap(85)).toBe(15_000);
    });

    it('is monotonically non-decreasing in the gap', () => {
        let prev = 0;
        for (let g = 0; g <= 100; g += 0.5) {
            const s = stepDownStepForGap(g);
            expect(s).toBeGreaterThanOrEqual(prev);
            prev = s;
        }
    });
});

describe('planStepDownProbe', () => {
    const plan = { target: 85, ceiling: 100_000, floor: 0 };

    it('probes the ceiling when no probes exist yet', () => {
        expect(planStepDownProbe(plan, [])).toEqual({ kind: 'probe', spend: 100_000 });
    });

    it('steps DOWN by the gap-scaled amount when only misses are seen', () => {
        // A single miss at the ceiling, 45pp short → a $15k drop.
        const one = planStepDownProbe(plan, [{ spend: 100_000, successRate: 40 }]);
        expect(one).toEqual({ kind: 'probe', spend: 85_000 });
        // Closer to the bar → a smaller drop (decelerating approach).
        const near = planStepDownProbe(plan, [
            { spend: 100_000, successRate: 40 },
            { spend: 85_000, successRate: 83 }, // 2pp short → $2,500 drop
        ]);
        expect(near).toEqual({ kind: 'probe', spend: 82_500 });
    });

    it('uses the LOWEST miss (highest success among misses) to size the down-step', () => {
        const probes: StepDownProbeResult[] = [
            { spend: 100_000, successRate: 30 },
            { spend: 90_000, successRate: 60 }, // lowest miss, 25pp short → $15k
        ];
        expect(planStepDownProbe(plan, probes)).toEqual({ kind: 'probe', spend: 75_000 });
    });

    it('searches UP toward the ceiling when only clears are seen (warm start under-shot)', () => {
        // Warm start well below the ceiling cleared with a big margin → step up.
        const up = planStepDownProbe(plan, [{ spend: 40_000, successRate: 99 }]); // margin 14 → $10k
        expect(up).toEqual({ kind: 'probe', spend: 50_000 });
    });

    it('does not exceed the ceiling while searching up', () => {
        const up = planStepDownProbe(plan, [{ spend: 98_000, successRate: 99 }]);
        expect(up).toEqual({ kind: 'probe', spend: 100_000 });
    });

    it('reports done at the ceiling when the ceiling itself clears', () => {
        expect(planStepDownProbe(plan, [{ spend: 100_000, successRate: 90 }]))
            .toEqual({ kind: 'done', spend: 100_000, successRate: 90 });
    });

    it('refines a wide bracket toward the top by probing the midpoint', () => {
        const probes: StepDownProbeResult[] = [
            { spend: 80_000, successRate: 70 }, // miss
            { spend: 60_000, successRate: 92 }, // clear
        ];
        // Midpoint of [60k clear, 80k miss] = 70k.
        expect(planStepDownProbe(plan, probes)).toEqual({ kind: 'probe', spend: 70_000 });
    });

    it('reports done at the highest clearing spend once the bracket is within precision', () => {
        const probes: StepDownProbeResult[] = [
            { spend: 62_500, successRate: 80 }, // miss
            { spend: 60_000, successRate: 90 }, // clear, within $2,500 of the miss
        ];
        expect(planStepDownProbe(plan, probes))
            .toEqual({ kind: 'done', spend: 60_000, successRate: 90 });
    });

    it('flags a cap hit when even the floor misses the bar', () => {
        expect(planStepDownProbe(plan, [{ spend: 0, successRate: 50 }]))
            .toEqual({ kind: 'capHit', spend: 0, successRate: 50 });
    });

    it('never proposes a spend below the floor while descending', () => {
        const probes: StepDownProbeResult[] = [{ spend: 5_000, successRate: 40 }];
        const next = planStepDownProbe(plan, probes);
        expect(next.kind).toBe('probe');
        if (next.kind === 'probe') expect(next.spend).toBeGreaterThanOrEqual(0);
    });

    it('falls back to the best clearing probe when the data is noise-inverted', () => {
        // A HIGHER spend cleared while a LOWER spend missed (MC wobble) — not a
        // valid bracket. Prefer the highest clearing (probed) spend.
        const probes: StepDownProbeResult[] = [
            { spend: 70_000, successRate: 88 }, // clear (higher spend)
            { spend: 60_000, successRate: 80 }, // miss (lower spend)
        ];
        expect(planStepDownProbe(plan, probes))
            .toEqual({ kind: 'done', spend: 70_000, successRate: 88 });
    });

    it('converges from a pure descent within a bounded probe count and reports a clearing spend', () => {
        // Simulate a monotone success curve: success rises ~1pp per $1k below a
        // knee, i.e. clears (>=85) at/below $57k here. Drive the helper to done.
        const rateAt = (spend: number) => Math.max(0, Math.min(100, 142 - spend / 1_000));
        const probes: StepDownProbeResult[] = [];
        let action = planStepDownProbe(plan, probes);
        let guard = 0;
        while (action.kind === 'probe' && guard < 30) {
            probes.push({ spend: action.spend, successRate: rateAt(action.spend) });
            action = planStepDownProbe(plan, probes);
            guard++;
        }
        expect(guard).toBeLessThan(20); // comfortably inside a ~15-probe budget
        expect(action.kind).toBe('done');
        if (action.kind === 'done') {
            expect(action.successRate).toBeGreaterThanOrEqual(85);
            expect(action.spend).toBeLessThanOrEqual(100_000);
            // The reported spend was actually one of the probed spends.
            expect(probes.some(p => p.spend === action.spend)).toBe(true);
        }
    });
});

describe('initialStepDownSpend', () => {
    const target = 85;
    it('anchors near the current spend when the baseline badly misses and the max is far above', () => {
        const spend = initialStepDownSpend({
            ceiling: 120_000, floor: 0, currentSpend: 50_000, baselineRate: 60, target,
        });
        expect(spend).toBe(50_000);
    });

    it('starts at the ceiling when the baseline is near/above the target', () => {
        const spend = initialStepDownSpend({
            ceiling: 120_000, floor: 0, currentSpend: 50_000, baselineRate: 84, target,
        });
        expect(spend).toBe(120_000);
    });

    it('starts at the ceiling when the max is not much above the current spend', () => {
        const spend = initialStepDownSpend({
            ceiling: 55_000, floor: 0, currentSpend: 50_000, baselineRate: 40, target,
        });
        expect(spend).toBe(55_000);
    });

    it('never returns a spend above the ceiling or below the floor', () => {
        const spend = initialStepDownSpend({
            ceiling: 45_000, floor: 0, currentSpend: 70_000, baselineRate: 20, target,
        });
        expect(spend).toBeLessThanOrEqual(45_000);
        expect(spend).toBeGreaterThanOrEqual(0);
    });
});

// A wide-gap fixture: healthy balances (so the deterministic max is high) paired
// with punishing volatility (so the MC-safe spend sits far below it). The gap
// between the deterministic max and the target-clearing spend is large — exactly
// the case the old fixed 12×$2,500 cap could not descend far enough to cover.
const wideGapInputs = (over: Partial<SimulationInputs> = {}): SimulationInputs => inputs({
    person: person({
        age: 60, retirementAge: 60, lifeExpectancy: 95, // long horizon
        rrsp: { type: 'RRSP', balance: 1_100_000 },
        tfsa: { type: 'TFSA', balance: 150_000 },
        nonRegisteredAccounts: [nonReg({ balance: 250_000, adjustedCostBase: 200_000 })],
    }),
    postRetirementSpend: 30_000,
    returnRates: {
        bondReturn: 0.03, cashInterest: 0.02, dividend: 0.03,
        capitalGrowth: 0.05, rrspGrowth: 0.05, tfsaGrowth: 0.05, volatility: 0.23,
    },
    ...over,
});

describe('optimizeMeltdown (max-spend step-down invariants)', () => {
    // MC wobbles run-to-run (runMonteCarlo is not seedable), so assert robust
    // properties, never exact dollars.
    it('(k) a wide deterministic-vs-MC gap still clears the bar (or only caps out degenerately)', async () => {
        const base = wideGapInputs();
        const res = await optimizeMeltdown(base, { objective: 'max-spend', mcIterations: 20, mcSuccessTarget: 75 });
        const ms = res.maxSpend!;

        // Never report above the deterministic max.
        expect(ms.sustainableSpend).toBeLessThanOrEqual(ms.deterministicMax);

        // The reported spend was actually the one MC-probed for the result.
        expect(res.recommendedSuccessRate).toBe(ms.achievedSuccessRate);
        expect(res.recommendedInputs.postRetirementSpend).toBe(ms.sustainableSpend);

        // Either the bar was cleared, or the run genuinely capped out (degenerate).
        if (ms.stepDownCapHit) {
            expect(ms.achievedSuccessRate).toBeLessThan(ms.mcSuccessTarget);
        } else {
            expect(ms.achievedSuccessRate).toBeGreaterThanOrEqual(ms.mcSuccessTarget);
        }
    }, 90_000);

    it('(l) recommendedInputs are feasible and its recorded metrics match a fresh run at that spend', async () => {
        const base = wideGapInputs();
        const res = await optimizeMeltdown(base, { objective: 'max-spend', mcIterations: 20, mcSuccessTarget: 75 });
        const metrics = computeSummaryMetrics(
            runSimulation(res.recommendedInputs), res.recommendedInputs, false,
        );
        expect(metrics.totalShortfall).toBeLessThanOrEqual(1000);
        // recResults/recMetrics were recomputed at the final spend.
        expect(res.recommendedMetrics.netEstateValue).toBeCloseTo(metrics.netEstateValue, 5);
    }, 90_000);
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

    it('carries postRetirementSpend + withdrawalStrategy only for max-spend recommendations', () => {
        const current = inputs({ postRetirementSpend: 40_000, withdrawalStrategy: 'tax-efficient' });
        const recommended = inputs({ postRetirementSpend: 62_500, withdrawalStrategy: 'rrsp-first' });

        // Default (estate): spend + strategy are left untouched.
        const estate = applyMeltdownRecommendation(current, recommended);
        expect(estate.postRetirementSpend).toBe(40_000);
        expect(estate.withdrawalStrategy).toBe('tax-efficient');

        // Max-spend: spend + strategy come from the recommendation.
        const maxSpend = applyMeltdownRecommendation(current, recommended, 'max-spend');
        expect(maxSpend.postRetirementSpend).toBe(62_500);
        expect(maxSpend.withdrawalStrategy).toBe('rrsp-first');
    });
});
