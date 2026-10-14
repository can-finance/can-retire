import { describe, it, expect } from 'vitest';
import type { MonteCarloPercentile, NonRegisteredAccount, Person, SimulationInputs } from '../engine/types';
import {
    shiftCppContributedYears,
    planAgeShift,
    applyRetirementShift,
    planAgeBisection,
    ageStepForGap,
    planAgeStepUp,
    tradeoffDeltas,
    reconcileCouldSpend,
    firstDepletionAge,
    isStrategyChangeNeeded,
    CPP_MAX_CONTRIBUTORY_YEARS,
} from './retirementAgeSearch';
import type { AgeFeasibilityProbe, AgeProbeResult, AgeStepUpAction, AgeBisectionAction } from './retirementAgeSearch';

// --- Fixtures ---------------------------------------------------------------

const nonReg = (): NonRegisteredAccount => ({
    type: 'NonRegistered', id: 'nr', name: 'Non-Registered',
    balance: 0, adjustedCostBase: 0, receivesSurplus: true,
    assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 },
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

// --- CPP follows the age ----------------------------------------------------

describe('shiftCppContributedYears', () => {
    it('moves the years with the age while both ages are under 65', () => {
        expect(shiftCppContributedYears(35, 60, 57)).toBe(32); // 3 years sooner
        expect(shiftCppContributedYears(35, 60, 62)).toBe(37); // 2 years later
        expect(shiftCppContributedYears(35, 60, 60)).toBe(35); // no move
    });

    it('counts only the part of a move that falls before 65', () => {
        // 63 → 67: only 63 and 64 are contributory years.
        expect(shiftCppContributedYears(35, 63, 67)).toBe(37);
        // 67 → 62: removes 62, 63, 64.
        expect(shiftCppContributedYears(40, 67, 62)).toBe(37);
        // 65 → 64 removes one year; 64 → 65 adds one.
        expect(shiftCppContributedYears(40, 65, 64)).toBe(39);
        expect(shiftCppContributedYears(39, 64, 65)).toBe(40);
    });

    it('changes nothing when both ages are 65 or later', () => {
        expect(shiftCppContributedYears(40, 66, 70)).toBe(40);
        expect(shiftCppContributedYears(40, 70, 66)).toBe(40);
        expect(shiftCppContributedYears(40, 65, 75)).toBe(40);
    });

    it('clamps to [0, 47]', () => {
        expect(shiftCppContributedYears(2, 60, 55)).toBe(0);
        expect(shiftCppContributedYears(0, 50, 40)).toBe(0);
        expect(shiftCppContributedYears(46, 60, 64)).toBe(CPP_MAX_CONTRIBUTORY_YEARS);
        expect(shiftCppContributedYears(47, 55, 64)).toBe(47);
    });
});

// --- Who moves, and how far -------------------------------------------------

describe('planAgeShift', () => {
    it('single still working: moves them, bounded by today and min(life expectancy − 1, 75)', () => {
        const plan = planAgeShift(inputs({ person: person({ age: 50, retirementAge: 60, lifeExpectancy: 90 }) }));
        expect(plan).toEqual({ available: true, shifted: ['person'], reportedWho: 'person', minDelta: -10, maxDelta: 15 });
    });

    it('caps the latest age at life expectancy − 1 when that is below 75', () => {
        const plan = planAgeShift(inputs({ person: person({ age: 50, retirementAge: 60, lifeExpectancy: 70 }) }));
        expect(plan.maxDelta).toBe(9); // 69 − 60
    });

    it('couple both working: one shared Δ, the tighter bound on each side wins', () => {
        const plan = planAgeShift(inputs({
            person: person({ age: 50, retirementAge: 60, lifeExpectancy: 90 }),   // Δ ∈ [−10, 15]
            spouse: person({ age: 56, retirementAge: 62, lifeExpectancy: 80 }),   // Δ ∈ [−6, 13]
        }));
        expect(plan).toEqual({ available: true, shifted: ['person', 'spouse'], reportedWho: 'person', minDelta: -6, maxDelta: 13 });
    });

    it('spouse already retired: only the primary moves', () => {
        const plan = planAgeShift(inputs({
            person: person({ age: 58, retirementAge: 63 }),
            spouse: person({ age: 61, retirementAge: 60 }),
        }));
        expect(plan.shifted).toEqual(['person']);
        expect(plan.reportedWho).toBe('person');
        expect(plan.minDelta).toBe(-5);
    });

    it('primary already retired: only the spouse moves, and the answer is reported as theirs', () => {
        const plan = planAgeShift(inputs({
            person: person({ age: 66, retirementAge: 65 }),
            spouse: person({ age: 57, retirementAge: 62 }),
        }));
        expect(plan.shifted).toEqual(['spouse']);
        expect(plan.reportedWho).toBe('spouse');
        expect(plan.minDelta).toBe(-5);
        expect(plan.maxDelta).toBe(13);
    });

    it('retiring this year (retirementAge === age) counts as already retired', () => {
        const plan = planAgeShift(inputs({ person: person({ age: 62, retirementAge: 62 }) }));
        expect(plan.available).toBe(false);
        expect(plan.unavailableReason).toBe('nobody-working');
    });

    it('nobody working: unavailable', () => {
        const plan = planAgeShift(inputs({
            person: person({ age: 70, retirementAge: 65 }),
            spouse: person({ age: 68, retirementAge: 60 }),
        }));
        expect(plan).toMatchObject({ available: false, unavailableReason: 'nobody-working', shifted: [] });
    });

    it('a worker already past 75 may stay at today’s age, but is never forced below it', () => {
        const plan = planAgeShift(inputs({ person: person({ age: 76, retirementAge: 78, lifeExpectancy: 90 }) }));
        expect(plan).toMatchObject({ available: true, minDelta: -2, maxDelta: -2 });
    });

    it('two workers whose ranges cannot overlap: unavailable', () => {
        const plan = planAgeShift(inputs({
            person: person({ age: 50, retirementAge: 60, lifeExpectancy: 90 }),  // Δ ∈ [−10, 15]
            spouse: person({ age: 76, retirementAge: 90, lifeExpectancy: 95 }),  // Δ ∈ [−14, −14]
        }));
        expect(plan).toMatchObject({ available: false, unavailableReason: 'no-common-range' });
    });
});

describe('applyRetirementShift', () => {
    it('moves every shifted person’s age and CPP years, and nobody else’s', () => {
        const base = inputs({
            person: person({ age: 58, retirementAge: 63, cppContributedYears: 38 }),
            spouse: person({ age: 61, retirementAge: 60, cppContributedYears: 30 }), // retired
        });
        const plan = planAgeShift(base);
        const { inputs: out, cppOverrideHeld } = applyRetirementShift(base, plan, -3);
        expect(out.person.retirementAge).toBe(60);
        expect(out.person.cppContributedYears).toBe(35);
        expect(out.spouse!.retirementAge).toBe(60);
        expect(out.spouse!.cppContributedYears).toBe(30);
        expect(cppOverrideHeld).toBe(false);
    });

    it('a couple moves together', () => {
        const base = inputs({
            person: person({ age: 50, retirementAge: 60, cppContributedYears: 35 }),
            spouse: person({ age: 48, retirementAge: 62, cppContributedYears: 33 }),
        });
        const { inputs: out } = applyRetirementShift(base, planAgeShift(base), 2);
        expect(out.person.retirementAge).toBe(62);
        expect(out.person.cppContributedYears).toBe(37);
        expect(out.spouse!.retirementAge).toBe(64);
        expect(out.spouse!.cppContributedYears).toBe(35);
    });

    it('holds a CPP Calculator estimate fixed and flags it', () => {
        const base = inputs({ person: person({ cppAnnualOverride: 12_000, cppContributedYears: 35 }) });
        const { inputs: out, cppOverrideHeld } = applyRetirementShift(base, planAgeShift(base), -4);
        expect(out.person.retirementAge).toBe(56);
        expect(out.person.cppContributedYears).toBe(35);
        expect(out.person.cppAnnualOverride).toBe(12_000);
        expect(cppOverrideHeld).toBe(true);
    });

    it('leaves a DB pension exactly as entered', () => {
        const pension = { annualAmount: 30_000, startAge: 60, indexedToInflation: true, bridgeAmount: 8_000, bridgeEndAge: 65 };
        const base = inputs({ person: person({ pension }) });
        const { inputs: out } = applyRetirementShift(base, planAgeShift(base), -3);
        expect(out.person.pension).toEqual(pension);
    });

    it('does not mutate its input', () => {
        const base = inputs();
        const snapshot = structuredClone(base);
        applyRetirementShift(base, planAgeShift(base), 5);
        expect(base).toEqual(snapshot);
    });
});

// --- Deterministic bisection ------------------------------------------------

// Drive the planner against a feasibility oracle; return the final action and
// the probe log.
function driveBisection(
    minDelta: number, maxDelta: number, feasibleAt: (d: number) => boolean, start = 0,
): { action: AgeBisectionAction; probes: AgeFeasibilityProbe[] } {
    const probes: AgeFeasibilityProbe[] = [];
    const plan = { minDelta, maxDelta, start };
    let action = planAgeBisection(plan, probes);
    let guard = 0;
    while (action.kind === 'probe' && guard++ < 100) {
        probes.push({ delta: action.delta, feasible: feasibleAt(action.delta) });
        action = planAgeBisection(plan, probes);
    }
    return { action, probes };
}

describe('planAgeBisection', () => {
    it('probes the plan’s own age first, clamped into range', () => {
        expect(planAgeBisection({ minDelta: -10, maxDelta: 15, start: 0 }, [])).toEqual({ kind: 'probe', delta: 0 });
        expect(planAgeBisection({ minDelta: 2, maxDelta: 8, start: 0 }, [])).toEqual({ kind: 'probe', delta: 2 });
        expect(planAgeBisection({ minDelta: -8, maxDelta: -2, start: 0 }, [])).toEqual({ kind: 'probe', delta: -2 });
    });

    it('finds the threshold of every monotone feasibility curve, never re-probing, within ⌈log2(n+1)⌉+1 probes', () => {
        for (let minDelta = -14; minDelta <= 0; minDelta += 2) {
            for (let maxDelta = minDelta; maxDelta <= 16; maxDelta += 3) {
                const n = maxDelta - minDelta + 1;
                const budget = Math.ceil(Math.log2(n + 1)) + 1;
                for (let threshold = minDelta - 2; threshold <= maxDelta + 2; threshold++) {
                    const { action, probes } = driveBisection(minDelta, maxDelta, d => d >= threshold);
                    if (threshold > maxDelta) {
                        expect(action).toEqual({ kind: 'unreachable' });
                    } else {
                        expect(action).toEqual({ kind: 'found', delta: Math.max(minDelta, threshold) });
                    }
                    expect(probes.length).toBeLessThanOrEqual(budget);
                    const deltas = probes.map(p => p.delta);
                    expect(new Set(deltas).size).toBe(deltas.length);
                    expect(deltas.every(d => d >= minDelta && d <= maxDelta)).toBe(true);
                    // The answer's year before was tested infeasible, unless the answer is the lower bound.
                    if (action.kind === 'found' && action.delta > minDelta) {
                        expect(probes).toContainEqual({ delta: action.delta - 1, feasible: false });
                    }
                }
            }
        }
    });

    it('reports the lower bound when even the earliest age is feasible ("retire now")', () => {
        const { action } = driveBisection(-10, 15, () => true);
        expect(action).toEqual({ kind: 'found', delta: -10 });
    });

    it('reports unreachable when even the latest age is infeasible', () => {
        const { action, probes } = driveBisection(-10, 15, () => false);
        expect(action).toEqual({ kind: 'unreachable' });
        expect(probes).toContainEqual({ delta: 15, feasible: false });
    });

    it('a stray infeasible probe ABOVE the lowest feasible one does not derail the bracket', () => {
        const probes: AgeFeasibilityProbe[] = [
            { delta: 0, feasible: true },
            { delta: 5, feasible: false }, // non-monotone noise above
            { delta: -1, feasible: false },
        ];
        expect(planAgeBisection({ minDelta: -10, maxDelta: 15, start: 0 }, probes))
            .toEqual({ kind: 'found', delta: 0 });
    });
});

// --- MC step-up --------------------------------------------------------------

describe('ageStepForGap', () => {
    it('jumps further the further below the bar, one year near it', () => {
        expect(ageStepForGap(0)).toBe(1);
        expect(ageStepForGap(3)).toBe(1);
        expect(ageStepForGap(3.5)).toBe(2);
        expect(ageStepForGap(8)).toBe(2);
        expect(ageStepForGap(8.5)).toBe(3);
        expect(ageStepForGap(15)).toBe(3);
        expect(ageStepForGap(15.5)).toBe(4);
        expect(ageStepForGap(85)).toBe(4);
    });

    it('is monotonically non-decreasing in the gap', () => {
        let prev = 0;
        for (let g = 0; g <= 100; g += 0.5) {
            const s = ageStepForGap(g);
            expect(s).toBeGreaterThanOrEqual(prev);
            prev = s;
        }
    });
});

function driveStepUp(
    plan: { target: number; start: number; max: number; maxProbes?: number },
    rateAt: (age: number) => number,
): { action: AgeStepUpAction; probes: AgeProbeResult[] } {
    const probes: AgeProbeResult[] = [];
    let action = planAgeStepUp(plan, probes);
    let guard = 0;
    while (action.kind === 'probe' && guard++ < 100) {
        probes.push({ age: action.age, successRate: rateAt(action.age) });
        action = planAgeStepUp(plan, probes);
    }
    return { action, probes };
}

describe('planAgeStepUp', () => {
    const plan = { target: 85, start: 58, max: 75 };

    it('probes the deterministic answer first', () => {
        expect(planAgeStepUp(plan, [])).toEqual({ kind: 'probe', age: 58 });
    });

    it('is done at the start when the start already clears (never searches earlier)', () => {
        expect(planAgeStepUp(plan, [{ age: 58, successRate: 90 }]))
            .toEqual({ kind: 'done', age: 58, successRate: 90 });
    });

    it('steps one year when just short of the bar, further when far below it', () => {
        expect(planAgeStepUp(plan, [{ age: 58, successRate: 83 }])).toEqual({ kind: 'probe', age: 59 });
        expect(planAgeStepUp(plan, [{ age: 58, successRate: 80 }])).toEqual({ kind: 'probe', age: 60 });
        expect(planAgeStepUp(plan, [{ age: 58, successRate: 72 }])).toEqual({ kind: 'probe', age: 61 });
        expect(planAgeStepUp(plan, [{ age: 58, successRate: 40 }])).toEqual({ kind: 'probe', age: 62 });
    });

    it('bisects a bracket between the highest miss and the lowest clear', () => {
        const probes: AgeProbeResult[] = [
            { age: 58, successRate: 40 },
            { age: 62, successRate: 92 },
        ];
        expect(planAgeStepUp(plan, probes)).toEqual({ kind: 'probe', age: 60 });
    });

    it('is done at the lowest clear once the miss is the year before it', () => {
        const probes: AgeProbeResult[] = [
            { age: 58, successRate: 40 },
            { age: 62, successRate: 92 },
            { age: 60, successRate: 80 },
            { age: 61, successRate: 86 },
        ];
        expect(planAgeStepUp(plan, probes)).toEqual({ kind: 'done', age: 61, successRate: 86 });
    });

    it('never proposes an age past the maximum', () => {
        expect(planAgeStepUp({ ...plan, max: 60 }, [{ age: 58, successRate: 30 }]))
            .toEqual({ kind: 'probe', age: 60 });
    });

    it('reports a bound hit (best probe) when the maximum still misses', () => {
        const probes: AgeProbeResult[] = [
            { age: 58, successRate: 30 },
            { age: 60, successRate: 70 },
        ];
        expect(planAgeStepUp({ ...plan, max: 60 }, probes))
            .toEqual({ kind: 'boundHit', age: 60, successRate: 70 });
    });

    it('bound hit ties go to the earlier age (same odds, retire sooner)', () => {
        const probes: AgeProbeResult[] = [
            { age: 58, successRate: 70 },
            { age: 60, successRate: 70 },
        ];
        expect(planAgeStepUp({ ...plan, max: 60 }, probes))
            .toEqual({ kind: 'boundHit', age: 58, successRate: 70 });
    });

    it('flags a cap hit when the probe budget runs out — with the clearing age when it has one', () => {
        const capped = { ...plan, maxProbes: 2 };
        // Bracket still open after two probes: report the clear, flagged.
        expect(planAgeStepUp(capped, [{ age: 58, successRate: 40 }, { age: 62, successRate: 92 }]))
            .toEqual({ kind: 'capHit', age: 62, successRate: 92, cleared: true });
        // Only misses: report the best miss, flagged.
        expect(planAgeStepUp(capped, [{ age: 58, successRate: 40 }, { age: 62, successRate: 70 }]))
            .toEqual({ kind: 'capHit', age: 62, successRate: 70, cleared: false });
    });

    it('ignores a lucky clear BELOW a later miss (MC noise) and keeps stepping up', () => {
        const probes: AgeProbeResult[] = [
            { age: 58, successRate: 86 }, // looked like a clear…
            { age: 59, successRate: 82 }, // …but a later age missed
        ];
        expect(planAgeStepUp(plan, probes)).toEqual({ kind: 'probe', age: 60 });
    });

    it('converges to the earliest clearing age on every monotone success curve, never re-probing', () => {
        // Measured plans gain roughly 3-10pp of success per extra working year
        // near the bar; 2.5pp/yr is a deliberately slow floor.
        for (const slope of [2.5, 4, 8, 20]) {
            for (let knee = 50; knee <= 80; knee++) {
                // Success crosses the 85 bar at `knee`.
                const rateAt = (age: number) => Math.max(0, Math.min(100, 85 + slope * (age - knee) + 0.5));
                for (const start of [50, 55, 58, 62]) {
                    const p = { target: 85, start, max: 75 };
                    const { action, probes } = driveStepUp(p, rateAt);
                    const ages = probes.map(x => x.age);
                    expect(new Set(ages).size).toBe(ages.length);
                    expect(ages.every(a => a >= start && a <= 75)).toBe(true);
                    expect(probes.length).toBeLessThanOrEqual(10);
                    const truth = Math.max(start, knee);
                    if (truth > 75) {
                        expect(action.kind).toBe('boundHit');
                    } else {
                        expect(action).toEqual({ kind: 'done', age: truth, successRate: rateAt(truth) });
                    }
                }
            }
        }
    });

    it('on a pathologically flat curve far from the bar, stops at the budget and flags it rather than guessing', () => {
        // 1pp per year, 25 years below the bar: ten probes can't climb that far.
        const rateAt = (age: number) => 85 + (age - 75) + 0.5;
        const { action, probes } = driveStepUp({ target: 85, start: 50, max: 75 }, rateAt);
        expect(probes.length).toBe(10);
        expect(action.kind).toBe('capHit');
        if (action.kind === 'capHit') {
            expect(action.cleared).toBe(false);
            expect(action.age).toBeLessThan(75);
        }
    });

    it('terminates on a wobbly curve and reports a probed age consistent with its flag', () => {
        // Deterministic pseudo-noise of up to ±4pp on a curve crossing the bar near 63.
        const noise = (age: number) => ((age * 7919) % 9) - 4;
        const rateAt = (age: number) => Math.max(0, Math.min(100, 85 + 3 * (age - 63) + noise(age)));
        for (const start of [52, 56, 60, 63, 66]) {
            const { action, probes } = driveStepUp({ target: 85, start, max: 75 }, rateAt);
            expect(action.kind).not.toBe('probe');
            if (action.kind === 'probe') continue;
            expect(probes.some(p => p.age === action.age)).toBe(true);
            if (action.kind === 'done') {
                expect(action.successRate).toBeGreaterThanOrEqual(85);
                // Every probe at or above the answer cleared (no miss above it).
                expect(probes.filter(p => p.age >= action.age).every(p => p.successRate >= 85)).toBe(true);
            }
        }
    });
});

// --- Trade-off table helpers ------------------------------------------------

describe('tradeoffDeltas', () => {
    it('spans answer − 2 … answer + 4', () => {
        expect(tradeoffDeltas(-3, -10, 15)).toEqual([-5, -4, -3, -2, -1, 0, 1]);
    });

    it('clamps to the search bounds', () => {
        expect(tradeoffDeltas(-9, -10, 15)).toEqual([-10, -9, -8, -7, -6, -5, 0]);
        expect(tradeoffDeltas(14, -10, 15)).toEqual([0, 12, 13, 14, 15]);
        expect(tradeoffDeltas(0, 0, 0)).toEqual([0]);
    });

    // Δ = 0 is the plan's own age — the visitor's target on the landing page.
    it('always includes the target when it is well before the answer', () => {
        // Target 60, answer 65 (Δ 5): window 63…69, so 60 is added on its own.
        expect(tradeoffDeltas(5, -5, 15)).toEqual([0, 3, 4, 5, 6, 7, 8, 9]);
        // The farthest case the search allows (target 60, answer 75).
        expect(tradeoffDeltas(15, -5, 15)).toEqual([0, 13, 14, 15]);
    });

    it('fills a single skipped age next to the target', () => {
        // Answer Δ 3: window 1…7 already touches the plan's age — no gap.
        expect(tradeoffDeltas(3, -5, 15)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        // Answer Δ 4: window 2…8 would skip only Δ 1; filled rather than marked.
        expect(tradeoffDeltas(4, -5, 15)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('includes the target when it is after the answer', () => {
        // Answer 6 years sooner: window −8…−2, and the one skipped age (Δ −1) is filled.
        expect(tradeoffDeltas(-6, -10, 15)).toEqual([-8, -7, -6, -5, -4, -3, -2, -1, 0]);
        // Answer 7 years sooner: window −9…−3, then the plan on its own.
        expect(tradeoffDeltas(-7, -10, 15)).toEqual([-9, -8, -7, -6, -5, -4, -3, 0]);
    });

    it('target equal to the answer is just the window', () => {
        expect(tradeoffDeltas(0, -10, 15)).toEqual([-2, -1, 0, 1, 2, 3, 4]);
    });

    it('leaves the target out when the search could not test it', () => {
        // Target past the search's limit: every allowed Δ is negative.
        expect(tradeoffDeltas(-6, -10, -3)).toEqual([-8, -7, -6, -5, -4, -3]);
        // Target before today (min Δ above 0) — not testable either.
        expect(tradeoffDeltas(5, 2, 15)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    });

    it('is ascending with no duplicates', () => {
        for (let answer = -10; answer <= 15; answer++) {
            const ds = tradeoffDeltas(answer, -10, 15);
            expect(ds).toContain(0);
            expect(ds).toContain(answer);
            for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThan(ds[i - 1]);
            // Never a lone skipped age: gaps are either 0 or at least 2 ages.
            for (let i = 1; i < ds.length; i++) expect(ds[i] - ds[i - 1]).not.toBe(2);
        }
    });
});

describe('reconcileCouldSpend', () => {
    it('a row that clears at the planned spend could spend at least that much', () => {
        expect(reconcileCouldSpend(67_500, true, 70_000, 500)).toBe(70_000);
        expect(reconcileCouldSpend(80_000, true, 70_000, 500)).toBe(80_000);
    });
    it('a row that misses at the planned spend could spend less than it', () => {
        expect(reconcileCouldSpend(72_500, false, 70_000, 500)).toBe(69_500);
        expect(reconcileCouldSpend(60_000, false, 70_000, 500)).toBe(60_000);
        expect(reconcileCouldSpend(0, false, 200, 500)).toBe(0);
    });
});

describe('firstDepletionAge', () => {
    const rows = (p5s: number[], startAge = 60): MonteCarloPercentile[] =>
        p5s.map((p5, i) => ({ year: 2026 + i, age: startAge + i, p5, p25: p5, p50: p5, p75: p5, p95: p5 }));

    it('returns the first age at/after `fromAge` whose 5th percentile is ~0', () => {
        expect(firstDepletionAge(rows([500_000, 300_000, 100_000, 0, 0]), 60)).toBe(63);
        expect(firstDepletionAge(rows([500_000, 300_000, 900, 0]), 60)).toBe(62); // ≤ $1,000 counts
    });

    it('skips the working years before `fromAge`', () => {
        expect(firstDepletionAge(rows([0, 0, 50_000, 40_000, 0]), 62)).toBe(64);
    });

    it('is null when money lasts the whole plan', () => {
        expect(firstDepletionAge(rows([500_000, 400_000, 300_000]), 60)).toBeNull();
        expect(firstDepletionAge([], 60)).toBeNull();
    });
});

// --- Is there anything to apply? ---------------------------------------------

describe('isStrategyChangeNeeded', () => {
    it('at the plan’s age: only when the strategy differs AND the plan as entered misses the bar', () => {
        expect(isStrategyChangeNeeded(0, true, 84, 85)).toBe(true);
        expect(isStrategyChangeNeeded(0, true, 85, 85)).toBe(false);  // clearing exactly counts as clearing
        expect(isStrategyChangeNeeded(0, true, 97, 85)).toBe(false);  // own strategy works: a preference
        expect(isStrategyChangeNeeded(0, false, 40, 85)).toBe(false); // same strategy: nothing to change
    });

    it('is false whenever the answer moves the age (that is a change on its own)', () => {
        for (const delta of [-3, -1, 1, 4]) {
            expect(isStrategyChangeNeeded(delta, true, 40, 85)).toBe(false);
        }
    });
});
