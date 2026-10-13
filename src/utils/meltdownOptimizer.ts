// RRSP meltdown optimizer — a search loop over EXISTING engine inputs.
//
// The engine (projection.ts / tax.ts / cpp.ts) is treated as a pure black box:
// this module only rewrites a handful of per-person fields (rrspMeltAmount,
// cppStartAge, oasStartAge) plus the household withdrawalStrategy — and, in
// max-spend mode, postRetirementSpend; in earliest-age mode, retirementAge and
// cppContributedYears — on deep clones of the base inputs and
// re-runs runSimulation / runMonteCarlo to score each candidate. In
// savings-needed mode the balances (and non-reg ACB) are rescaled too — on the
// clones the search scores, never as a recommendation. Nothing here mutates the
// caller's inputs.
//
// Four objective modes share one coordinate-descent search (see the `Objective`
// abstraction below and runStrategySearch). All four are duals of the same
// feasibility check — fix all but one of {retirement age, spending, estate,
// savings}, solve for the remaining one:
//
//  - 'estate' (default): maximize nominal netEstateValue subject to a $1k
//    shortfall tolerance. A deterministic sweep picks a winner; a Monte Carlo
//    pass then guards against a winner that looks great deterministically but is
//    materially riskier than the baseline. Both withdrawal orders are searched:
//    the order governs only the residual spending deficit (RRIF minimums and the
//    voluntary melt come out first regardless), but measured across 13 test
//    plans, holding it fixed cost up to 48% of net estate — and which order wins
//    is plan-dependent, so it has to be searched rather than assumed.
//  - 'max-spend': fix the plan's shape and solve for the highest sustainable
//    postRetirementSpend. Each candidate is scored by bisecting spend to ~$500
//    precision (feasibility is monotone in spend); the deterministic winner's
//    spend is then stepped DOWN until Monte Carlo success clears a user-chosen
//    threshold, because a deterministic max-spend number is dangerously
//    optimistic for someone who will actually live on it.
//  - 'earliest-age': fix spending and solve for the earliest retirement age.
//    Every still-working person's retirementAge moves by one shared Δ (CPP
//    contribution years follow it; a DB pension does not). At each age the
//    inner check is "does ANY strategy keep the plan funded" — the same search,
//    scored by net estate among deterministically feasible candidates. An
//    integer bisection finds the earliest deterministically feasible age, then
//    a Monte Carlo step-up moves later until the user's success bar clears.
//    The pure decision helpers live in retirementAgeSearch.ts.
//  - 'savings-needed': fix the retirement ages and spending, solve for the
//    household savings (today's dollars) that keep the plan funded at the
//    user's success bar. The same outer loop as earliest-age with a different
//    outer variable: a bisection on the savings total D (the inner check is
//    earliest-age's "does ANY strategy work here", unchanged), then a Monte
//    Carlo step-up on D. D is placed across accounts by scaling the plan's own
//    mix, or by a stated default mix when nothing is saved yet. The pure
//    decision helpers live in savingsSearch.ts.

import { runSimulation, runMonteCarlo } from '../engine/projection';
import type { Person, SimulationInputs, SimulationResult, MonteCarloResult } from '../engine/types';
import { computeSummaryMetrics } from './summaryMetrics';
import type { SummaryMetrics } from './summaryMetrics';
import {
    planAgeShift,
    applyRetirementShift,
    planAgeBisection,
    planAgeStepUp,
    isStrategyChangeNeeded,
    tradeoffDeltas,
    reconcileCouldSpend,
    firstDepletionAge,
    personOf,
    DEFAULT_MAX_AGE_STEPUP_PROBES,
} from './retirementAgeSearch';
import type { AgeFeasibilityProbe, AgeProbeResult, AgeStepUpAction, Who } from './retirementAgeSearch';
import {
    householdSavings,
    savingsBasis,
    allocateSavings,
    savingsBreakdown,
    savingsSearchCap,
    savingsSearchScale,
    planSavingsBisection,
    planSavingsStepUp,
    planSavingsFraming,
    householdSavingsAtRetirement,
    DEFAULT_MAX_SAVINGS_STEPUP_PROBES,
} from './savingsSearch';
import type {
    SavingsAccountsBreakdown,
    SavingsBasis,
    SavingsFeasibilityProbe,
    SavingsProbeResult,
    SavingsStepUpAction,
} from './savingsSearch';

type WithdrawalStrategy = 'tax-efficient' | 'rrsp-first';

// The four things the optimizer can solve for.
export type OptimizerObjective = 'estate' | 'max-spend' | 'earliest-age' | 'savings-needed';

// --- Public options / result types ---------------------------------------

export interface OptimizeMeltdownOptions {
    // Which objective to solve for (default 'estate'). 'max-spend' finds the
    // highest sustainable annual spending instead of the largest estate;
    // 'earliest-age' finds the earliest retirement age at the planned spending;
    // 'savings-needed' finds the household savings the plan needs today.
    objective?: OptimizerObjective;
    // Also search CPP/OAS start ages (default true). When false, both are pinned
    // to the user's current input values. Applies to every objective.
    considerCppOas?: boolean;
    // Monte Carlo iterations for the validation pass (default 200).
    mcIterations?: number;
    // max-spend, earliest-age and savings-needed: the Monte Carlo success rate
    // (0-100) the answer must clear (the spend step-down / the age or savings
    // step-up). Default 85.
    mcSuccessTarget?: number;
    // earliest-age only: 'all' (default) fills the "could spend" column on
    // every trade-off row; 'none' skips it (faster, e.g. for tests).
    couldSpendRows?: 'all' | 'none';
    // savings-needed only, TEST-ONLY: replaces the search cap (savingsSearchCap)
    // so the unreachable path can be reached without a pathological plan.
    savingsSearchCap?: number;
    // Progress callback. `total` is an estimate that the run snaps to on finish.
    onProgress?: (done: number, total: number) => void;
    // Cancellation. Checked between batches; rejects with an AbortError.
    signal?: AbortSignal;
}

// Human-readable per-person recommendation, for the plain-language card.
export interface PersonMeltdownDecision {
    who: 'person' | 'spouse';
    label: string;              // 'You' / 'Spouse'
    hasRrsp: boolean;
    meltAmount: number;         // recommended rrspMeltAmount
    meltStartAge: number;       // first year the melt actually runs
    meltEndAge: number;         // always 71 (last year before mandatory RRIF)
    originalMeltAmount: number;    // the plan's existing rrspMeltAmount, before this recommendation
    originalMeltStartAge: number;  // the plan's existing effective melt start age
    cppStartAge: number;
    cppChanged: boolean;
    originalCppStartAge: number;
    oasStartAge: number;
    oasChanged: boolean;
    originalOasStartAge: number;
}

// max-spend-only extras. Present only when `objective === 'max-spend'`.
export interface MaxSpendResult {
    sustainableSpend: number;   // final annual spend after the MC step-down
    currentSpend: number;       // the plan's existing postRetirementSpend
    spendDelta: number;         // sustainable − current (nominal)
    deterministicMax: number;   // the pre-step-down bisected max (≥ sustainableSpend)
    mcSuccessTarget: number;    // the threshold the spend was held to
    achievedSuccessRate: number; // MC success rate at the final spend
    stepDownCapHit: boolean;    // true when the probe cap was hit still short of target
    withdrawalStrategy: WithdrawalStrategy; // the winning household strategy
    strategyChanged: boolean;   // winning strategy differs from the plan's
    onTrack: boolean;           // sustainable within one precision step of current
}

// earliest-age: one shifted person's ages. Present for everyone whose
// retirement age the search moves (retirementAge > age today).
export interface EarliestAgePerson {
    who: Who;
    label: string;                     // 'You' / 'Spouse'
    currentAge: number;                // age today
    planRetirementAge: number;         // the plan's retirementAge
    answerRetirementAge: number | null; // retirementAge at the answer (null when not found)
    planCppYears: number;
    answerCppYears: number | null;     // follows the age unless a CPP Calculator estimate is held
}

// earliest-age: one row of the trade-off table.
export interface EarliestAgeRow {
    delta: number;                     // Δ vs the plan (negative = sooner)
    retirementAge: number;             // the reported person's retirement age
    otherRetirementAge?: number;       // the other shifted person's, when both move
    successRate: number;               // MC success at the planned spending
    clearsTarget: boolean;
    deterministicFeasible: boolean;    // some strategy funds the plan on average returns
    // Display-only, in TODAY'S dollars (computeSummaryMetrics(..., true)) so they
    // compare with couldSpend and the page's inputs. The search itself ranks on
    // the nominal metrics; these never feed back into it.
    netEstate: number;                 // net estate at the end, today's $ (best strategy at this age)
    lifetimeTax: number;               // lifetime tax incl. terminal tax, today's $
    // Estimated max sustainable spend at this age to the same bar, on this row's
    // winning strategy (not re-searched). null = skipped (couldSpendRows 'none')
    // or no spend clears the bar.
    couldSpend: number | null;
    isAnswer: boolean;
    isPlan: boolean;                   // Δ = 0, the plan's own age
}

// earliest-age-only extras. Present only when `objective === 'earliest-age'`.
export interface EarliestAgeResult {
    // 'found': an age clears the plan (check boundHit/stepUpCapHit for how firmly).
    // 'unreachable': no age up to the cap funds the planned spending even on
    //   average returns. 'unavailable': nothing to move (see unavailableReason).
    status: 'found' | 'unreachable' | 'unavailable';
    unavailableReason?: 'nobody-working' | 'no-common-range';
    reportedWho: Who;                  // whose age the headline reports
    people: EarliestAgePerson[];       // every shifted person
    currentAge: number;                // reported person's age today
    planAge: number;                   // reported person's planned retirement age
    answerAge: number | null;          // reported person's earliest retirement age
    deltaYears: number | null;         // answerAge − planAge (negative = sooner)
    deterministicAge: number | null;   // earliest age feasible on average returns (≤ answerAge)
    minAge: number;                    // reported person's search bounds
    maxAge: number;
    retiresNow: boolean;               // answer is the reported person's age today
    atLowerBound: boolean;             // answer is the earliest age the search can test
    mcSuccessTarget: number;
    achievedSuccessRate: number | null; // MC success at the answer age, planned spending
    stepUpCapHit: boolean;             // MC probe budget ran out (answer may be a little late)
    boundHit: boolean;                 // even the latest allowed age misses the bar
    onTrack: boolean;                  // answer equals the plan's own age
    // The answer is the plan's own age, but only with a different strategy: the
    // answer's CPP/OAS start, melt amount or withdrawal order differs from the
    // plan's AND the plan as entered misses the success bar. Always false when
    // the answer moves the age (that is a change in its own right) and when
    // there is no answer.
    strategyChangeNeeded: boolean;
    postRetirementSpend: number;       // the spending the age was solved at
    cppOverrideHeld: boolean;          // a CPP Calculator estimate did not move with retirement age
    pensionHeld: boolean;              // a shifted person's DB pension was held as entered
    withdrawalStrategy: WithdrawalStrategy; // the answer age's winning order
    strategyChanged: boolean;
    rows: EarliestAgeRow[];            // trade-off table (empty unless found)
    // Reported person's age when the 5th-percentile balance first hits ~0 after
    // retiring (the worst 1-in-20 markets), or null when money lasts the plan.
    badMarketsAge: number | null;
}

// savings-needed: one person's balances at the answer, today's dollars, for a
// "how that splits" line. Sums across people to neededSavings.
export type SavingsNeededAccounts = SavingsAccountsBreakdown;

