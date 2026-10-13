// Pure building blocks for the "How much do I need to retire?" (savings-needed)
// objective.
//
// Nothing here runs the engine or Monte Carlo: these helpers decide WHERE a
// household savings total sits across accounts, how far the search may go, who
// the at-retirement figures are reported for, and — given probe results the
// driver in meltdownOptimizer.ts feeds back — which total to try next. Keeping
// the decisions MC-free is what lets them be tested exhaustively without flake,
// the same split Phase 3 uses for the retirement age (retirementAgeSearch.ts).
//
// Terminology: the search moves one scalar, the household savings total D —
// every RRSP, TFSA and non-registered balance of both people, in today's
// dollars. The spec's "multiplier k on balances" is D / current for a household
// that has savings; a dollar total also covers the household that has none.

import type { Person, SimulationInputs, SimulationResult } from '../engine/types';
import { isStillWorking, personOf } from './retirementAgeSearch';
import type { Who } from './retirementAgeSearch';

// --- Tunables --------------------------------------------------------------

// Search cap: the largest total the search will propose. Either 20× what the
// household has (the TODO's "sane cap"), or 50 years of retirement spending —
// whichever is larger, so a household with little saved still gets a cap that
// can fund its spending with no help from returns or guaranteed income. The
// floor keeps a near-zero-spend plan (one funded by a one-time expense) from
// being capped at nothing.
export const SAVINGS_CAP_CURRENT_MULTIPLE = 20;
export const SAVINGS_CAP_SPEND_MULTIPLE = 50;
export const SAVINGS_CAP_MIN = 1_000_000;
export const SAVINGS_CAP_ROUNDING = 10_000;

// Probed totals are rounded to this, so the answer reads as a tidy figure and
// a probe never lands a few dollars off one already run. The FIRST probe of
// each phase is exempt: the deterministic phase starts at the household's
// exact current savings (k = 1 must be the plan as entered), and the MC phase
// starts at the deterministic answer (already checked, so its check is cached).
export const SAVINGS_GRANULARITY = 1_000;

// "Ten years of retirement spending" — the scale for a move when the total
// itself is no guide (zero or tiny savings). It is the first nonzero total the
// deterministic expansion proposes from nothing, and the floor of the MC step's
// base, so a deterministic answer of $0 can still step up by a meaningful
// amount. The minimum covers a plan with (almost) no spending.
export const SAVINGS_SCALE_SPEND_YEARS = 10;
export const SAVINGS_SCALE_MIN = 100_000;

// Deterministic phase: geometric expansion factor while nothing is feasible,
// then bisection to max($5,000, 2.5% of the upper bracket). The relative term
// keeps the probe count flat across household sizes; the deterministic answer
// is only the MC phase's floor, and that phase refines to its own precision,
// so it does not need to be tighter than this.
export const SAVINGS_EXPANSION_FACTOR = 2;
export const SAVINGS_DET_PRECISION_ABS = 5_000;
export const SAVINGS_DET_PRECISION_REL = 0.025;

// MC phase: refine the bracket to max($5,000, 2% of the lowest clearing total)
// within this many probes (each a full Monte Carlo run, plus a strategy search
// at any total the deterministic phase didn't check).
export const SAVINGS_MC_PRECISION_ABS = 5_000;
export const SAVINGS_MC_PRECISION_REL = 0.02;
export const DEFAULT_MAX_SAVINGS_STEPUP_PROBES = 10;

// --- Household savings -----------------------------------------------------

function nonRegBalance(p: Person): number {
    return p.nonRegisteredAccounts.reduce((s, a) => s + a.balance, 0);
}

function personSavings(p: Person): number {
    return p.rrsp.balance + p.tfsa.balance + nonRegBalance(p);
}

// RRSP + TFSA + every non-registered balance, both people, today.
export function householdSavings(inputs: SimulationInputs): number {
    return personSavings(inputs.person) + (inputs.spouse ? personSavings(inputs.spouse) : 0);
}

export type SavingsBasis = 'proportional' | 'default';

// Which allocation a household gets: its own mix scaled, when it has one; the
// stated default mix when there is nothing to scale.
export function savingsBasis(inputs: SimulationInputs): SavingsBasis {
    return householdSavings(inputs) > 0 ? 'proportional' : 'default';
}

