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

function floorTo(value: number, step: number): number {
    return Math.floor(value / step) * step;
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
    start: number;         // first total to probe (the deterministic answer); never goes below it
    cap: number;           // largest total the search may propose
    // Optional guess at the answer (≥ start), probed first instead of the
    // start, and again later while it still lies inside the bracket. A clear
    // there makes the search step DOWN toward the start; a miss steps up from
    // it. The age rows pass their neighbour's MC/deterministic ratio × their
    // own deterministic answer. Rounded up to the granularity.
    firstProbe?: number;
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
    // A caller may hand in a probe it already measured (the age rows' MC at
    // current savings) as long as its total is ≥ the start: a miss there steps
    // up from it; a clear there steps down toward the start (see below).
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
    const start = Math.min(cap, Math.max(0, plan.start));
    const hint = plan.firstProbe === undefined
        ? null
        : Math.min(cap, Math.max(start, ceilTo(plan.firstProbe, granularity)));
    const probed = (total: number) => probes.some(p => p.total === total);

    if (probes.length === 0) return { kind: 'probe', total: hint ?? start };

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

    // The hint, while it still lies strictly inside the bracket (seeded probes
    // can come before it).
    if (hint !== null && !probed(hint) && probes.length < maxProbes
        && (!highestMiss || hint > highestMiss.total) && (!lowestClear || hint < lowestClear.total)) {
        return { kind: 'probe', total: hint };
    }

    if (lowestClear) {
        const done: SavingsStepUpAction = { kind: 'done', total: lowestClear.total, successRate: lowestClear.successRate };
        // Clears only, above an unprobed start (a hint or a handed-in probe
        // cleared): a clear says nothing about the totals below it, so step
        // DOWN toward the start — gap-scaled by how far above the bar it sits —
        // until something misses or the start itself is probed. A search that
        // began at the start has always probed it, so never gets here.
        if (!highestMiss && lowestClear.total > start && !probed(start)) {
            if (probes.length >= maxProbes) {
                return { kind: 'capHit', total: lowestClear.total, successRate: lowestClear.successRate, cleared: true };
            }
            const step = Math.max(lowestClear.total, plan.minStepBase)
                * savingsStepFractionForGap(lowestClear.successRate - target);
            const next = Math.max(start, floorTo(lowestClear.total - step, granularity));
            return { kind: 'probe', total: next };
        }
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

// --- Per-year framing: "spend $R less a year and save the difference" ------
//
// The engine has no contribution lever: before retirement, saving IS the
// surplus of after-tax income over preRetirementSpend, swept into accounts
// every year (projection.ts, Step 4). So "save $R more a year" is modelled as
// preRetirementSpend lowered by R — today's dollars, indexed by the engine
// like any spending — on the plan as entered, at today's balances. What the
// engine then does with R, as read from projection.ts:
//
//  - WHICH YEARS. preRetirementSpend is charged in every year the household is
//    not "retired", and the household only counts as retired once EVERY living
//    person has reached their retirementAge. So the lever runs from this year
//    until the last earner retires: for a couple it can run past the reported
//    person's own retirement, and it covers years when one spouse has retired
//    and the other still works (preRetirementSpendYears counts them).
//  - WHERE IT GOES. A surplus year's surplus fills each person's TFSA (the
//    indexed $7,000 limit, the primary first), then RRSP room for each person
//    still working, under 71 and not melting (18% of the indexed salary, capped
//    at the indexed $31,000) — the deduction's tax refund is swept into that
//    person's non-registered surplus account the same year, so an RRSP dollar
//    saves a little more than a dollar — then the non-registered surplus
//    accounts, split evenly between the two people. The extra therefore lands
//    wherever the plan's own surplus doesn't already fill: TFSA and RRSP room
//    first, then non-registered — a different mix from the lump sum's, which
//    scales the household's current mix. A person with no non-registered
//    account at all has nowhere for surplus past their TFSA/RRSP room (the
//    engine leaves it unsaved), so the lever stops helping there.
//  - DEFICIT YEARS. In a pre-retirement year that already spends more than it
//    takes in (a spouse retired and drawing, say), R comes off that year's
//    withdrawals instead of being swept in — worth at least as much as saving it.

// Probed R values are rounded to this ($/yr): the answer reads as a tidy
// figure, and the planners' first probes (R = 0, and the MC phase's start at
// the deterministic answer) are exempt as for the lump sum.
export const PER_YEAR_GRANULARITY = 100;
// The MC phase refines R to max($500, 2.5% of the lowest clear): a few hundred
// dollars a year is below what the copy ("about $R a year") or the simulations
// can claim, and the relative term keeps the probe count flat. The
// deterministic answer is only the MC phase's floor, so (as for the lump sum)
// it stops at a looser max($1,000, 5% of the upper bracket).
export const PER_YEAR_PRECISION_ABS = 500;
export const PER_YEAR_PRECISION_REL = 0.025;
export const PER_YEAR_DET_PRECISION_ABS = 1_000;
export const PER_YEAR_DET_PRECISION_REL = 0.05;
// Floor of the per-year scale (see savingsPerYearScale).
export const PER_YEAR_SCALE_MIN = 1_000;

// Years the engine charges preRetirementSpend, counted from this year: those in
// which some living person is still short of their retirement age. 0 when
// everyone has retired. (Nobody dies before retiring: the engine refuses a
// retirement age past life expectancy.)
export function preRetirementSpendYears(inputs: SimulationInputs): number {
    const working = (p: Person): number => Math.max(0, p.retirementAge - p.age);
    return Math.max(working(inputs.person), inputs.spouse ? working(inputs.spouse) : 0);
}

// Rough size of R: the at-retirement gap (today's dollars) spread evenly over
// the years to retirement. Growth on the contributions is ignored, so it errs
// high — the right side to err on for the deterministic search's first step
// out of R = 0, which then bisects down from it. Also the floor of the MC
// step's base. Rounded up to the granularity, within [PER_YEAR_SCALE_MIN, cap].
export function savingsPerYearScale(gapAtRetirement: number, yearsToRetirement: number, cap: number): number {
    const top = Math.max(0, cap);
    if (yearsToRetirement < 1) return top;
    const raw = ceilTo(Math.max(0, gapAtRetirement) / yearsToRetirement, PER_YEAR_GRANULARITY);
    return Math.min(top, Math.max(PER_YEAR_SCALE_MIN, raw));
}

// The deterministic search over R: from R = 0 (the plan as entered, which the
// lump-sum search has already checked), expanding ×2 from the scale up to
// spending nothing before retirement, then bisecting.
export function savingsPerYearBisectionPlan(preRetirementSpend: number, scale: number): SavingsBisectionPlan {
    return {
        start: 0,
        cap: Math.max(0, preRetirementSpend),
        expandFloor: scale,
        precisionAbs: PER_YEAR_DET_PRECISION_ABS,
        precisionRel: PER_YEAR_DET_PRECISION_REL,
        granularity: PER_YEAR_GRANULARITY,
    };
}

// A guess at the MC answer for R: the R whose effect on savings at retirement
// matches the lump sum's at-retirement gap, given `slope` — the extra savings
// at retirement (today's $) per $1/yr of R, measured on average returns. It
// tends to run a little high (dollars saved year by year meet less of the
// pre-retirement market risk than a lump sum held all along, so they need to
// add up to less), which the step-up corrects by stepping down. null when
// there is no usable slope (the extra isn't being saved anywhere).
export function savingsPerYearHint(gapAtRetirement: number, slope: number, cap: number): number | null {
    if (!(slope > 0) || !(gapAtRetirement > 0)) return null;
    return Math.min(Math.max(0, cap), gapAtRetirement / slope);
}

// The MC step-up over R, from the deterministic answer (first probing the
// hint, when there is one).
export function savingsPerYearStepUpPlan(
    target: number,
    deterministicExtra: number,
    preRetirementSpend: number,
    scale: number,
    hint: number | null = null,
): SavingsStepUpPlan {
    return {
        target,
        start: deterministicExtra,
        cap: Math.max(0, preRetirementSpend),
        minStepBase: scale,
        firstProbe: hint ?? undefined,
        precisionAbs: PER_YEAR_PRECISION_ABS,
        precisionRel: PER_YEAR_PRECISION_REL,
        granularity: PER_YEAR_GRANULARITY,
    };
}

// --- Savings needed at each retirement age ---------------------------------
//
// Rows for the plan's retirement age moved by Δ = −3 … +3 (every still-working
// person by the same Δ, as in the earliest-age search). A full savings solve
// per row would repeat the strategy search at every probed total, so each row
// other than the plan's own is an ESTIMATE, like the earliest-age "could
// spend" column: the headline answer's strategy held fixed, a deterministic
// search on D with engine runs only, then the MC step-up. The plan's own row
// (Δ = 0) is the headline answer itself, never re-estimated.

export const SAVINGS_AGE_ROW_SPAN = 3;
// Rows refine more coarsely than the headline (5% vs 2%) within a smaller
// probe budget, which roughly halves their MC runs: they are estimates on a
// held strategy, and at the usual iteration counts one MC run's wobble is
// already worth a few percent of savings, so a tighter bracket would mostly
// measure noise. (Each row also starts from a guess — see firstProbe.)
export const SAVINGS_ROW_MC_PRECISION_ABS = 5_000;
export const SAVINGS_ROW_MC_PRECISION_REL = 0.05;
export const SAVINGS_ROW_MAX_STEPUP_PROBES = 6;

// Δs for the rows: −SPAN … +SPAN clamped to the age-shift bounds, plus the
// plan's own Δ = 0 even when the bounds exclude it (a retirement age entered
// past 75 or past life expectancy − 1): the plan row is the headline answer.
export function savingsAgeRowDeltas(minDelta: number, maxDelta: number): number[] {
    const out: number[] = [];
    for (let d = Math.max(minDelta, -SAVINGS_AGE_ROW_SPAN); d <= Math.min(maxDelta, SAVINGS_AGE_ROW_SPAN); d++) out.push(d);
    if (!out.includes(0)) {
        out.push(0);
        out.sort((a, b) => a - b);
    }
    return out;
}

// What a row says about the amount, before and after reconciliation.
export interface SavingsRowNeed {
    status: 'found' | 'unreachable'; // unreachable: even the cap fails on average returns
    neededSavings: number | null;    // null when unreachable
    clears: boolean;                 // neededSavings clears the success bar
    stepUpCapHit: boolean;
    boundHit: boolean;
}

// The smallest total on the grid strictly above `value`.
function gridAbove(value: number, granularity: number): number {
    return Math.floor(value / granularity) * granularity + granularity;
}

// A row's own MC at current savings is the authoritative measurement of
// "retiring at this age with what you have" — the step-up's answer comes from
// separate, unseeded runs — so keep the two consistent (the counterpart of
// reconcileCouldSpend): a row that clears at current savings needs no more
// than current (and clears there, whatever the step-up managed); a row that
// misses at current needs more than current, at least one grid step.
export function reconcileRowNeed<T extends SavingsRowNeed>(
    row: T,
    currentSavings: number,
    clearsAtCurrent: boolean,
    granularity: number = SAVINGS_GRANULARITY,
): T {
    if (clearsAtCurrent) {
        if (row.clears && row.neededSavings !== null && row.neededSavings <= currentSavings) return row;
        return { ...row, status: 'found', neededSavings: currentSavings, clears: true, stepUpCapHit: false, boundHit: false };
    }
    if (row.neededSavings !== null && row.neededSavings <= currentSavings) {
        return { ...row, neededSavings: gridAbove(currentSavings, granularity) };
    }
    return row;
}

export interface SavingsRowDraft extends SavingsRowNeed {
    delta: number;
    isPlan: boolean;
    clearsAtCurrent: boolean;
    // The held strategy's deterministic answer at this age (computed for the
    // plan row too, on the same held strategy, so the shape compares like with
    // like). null when unreachable.
    heldDeterministic: number | null;
}

// Whether two adjacent rows' deterministic answers agree that the later age
// needs no more, to within the deterministic search's precision.
function laterNeedsNoMore(earlierDet: number | null, laterDet: number | null): boolean {
    if (earlierDet === null || laterDet === null) return false;
    const tolerance = Math.max(SAVINGS_DET_PRECISION_ABS, SAVINGS_DET_PRECISION_REL * Math.max(earlierDet, laterDet));
    return laterDet <= earlierDet + tolerance;
}

// Reconcile the rows (sorted by Δ, exactly one isPlan), in three passes:
//  1. each estimated row against its own MC at current savings (reconcileRowNeed);
//  2. smooth MC wobble so a later retirement needs no more than an earlier one,
//     outward from the plan row (which never moves, so the table agrees with
//     the headline) — but only between adjacent rows that both clear AND whose
//     deterministic answers agree on the direction. Later is usually cheaper
//     (more saving years, a shorter retirement, more CPP years), but not
//     always: a household spending more than it earns before retiring needs
//     MORE for every extra working year, and smoothing would hide exactly that;
//     the deterministic answers carry no MC noise, so they decide;
//  3. pass 1 again: a row's own measurement outranks its neighbour's, so a row
//     that misses at current savings is never smoothed into "have enough".
// Pure: returns new row objects.
export function reconcileSavingsAgeRows<T extends SavingsRowDraft>(
    rows: T[],
    currentSavings: number,
    granularity: number = SAVINGS_GRANULARITY,
): T[] {
    const own = (r: T): T => (r.isPlan ? r : reconcileRowNeed(r, currentSavings, r.clearsAtCurrent, granularity));
    const out = rows.map(own);
    const p = out.findIndex(r => r.isPlan);
    if (p < 0) return out;

    const smoothable = (earlier: T, later: T): boolean =>
        earlier.clears && later.clears && earlier.neededSavings !== null && later.neededSavings !== null
        && laterNeedsNoMore(earlier.heldDeterministic, later.heldDeterministic);
    for (let i = p + 1; i < out.length; i++) {
        const earlier = out[i - 1];
        const later = out[i];
        if (smoothable(earlier, later) && later.neededSavings! > earlier.neededSavings!) {
            out[i] = { ...later, neededSavings: earlier.neededSavings };
        }
    }
    for (let i = p - 1; i >= 0; i--) {
        const earlier = out[i];
        const later = out[i + 1];
        if (smoothable(earlier, later) && earlier.neededSavings! < later.neededSavings!) {
            out[i] = { ...earlier, neededSavings: later.neededSavings };
        }
    }
    return out.map(own);
}