// savings-needed-only extras. Present only when `objective === 'savings-needed'`.
//
// Every dollar figure here is in TODAY'S dollars. The answer is a household
// total held TODAY (balances are entered as of today); for someone still
// working the at-retirement pair restates it as what the household would hold
// on the day they retire.
export interface SavingsNeededResult {
    // 'found': a savings total clears the plan (check boundHit/stepUpCapHit
    //   for how firmly).
    // 'unreachable': even searchCap fails on average returns, whatever the
    //   strategy — the spending is more than savings can fund at these
    //   retirement ages. Point at max-spend / earliest-age instead.
    status: 'found' | 'unreachable';
    // How a total was spread across accounts (state it in the answer — $1 of
    // RRSP, TFSA and non-reg are worth different after-tax amounts):
    //  'proportional': the household's current mix scaled up or down — every
    //    RRSP, TFSA and non-registered balance, non-reg cost base with it.
    //  'default': nothing saved today, so no mix to scale — split evenly
    //    between spouses, then TFSA up to the room each could have built up
    //    since 18 (or 2009), the rest to RRSP.
    basis: SavingsBasis;
    currentSavings: number;            // household RRSP + TFSA + non-reg today
    neededSavings: number | null;      // household total today that clears the bar (null when unreachable)
    deterministicSavings: number | null; // smallest total funding the plan on average returns (≤ neededSavings)
    searchCap: number;                 // largest total the search would try
    savingsGap: number | null;         // neededSavings − currentSavings; negative = the margin you have
    haveEnough: boolean;               // neededSavings ≤ currentSavings (false when unreachable)
    // The answer is $0: guaranteed income (CPP/OAS/DB pension) plus what the
    // working years' surplus sweeps into accounts covers the spending alone.
    needIsZero: boolean;
    // haveEnough, but only with a different strategy: the answer's CPP/OAS
    // start, melt amount or withdrawal order differs from the plan's AND the
    // plan as entered misses the bar at current savings (baselineSuccessRate).
    // When haveEnough while the plan as entered misses and this is false, the
    // two differ by MC wobble alone (separate unseeded runs) — say "about
    // enough" rather than contradict the odds shown.
    strategyChangeNeeded: boolean;
    neededAccounts: SavingsNeededAccounts[]; // per person at the answer; empty when unreachable

    // --- At-retirement framing ---
    stillWorking: boolean;             // anyone in the household still working
    // Whose retirement frames the at-retirement figures: the primary person if
    // still working, else the spouse if still working, else the primary (with
    // the at-retirement figures null — already retired).
    reportedWho: Who;
    currentAge: number;                // reported person's age today
    retirementAge: number | null;      // reported person's planned retirement age (null when nobody is still working)
    // Household savings on the day `reportedWho` retires (the END-of-year
    // balance of their last working year, deflated by that row's
    // inflationFactor — see householdSavingsAtRetirement), today's dollars.
    // neededAtRetirement is the answer's run; currentAtRetirement runs the
    // answer's strategy at CURRENT savings, so the two differ only by savings
    // (when unreachable there is no answer strategy: it is the plan as
    // entered). Both null when nobody is still working.
    neededAtRetirement: number | null;
    currentAtRetirement: number | null;

    mcSuccessTarget: number;
    achievedSuccessRate: number | null; // MC success at the answer (null when unreachable)
    // MC probe budget ran out. With achievedSuccessRate ≥ the target the answer
    // clears but may be a little high; below it, no probed total cleared
    // (the answer is the best probe — read it like boundHit).
    stepUpCapHit: boolean;
    boundHit: boolean;                 // even searchCap misses the bar (answer = best probe)
    postRetirementSpend: number;       // the spending the savings were solved at
    withdrawalStrategy: WithdrawalStrategy; // the answer's winning order
    strategyChanged: boolean;
    // Reported person's age when the 5th-percentile balance first hits ~0 after
    // they retire (from today when already retired) at the answer, on their own
    // clock — or null when money lasts the plan even in the worst 1-in-20 markets.
    badMarketsAge: number | null;
}

export interface MeltdownResult {
    // Which objective produced this result. Drives both the UI rendering and
    // which fields applyMeltdownRecommendation carries over.
    objective: OptimizerObjective;

    // For estate: false when nothing feasible beats the baseline. For max-spend:
    // false when the sustainable spend lands within one precision step of the
    // current planned spend ("your plan is about right"). For earliest-age:
    // true when the answer moves the age, or when it keeps the plan's own age
    // but needs a different strategy to clear the bar (see
    // EarliestAgeResult.strategyChangeNeeded); false when the plan already works
    // at its own age as entered, or when there is no answer (unreachable /
    // unavailable). Either way the UI shows a muted state and hides Apply/Save.
    // For savings-needed: true when an answer was found and it is MORE than
    // the household has today (there is no Apply for this mode — balances are
    // facts, not choices).
    improved: boolean;

    baselineInputs: SimulationInputs;
    recommendedInputs: SimulationInputs;

    baselineResults: SimulationResult[];
    recommendedResults: SimulationResult[];
    baselineMetrics: SummaryMetrics;   // nominal
    recommendedMetrics: SummaryMetrics; // nominal

    baselineMonteCarlo: MonteCarloResult | null;
    recommendedMonteCarlo: MonteCarloResult | null;

    decisions: PersonMeltdownDecision[];

    netEstateDelta: number;   // recommended − baseline (nominal)
    lifetimeTaxDelta: number; // recommended − baseline (nominal)

    baselineSuccessRate: number | null;
    recommendedSuccessRate: number | null;
    // estate only: set when the deterministic winner was kept despite a Monte
    // Carlo success rate materially (>1pt) below baseline and no safer runner-up
    // qualified. Always false in max-spend, earliest-age and savings-needed
    // modes (the MC step-down / step-up IS the guard).
    mcWarning: boolean;

    // Present only when objective === 'max-spend'.
    maxSpend?: MaxSpendResult;
    // Present only when objective === 'earliest-age'.
    earliestAge?: EarliestAgeResult;
    // Present only when objective === 'savings-needed'. The top-level fields
    // then read: baseline* = the plan as entered at current savings
    // (baselineSuccessRate is "your odds today"); recommended* = the answer
    // (balances at neededSavings, the winning strategy); decisions = the
    // strategy at the answer vs the plan's.
    savingsNeeded?: SavingsNeededResult;
}

// --- Tunables ------------------------------------------------------------

const SHORTFALL_TOL = 1000;   // same $1k tolerance runMonteCarlo uses
const IMPROVE_EPS = 1;        // net-estate must beat baseline by >$1 to count
const TIE_EPS = 1;            // net-estate values within $1 are "tied"
const COARSE_STEPS = 8;       // ~8 nonzero melt values in the estate coarse grid
const MAX_SWEEPS = 3;         // coordinate-descent sweep cap for couples
const MAX_PATTERN_STEPS = 8;  // diagonal steps per sweep (grid is 9 long, so this spans it)
const PATTERN_EST = 8;        // progress-estimate allowance for the pattern phase
const BATCH = 10;             // engine runs between event-loop yields
const MC_WARN_MARGIN = 1;     // pp the winner may trail baseline before warning

// max-spend tunables
const SPEND_PRECISION = 500;      // bisection precision on postRetirementSpend
const SPEND_FLOOR = 20_000;       // lower anchor for the doubling search
const MAX_DOUBLINGS = 8;          // cap on the "grow hi until infeasible" phase
const MAXSPEND_MELT_STEPS = 3;    // far fewer nonzero melt values than estate mode
const SPEND_TIE_EPS = SPEND_PRECISION; // spends within one precision step are "tied"
const DEFAULT_MC_TARGET = 85;     // default success-rate bar
const AVG_BISECTION_RUNS = 12;    // progress estimate only (snaps at finish)

// max-spend MC step-down (adaptive descent). The step size scales with how far
// the last probe's success rate sits from the target: big jumps far from the
// bar, ~$2,500 precision near it. See planStepDownProbe / stepDownStepForGap.
const STEPDOWN_PRECISION = 2500;      // refine the sustainable spend to this granularity
const MAX_STEPDOWN_PROBES = 16;       // cap on step-down MC probes (each a full runMonteCarlo)
const STEPDOWN_WARM_MISS_MARGIN = 8;  // pp below target that marks a "badly missing" baseline
const STEPDOWN_WARM_MIN_GAP = 20_000; // det-max must clear current spend by this to warm-start low

// earliest-age tunables. The inner "is any strategy feasible at this age" check
// runs once per probed age, so it uses max-spend's cheap grid (few melt steps,
// no refinement): the melt amount mostly reorders taxes rather than deciding
// whether the money lasts.
export const EARLIEST_AGE_MELT_STEPS = MAXSPEND_MELT_STEPS;
const MAX_AGE_STEPUP_PROBES = DEFAULT_MAX_AGE_STEPUP_PROBES;
const DEPLETION_THRESHOLD = SHORTFALL_TOL; // p5 balance at/below this counts as "run out"

// savings-needed reuses earliest-age's inner check unchanged (same objective,
// same cheap grid); its own search constants live in savingsSearch.ts.
const MAX_SAVINGS_STEPUP_PROBES = DEFAULT_MAX_SAVINGS_STEPUP_PROBES;

// --- Candidate builders (exported for testing) ---------------------------

// CPP candidates: {60,65,70} ∪ {current}, filtered to ages the person can still
// choose (≥ current age). If CPP was already set to before "now" it's locked in
// (can't rewrite the past) — keep only the current value.
export function buildCppCandidates(person: Person, considerCppOas: boolean): number[] {
    const current = person.cppStartAge;
    if (!considerCppOas) return [current];
    if (current < person.age) return [current];
    const filtered = [...new Set([60, 65, 70, current])].filter(a => a >= person.age);
    return filtered.length ? filtered.sort((a, b) => a - b) : [current];
}

// OAS candidates: {65,70} ∪ {current}, same ≥-current-age filtering.
export function buildOasCandidates(person: Person, considerCppOas: boolean): number[] {
    const current = person.oasStartAge;
    if (!considerCppOas) return [current];
    if (current < person.age) return [current];
    const filtered = [...new Set([65, 70, current])].filter(a => a >= person.age);
    return filtered.length ? filtered.sort((a, b) => a - b) : [current];
}

// Coarse annual-melt grid: 0 plus ~`steps` values scaled to the person's RRSP
// balance and melt window. The natural upper anchor is "deplete the RRSP evenly
// across the window"; we extend 1.5× past it so faster drawdowns are also on the
// table (the engine caps each year at the remaining balance). `steps` defaults to
// the estate mode's density; max-spend passes a much smaller count because the
// voluntary melt amount barely moves the sustainable spend (deficit-driven
// withdrawals drain the RRSP anyway — melt mostly reorders taxes).
export function buildMeltGrid(person: Person, steps: number = COARSE_STEPS): number[] {
    const balance = person.rrsp.balance;
    if (balance <= 0) return [0];
    const startAge = Math.max(person.retirementAge, person.age);
    const meltYears = 72 - startAge; // melt runs while age < 72
    if (meltYears <= 0) return [0];

    const fullDepletion = balance / meltYears;
    const max = fullDepletion * 1.5;
    const grid = [0];
    for (let i = 1; i <= steps; i++) {
        grid.push(roundTo((max * i) / steps, 500));
    }
    return dedupe(grid);
}

// Finer melt values around the coarse winner: subdivide the interval between the
// winner's coarse-grid neighbours. Excludes the winner and any value ≤ 0.
function refineMeltGrid(winner: number, coarseGrid: number[]): number[] {
    if (winner <= 0) return [];
    const sorted = dedupe(coarseGrid).sort((a, b) => a - b);
    const idx = sorted.indexOf(winner);
    const step = sorted.length > 1 ? sorted[1] - sorted[0] : winner;
    const lo = idx > 0 ? sorted[idx - 1] : Math.max(0, winner - step);
    const hi = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : winner + step;
    const span = hi - lo;
    const out: number[] = [];
    const STEPS = 4;
    for (let i = 1; i < STEPS; i++) {
        out.push(roundTo(lo + (span * i) / STEPS, 250));
    }
    return dedupe(out).filter(v => v > 0 && v !== winner);
}

function roundTo(value: number, step: number): number {
    return Math.round(value / step) * step;
}

function dedupe(values: number[]): number[] {
    return [...new Set(values)];
}

// --- Max-spend bisection (exported for testing) --------------------------