// --- TFSA room -------------------------------------------------------------

// Published annual TFSA dollar limits. Years after the last published one are
// held at it (update this table when CRA announces the next year's limit):
// holding flat errs toward a little less TFSA room in the default mix, never
// toward room that doesn't exist.
export const TFSA_ANNUAL_LIMITS: Readonly<Record<number, number>> = {
    2009: 5_000, 2010: 5_000, 2011: 5_000, 2012: 5_000,
    2013: 5_500, 2014: 5_500,
    2015: 10_000,
    2016: 5_500, 2017: 5_500, 2018: 5_500,
    2019: 6_000, 2020: 6_000, 2021: 6_000, 2022: 6_000,
    2023: 6_500,
    2024: 7_000, 2025: 7_000, 2026: 7_000,
};
export const TFSA_FIRST_YEAR = 2009;
export const TFSA_LAST_PUBLISHED_YEAR = 2026;

export function tfsaAnnualLimit(year: number): number {
    if (year < TFSA_FIRST_YEAR) return 0;
    return TFSA_ANNUAL_LIMITS[Math.min(year, TFSA_LAST_PUBLISHED_YEAR)];
}

// The engine stamps result rows with `new Date().getFullYear() + yearOffset`,
// so "now" here is the same clock.
export function currentCalendarYear(): number {
    return new Date().getFullYear();
}

// TFSA room someone `age` today could have built up by now, never having
// contributed: the annual limits from the year they turned 18 (or 2009, when
// TFSAs began, if later) through the current year. Ages are whole years with no
// birthday in this model, so the year they turned 18 is currentYear − age + 18.
// Ignores residency gaps; this only places the default mix, it is not advice
// on anyone's actual room.
export function tfsaRoomAccumulated(age: number, currentYear: number = currentCalendarYear()): number {
    const first = Math.max(TFSA_FIRST_YEAR, currentYear - age + 18);
    let room = 0;
    for (let y = first; y <= currentYear; y++) room += tfsaAnnualLimit(y);
    return room;
}

// --- Allocation: a total → balances ----------------------------------------

export interface SavingsAllocation {
    inputs: SimulationInputs;
    basis: SavingsBasis;
}

// The plan with its household savings set to `total` (clamped at 0). Pure:
// returns a deep clone; nothing but balances (and non-reg ACB) changes.
//
//  - 'proportional' (the household has savings): every balance — each person's
//    RRSP, TFSA and EVERY non-registered account — scales by total / current,
//    so the mix is exactly the plan's. Non-reg adjustedCostBase scales by the
//    same factor, keeping each account's unrealized-gain ratio (and so the tax
//    on drawing it) unchanged. contributionRoom is room, not money: untouched.
//  - 'default' (nothing saved, so no mix to scale): split evenly between the
//    two people for a couple, then within each person TFSA first up to the room
//    they could have built up by now (tfsaRoomAccumulated), the rest to their
//    own RRSP. Non-registered accounts stay as entered (at zero). Every balance
//    is non-decreasing in `total`, which is what makes bisecting on it valid.
export function allocateSavings(
    inputs: SimulationInputs,
    total: number,
    opts: { currentYear?: number } = {},
): SavingsAllocation {
    const next = structuredClone(inputs);
    const target = Math.max(0, total);
    const current = householdSavings(inputs);

    if (current > 0) {
        const factor = target / current;
        const scale = (p: Person): void => {
            p.rrsp.balance *= factor;
            p.tfsa.balance *= factor;
            for (const a of p.nonRegisteredAccounts) {
                a.balance *= factor;
                a.adjustedCostBase *= factor;
            }
        };
        scale(next.person);
        if (next.spouse) scale(next.spouse);
        return { inputs: next, basis: 'proportional' };
    }

    const year = opts.currentYear ?? currentCalendarYear();
    const people = next.spouse ? [next.person, next.spouse] : [next.person];
    const share = target / people.length;
    for (const p of people) {
        const tfsa = Math.min(share, tfsaRoomAccumulated(p.age, year));
        p.tfsa.balance = tfsa;
        p.rrsp.balance = share - tfsa;
    }
    return { inputs: next, basis: 'default' };
}

