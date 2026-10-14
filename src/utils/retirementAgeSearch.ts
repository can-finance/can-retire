// Pure building blocks for the "When can I retire?" (earliest-age) objective.
//
// Nothing here runs the engine or Monte Carlo: these helpers decide WHO moves,
// HOW FAR the retirement age may move, what follows the age (CPP contribution
// years), and — given probe results the driver in meltdownOptimizer.ts feeds
// back — which age to try next. Keeping the decisions MC-free is what lets them
// be tested exhaustively without flake, the same split Phase 2 uses for its
// spend step-down (planStepDownProbe).
//
// Terminology: the search moves every still-working person's retirementAge by
// one shared integer `delta` (Δ). Negative Δ = retire sooner than the plan.

import type { MonteCarloPercentile, Person, SimulationInputs } from '../engine/types';

// CPP contributions count from 18 to 65 in this model, so a career tops out at
// 47 contributory years — the same cap the person-field validation enforces.
export const CPP_MAX_CONTRIBUTORY_YEARS = 47;
// Last age a contribution year counts in the simple CPP estimate.
export const CPP_CONTRIBUTION_END_AGE = 65;
// Latest retirement age the search will propose (also capped at lifeExpectancy − 1).
export const MAX_SEARCH_RETIREMENT_AGE = 75;

export type Who = 'person' | 'spouse';

// --- CPP follows the age ---------------------------------------------------

// Moving retirement from `oldRetirementAge` to `newRetirementAge` adds or removes
// the CPP contribution years in between — but only years before 65 count, so a
// move that stays at or past 65 changes nothing. Clamped to [0, 47]. Always
// shift from the plan's own years and ages (never compound shifts), so the clamp
// can't drift the result.
export function shiftCppContributedYears(
    years: number,
    oldRetirementAge: number,
    newRetirementAge: number,
): number {
    const change = Math.min(newRetirementAge, CPP_CONTRIBUTION_END_AGE)
        - Math.min(oldRetirementAge, CPP_CONTRIBUTION_END_AGE);
    return Math.min(CPP_MAX_CONTRIBUTORY_YEARS, Math.max(0, years + change));
}

// --- Who moves, and how far ------------------------------------------------

export interface AgeShiftPlan {
    // False when no one in the household is still working (nothing to move), or
    // when two working spouses' allowed ranges don't overlap.
    available: boolean;
    unavailableReason?: 'nobody-working' | 'no-common-range';
    // Everyone whose retirement age moves (retirementAge > age today).
    shifted: Who[];
    // Whose age the answer is reported as: the primary person when they move,
    // otherwise the spouse.
    reportedWho: Who;
    // Inclusive Δ bounds. Each shifted person's new age stays ≥ their age today
    // and ≤ min(lifeExpectancy − 1, 75).
    minDelta: number;
    maxDelta: number;
}

export function isStillWorking(p: Person): boolean {
    return p.retirementAge > p.age;
}

// Latest age this person may be moved to. Normally min(lifeExpectancy − 1, 75);
// someone already past 75 and still working may stay at today's age at most
// (never forced below it), so the range is never empty for one person on its own.
function personMaxRetirementAge(p: Person): number {
    return Math.min(p.lifeExpectancy - 1, Math.max(MAX_SEARCH_RETIREMENT_AGE, p.age));
}

export function personOf(inputs: SimulationInputs, who: Who): Person {
    return who === 'spouse' ? inputs.spouse! : inputs.person;
}

export function planAgeShift(inputs: SimulationInputs): AgeShiftPlan {
    const shifted: Who[] = [];
    if (isStillWorking(inputs.person)) shifted.push('person');
    if (inputs.spouse && isStillWorking(inputs.spouse)) shifted.push('spouse');

    if (shifted.length === 0) {
        return {
            available: false, unavailableReason: 'nobody-working',
            shifted, reportedWho: 'person', minDelta: 0, maxDelta: 0,
        };
    }

    let minDelta = -Infinity;
    let maxDelta = Infinity;
    for (const who of shifted) {
        const p = personOf(inputs, who);
        minDelta = Math.max(minDelta, p.age - p.retirementAge);
        maxDelta = Math.min(maxDelta, personMaxRetirementAge(p) - p.retirementAge);
    }

    const reportedWho: Who = shifted.includes('person') ? 'person' : 'spouse';
    if (minDelta > maxDelta) {
        return {
            available: false, unavailableReason: 'no-common-range',
            shifted, reportedWho, minDelta: 0, maxDelta: 0,
        };
    }
    return { available: true, shifted, reportedWho, minDelta, maxDelta };
}