// Highest postRetirementSpend the plan can fund without shortfall, to
// SPEND_PRECISION. Feasibility (totalShortfall ≤ SHORTFALL_TOL) is monotone
// decreasing in spend — zero spend never shortfalls, huge spend always does — so
// a bisection between a known-feasible lo and an infeasible hi converges. `hi`
// is found by doubling from a floor; if it stays feasible past the doubling cap
// (very wealthy plan) that capped spend is returned as the answer. `inputs`
// should already carry the candidate's melt/CPP/OAS/strategy; only
// postRetirementSpend is varied here.
export function maxSustainableSpend(
    inputs: SimulationInputs,
    opts: { precision?: number; floor?: number; maxDoublings?: number } = {},
): { spend: number; runs: number } {
    const precision = opts.precision ?? SPEND_PRECISION;
    const floor = opts.floor ?? SPEND_FLOOR;
    const maxDoublings = opts.maxDoublings ?? MAX_DOUBLINGS;

    let runs = 0;
    const feasibleAt = (spend: number): boolean => {
        runs++;
        const trial = withSpend(inputs, spend);
        const metrics = computeSummaryMetrics(runSimulation(trial), trial, false);
        return metrics.totalShortfall <= SHORTFALL_TOL;
    };

    // lo is always feasible (spending nothing can never shortfall).
    let lo = 0;
    let hi = Math.max(inputs.postRetirementSpend, floor);
    let hiFeasible = feasibleAt(hi);
    let doublings = 0;
    while (hiFeasible && doublings < maxDoublings) {
        lo = hi;
        hi = hi * 2;
        hiFeasible = feasibleAt(hi);
        doublings++;
    }

    if (hiFeasible) {
        // Doubling cap hit with hi still feasible — return it (rounded down).
        return { spend: Math.floor(hi / precision) * precision, runs };
    }

    // Bisect the feasible/infeasible boundary.
    while (hi - lo > precision) {
        const mid = (lo + hi) / 2;
        if (feasibleAt(mid)) lo = mid;
        else hi = mid;
    }
    return { spend: Math.floor(lo / precision) * precision, runs };
}

// --- Max-spend MC step-down (exported for testing) -----------------------
//
// The deterministic max is dangerously optimistic, so we step spend DOWN until
// a Monte Carlo success rate clears the user's target. `runMonteCarlo` wobbles
// at these iteration counts, so we do NOT bisect on the raw MC rate — instead we
// establish a bracket of probed spends (a highest "clears" and a lowest "misses")
// and refine it to STEPDOWN_PRECISION. All the decision logic lives in the two
// pure helpers below (MC-free, exhaustively unit-tested); the MC-running loop in
// finishMaxSpend is a thin driver.

// Dollars to move for the next probe, given how many percentage points the last
// probe sits from the target (below it, when descending; above it, when the warm
// start over-shot low and we search back up). Big jumps far from the bar shrink
// to ~$2,500 precision as the probe approaches it — which also keeps the eventual
// overshoot small, so the bracket refinement rarely needs extra probes.
export function stepDownStepForGap(gapPP: number): number {
    if (gapPP <= 3) return 2_500;
    if (gapPP <= 7) return 5_000;
    if (gapPP <= 15) return 10_000;
    return 15_000;
}

export interface StepDownProbeResult { spend: number; successRate: number; }

export interface StepDownPlan {
    target: number;    // MC success rate the spend must clear
    ceiling: number;   // deterministic max — spend can never exceed this
    floor: number;     // lower anchor (0)
    precision?: number; // bracket width to stop at (default STEPDOWN_PRECISION)
}

export type StepDownAction =
    | { kind: 'probe'; spend: number }                       // run MC at this spend next
    | { kind: 'done'; spend: number; successRate: number }   // report this probed, clearing spend
    | { kind: 'capHit'; spend: number; successRate: number }; // couldn't clear anywhere

// Given the probes run so far, decide the next move. Pure: no MC, no clocks.
// Strategy: with only misses seen, step DOWN (adaptive); with only clears seen,
// step UP toward the ceiling (the winner's plan usually beats the baseline, so a
// low warm start that clears must not understate the sustainable spend); once a
// clears/misses bracket exists, refine it to `precision`.
export function planStepDownProbe(
    plan: StepDownPlan,
    probes: StepDownProbeResult[],
): StepDownAction {
    const precision = plan.precision ?? STEPDOWN_PRECISION;
    const { target, ceiling, floor } = plan;

    if (probes.length === 0) return { kind: 'probe', spend: ceiling };

    let bestClear: StepDownProbeResult | null = null;  // highest spend that cleared
    let lowestMiss: StepDownProbeResult | null = null; // lowest spend that missed
    for (const p of probes) {
        if (p.successRate >= target) {
            if (!bestClear || p.spend > bestClear.spend) bestClear = p;
        } else {
            if (!lowestMiss || p.spend < lowestMiss.spend) lowestMiss = p;
        }
    }

    // Bracket established (a clear strictly below a miss): refine toward the top.
    if (bestClear && lowestMiss && lowestMiss.spend > bestClear.spend) {
        if (lowestMiss.spend - bestClear.spend <= precision) {
            return { kind: 'done', spend: bestClear.spend, successRate: bestClear.successRate };
        }
        const mid = roundTo((bestClear.spend + lowestMiss.spend) / 2, precision);
        if (mid <= bestClear.spend || mid >= lowestMiss.spend) {
            return { kind: 'done', spend: bestClear.spend, successRate: bestClear.successRate };
        }
        return { kind: 'probe', spend: mid };
    }

    // Only clears so far → search UP (bounded by the ceiling).
    if (bestClear && !lowestMiss) {
        if (bestClear.spend >= ceiling) {
            return { kind: 'done', spend: bestClear.spend, successRate: bestClear.successRate };
        }
        const step = stepDownStepForGap(bestClear.successRate - target);
        const next = Math.min(ceiling, bestClear.spend + step);
        if (next <= bestClear.spend) {
            return { kind: 'done', spend: bestClear.spend, successRate: bestClear.successRate };
        }
        return { kind: 'probe', spend: next };
    }

    // Only misses so far → search DOWN (bounded by the floor).
    if (!bestClear && lowestMiss) {
        if (lowestMiss.spend <= floor) {
            return { kind: 'capHit', spend: lowestMiss.spend, successRate: lowestMiss.successRate };
        }
        const step = stepDownStepForGap(target - lowestMiss.successRate);
        const next = Math.max(floor, lowestMiss.spend - step);
        return { kind: 'probe', spend: next };
    }

    // Noise-inverted (a higher spend cleared while a lower one missed) or otherwise
    // ambiguous: fall back to the best clearing probe, else the least-bad miss.
    if (bestClear) return { kind: 'done', spend: bestClear.spend, successRate: bestClear.successRate };
    return { kind: 'capHit', spend: lowestMiss!.spend, successRate: lowestMiss!.successRate };
}

// The first spend to MC-probe. Normally the deterministic max, but when the
// baseline (current plan at current spend) badly misses the target AND the
// deterministic max sits well above the current spend, the target-clearing spend
// is likely far below the deterministic max — so anchor near the current spend to
// skip a long descent. If that anchor clears, planStepDownProbe searches upward,
// so a warm start can never understate the answer.
export function initialStepDownSpend(args: {
    ceiling: number; floor: number; currentSpend: number; baselineRate: number; target: number;
}): number {
    const { ceiling, floor, currentSpend, baselineRate, target } = args;
    const badMiss = baselineRate < target - STEPDOWN_WARM_MISS_MARGIN;
    const bigGap = ceiling - currentSpend > STEPDOWN_WARM_MIN_GAP;
    if (badMiss && bigGap) return Math.min(ceiling, Math.max(floor, currentSpend));
    return ceiling;
}

// --- Internal search plumbing --------------------------------------------

interface PersonChoice { melt: number; cpp: number; oas: number; }
// Every candidate carries an explicit household withdrawal order — both
// objectives search it, so there is no "leave it as the plan has it" case.
interface Assignment { person: PersonChoice; spouse?: PersonChoice; strategy: WithdrawalStrategy; }
// The per-person half of an assignment, before a descent tags it with the
// strategy arm it belongs to.
type UntaggedAssignment = Omit<Assignment, 'strategy'>;

interface Evaluated {
    a: Assignment;
    sig: string;
    inputs: SimulationInputs;   // spend-adjusted in max-spend mode
    results: SimulationResult[];
    metrics: SummaryMetrics;
    feasible: boolean;
    score: number;              // objective scalar: netEstateValue | max sustainable spend
    ageDist: number;   // |Δcpp|+|Δoas| vs current inputs (tie-break a)
    totalMelt: number; // household melt (tie-break b)
    strategyMatchesCurrent: boolean; // tie-break c (both objectives)
}

function signatureOf(a: Assignment): string {
    const p = `${a.person.melt}/${a.person.cpp}/${a.person.oas}`;
    const s = a.spouse ? `${a.spouse.melt}/${a.spouse.cpp}/${a.spouse.oas}` : '-';
    return `${p}|${s}#${a.strategy}`;
}

function personChoices(melt: number[], cpp: number[], oas: number[]): PersonChoice[] {
    const out: PersonChoice[] = [];
    for (const m of melt) for (const c of cpp) for (const o of oas) out.push({ melt: m, cpp: c, oas: o });
    return out;
}

// cppOverrideStartAge is deliberately NOT a searched field: it records the age a
// CPP Calculator estimate was worked out at, and the engine re-bases the
// estimate to whichever cppStartAge is being tried. Moving it with cppStartAge
// would pay the same amount at every start age and make 60 look best.
function applyChoice(p: Person, c: PersonChoice): void {
    p.rrspMeltAmount = c.melt;
    p.rrspMeltStartAge = undefined; // engine defaults the start to retirementAge
    p.cppStartAge = c.cpp;
    p.oasStartAge = c.oas;
}

function applyAssignment(base: SimulationInputs, a: Assignment): SimulationInputs {
    const next = structuredClone(base);
    applyChoice(next.person, a.person);
    if (next.spouse && a.spouse) applyChoice(next.spouse, a.spouse);
    next.withdrawalStrategy = a.strategy;
    return next;
}

function withSpend(inputs: SimulationInputs, spend: number): SimulationInputs {
    const next = structuredClone(inputs);
    next.postRetirementSpend = spend;
    return next;
}

function nearest(values: number[], target: number): number {
    return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), values[0]);
}

function initialChoice(p: Person, melt: number[], cpp: number[], oas: number[]): PersonChoice {
    return {
        melt: nearest(melt, p.rrspMeltAmount ?? 0),
        cpp: cpp.includes(p.cppStartAge) ? p.cppStartAge : nearest(cpp, p.cppStartAge),
        oas: oas.includes(p.oasStartAge) ? p.oasStartAge : nearest(oas, p.oasStartAge),
    };
}

function ageDistance(base: SimulationInputs, a: Assignment): number {
    let d = Math.abs(a.person.cpp - base.person.cppStartAge) + Math.abs(a.person.oas - base.person.oasStartAge);
    if (base.spouse && a.spouse) {
        d += Math.abs(a.spouse.cpp - base.spouse.cppStartAge) + Math.abs(a.spouse.oas - base.spouse.oasStartAge);
    }
    return d;
}