// One person's balances, for the "how that splits" line.
export interface SavingsAccountsBreakdown {
    who: Who;
    label: string;   // 'You' / 'Spouse'
    rrsp: number;
    tfsa: number;
    nonReg: number;  // every non-registered account, summed
    total: number;   // rrsp + tfsa + nonReg
}

export function savingsBreakdown(inputs: SimulationInputs): SavingsAccountsBreakdown[] {
    const row = (who: Who, p: Person): SavingsAccountsBreakdown => {
        const nonReg = nonRegBalance(p);
        return {
            who,
            label: who === 'spouse' ? 'Spouse' : 'You',
            rrsp: p.rrsp.balance,
            tfsa: p.tfsa.balance,
            nonReg,
            total: p.rrsp.balance + p.tfsa.balance + nonReg,
        };
    };
    const out = [row('person', inputs.person)];
    if (inputs.spouse) out.push(row('spouse', inputs.spouse));
    return out;
}

// --- Search scale ----------------------------------------------------------

function ceilTo(value: number, step: number): number {
    return Math.ceil(value / step) * step;
}

function roundTo(value: number, step: number): number {
    return Math.round(value / step) * step;
}

export function savingsSearchCap(inputs: SimulationInputs): number {
    const raw = Math.max(
        SAVINGS_CAP_CURRENT_MULTIPLE * householdSavings(inputs),
        SAVINGS_CAP_SPEND_MULTIPLE * Math.max(0, inputs.postRetirementSpend),
        SAVINGS_CAP_MIN,
    );
    return ceilTo(raw, SAVINGS_CAP_ROUNDING);
}

// See SAVINGS_SCALE_SPEND_YEARS.
export function savingsSearchScale(postRetirementSpend: number): number {
    return Math.max(SAVINGS_SCALE_MIN, SAVINGS_SCALE_SPEND_YEARS * Math.max(0, postRetirementSpend));
}

// --- Deterministic outer search: bisection over D --------------------------

export interface SavingsBisectionPlan {
    start: number;        // first total to probe: the household's current savings (k = 1); clamped to [0, cap]
    cap: number;          // largest total the search may propose
    expandFloor: number;  // smallest total an expansion proposes (the step out of zero / tiny savings)
    precisionAbs?: number; // default SAVINGS_DET_PRECISION_ABS
    precisionRel?: number; // default SAVINGS_DET_PRECISION_REL (of the upper bracket)
    granularity?: number;  // default SAVINGS_GRANULARITY
}

export interface SavingsFeasibilityProbe { total: number; feasible: boolean; }

export type SavingsBisectionAction =
    | { kind: 'probe'; total: number }
    // Smallest feasible total found: its bracket below is within precision, or
    // it is 0 (nothing needed beyond guaranteed income and pre-retirement saving).
    | { kind: 'found'; total: number }
    | { kind: 'unreachable' };            // infeasible even at the cap

// Next deterministic probe. Treats feasibility as monotone increasing in D
// (more savings never hurts). Order: the current total first; if it is
// feasible, 0 next (does the plan need savings at all?) and then bisect
// between them; if it is infeasible, expand ×2 (at least to expandFloor,
// at most to the cap) until something is feasible — or report unreachable
// once the cap itself is infeasible. The bracket is the lowest feasible probe
// and the highest infeasible probe below it, so a noisy, non-monotone probe
// above the bracket can't derail it. Pure: no engine calls.
export function planSavingsBisection(
    plan: SavingsBisectionPlan,
    probes: SavingsFeasibilityProbe[],
): SavingsBisectionAction {
    const cap = Math.max(0, plan.cap);
    const precisionAbs = plan.precisionAbs ?? SAVINGS_DET_PRECISION_ABS;
    const precisionRel = plan.precisionRel ?? SAVINGS_DET_PRECISION_REL;
    const granularity = plan.granularity ?? SAVINGS_GRANULARITY;

    if (probes.length === 0) {
        return { kind: 'probe', total: Math.min(cap, Math.max(0, plan.start)) };
    }

    let hi: number | null = null;
    for (const p of probes) if (p.feasible && (hi === null || p.total < hi)) hi = p.total;

    if (hi === null) {
        // Nothing feasible yet: expand from the highest infeasible total.
        const top = probes.reduce((m, p) => Math.max(m, p.total), 0);
        if (top >= cap) return { kind: 'unreachable' };
        let next = Math.min(cap, ceilTo(Math.max(SAVINGS_EXPANSION_FACTOR * top, plan.expandFloor), granularity));
        if (next <= top) next = cap; // a zero floor out of zero: jump straight to the cap
        return { kind: 'probe', total: next };
    }

    if (hi <= 0) return { kind: 'found', total: 0 };

    let lo: number | null = null;
    for (const p of probes) if (!p.feasible && p.total < hi && (lo === null || p.total > lo)) lo = p.total;
    // Nothing infeasible below the lowest feasible total: does the plan need
    // any savings at all?
    if (lo === null) return { kind: 'probe', total: 0 };

    if (hi - lo <= Math.max(precisionAbs, precisionRel * hi)) return { kind: 'found', total: hi };
    const mid = roundTo((lo + hi) / 2, granularity);
    if (mid <= lo || mid >= hi) return { kind: 'found', total: hi };
    return { kind: 'probe', total: mid };
}