// The plan with every shifted person's retirement age moved by `delta`, and
// their CPP contribution years moved with it. A person with a CPP Calculator
// estimate (cppAnnualOverride) keeps it untouched — it is a dollar figure with
// no years behind it to shift (the engine re-bases it only for the CPP start
// age, via cppOverrideStartAge) — and the result says so via `cppOverrideHeld`. DB pensions are deliberately left alone (the engine has
// no years-of-service model). Pure: returns a deep clone.
export function applyRetirementShift(
    inputs: SimulationInputs,
    plan: AgeShiftPlan,
    delta: number,
): { inputs: SimulationInputs; cppOverrideHeld: boolean } {
    const next = structuredClone(inputs);
    let cppOverrideHeld = false;
    for (const who of plan.shifted) {
        const p = personOf(next, who);
        const oldAge = p.retirementAge;
        const newAge = oldAge + delta;
        p.retirementAge = newAge;
        if (p.cppAnnualOverride != null) {
            cppOverrideHeld = true;
        } else {
            p.cppContributedYears = shiftCppContributedYears(p.cppContributedYears, oldAge, newAge);
        }
    }
    return { inputs: next, cppOverrideHeld };
}

// --- Deterministic outer search: integer bisection over Δ -------------------

export interface AgeBisectionPlan {
    minDelta: number;
    maxDelta: number;
    start: number; // first Δ to probe (the plan's own age, Δ = 0); clamped into range
}

export interface AgeFeasibilityProbe { delta: number; feasible: boolean; }

export type AgeBisectionAction =
    | { kind: 'probe'; delta: number }
    | { kind: 'found'; delta: number }   // earliest feasible Δ (its Δ − 1 tested infeasible, or Δ is the lower bound)
    | { kind: 'unreachable' };           // infeasible even at maxDelta

// Next deterministic probe. Treats feasibility as monotone in Δ (later is never
// worse), with virtual bounds: minDelta − 1 counts as infeasible and
// maxDelta + 1 as feasible-by-convention ("unreachable"). The bracket is the
// lowest feasible probe and the highest infeasible probe below it, so a noisy,
// non-monotone probe above the bracket can't derail it. Pure: no engine calls.
export function planAgeBisection(plan: AgeBisectionPlan, probes: AgeFeasibilityProbe[]): AgeBisectionAction {
    const { minDelta, maxDelta } = plan;
    if (probes.length === 0) {
        return { kind: 'probe', delta: Math.min(maxDelta, Math.max(minDelta, plan.start)) };
    }

    let hi = maxDelta + 1;
    for (const p of probes) if (p.feasible && p.delta < hi) hi = p.delta;
    let lo = minDelta - 1;
    for (const p of probes) if (!p.feasible && p.delta < hi && p.delta > lo) lo = p.delta;

    if (hi - lo <= 1) {
        return hi > maxDelta ? { kind: 'unreachable' } : { kind: 'found', delta: hi };
    }
    return { kind: 'probe', delta: Math.floor((lo + hi) / 2) };
}

// --- Monte Carlo step-up ---------------------------------------------------
//
// The deterministic answer assumes average returns every year, so the driver
// MC-tests it and, while it misses the user's success bar, moves later. MC
// wobbles a few points at these iteration counts, so (as in Phase 2) we never
// bisect on the raw rate: probes establish a bracket between the highest age
// that misses and the lowest age above it that clears, then close it.

export const DEFAULT_MAX_AGE_STEPUP_PROBES = 10;

// Years to jump for the next probe given how many percentage points the last
// miss sat below the bar. Big jumps far from it, single years near it.
export function ageStepForGap(gapPP: number): number {
    if (gapPP <= 3) return 1;
    if (gapPP <= 8) return 2;
    if (gapPP <= 15) return 3;
    return 4;
}

export interface AgeProbeResult { age: number; successRate: number; }

export interface AgeStepUpPlan {
    target: number;      // MC success rate the age must clear
    start: number;       // first age to probe (the deterministic answer)
    max: number;         // latest age the search may propose
    maxProbes?: number;  // probe budget (default DEFAULT_MAX_AGE_STEPUP_PROBES)
}

export type AgeStepUpAction =
    | { kind: 'probe'; age: number }
    // The earliest probed age that clears, with the age below it missing (or it
    // is the start — the search never moves earlier than the deterministic answer).
    | { kind: 'done'; age: number; successRate: number }
    // Even `max` misses the bar: report the best probe found.
    | { kind: 'boundHit'; age: number; successRate: number }
    // Probe budget exhausted. `cleared` says whether the reported age clears the
    // bar (bracket not fully closed — the answer may be a year or so late) or is
    // just the best miss.
    | { kind: 'capHit'; age: number; successRate: number; cleared: boolean };

// Best probe to report when nothing qualifies cleanly: highest success rate,
// ties to the earlier age (same odds, retire sooner).
function bestProbe(probes: AgeProbeResult[]): AgeProbeResult {
    return probes.reduce((b, p) =>
        (p.successRate > b.successRate || (p.successRate === b.successRate && p.age < b.age) ? p : b));
}