function householdMelt(a: Assignment): number {
    return a.person.melt + (a.spouse?.melt ?? 0);
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function abortError(): DOMException {
    return new DOMException('Meltdown optimization aborted', 'AbortError');
}

// --- Objective abstraction -----------------------------------------------
// An objective bundles: how to score a candidate (and at what run cost), how to
// compare two scored candidates, how dense the melt grid is, whether to refine,
// and which household withdrawal strategies to search. Every mode reuses the
// same coordinate-descent loop; only these knobs differ.

interface ScoreOutput {
    inputs: SimulationInputs;   // possibly spend-adjusted
    score: number;
    results: SimulationResult[];
    metrics: SummaryMetrics;
    feasible: boolean;
    runs: number;
}

interface Objective {
    mode: OptimizerObjective;
    meltSteps: number;
    refine: boolean;
    strategies: WithdrawalStrategy[];
    // When true, every scored candidate (feasible or not) may become the
    // incumbent, and `cmp` must rank feasible ahead of infeasible. The search is
    // then steered toward feasibility by the least-bad candidate instead of
    // holding its starting point until something happens to clear — which
    // matters when the question is "is ANY candidate feasible here".
    rankInfeasible?: boolean;
    score: (inputs: SimulationInputs) => ScoreOutput;
    cmp: (a: Evaluated, b: Evaluated) => number;
}

function estateObjective(): Objective {
    // Ranking: net estate desc, then closeness to current CPP/OAS, then smaller
    // melt, then prefer the plan's current withdrawal order — same shape as
    // max-spend's cmp. The last tie-break matters now that both orders are
    // searched: when the order makes no difference to the estate (common — it
    // only governs the residual deficit), a tie must not gratuitously flip a
    // setting the user chose.
    const cmp = (a: Evaluated, b: Evaluated): number => {
        const d = a.score - b.score;
        if (Math.abs(d) > TIE_EPS) return d > 0 ? -1 : 1;
        if (a.ageDist !== b.ageDist) return a.ageDist - b.ageDist;
        if (a.totalMelt !== b.totalMelt) return a.totalMelt - b.totalMelt;
        if (a.strategyMatchesCurrent !== b.strategyMatchesCurrent) return a.strategyMatchesCurrent ? -1 : 1;
        return 0;
    };
    return {
        mode: 'estate',
        meltSteps: COARSE_STEPS,
        refine: true,
        // Both orders are searched. Direction is plan-dependent: across 13 test
        // plans tax-efficient won 11, but an RRSP-growth-3% / non-reg-6% plan
        // flipped to rrsp-first by $85k of net estate.
        strategies: ['tax-efficient', 'rrsp-first'],
        score: (inputs) => {
            const results = runSimulation(inputs);
            const metrics = computeSummaryMetrics(results, inputs, false);
            return {
                inputs,
                score: metrics.netEstateValue,
                results,
                metrics,
                feasible: metrics.totalShortfall <= SHORTFALL_TOL,
                runs: 1,
            };
        },
        cmp,
    };
}

function maxSpendObjective(): Objective {
    // Ranking: sustainable spend desc, then closeness to current CPP/OAS, then
    // smaller melt, then prefer the plan's current withdrawal strategy.
    const cmp = (a: Evaluated, b: Evaluated): number => {
        const d = a.score - b.score;
        if (Math.abs(d) > SPEND_TIE_EPS) return d > 0 ? -1 : 1;
        if (a.ageDist !== b.ageDist) return a.ageDist - b.ageDist;
        if (a.totalMelt !== b.totalMelt) return a.totalMelt - b.totalMelt;
        if (a.strategyMatchesCurrent !== b.strategyMatchesCurrent) return a.strategyMatchesCurrent ? -1 : 1;
        return 0;
    };
    return {
        mode: 'max-spend',
        meltSteps: MAXSPEND_MELT_STEPS,
        refine: false, // the melt lever barely moves sustainable spend — skip refinement
        strategies: ['tax-efficient', 'rrsp-first'],
        score: (inputs) => {
            const { spend, runs } = maxSustainableSpend(inputs);
            const atSpend = withSpend(inputs, spend);
            const results = runSimulation(atSpend);
            const metrics = computeSummaryMetrics(results, atSpend, false);
            return {
                inputs: atSpend,
                score: spend,
                results,
                metrics,
                feasible: true, // spend was chosen to be feasible
                runs: runs + 1,
            };
        },
        cmp,
    };
}

// earliest-age inner check: "does ANY strategy keep the plan funded at this
// age", answered by the same descent. Scored like estate mode (net estate, so
// the age's recommended strategy is the best-estate one among those that work)
// on max-spend's cheap grid. rankInfeasible keeps the descent moving toward
// feasibility on an age where nothing clears yet: infeasible candidates rank by
// total shortfall, smallest first, and always behind every feasible one — so
// the winner is feasible exactly when some evaluated candidate is.
function earliestAgeObjective(): Objective {
    const cmp = (a: Evaluated, b: Evaluated): number => {
        if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
        const d = a.feasible
            ? b.score - a.score                                        // estate desc
            : a.metrics.totalShortfall - b.metrics.totalShortfall;     // shortfall asc
        if (Math.abs(d) > TIE_EPS) return d < 0 ? -1 : 1;
        if (a.ageDist !== b.ageDist) return a.ageDist - b.ageDist;
        if (a.totalMelt !== b.totalMelt) return a.totalMelt - b.totalMelt;
        if (a.strategyMatchesCurrent !== b.strategyMatchesCurrent) return a.strategyMatchesCurrent ? -1 : 1;
        return 0;
    };
    return {
        mode: 'earliest-age',
        meltSteps: EARLIEST_AGE_MELT_STEPS,
        refine: false,
        strategies: ['tax-efficient', 'rrsp-first'],
        rankInfeasible: true,
        score: (inputs) => {
            const results = runSimulation(inputs);
            const metrics = computeSummaryMetrics(results, inputs, false);
            return {
                inputs,
                score: metrics.netEstateValue,
                results,
                metrics,
                feasible: metrics.totalShortfall <= SHORTFALL_TOL,
                runs: 1,
            };
        },
        cmp,
    };
}

function objectiveFor(mode: OptimizerObjective): Objective {
    if (mode === 'max-spend') return maxSpendObjective();
    if (mode === 'earliest-age') return earliestAgeObjective();
    return estateObjective();
}

// --- Shared strategy search ----------------------------------------------
//
// One coordinate-descent search over melt × CPP × OAS per person, once per
// withdrawal strategy, scored by `objective`. Every mode runs this: estate and
// max-spend once on the plan, earliest-age once per probed retirement age.

interface SearchGrids {
    p1Melt: number[]; p1Cpp: number[]; p1Oas: number[];
    p2Melt: number[]; p2Cpp: number[]; p2Oas: number[];
}

function buildSearchGrids(base: SimulationInputs, objective: Objective, considerCppOas: boolean): SearchGrids {
    const hasSpouse = !!base.spouse;
    return {
        p1Melt: buildMeltGrid(base.person, objective.meltSteps),
        p1Cpp: buildCppCandidates(base.person, considerCppOas),
        p1Oas: buildOasCandidates(base.person, considerCppOas),
        p2Melt: hasSpouse ? buildMeltGrid(base.spouse!, objective.meltSteps) : [],
        p2Cpp: hasSpouse ? buildCppCandidates(base.spouse!, considerCppOas) : [],
        p2Oas: hasSpouse ? buildOasCandidates(base.spouse!, considerCppOas) : [],
    };
}

// Engine runs a search is expected to take (progress estimate only).
function estimateSearchRuns(base: SimulationInputs, objective: Objective, grids: SearchGrids): number {
    const hasSpouse = !!base.spouse;
    const s1 = grids.p1Melt.length * grids.p1Cpp.length * grids.p1Oas.length;
    const s2 = hasSpouse ? grids.p2Melt.length * grids.p2Cpp.length * grids.p2Oas.length : 0;
    const REFINE_EST = objective.refine ? 3 : 0;
    const detPerStrategy = hasSpouse
        ? MAX_SWEEPS * (s1 + s2 + PATTERN_EST) + 2 * REFINE_EST
        : s1 + REFINE_EST;
    const runsPerCandidate = objective.mode === 'max-spend' ? AVG_BISECTION_RUNS : 1;
    return detPerStrategy * objective.strategies.length * runsPerCandidate;
}

interface StrategySearchArgs {
    base: SimulationInputs;
    objective: Objective;
    grids: SearchGrids;
    signal?: AbortSignal;
    // Called after each scored candidate with the engine runs it cost.
    onRuns: (runs: number) => void;
}

interface StrategySearchOutcome {
    // Best candidate by objective.cmp. Only feasible candidates qualify unless
    // the objective sets rankInfeasible. Null when nothing qualified.
    winner: Evaluated | null;
    allEvals: Evaluated[];
}

async function runStrategySearch(args: StrategySearchArgs): Promise<StrategySearchOutcome> {
    const { base, objective, grids, signal, onRuns } = args;
    const { p1Melt, p1Cpp, p1Oas, p2Melt, p2Cpp, p2Oas } = grids;
    const hasSpouse = !!base.spouse;
    const currentStrategy: WithdrawalStrategy = base.withdrawalStrategy ?? 'tax-efficient';

    let sinceYield = 0;
    // Held in a ref so the closure below can update it without TS narrowing the
    // outer reads to `null` (control-flow analysis ignores closure writes).
    const bestRef: { current: Evaluated | null } = { current: null };
    const cache = new Map<string, Evaluated>();
    const allEvals: Evaluated[] = [];

    const evaluate = async (a: Assignment): Promise<Evaluated> => {
        const sig = signatureOf(a);
        const cached = cache.get(sig);
        if (cached) return cached;
        if (signal?.aborted) throw abortError();

        const applied = applyAssignment(base, a);
        const sc = objective.score(applied);
        const ev: Evaluated = {
            a, sig,
            inputs: sc.inputs,
            results: sc.results,
            metrics: sc.metrics,
            feasible: sc.feasible,
            score: sc.score,
            ageDist: ageDistance(base, a),
            totalMelt: householdMelt(a),
            strategyMatchesCurrent: a.strategy === currentStrategy,
        };
        cache.set(sig, ev);
        allEvals.push(ev);
        const eligible = ev.feasible || objective.rankInfeasible === true;
        if (eligible && (bestRef.current === null || objective.cmp(ev, bestRef.current) < 0)) bestRef.current = ev;

        onRuns(sc.runs);
        sinceYield += sc.runs;
        if (sinceYield >= BATCH) {
            sinceYield = 0;
            await yieldToEventLoop();
            if (signal?.aborted) throw abortError();
        }
        return ev;
    };

    const evalList = async (assignments: Assignment[]): Promise<void> => {
        for (const a of assignments) await evaluate(a);
    };

    // --- Deterministic search (one descent per searched strategy) ---
    // The loop SHAPE is identical across modes; each mode runs it once per
    // withdrawal strategy, accumulating into the shared best/cache/allEvals.
    // Signatures carry the strategy, so the arms never share cache entries — but
    // they DO share the incumbent, which warm-starts the second arm from the
    // first arm's coordinates and lets it stop early when it can't beat them.
    const runDescent = async (strategy: WithdrawalStrategy): Promise<void> => {
        const tag = (a: UntaggedAssignment): Assignment => ({ ...a, strategy });

        if (!hasSpouse) {
            await evalList(personChoices(p1Melt, p1Cpp, p1Oas).map(pc => tag({ person: pc })));
            const winnerSoFar = bestRef.current;
            if (objective.refine && winnerSoFar) {
                const refined = refineMeltGrid(winnerSoFar.a.person.melt, p1Melt);
                await evalList(refined.map(m => tag({ person: { ...winnerSoFar.a.person, melt: m } })));
            }
        } else {
            const init: Assignment = tag({
                person: initialChoice(base.person, p1Melt, p1Cpp, p1Oas),
                spouse: initialChoice(base.spouse!, p2Melt, p2Cpp, p2Oas),
            });
            await evaluate(init);

            // --- Pattern (diagonal) step -------------------------------------
            // Coordinate descent moves one person at a time, so it halts at any
            // point that is the best in its own row AND its own column. On a
            // DIAGONAL ridge such a point is not the optimum, and no number of
            // further sweeps escapes it — every single-person move is a no-op by
            // construction. Pension income splitting is what creates that ridge:
            // it couples the two melt amounts through household tax, tilting the
            // surface off the coordinate axes. Measured case: descent settled
            // $3,499 of net estate below the true grid optimum for a splitting
            // couple, at a point that was simultaneously its row and column max.
            //
            // So after each sweep, try moving BOTH melts one grid step together
            // (the four diagonal neighbours) and keep walking while that helps.
            // Evaluations are memoised by signature, so revisits are free.
            const patternStep = async (): Promise<void> => {
                for (let step = 0; step < MAX_PATTERN_STEPS; step++) {
                    const cur = bestRef.current;
                    if (!cur?.a.spouse) return;
                    const i = p1Melt.indexOf(cur.a.person.melt);
                    const j = p2Melt.indexOf(cur.a.spouse.melt);
                    if (i < 0 || j < 0) return; // off-grid: nothing to step from

                    const beforeSig = cur.sig;
                    const moves: Assignment[] = [];
                    for (const di of [-1, 1]) {
                        for (const dj of [-1, 1]) {
                            const ni = i + di;
                            const nj = j + dj;
                            if (ni < 0 || ni >= p1Melt.length) continue;
                            if (nj < 0 || nj >= p2Melt.length) continue;
                            moves.push(tag({
                                person: { ...cur.a.person, melt: p1Melt[ni] },
                                spouse: { ...cur.a.spouse!, melt: p2Melt[nj] },
                            }));
                        }
                    }
                    await evalList(moves);
                    // No diagonal neighbour beat the incumbent — the ridge (if any)
                    // has been climbed as far as it goes.
                    if ((bestRef.current?.sig ?? null) === beforeSig) return;
                }
            };

            let sweeps = 0;
            let improvedSweep = true;
            while (improvedSweep && sweeps < MAX_SWEEPS) {
                const beforeSig = bestRef.current?.sig ?? null;

                const heldSpouse = bestRef.current?.a.spouse ?? init.spouse!;
                await evalList(personChoices(p1Melt, p1Cpp, p1Oas).map(pc => tag({ person: pc, spouse: heldSpouse })));

                const heldPerson = bestRef.current?.a.person ?? init.person;
                await evalList(personChoices(p2Melt, p2Cpp, p2Oas).map(pc => tag({ person: heldPerson, spouse: pc })));

                // Climb any diagonal ridge before concluding we have converged, so
                // the next sweep re-optimises each coordinate from the better point.
                await patternStep();

                improvedSweep = (bestRef.current?.sig ?? null) !== beforeSig;
                sweeps++;
            }

            if (objective.refine) {
                const bp = bestRef.current;
                if (bp) {
                    const refP = refineMeltGrid(bp.a.person.melt, p1Melt);
                    await evalList(refP.map(m => tag({ person: { ...bp.a.person, melt: m }, spouse: bp.a.spouse })));

                    const bs = bestRef.current!;
                    const refS = refineMeltGrid(bs.a.spouse!.melt, p2Melt);
                    await evalList(refS.map(m => tag({ person: bs.a.person, spouse: { ...bs.a.spouse!, melt: m } })));
                }
            }
        }
    };

    // The plan's CURRENT withdrawal order goes first. Ties keep the incumbent, so
    // arm order decides them — and the cmp tie-break alone isn't enough, because
    // the refinement phase lands the first arm on melt values that are off the
    // coarse grid and therefore have no twin in the second arm to tie against.
    // Searching the user's order first means an order-indifferent plan (the melt
    // and RRIF minimums cover the spending, so the order is never consulted)
    // keeps the setting they chose instead of flipping to whichever arm ran first.
    const strategyOrder = [...objective.strategies].sort(
        (a, b) => Number(b === currentStrategy) - Number(a === currentStrategy),
    );
    for (const strategy of strategyOrder) {
        await runDescent(strategy);
    }

    return { winner: bestRef.current, allEvals };
}

// --- Main entry point ----------------------------------------------------

export async function optimizeMeltdown(
    baseInputs: SimulationInputs,
    options: OptimizeMeltdownOptions = {},
): Promise<MeltdownResult> {
    const mode = options.objective ?? 'estate';
    if (mode === 'earliest-age') return solveEarliestAge(baseInputs, options);
    if (mode === 'savings-needed') return solveSavingsNeeded(baseInputs, options);

    const considerCppOas = options.considerCppOas ?? true;
    const mcIterations = options.mcIterations ?? 200;
    const mcSuccessTarget = options.mcSuccessTarget ?? DEFAULT_MC_TARGET;
    const { onProgress, signal } = options;
    const objective = objectiveFor(mode);

    if (signal?.aborted) throw abortError();

    const base = structuredClone(baseInputs);
    const currentStrategy: WithdrawalStrategy = base.withdrawalStrategy ?? 'tax-efficient';

    // Baseline: the user's plan exactly as entered (its own rrspMeltStartAge and
    // amount), scored nominally for an apples-to-apples comparison.
    const baselineResults = runSimulation(base);
    const baselineMetrics = computeSummaryMetrics(baselineResults, base, false);

    // Per-person sub-grids (melt density comes from the objective).
    const grids = buildSearchGrids(base, objective, considerCppOas);

    // Progress total estimate (deterministic sweeps × runs-per-candidate ×
    // strategies + a Monte Carlo buffer). Snaps to `total` on finish.
    const detEstimate = estimateSearchRuns(base, objective, grids);
    // Baseline MC (1) + up to MAX_STEPDOWN_PROBES step-down probes.
    const mcBuffer = objective.mode === 'max-spend' ? 1 + MAX_STEPDOWN_PROBES : 4;
    const total = detEstimate + mcBuffer;

    let done = 0;
    const report = () => onProgress?.(Math.min(done, total), total);

    const { winner, allEvals } = await runStrategySearch({
        base, objective, grids, signal,
        onRuns: (runs) => { done += runs; report(); },
    });

    if (objective.mode === 'max-spend') {
        return finishMaxSpend({
            base, winner, baselineResults, baselineMetrics,
            mcIterations, mcSuccessTarget, currentStrategy, signal,
            setDoneTotal: () => { done = total; report(); },
            reportProbe: () => { done += 1; report(); },
        });
    }

    // ===================== estate objective (unchanged) =====================
    const improved = winner !== null && winner.metrics.netEstateValue > baselineMetrics.netEstateValue + IMPROVE_EPS;

    // --- Nothing feasible beats the baseline ---
    if (!improved || winner === null) {
        if (signal?.aborted) throw abortError();
        const baselineMonteCarlo = runMonteCarlo(base, mcIterations);
        done = total;
        report();
        return {
            objective: 'estate',
            improved: false,
            baselineInputs: base,
            recommendedInputs: structuredClone(base),
            baselineResults,
            recommendedResults: baselineResults,
            baselineMetrics,
            recommendedMetrics: baselineMetrics,
            baselineMonteCarlo,
            recommendedMonteCarlo: baselineMonteCarlo,
            decisions: [],
            netEstateDelta: 0,
            lifetimeTaxDelta: 0,
            baselineSuccessRate: baselineMonteCarlo.successRate,
            recommendedSuccessRate: baselineMonteCarlo.successRate,
            mcWarning: false,
        };
    }

    // --- Monte Carlo validation ---
    // Rank feasible candidates; the winner plus up to 2 distinct runners-up that
    // also beat the baseline net estate get a Monte Carlo run.
    const ranked = allEvals.filter(e => e.feasible).sort(objective.cmp);
    const runnersUp: Evaluated[] = [];
    for (const e of ranked) {
        if (e.sig === winner.sig) continue;
        if (e.metrics.netEstateValue <= baselineMetrics.netEstateValue + IMPROVE_EPS) continue;
        runnersUp.push(e);
        if (runnersUp.length >= 2) break;
    }

    const runMc = async (inputs: SimulationInputs): Promise<MonteCarloResult> => {
        if (signal?.aborted) throw abortError();
        const mc = runMonteCarlo(inputs, mcIterations);
        await yieldToEventLoop();
        return mc;
    };

    const baselineMonteCarlo = await runMc(base);
    const winnerMc = await runMc(winner.inputs);
    const runnerMcs: MonteCarloResult[] = [];
    for (const r of runnersUp) runnerMcs.push(await runMc(r.inputs));

    // Prefer a runner-up when the winner's success rate is materially below
    // baseline; otherwise keep the winner (flagging the risk).
    let recommended: Evaluated = winner;
    let recommendedMc: MonteCarloResult = winnerMc;
    let mcWarning = false;
    if (winnerMc.successRate < baselineMonteCarlo.successRate - MC_WARN_MARGIN) {
        const altIdx = runnersUp.findIndex(
            (_, i) => runnerMcs[i].successRate >= baselineMonteCarlo.successRate - MC_WARN_MARGIN,
        );
        if (altIdx >= 0) {
            recommended = runnersUp[altIdx];
            recommendedMc = runnerMcs[altIdx];
        } else {
            mcWarning = true;
        }
    }

    const recommendedResults = recommended.results;
    const recommendedMetrics = recommended.metrics;

    const decisions: PersonMeltdownDecision[] = [
        buildDecision('person', 'You', base.person, recommended.a.person),
    ];
    if (base.spouse && recommended.a.spouse) {
        decisions.push(buildDecision('spouse', 'Spouse', base.spouse, recommended.a.spouse));
    }

    done = total;
    report();

    return {
        objective: 'estate',
        improved: true,
        baselineInputs: base,
        recommendedInputs: recommended.inputs,
        baselineResults,
        recommendedResults,
        baselineMetrics,
        recommendedMetrics,
        baselineMonteCarlo,
        recommendedMonteCarlo: recommendedMc,
        decisions,
        netEstateDelta: recommendedMetrics.netEstateValue - baselineMetrics.netEstateValue,
        lifetimeTaxDelta: recommendedMetrics.lifetimeTaxPaid - baselineMetrics.lifetimeTaxPaid,
        baselineSuccessRate: baselineMonteCarlo.successRate,
        recommendedSuccessRate: recommendedMc.successRate,
        mcWarning,
    };
}

// --- Shared MC step-down driver --------------------------------------------
//
// Adaptive MC step-down. We do NOT bisect on the raw MC rate — it wobbles a few
// points at these iteration counts. Instead we probe spends, bracket the target
// between a "clears" and a "misses" probe, and refine to precision. The
// per-probe decision lives in planStepDownProbe; here we just run the MC and
// feed it back. Warm-started from a baseline at `currentSpend` so a
// far-below-max answer doesn't cost a long descent. Used by max-spend mode (on
// the searched winner) and by earliest-age's could-spend column (on each row's
// winner).

interface SpendStepDownArgs {
    ceilingInputs: SimulationInputs; // the plan at the deterministic max (spend = ceiling)
    ceiling: number;                 // deterministic max
    currentSpend: number;            // the spend `baselineRate` was measured at
    baselineRate: number;            // MC success rate at currentSpend (warm start)
    // Optional: the MC run behind baselineRate, when it was run on these same
    // inputs at currentSpend — then it is the first probe. Max-spend mode omits
    // it (its baseline is the plan as entered, a different strategy).
    baselineMc?: MonteCarloResult;
    target: number;
    mcIterations: number;
    signal?: AbortSignal;
    onProbe?: () => void;
}

interface SpendStepDownOutcome {
    spend: number;          // final sustainable spend (a probed spend)
    mc: MonteCarloResult;   // the MC run at that spend
    capHit: boolean;        // no probed spend cleared the target
}

function runSpendStepDown(args: SpendStepDownArgs): SpendStepDownOutcome {
    const { ceilingInputs, ceiling, currentSpend, baselineRate, target, mcIterations, signal, onProbe } = args;
    const stepPlan: StepDownPlan = { target, ceiling, floor: 0 };
    const probeAt = (spendValue: number): { spend: number; mc: MonteCarloResult } => {
        const atSpend = spendValue === ceiling ? ceilingInputs : withSpend(ceilingInputs, spendValue);
        const runMc = runMonteCarlo(atSpend, mcIterations);
        onProbe?.();
        return { spend: spendValue, mc: runMc };
    };

    const probes: { spend: number; mc: MonteCarloResult }[] = [];
    let runs = 0;
    if (args.baselineMc && currentSpend <= ceiling) {
        // A baseline MC run on these same inputs is a real probe, already paid
        // for, so planStepDownProbe takes the first step from it: up toward the
        // ceiling if it clears, down if it misses. (Only within the ceiling, so
        // no bracket can send a probe above the deterministic max.)
        probes.push({ spend: currentSpend, mc: args.baselineMc });
    } else {
        // Otherwise anchor the first probe heuristically from the baseline rate.
        probes.push(probeAt(initialStepDownSpend({ ceiling, floor: 0, currentSpend, baselineRate, target })));
        runs++;
    }

    const asResults = () => probes.map(p => ({ spend: p.spend, successRate: p.mc.successRate }));
    let action = planStepDownProbe(stepPlan, asResults());
    while (action.kind === 'probe' && runs < MAX_STEPDOWN_PROBES) {
        if (signal?.aborted) throw abortError();
        probes.push(probeAt(action.spend));
        runs++;
        action = planStepDownProbe(stepPlan, asResults());
    }

    // Resolve the final spend. A 'done'/'capHit' action names a probed spend; if
    // we merely ran out of probe budget, fall back to the best clearing probe (or
    // the highest-success probe, flagged as a cap hit).
    let spend: number;
    let capHit: boolean;
    if (action.kind === 'done') {
        spend = action.spend;
        capHit = false;
    } else if (action.kind === 'capHit') {
        spend = action.spend;
        capHit = true;
    } else {
        const clearing = probes.filter(p => p.mc.successRate >= target);
        if (clearing.length) {
            spend = clearing.reduce((b, p) => (p.spend > b.spend ? p : b)).spend;
            capHit = false;
        } else {
            spend = probes.reduce((b, p) => (p.mc.successRate > b.mc.successRate ? p : b)).spend;
            capHit = true;
        }
    }

    // The MC result at the reported spend (it was probed).
    const finalProbe = probes.find(p => p.spend === spend)
        ?? probes.reduce((b, p) => (Math.abs(p.spend - spend) < Math.abs(b.spend - spend) ? p : b));
    return { spend, mc: finalProbe.mc, capHit };
}

export interface SustainableSpendEstimate {
    deterministicMax: number; // bisected max on average returns
    spend: number;            // after the MC step-down
    successRate: number;      // MC success rate at `spend`
    capHit: boolean;          // no probed spend cleared the target
}

// Max-spend's spending machinery (Phase 2) on FIXED inputs: no strategy
// search, just the deterministic bisection and the MC step-down held to
// `mcSuccessTarget`. `baselineMc` is an MC run already made on these inputs at
// their own postRetirementSpend: it serves as the step-down's first probe (or,
// above the deterministic max, its rate as the warm start). Used for the
// earliest-age "could spend"
// column, on each row's winning strategy.
export function estimateSustainableSpend(
    inputs: SimulationInputs,
    opts: {
        baselineMc: MonteCarloResult;
        mcIterations: number;
        mcSuccessTarget: number;
        signal?: AbortSignal;
        onProbe?: () => void;
    },
): SustainableSpendEstimate {
    const { spend: deterministicMax } = maxSustainableSpend(inputs);
    const out = runSpendStepDown({
        ceilingInputs: withSpend(inputs, deterministicMax),
        ceiling: deterministicMax,
        currentSpend: inputs.postRetirementSpend,
        baselineRate: opts.baselineMc.successRate,
        baselineMc: opts.baselineMc,
        target: opts.mcSuccessTarget,
        mcIterations: opts.mcIterations,
        signal: opts.signal,
        onProbe: opts.onProbe,
    });
    return { deterministicMax, spend: out.spend, successRate: out.mc.successRate, capHit: out.capHit };
}

// --- Max-spend finish: MC step-down + result assembly --------------------

interface FinishMaxSpendArgs {
    base: SimulationInputs;
    winner: Evaluated | null;
    baselineResults: SimulationResult[];
    baselineMetrics: SummaryMetrics;
    mcIterations: number;
    mcSuccessTarget: number;
    currentStrategy: WithdrawalStrategy;
    signal?: AbortSignal;
    setDoneTotal: () => void;
    reportProbe: () => void;
}

function finishMaxSpend(args: FinishMaxSpendArgs): MeltdownResult {
    const {
        base, winner, baselineResults, baselineMetrics,
        mcIterations, mcSuccessTarget, currentStrategy, signal,
        setDoneTotal, reportProbe,
    } = args;

    if (signal?.aborted) throw abortError();

    const currentSpend = base.postRetirementSpend;
    // Baseline MC at the current plan and current spend, for the comparison view.
    const baselineMonteCarlo = runMonteCarlo(base, mcIterations);
    reportProbe();

    // Degenerate: no feasible candidate (shouldn't happen — spend 0 is always
    // feasible). Fall back to a not-improved, current-plan result.
    if (winner === null) {
        setDoneTotal();
        return {
            objective: 'max-spend',
            improved: false,
            baselineInputs: base,
            recommendedInputs: structuredClone(base),
            baselineResults,
            recommendedResults: baselineResults,
            baselineMetrics,
            recommendedMetrics: baselineMetrics,
            baselineMonteCarlo,
            recommendedMonteCarlo: baselineMonteCarlo,
            decisions: [],
            netEstateDelta: 0,
            lifetimeTaxDelta: 0,
            baselineSuccessRate: baselineMonteCarlo.successRate,
            recommendedSuccessRate: baselineMonteCarlo.successRate,
            mcWarning: false,
            maxSpend: {
                sustainableSpend: currentSpend,
                currentSpend,
                spendDelta: 0,
                deterministicMax: currentSpend,
                mcSuccessTarget,
                achievedSuccessRate: baselineMonteCarlo.successRate,
                stepDownCapHit: false,
                withdrawalStrategy: currentStrategy,
                strategyChanged: false,
                onTrack: true,
            },
        };
    }

    const deterministicMax = winner.score;

    // Adaptive MC step-down from the winner's deterministic max, warm-started
    // from the baseline signal (see runSpendStepDown).
    const { spend: sustainableSpend, mc, capHit: stepDownCapHit } = runSpendStepDown({
        ceilingInputs: winner.inputs, ceiling: deterministicMax, currentSpend,
        baselineRate: baselineMonteCarlo.successRate, target: mcSuccessTarget,
        mcIterations, signal, onProbe: reportProbe,
    });

    // Recompute the nominal projection/metrics at the final spend, reusing the
    // winner's at the deterministic max.
    const recommendedInputs = withSpend(winner.inputs, sustainableSpend);
    const recResults = sustainableSpend === deterministicMax ? winner.results : runSimulation(recommendedInputs);
    const recMetrics = sustainableSpend === deterministicMax
        ? winner.metrics
        : computeSummaryMetrics(recResults, recommendedInputs, false);

    const winningStrategy: WithdrawalStrategy = winner.a.strategy;
    const spendDelta = sustainableSpend - currentSpend;
    // "About right": within one precision step of the current planned spend.
    const onTrack = Math.abs(spendDelta) <= SPEND_PRECISION;

    const decisions: PersonMeltdownDecision[] = [
        buildDecision('person', 'You', base.person, winner.a.person),
    ];
    if (base.spouse && winner.a.spouse) {
        decisions.push(buildDecision('spouse', 'Spouse', base.spouse, winner.a.spouse));
    }

    setDoneTotal();

    return {
        objective: 'max-spend',
        improved: !onTrack,
        baselineInputs: base,
        recommendedInputs,
        baselineResults,
        recommendedResults: recResults,
        baselineMetrics,
        recommendedMetrics: recMetrics,
        baselineMonteCarlo,
        recommendedMonteCarlo: mc,
        decisions,
        netEstateDelta: recMetrics.netEstateValue - baselineMetrics.netEstateValue,
        lifetimeTaxDelta: recMetrics.lifetimeTaxPaid - baselineMetrics.lifetimeTaxPaid,
        baselineSuccessRate: baselineMonteCarlo.successRate,
        recommendedSuccessRate: mc.successRate,
        mcWarning: false, // the step-down is the guard in max-spend mode
        maxSpend: {
            sustainableSpend,
            currentSpend,
            spendDelta,
            deterministicMax,
            mcSuccessTarget,
            achievedSuccessRate: mc.successRate,
            stepDownCapHit,
            withdrawalStrategy: winningStrategy,
            strategyChanged: winningStrategy !== currentStrategy,
            onTrack,
        },
    };
}

// --- Earliest-age solve ----------------------------------------------------
//
// Outer loop over a shared retirement-age shift Δ (see retirementAgeSearch.ts
// for the pure planners it drives):
//   1. Deterministic bisection: the earliest Δ at which ANY strategy funds the
//      plan on average returns (inner check = runStrategySearch with
//      earliestAgeObjective, cached per Δ).
//   2. Monte Carlo step-up from there until the success bar clears.
//   3. Trade-off rows around the answer, reusing the cached checks and MCs. The
//      "could spend" column is an estimate on each row's winning strategy:
//      max-spend's bisection + MC step-down, without a fresh strategy search.

// Progress for a run made of phases whose costs are only roughly known: each
// phase owns a slice of a fixed 0-1000 scale and reports a fraction of that
// slice, so the bar never moves backwards and never sits at 100% early.
function phasedProgress(onProgress?: (done: number, total: number) => void) {
    const TOTAL = 1000;
    let last = 0;
    return {
        at(from: number, to: number, fraction: number): void {
            const f = Math.max(0, Math.min(1, fraction));
            const v = Math.min(TOTAL - 1, Math.floor((from + (to - from) * f) * TOTAL));
            if (v > last) {
                last = v;
                onProgress?.(v, TOTAL);
            }
        },
        finish(): void {
            onProgress?.(TOTAL, TOTAL);
        },
    };
}

const PROGRESS_DET_END = 0.2;   // deterministic bisection
const PROGRESS_MC_END = 0.3;    // MC step-up; the trade-off rows take the rest
// A row's could-spend estimate (bisection + a few MC probes) vs that row's
// check + MC, in progress units. Progress only.
const COULD_SPEND_WEIGHT = 2;
const EXPECTED_COULD_SPEND_PROBES = 3;
const EXPECTED_STEPUP_PROBES = 3;

// --- Shared outer-loop plumbing (earliest-age and savings-needed) ---------
//
// Both outer searches move one plan input — the retirement-age shift Δ, or the
// household savings total D — and ask the same two questions at each value:
//   1. the inner check: does ANY strategy fund the plan on average returns?
//      runStrategySearch with earliestAgeObjective (best estate among feasible
//      candidates, least shortfall when none is), and
//   2. on demand, the Monte Carlo success rate of that value's winning strategy.
// Both are cached per value, so a value the deterministic phase checked costs
// nothing when the MC phase or the result assembly revisits it.

interface OuterCheck {
    key: number; // the outer value (Δ or D)
    // Best strategy at this value: the largest net estate among feasible
    // candidates, or — when none is feasible — the smallest shortfall.
    winner: Evaluated;
    feasible: boolean;
}

// runMonteCarlo with an abort check either side and an event-loop yield after
// it (one MC run is long enough to starve the UI otherwise).
function abortableMcRunner(mcIterations: number, signal?: AbortSignal) {
    return async (inputs: SimulationInputs): Promise<MonteCarloResult> => {
        if (signal?.aborted) throw abortError();
        const mc = runMonteCarlo(inputs, mcIterations);
        await yieldToEventLoop();
        if (signal?.aborted) throw abortError();
        return mc;
    };
}

interface OuterProbe {
    // The inner check at `key`. `onFraction` reports the search's progress
    // (0-1) when it actually runs; a cached check reports nothing.
    checkAt(key: number, onFraction?: (f: number) => void): Promise<OuterCheck>;
    // MC on checkAt(key)'s winner. `onFraction` is passed to the check.
    mcAt(key: number, onFraction?: (f: number) => void): Promise<MonteCarloResult>;
    // Uncached MC on arbitrary inputs (the baseline), same abort handling.
    runMc(inputs: SimulationInputs): Promise<MonteCarloResult>;
}

function createOuterProbe(args: {
    inputsAt: (key: number) => SimulationInputs; // the plan with the outer input set to `key`
    considerCppOas: boolean;
    mcIterations: number;
    signal?: AbortSignal;
}): OuterProbe {
    const { inputsAt, considerCppOas, mcIterations, signal } = args;
    const objective = earliestAgeObjective();
    const runMc = abortableMcRunner(mcIterations, signal);
    const checks = new Map<number, OuterCheck>();
    const mcs = new Map<number, MonteCarloResult>();

    const checkAt = async (key: number, onFraction?: (f: number) => void): Promise<OuterCheck> => {
        const hit = checks.get(key);
        if (hit) return hit;
        const at = inputsAt(key);
        const grids = buildSearchGrids(at, objective, considerCppOas);
        const est = Math.max(1, estimateSearchRuns(at, objective, grids));
        let runs = 0;
        const { winner } = await runStrategySearch({
            base: at, objective, grids, signal,
            onRuns: (n) => { runs += n; onFraction?.(Math.min(1, runs / est)); },
        });
        // rankInfeasible makes every scored candidate eligible, and the grids are
        // never empty, so a winner always exists.
        if (!winner) throw new Error('outer-loop inner check scored no candidates');
        const check: OuterCheck = { key, winner, feasible: winner.feasible };
        checks.set(key, check);
        return check;
    };

    const mcAt = async (key: number, onFraction?: (f: number) => void): Promise<MonteCarloResult> => {
        const hit = mcs.get(key);
        if (hit) return hit;
        const c = await checkAt(key, onFraction);
        const mc = await runMc(c.winner.inputs);
        mcs.set(key, mc);
        return mc;
    };

    return { checkAt, mcAt, runMc };
}

// Bad-markets line: the first age the 5th-percentile balance hits ~0 once the
// reported person has retired. The percentile rows run on the primary person's
// clock (age = primary age today + years elapsed), so search from
// `yearsToRetirement` years out on that clock, then report on the reported
// person's own clock. null when money lasts the plan even in those markets.
function badMarketsAgeAfter(
    mc: MonteCarloResult,
    base: SimulationInputs,
    reported: Person,
    yearsToRetirement: number,
): number | null {
    const depletionPrimaryAge = firstDepletionAge(
        mc.percentiles, base.person.age + yearsToRetirement, DEPLETION_THRESHOLD,
    );
    return depletionPrimaryAge === null
        ? null
        : depletionPrimaryAge - base.person.age + reported.age;
}

function hasPension(p: Person): boolean {
    return !!p.pension && (p.pension.annualAmount > 0 || (p.pension.bridgeAmount ?? 0) > 0);
}

async function solveEarliestAge(
    baseInputs: SimulationInputs,
    options: OptimizeMeltdownOptions,
): Promise<MeltdownResult> {
    const considerCppOas = options.considerCppOas ?? true;
    const mcIterations = options.mcIterations ?? 200;
    const mcSuccessTarget = options.mcSuccessTarget ?? DEFAULT_MC_TARGET;
    const couldSpendScope = options.couldSpendRows ?? 'all';
    const { signal } = options;
    const progress = phasedProgress(options.onProgress);

    if (signal?.aborted) throw abortError();

    const base = structuredClone(baseInputs);
    const currentStrategy: WithdrawalStrategy = base.withdrawalStrategy ?? 'tax-efficient';
    const baselineResults = runSimulation(base);
    const baselineMetrics = computeSummaryMetrics(baselineResults, base, false);

    const shift = planAgeShift(base);
    // Inner check and MC, cached per Δ.
    const probe = createOuterProbe({
        inputsAt: (delta) => applyRetirementShift(base, shift, delta).inputs,
        considerCppOas, mcIterations, signal,
    });
    const { checkAt, mcAt, runMc } = probe;
    const reported = personOf(base, shift.reportedWho);
    const pensionHeld = shift.shifted.some(w => hasPension(personOf(base, w)));
    const cppOverrideHeld = shift.shifted.some(w => personOf(base, w).cppAnnualOverride != null);

    const personSummary = (who: Who, answerInputs: SimulationInputs | null): EarliestAgePerson => {
        const p = personOf(base, who);
        const a = answerInputs ? personOf(answerInputs, who) : null;
        return {
            who,
            label: who === 'spouse' ? 'Spouse' : 'You',
            currentAge: p.age,
            planRetirementAge: p.retirementAge,
            answerRetirementAge: a ? a.retirementAge : null,
            planCppYears: p.cppContributedYears,
            answerCppYears: a ? a.cppContributedYears : null,
        };
    };

    // No answer to give: nothing to move, or no age up to the cap is fundable.
    // Returns the plan unchanged (improved: false hides Apply/Save).
    const noAnswer = async (status: 'unreachable' | 'unavailable'): Promise<MeltdownResult> => {
        const baselineMonteCarlo = await runMc(base);
        progress.finish();
        return {
            objective: 'earliest-age',
            improved: false,
            baselineInputs: base,
            recommendedInputs: structuredClone(base),
            baselineResults,
            recommendedResults: baselineResults,
            baselineMetrics,
            recommendedMetrics: baselineMetrics,
            baselineMonteCarlo,
            recommendedMonteCarlo: baselineMonteCarlo,
            decisions: [],
            netEstateDelta: 0,
            lifetimeTaxDelta: 0,
            baselineSuccessRate: baselineMonteCarlo.successRate,
            recommendedSuccessRate: baselineMonteCarlo.successRate,
            mcWarning: false,
            earliestAge: {
                status,
                unavailableReason: shift.unavailableReason,
                reportedWho: shift.reportedWho,
                people: shift.shifted.map(w => personSummary(w, null)),
                currentAge: reported.age,
                planAge: reported.retirementAge,
                answerAge: null,
                deltaYears: null,
                deterministicAge: null,
                minAge: reported.retirementAge + shift.minDelta,
                maxAge: reported.retirementAge + shift.maxDelta,
                retiresNow: false,
                atLowerBound: false,
                mcSuccessTarget,
                achievedSuccessRate: null,
                stepUpCapHit: false,
                boundHit: false,
                onTrack: false,
                strategyChangeNeeded: false,
                postRetirementSpend: base.postRetirementSpend,
                cppOverrideHeld,
                pensionHeld,
                withdrawalStrategy: currentStrategy,
                strategyChanged: false,
                rows: [],
                badMarketsAge: null,
            },
        };
    };

    if (!shift.available) return noAnswer('unavailable');

    // --- 1. Deterministic bisection over Δ ---
    const rangeSize = shift.maxDelta - shift.minDelta + 1;
    const estDetChecks = Math.ceil(Math.log2(rangeSize + 1)) + 1;
    const bisectPlan = { minDelta: shift.minDelta, maxDelta: shift.maxDelta, start: 0 };
    const detProbes: AgeFeasibilityProbe[] = [];
    let bisect = planAgeBisection(bisectPlan, detProbes);
    while (bisect.kind === 'probe') {
        const n = detProbes.length;
        const c = await checkAt(bisect.delta, f => progress.at(0, PROGRESS_DET_END, (n + f) / estDetChecks));
        detProbes.push({ delta: bisect.delta, feasible: c.feasible });
        bisect = planAgeBisection(bisectPlan, detProbes);
    }
    if (bisect.kind === 'unreachable') return noAnswer('unreachable');
    const detDelta = bisect.delta;
    progress.at(0, PROGRESS_DET_END, 1);

    // --- 2. Monte Carlo step-up from the deterministic answer ---
    const stepPlan = { target: mcSuccessTarget, start: detDelta, max: shift.maxDelta, maxProbes: MAX_AGE_STEPUP_PROBES };
    const mcProbes: AgeProbeResult[] = [];
    let step: AgeStepUpAction = planAgeStepUp(stepPlan, mcProbes);
    while (step.kind === 'probe') {
        const mc = await mcAt(step.age);
        mcProbes.push({ age: step.age, successRate: mc.successRate });
        progress.at(PROGRESS_DET_END, PROGRESS_MC_END, mcProbes.length / EXPECTED_STEPUP_PROBES);
        step = planAgeStepUp(stepPlan, mcProbes);
    }
    const answerDelta = step.age;
    const stepUpCapHit = step.kind === 'capHit';
    const boundHit = step.kind === 'boundHit';

    const baselineMonteCarlo = await runMc(base);

    // --- 3. Trade-off rows ---
    const rowDeltas = tradeoffDeltas(answerDelta, shift.minDelta, shift.maxDelta);
    const withCouldSpend = couldSpendScope === 'all';
    const totalUnits = rowDeltas.length * (1 + (withCouldSpend ? COULD_SPEND_WEIGHT : 0));
    let unitsDone = 0;
    const rowProgress = (extra: number) => progress.at(PROGRESS_MC_END, 1, (unitsDone + extra) / totalUnits);

    const otherWho = shift.shifted.find(w => w !== shift.reportedWho);
    const rows: EarliestAgeRow[] = [];
    for (const delta of rowDeltas) {
        const c = await checkAt(delta);
        const mc = await mcAt(delta);
        unitsDone += 1;
        rowProgress(0);
        const clears = mc.successRate >= mcSuccessTarget;

        let couldSpend: number | null = null;
        if (withCouldSpend) {
            // An estimate: Phase 2's spending machinery (bisection + MC step-down)
            // on this row's own winning strategy, held fixed — no fresh strategy
            // search. The row's MC at the planned spend (same inputs) is the
            // step-down's first probe.
            let probesRun = 0;
            const est = estimateSustainableSpend(c.winner.inputs, {
                baselineMc: mc, mcIterations, mcSuccessTarget, signal,
                onProbe: () => {
                    probesRun++;
                    rowProgress(COULD_SPEND_WEIGHT * Math.min(1, probesRun / EXPECTED_COULD_SPEND_PROBES));
                },
            });
            couldSpend = est.capHit
                ? null // no spend cleared the bar — nothing honest to show
                : reconcileCouldSpend(est.spend, clears, base.postRetirementSpend, SPEND_PRECISION);
            unitsDone += COULD_SPEND_WEIGHT;
            rowProgress(0);
            await yieldToEventLoop();
            if (signal?.aborted) throw abortError();
        }

        // Today's-dollar view of the row's cached winner run (no new engine run);
        // the nominal c.winner.metrics the search ranked on stay untouched.
        const realMetrics = computeSummaryMetrics(c.winner.results, c.winner.inputs, true);

        rows.push({
            delta,
            retirementAge: reported.retirementAge + delta,
            otherRetirementAge: otherWho ? personOf(base, otherWho).retirementAge + delta : undefined,
            successRate: mc.successRate,
            clearsTarget: clears,
            deterministicFeasible: c.feasible,
            netEstate: realMetrics.netEstateValue,
            lifetimeTax: realMetrics.lifetimeTaxPaid,
            couldSpend,
            isAnswer: delta === answerDelta,
            isPlan: delta === 0,
        });
    }

    // --- Result assembly ---
    const answerCheck = await checkAt(answerDelta); // cached: the step-up probed it
    const answerMc = await mcAt(answerDelta);       // cached likewise
    const winner = answerCheck.winner;
    const recommendedInputs = winner.inputs;
    const answerAge = reported.retirementAge + answerDelta;

    // Bad-markets line, from the reported person's (new) retirement onward.
    const badMarketsAge = badMarketsAgeAfter(answerMc, base, reported, answerAge - reported.age);

    const decisions: PersonMeltdownDecision[] = [
        buildDecision('person', 'You', base.person, winner.a.person, recommendedInputs.person.retirementAge),
    ];
    if (base.spouse && winner.a.spouse && recommendedInputs.spouse) {
        decisions.push(buildDecision(
            'spouse', 'Spouse', base.spouse, winner.a.spouse, recommendedInputs.spouse.retirementAge,
        ));
    }

    const onTrack = answerDelta === 0;
    const winningStrategy = winner.a.strategy;
    // At the plan's own age there is still something to apply when the plan
    // only clears the bar with a different strategy. When the plan as entered
    // already clears it, the search's pick is a preference, not a fix: stay on
    // track with nothing to apply.
    const strategyChangeNeeded = isStrategyChangeNeeded(
        answerDelta,
        strategyDiffersFromPlan(decisions, currentStrategy, winningStrategy),
        baselineMonteCarlo.successRate,
        mcSuccessTarget,
    );
    progress.finish();

    return {
        objective: 'earliest-age',
        improved: !onTrack || strategyChangeNeeded,
        baselineInputs: base,
        recommendedInputs,
        baselineResults,
        recommendedResults: winner.results,
        baselineMetrics,
        recommendedMetrics: winner.metrics,
        baselineMonteCarlo,
        recommendedMonteCarlo: answerMc,
        decisions,
        netEstateDelta: winner.metrics.netEstateValue - baselineMetrics.netEstateValue,
        lifetimeTaxDelta: winner.metrics.lifetimeTaxPaid - baselineMetrics.lifetimeTaxPaid,
        baselineSuccessRate: baselineMonteCarlo.successRate,
        recommendedSuccessRate: answerMc.successRate,
        mcWarning: false, // the MC step-up is the guard in earliest-age mode
        earliestAge: {
            status: 'found',
            reportedWho: shift.reportedWho,
            people: shift.shifted.map(w => personSummary(w, recommendedInputs)),
            currentAge: reported.age,
            planAge: reported.retirementAge,
            answerAge,
            deltaYears: answerDelta,
            deterministicAge: reported.retirementAge + detDelta,
            minAge: reported.retirementAge + shift.minDelta,
            maxAge: reported.retirementAge + shift.maxDelta,
            retiresNow: answerAge === reported.age,
            atLowerBound: answerDelta === shift.minDelta,
            mcSuccessTarget,
            achievedSuccessRate: answerMc.successRate,
            stepUpCapHit,
            boundHit,
            onTrack,
            strategyChangeNeeded,
            postRetirementSpend: base.postRetirementSpend,
            cppOverrideHeld,
            pensionHeld,
            withdrawalStrategy: winningStrategy,
            strategyChanged: winningStrategy !== currentStrategy,
            rows,
            badMarketsAge,
        },
    };
}

// --- Savings-needed solve --------------------------------------------------
//
// Outer loop over the household savings total D, today's dollars (see
// savingsSearch.ts for the allocation and the pure planners it drives):
//   1. Deterministic search: the smallest D at which ANY strategy funds the
//      plan on average returns — the current total first, then 0 or a ×2
//      expansion, then bisection. Inner check = earliest-age's, cached per D.
//   2. Monte Carlo step-up from there until the success bar clears, on each
//      probed D's winning strategy.
// Retirement ages and spending are held exactly as entered.

const PROGRESS_SAVINGS_DET_END = 0.6; // deterministic search; the MC step-up takes the rest
// Typical counts, progress only (the bar clamps at each phase's end).
const EXPECTED_SAVINGS_DET_CHECKS = 8;
const EXPECTED_SAVINGS_STEPUP_PROBES = 5;

async function solveSavingsNeeded(
    baseInputs: SimulationInputs,
    options: OptimizeMeltdownOptions,
): Promise<MeltdownResult> {
    const considerCppOas = options.considerCppOas ?? true;
    const mcIterations = options.mcIterations ?? 200;
    const mcSuccessTarget = options.mcSuccessTarget ?? DEFAULT_MC_TARGET;
    const { signal } = options;
    const progress = phasedProgress(options.onProgress);

    if (signal?.aborted) throw abortError();

    const base = structuredClone(baseInputs);
    const currentStrategy: WithdrawalStrategy = base.withdrawalStrategy ?? 'tax-efficient';
    const baselineResults = runSimulation(base);
    const baselineMetrics = computeSummaryMetrics(baselineResults, base, false);

    const currentSavings = householdSavings(base);
    const basis = savingsBasis(base);
    const searchCap = options.savingsSearchCap ?? savingsSearchCap(base);
    const scale = savingsSearchScale(base.postRetirementSpend);
    const framing = planSavingsFraming(base);
    const reported = personOf(base, framing.reportedWho);

    // Inner check and MC, cached per D.
    const probe = createOuterProbe({
        inputsAt: (total) => allocateSavings(base, total).inputs,
        considerCppOas, mcIterations, signal,
    });

    // Fields that read the same whatever the outcome.
    const common = {
        basis,
        currentSavings,
        searchCap,
        stillWorking: framing.stillWorking,
        reportedWho: framing.reportedWho,
        currentAge: framing.currentAge,
        retirementAge: framing.retirementAge,
        mcSuccessTarget,
        postRetirementSpend: base.postRetirementSpend,
    };

    // --- 1. Deterministic search over D ---
    const bisectPlan = { start: currentSavings, cap: searchCap, expandFloor: scale };
    const detProbes: SavingsFeasibilityProbe[] = [];
    let bisect = planSavingsBisection(bisectPlan, detProbes);
    while (bisect.kind === 'probe') {
        const n = detProbes.length;
        const c = await probe.checkAt(bisect.total,
            f => progress.at(0, PROGRESS_SAVINGS_DET_END, (n + f) / EXPECTED_SAVINGS_DET_CHECKS));
        detProbes.push({ total: bisect.total, feasible: c.feasible });
        bisect = planSavingsBisection(bisectPlan, detProbes);
    }

    if (bisect.kind === 'unreachable') {
        // Even the cap can't fund the spending on average returns. Report the
        // plan unchanged (improved: false), with its own at-retirement total.
        const baselineMonteCarlo = await probe.runMc(base);
        progress.finish();
        return {
            objective: 'savings-needed',
            improved: false,
            baselineInputs: base,
            recommendedInputs: structuredClone(base),
            baselineResults,
            recommendedResults: baselineResults,
            baselineMetrics,
            recommendedMetrics: baselineMetrics,
            baselineMonteCarlo,
            recommendedMonteCarlo: baselineMonteCarlo,
            decisions: [],
            netEstateDelta: 0,
            lifetimeTaxDelta: 0,
            baselineSuccessRate: baselineMonteCarlo.successRate,
            recommendedSuccessRate: baselineMonteCarlo.successRate,
            mcWarning: false,
            savingsNeeded: {
                ...common,
                status: 'unreachable',
                neededSavings: null,
                deterministicSavings: null,
                savingsGap: null,
                haveEnough: false,
                needIsZero: false,
                strategyChangeNeeded: false,
                neededAccounts: [],
                neededAtRetirement: null,
                currentAtRetirement: householdSavingsAtRetirement(baselineResults, framing.yearsToRetirement),
                achievedSuccessRate: null,
                stepUpCapHit: false,
                boundHit: false,
                withdrawalStrategy: currentStrategy,
                strategyChanged: false,
                badMarketsAge: null,
            },
        };
    }
    const deterministicSavings = bisect.total;
    progress.at(0, PROGRESS_SAVINGS_DET_END, 1);

    // --- 2. Monte Carlo step-up from the deterministic answer ---
    const stepPlan = {
        target: mcSuccessTarget, start: deterministicSavings, cap: searchCap,
        minStepBase: scale, maxProbes: MAX_SAVINGS_STEPUP_PROBES,
    };
    const mcProbes: SavingsProbeResult[] = [];
    let step: SavingsStepUpAction = planSavingsStepUp(stepPlan, mcProbes);
    while (step.kind === 'probe') {
        const n = mcProbes.length;
        // A total the deterministic phase never checked costs a strategy search
        // as well as the MC run: let the search move the bar most of the way.
        const mc = await probe.mcAt(step.total, f => progress.at(
            PROGRESS_SAVINGS_DET_END, 1, (n + 0.7 * f) / EXPECTED_SAVINGS_STEPUP_PROBES,
        ));
        mcProbes.push({ total: step.total, successRate: mc.successRate });
        progress.at(PROGRESS_SAVINGS_DET_END, 1, mcProbes.length / EXPECTED_SAVINGS_STEPUP_PROBES);
        step = planSavingsStepUp(stepPlan, mcProbes);
    }
    const neededSavings = step.total;
    const stepUpCapHit = step.kind === 'capHit';
    const boundHit = step.kind === 'boundHit';

    // "Your odds today": the plan exactly as entered, at current savings.
    const baselineMonteCarlo = await probe.runMc(base);

    // --- Result assembly ---
    const answerCheck = await probe.checkAt(neededSavings); // cached: the step-up probed it
    const answerMc = await probe.mcAt(neededSavings);       // cached likewise
    const winner = answerCheck.winner;
    const recommendedInputs = winner.inputs;

    // At-retirement pair. The current-savings side runs the ANSWER's strategy
    // on the plan's own balances (one extra engine run), so it differs from
    // the answer's run by savings alone — not by a strategy change too.
    let neededAtRetirement: number | null = null;
    let currentAtRetirement: number | null = null;
    if (framing.yearsToRetirement !== null) {
        neededAtRetirement = householdSavingsAtRetirement(winner.results, framing.yearsToRetirement);
        const atCurrent = runSimulation(applyAssignment(base, winner.a));
        currentAtRetirement = householdSavingsAtRetirement(atCurrent, framing.yearsToRetirement);
    }

    // Bad-markets line, from the reported person's retirement (or today, when
    // everyone has already retired).
    const badMarketsAge = badMarketsAgeAfter(answerMc, base, reported, framing.yearsToRetirement ?? 0);

    // Decisions compare the answer's strategy with the plan's, judged at the
    // answer's balances: hasRrsp must reflect the RRSP the answer holds (a
    // default-mix answer gives an RRSP to someone who has none today).
    const planAtAnswer = allocateSavings(base, neededSavings).inputs;
    const decisions: PersonMeltdownDecision[] = [
        buildDecision('person', 'You', planAtAnswer.person, winner.a.person),
    ];
    if (planAtAnswer.spouse && winner.a.spouse) {
        decisions.push(buildDecision('spouse', 'Spouse', planAtAnswer.spouse, winner.a.spouse));
    }

    const haveEnough = neededSavings <= currentSavings;
    const winningStrategy = winner.a.strategy;
    // Same rule as earliest-age at the plan's own age: when the answer fits
    // within current savings, a different strategy is a fix only if the plan
    // as entered misses the bar.
    const strategyChangeNeeded = haveEnough
        && strategyDiffersFromPlan(decisions, currentStrategy, winningStrategy)
        && baselineMonteCarlo.successRate < mcSuccessTarget;
    progress.finish();

    return {
        objective: 'savings-needed',
        improved: neededSavings > currentSavings,
        baselineInputs: base,
        recommendedInputs,
        baselineResults,
        recommendedResults: winner.results,
        baselineMetrics,
        recommendedMetrics: winner.metrics,
        baselineMonteCarlo,
        recommendedMonteCarlo: answerMc,
        decisions,
        netEstateDelta: winner.metrics.netEstateValue - baselineMetrics.netEstateValue,
        lifetimeTaxDelta: winner.metrics.lifetimeTaxPaid - baselineMetrics.lifetimeTaxPaid,
        baselineSuccessRate: baselineMonteCarlo.successRate,
        recommendedSuccessRate: answerMc.successRate,
        mcWarning: false, // the MC step-up is the guard in savings-needed mode
        savingsNeeded: {
            ...common,
            status: 'found',
            neededSavings,
            deterministicSavings,
            savingsGap: neededSavings - currentSavings,
            haveEnough,
            needIsZero: neededSavings === 0,
            strategyChangeNeeded,
            neededAccounts: savingsBreakdown(recommendedInputs),
            neededAtRetirement,
            currentAtRetirement,
            achievedSuccessRate: answerMc.successRate,
            stepUpCapHit,
            boundHit,
            withdrawalStrategy: winningStrategy,
            strategyChanged: winningStrategy !== currentStrategy,
            badMarketsAge,
        },
    };
}

// Merge only the fields the optimizer searched from `recommended` onto a fresh
// clone of `current`. Everything else — balances, any edits made while the
// optimizer was open — comes from `current`, so applying a stale recommendation
// never clobbers unrelated changes. Spouse fields are only copied when BOTH
// sides have a spouse; if the spouse was removed since the recommendation was
// computed, `current` (spouse-less) wins untouched.
//
// BOTH objectives search the household withdrawalStrategy, so it is always
// carried over (a recommendation whose winning order is never applied would be
// displayed and then silently dropped). postRetirementSpend is max-spend's alone
// — the estate search leaves spending exactly as planned — so an estate apply
// still never touches it. earliest-age additionally owns the retirement ages and
// the CPP contribution years that follow them (an unmoved spouse's values come
// across unchanged), and also leaves spending alone. savings-needed carries the
// strategy fields only, exactly like estate: its recommendedInputs hold the
// balances at the needed savings, but balances are facts about the household,
// not choices, so they NEVER come across (the UI offers no Apply for it anyway).
export function applyMeltdownRecommendation(
    current: SimulationInputs,
    recommended: SimulationInputs,
    objective: OptimizerObjective = 'estate',
): SimulationInputs {
    const next = structuredClone(current);
    const withAges = objective === 'earliest-age';
    copySearchedFields(next.person, recommended.person, withAges);
    if (next.spouse && recommended.spouse) {
        copySearchedFields(next.spouse, recommended.spouse, withAges);
    }
    // A recommendation always carries a strategy; the guard only keeps a
    // hand-built payload without one from erasing the user's setting.
    if (recommended.withdrawalStrategy) {
        next.withdrawalStrategy = recommended.withdrawalStrategy;
    }
    if (objective === 'max-spend') {
        next.postRetirementSpend = recommended.postRetirementSpend;
    }
    return next;
}

// cppAnnualOverride / cppOverrideStartAge stay as `current` has them (see
// applyChoice): applying a new cppStartAge keeps the estimate's base age.
function copySearchedFields(target: Person, source: Person, withRetirementAge: boolean): void {
    target.rrspMeltAmount = source.rrspMeltAmount;
    target.rrspMeltStartAge = source.rrspMeltStartAge;
    target.cppStartAge = source.cppStartAge;
    target.oasStartAge = source.oasStartAge;
    if (withRetirementAge) {
        target.retirementAge = source.retirementAge;
        target.cppContributedYears = source.cppContributedYears;
    }
}

// Whether a recommendation changes any searched strategy field vs the plan:
// a CPP or OAS start age, the melt amount (for someone with an RRSP — without
// one the melt does nothing), or the household withdrawal order. These are
// exactly the changes describeStrategyChanges puts into words, so "differs"
// here and a non-empty strategy line there always agree.
export function strategyDiffersFromPlan(
    decisions: PersonMeltdownDecision[],
    currentStrategy: WithdrawalStrategy,
    suggestedStrategy: WithdrawalStrategy,
): boolean {
    if (suggestedStrategy !== currentStrategy) return true;
    return decisions.some(d =>
        d.cppChanged || d.oasChanged || (d.hasRrsp && d.meltAmount !== d.originalMeltAmount));
}

// `retirementAge` is the age the recommendation retires at — the plan's own
// unless the earliest-age search moved it. The melt starts there.
function buildDecision(
    who: 'person' | 'spouse',
    label: string,
    base: Person,
    choice: PersonChoice,
    retirementAge: number = base.retirementAge,
): PersonMeltdownDecision {
    return {
        who,
        label,
        hasRrsp: base.rrsp.balance > 0,
        meltAmount: choice.melt,
        meltStartAge: Math.max(retirementAge, base.age),
        meltEndAge: 71,
        originalMeltAmount: base.rrspMeltAmount ?? 0,
        originalMeltStartAge: Math.max(base.rrspMeltStartAge || base.retirementAge, base.age),
        cppStartAge: choice.cpp,
        cppChanged: choice.cpp !== base.cppStartAge,
        originalCppStartAge: base.cppStartAge,
        oasStartAge: choice.oas,
        oasChanged: choice.oas !== base.oasStartAge,
        originalOasStartAge: base.oasStartAge,
    };
}