// --- Monte Carlo step-up ---------------------------------------------------
//
// The deterministic answer assumes average returns every year, so the driver
// MC-tests it and, while it misses the user's success bar, adds savings. MC
// wobbles a few points at these iteration counts, so (as for the age) we never
// bisect on the raw rate: probes establish a bracket between the highest total
// that misses and the lowest total above it that clears, then close it.

// Fraction of the step base to add for the next probe, given how many
// percentage points the last miss sat below the bar. Big jumps far from it,
// small ones near it.
export function savingsStepFractionForGap(gapPP: number): number {
    if (gapPP <= 3) return 0.04;
    if (gapPP <= 8) return 0.08;
    if (gapPP <= 15) return 0.15;
    if (gapPP <= 30) return 0.30;
    return 0.50;
}

export interface SavingsProbeResult { total: number; successRate: number; }

export interface SavingsStepUpPlan {
    target: number;        // MC success rate the total must clear
    start: number;         // first total to probe (the deterministic answer)
    cap: number;           // largest total the search may propose
    // Floor of the step's base: a step adds max(total, minStepBase) × the gap
    // fraction, so a deterministic answer of 0 still steps up (see
    // savingsSearchScale).
    minStepBase: number;
    maxProbes?: number;    // probe budget (default DEFAULT_MAX_SAVINGS_STEPUP_PROBES)
    precisionAbs?: number; // default SAVINGS_MC_PRECISION_ABS
    precisionRel?: number; // default SAVINGS_MC_PRECISION_REL (of the lowest clear)
    granularity?: number;  // default SAVINGS_GRANULARITY
}

export type SavingsStepUpAction =
    | { kind: 'probe'; total: number }
    // The lowest probed total that clears, with a miss within precision below
    // it (or it is the start — the search never goes below the deterministic answer).
    | { kind: 'done'; total: number; successRate: number }
    // Even the cap misses the bar: report the best probe found.
    | { kind: 'boundHit'; total: number; successRate: number }
    // Probe budget exhausted. `cleared` says whether the reported total clears
    // the bar (bracket not fully closed — the answer may be a little high) or
    // is just the best miss.
    | { kind: 'capHit'; total: number; successRate: number; cleared: boolean };

// Best probe to report when nothing qualifies cleanly: highest success rate,
// ties to the smaller total (same odds, less to save).
function bestProbe(probes: SavingsProbeResult[]): SavingsProbeResult {
    return probes.reduce((b, p) =>
        (p.successRate > b.successRate || (p.successRate === b.successRate && p.total < b.total) ? p : b));
}