// Given the probes run so far, decide the next move. Pure: no MC, no clocks.
export function planAgeStepUp(plan: AgeStepUpPlan, probes: AgeProbeResult[]): AgeStepUpAction {
    const { target, max } = plan;
    const maxProbes = plan.maxProbes ?? DEFAULT_MAX_AGE_STEPUP_PROBES;

    if (probes.length === 0) return { kind: 'probe', age: Math.min(max, plan.start) };

    let highestMiss: AgeProbeResult | null = null;
    for (const p of probes) {
        if (p.successRate < target && (!highestMiss || p.age > highestMiss.age)) highestMiss = p;
    }
    // Only a clear ABOVE every miss counts: a clear below a later miss is MC noise
    // in the lucky direction, and trusting it would understate the age.
    let lowestClear: AgeProbeResult | null = null;
    for (const p of probes) {
        if (p.successRate < target) continue;
        if (highestMiss && p.age <= highestMiss.age) continue;
        if (!lowestClear || p.age < lowestClear.age) lowestClear = p;
    }

    if (lowestClear) {
        if (!highestMiss || lowestClear.age - highestMiss.age <= 1) {
            return { kind: 'done', age: lowestClear.age, successRate: lowestClear.successRate };
        }
        if (probes.length >= maxProbes) {
            return { kind: 'capHit', age: lowestClear.age, successRate: lowestClear.successRate, cleared: true };
        }
        return { kind: 'probe', age: Math.floor((highestMiss.age + lowestClear.age) / 2) };
    }

    // Misses only (above any clear): step up, gap-scaled, bounded by `max`.
    const miss = highestMiss!;
    if (miss.age >= max) {
        const best = bestProbe(probes);
        return { kind: 'boundHit', age: best.age, successRate: best.successRate };
    }
    if (probes.length >= maxProbes) {
        const best = bestProbe(probes);
        return { kind: 'capHit', age: best.age, successRate: best.successRate, cleared: false };
    }
    const next = Math.min(max, miss.age + ageStepForGap(target - miss.successRate));
    return { kind: 'probe', age: next };
}

// --- Is there anything to apply? -------------------------------------------

// At the plan's own age (Δ = 0), whether the answer still asks the user to
// change something: the answer's strategy differs from the plan's AND the plan
// as entered misses the success bar. When the plan's own strategy clears the
// bar, the search's (best-estate) pick is a preference, not a fix, so there is
// nothing to apply. A moved age is a change in its own right, so this is false
// for any other Δ — the caller treats Δ ≠ 0 as "improved" on its own.
export function isStrategyChangeNeeded(
    answerDelta: number,
    strategyDiffers: boolean,
    planSuccessRate: number,
    target: number,
): boolean {
    return answerDelta === 0 && strategyDiffers && planSuccessRate < target;
}

// --- Trade-off table -------------------------------------------------------

// Δs for the trade-off rows: answer − 2 … answer + 4, clamped to the bounds,
// plus the plan's own age (Δ = 0 — the target the visitor typed in on the
// landing page) whenever the search could test it, so the table always has a
// row for the age they asked about. When the plan sits outside the window it is
// added on its own rather than filling every age in between: each row costs a
// Monte Carlo run and a could-spend search, and a far-off target would
// otherwise stretch the table to a dozen rows. A gap of a single age is filled
// (the table's "skipped ages" marker would take that line anyway). Ascending.
export function tradeoffDeltas(answer: number, minDelta: number, maxDelta: number): number[] {
    const lo = Math.max(minDelta, answer - 2);
    const hi = Math.min(maxDelta, answer + 4);
    const out = new Set<number>();
    for (let d = lo; d <= hi; d++) out.add(d);
    if (minDelta <= 0 && 0 <= maxDelta) {
        out.add(0);
        if (lo - 0 === 2) out.add(1);        // plan, one age skipped, window
        if (0 - hi === 2) out.add(-1);       // window, one age skipped, plan
    }
    return [...out].sort((a, b) => a - b);
}

// "Could spend" comes from its own MC step-down with its own MC wobble, so it
// can land a step on the wrong side of the planned spend. The row's
// success check at the planned spend is the authoritative measurement, so keep
// the two consistent: a row that clears at the planned spend could spend at
// least that much; a row that misses could spend less than it.
export function reconcileCouldSpend(
    couldSpend: number,
    clearsAtPlannedSpend: boolean,
    plannedSpend: number,
    precision: number,
): number {
    if (clearsAtPlannedSpend) return Math.max(couldSpend, plannedSpend);
    return Math.max(0, Math.min(couldSpend, plannedSpend - precision));
}

// --- Bad-markets line ------------------------------------------------------

// First age (on the percentile rows' own clock — the primary person's age) at or
// after `fromAge` where the 5th-percentile total-asset balance is ~0, or null
// when money lasts the whole plan even in those markets. `fromAge` skips the
// working years, where a thin balance is not "running out".
export function firstDepletionAge(
    percentiles: MonteCarloPercentile[],
    fromAge: number,
    threshold = 1000,
): number | null {
    for (const row of percentiles) {
        if (row.age < fromAge) continue;
        if (row.p5 <= threshold) return row.age;
    }
    return null;
}