// Given the probes run so far, decide the next move. Pure: no MC, no clocks.
export function planSavingsStepUp(plan: SavingsStepUpPlan, probes: SavingsProbeResult[]): SavingsStepUpAction {
    const { target } = plan;
    const cap = Math.max(0, plan.cap);
    const maxProbes = plan.maxProbes ?? DEFAULT_MAX_SAVINGS_STEPUP_PROBES;
    const precisionAbs = plan.precisionAbs ?? SAVINGS_MC_PRECISION_ABS;
    const precisionRel = plan.precisionRel ?? SAVINGS_MC_PRECISION_REL;
    const granularity = plan.granularity ?? SAVINGS_GRANULARITY;

    if (probes.length === 0) return { kind: 'probe', total: Math.min(cap, Math.max(0, plan.start)) };

    let highestMiss: SavingsProbeResult | null = null;
    for (const p of probes) {
        if (p.successRate < target && (!highestMiss || p.total > highestMiss.total)) highestMiss = p;
    }
    // Only a clear ABOVE every miss counts: a clear below a larger miss is MC
    // noise in the lucky direction, and trusting it would understate the need.
    let lowestClear: SavingsProbeResult | null = null;
    for (const p of probes) {
        if (p.successRate < target) continue;
        if (highestMiss && p.total <= highestMiss.total) continue;
        if (!lowestClear || p.total < lowestClear.total) lowestClear = p;
    }

    if (lowestClear) {
        const done: SavingsStepUpAction = { kind: 'done', total: lowestClear.total, successRate: lowestClear.successRate };
        if (!highestMiss) return done;
        const width = lowestClear.total - highestMiss.total;
        if (width <= Math.max(precisionAbs, precisionRel * lowestClear.total)) return done;
        if (probes.length >= maxProbes) {
            return { kind: 'capHit', total: lowestClear.total, successRate: lowestClear.successRate, cleared: true };
        }
        const mid = roundTo((highestMiss.total + lowestClear.total) / 2, granularity);
        if (mid <= highestMiss.total || mid >= lowestClear.total) return done;
        return { kind: 'probe', total: mid };
    }

    // Misses only (above any clear): step up, gap-scaled, bounded by the cap.
    const miss = highestMiss!;
    if (miss.total >= cap) {
        const best = bestProbe(probes);
        return { kind: 'boundHit', total: best.total, successRate: best.successRate };
    }
    if (probes.length >= maxProbes) {
        const best = bestProbe(probes);
        return { kind: 'capHit', total: best.total, successRate: best.successRate, cleared: false };
    }
    const step = Math.max(miss.total, plan.minStepBase) * savingsStepFractionForGap(target - miss.successRate);
    let next = Math.min(cap, ceilTo(miss.total + step, granularity));
    if (next <= miss.total) next = cap; // a zero step base: nowhere to go but the cap
    return { kind: 'probe', total: next };
}

// --- At-retirement framing -------------------------------------------------

export interface SavingsFraming {
    stillWorking: boolean;            // anyone in the household still working
    // Whose retirement the at-retirement figures are framed on: the primary
    // person when still working, else the spouse when still working, else the
    // primary (with no at-retirement figures — they have already retired).
    reportedWho: Who;
    currentAge: number;               // reported person's age today
    retirementAge: number | null;     // reported person's planned retirement age; null when nobody is still working
    yearsToRetirement: number | null; // retirementAge − currentAge (≥ 1); null likewise
}

export function planSavingsFraming(inputs: SimulationInputs): SavingsFraming {
    const personWorking = isStillWorking(inputs.person);
    const spouseWorking = !!inputs.spouse && isStillWorking(inputs.spouse);
    const stillWorking = personWorking || spouseWorking;
    const reportedWho: Who = !personWorking && spouseWorking ? 'spouse' : 'person';
    const p = personOf(inputs, reportedWho);
    return {
        stillWorking,
        reportedWho,
        currentAge: p.age,
        retirementAge: stillWorking ? p.retirementAge : null,
        yearsToRetirement: stillWorking ? p.retirementAge - p.age : null,
    };
}

// Household savings on the day the reported person retires, in today's
// dollars, from a deterministic run. Result rows carry END-of-year balances
// (after that year's growth, saving and spending), so the balance on
// retirement day is the row of the last working year: index
// yearsToRetirement − 1 — the same row summaryMetrics' initialWithdrawalRate
// takes as the pre-retirement base. Deflated by that row's own
// inflationFactor, the convention every today's-dollars view in the app uses
// (the wealth chart, the year table), so the figure matches what the wealth
// chart shows at the age before retirement with today's dollars on. null when
// there is no such row (already retired, or an empty run).
export function householdSavingsAtRetirement(
    results: SimulationResult[],
    yearsToRetirement: number | null,
): number | null {
    if (yearsToRetirement === null || yearsToRetirement < 1) return null;
    const row = results[yearsToRetirement - 1];
    if (!row) return null;
    return row.totalAssets / row.inflationFactor;
}
