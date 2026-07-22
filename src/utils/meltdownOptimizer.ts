// RRSP meltdown optimizer — a search loop over EXISTING engine inputs.
//
// The engine (projection.ts / tax.ts / cpp.ts) is treated as a pure black box:
// this module only rewrites a handful of per-person fields (rrspMeltAmount,
// cppStartAge, oasStartAge) — plus, in max-spend mode, the household
// withdrawalStrategy and postRetirementSpend — on deep clones of the base
// inputs and re-runs runSimulation / runMonteCarlo to score each candidate.
// Nothing here mutates the caller's inputs.
//
// Two objective modes share one coordinate-descent search (see the `Objective`
// abstraction below); a future "when can I retire?" mode is the same feasibility
// check pointed at a third variable and should slot in the same way.
//
//  - 'estate' (default): maximize nominal netEstateValue subject to a $1k
//    shortfall tolerance. A deterministic sweep picks a winner; a Monte Carlo
//    pass then guards against a winner that looks great deterministically but is
//    materially riskier than the baseline.
//  - 'max-spend': fix the plan's shape and solve for the highest sustainable
//    postRetirementSpend. Each candidate is scored by bisecting spend to ~$500
//    precision (feasibility is monotone in spend); the deterministic winner's
//    spend is then stepped DOWN until Monte Carlo success clears a user-chosen
//    threshold, because a deterministic max-spend number is dangerously
//    optimistic for someone who will actually live on it.

import { runSimulation, runMonteCarlo } from '../engine/projection';
import type { Person, SimulationInputs, SimulationResult, MonteCarloResult } from '../engine/types';
import { computeSummaryMetrics } from './summaryMetrics';
import type { SummaryMetrics } from './summaryMetrics';

type WithdrawalStrategy = 'tax-efficient' | 'rrsp-first';

// --- Public options / result types ---------------------------------------

export interface OptimizeMeltdownOptions {
    // Which objective to solve for (default 'estate'). 'max-spend' finds the
    // highest sustainable annual spending instead of the largest estate.
    objective?: 'estate' | 'max-spend';
    // Also search CPP/OAS start ages (default true). When false, both are pinned
    // to the user's current input values. Applies to both objectives.
    considerCppOas?: boolean;
    // Monte Carlo iterations for the validation pass (default 200).
    mcIterations?: number;
    // max-spend only: the Monte Carlo success rate (0-100) the sustainable spend
    // must clear during the step-down. Default 85.
    mcSuccessTarget?: number;
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

export interface MeltdownResult {
    // Which objective produced this result. Drives both the UI rendering and how
    // applyMeltdownRecommendation treats spend/strategy.
    objective: 'estate' | 'max-spend';

    // For estate: false when nothing feasible beats the baseline. For max-spend:
    // false when the sustainable spend lands within one precision step of the
    // current planned spend ("your plan is about right"). Either way the UI shows
    // a muted "already looks good" state and hides Apply/Save.
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
    // qualified. Always false in max-spend mode (the step-down IS the guard).
    mcWarning: boolean;

    // Present only when objective === 'max-spend'.
    maxSpend?: MaxSpendResult;
}

// --- Tunables ------------------------------------------------------------

const SHORTFALL_TOL = 1000;   // same $1k tolerance runMonteCarlo uses
const IMPROVE_EPS = 1;        // net-estate must beat baseline by >$1 to count
const TIE_EPS = 1;            // net-estate values within $1 are "tied"
const COARSE_STEPS = 8;       // ~8 nonzero melt values in the estate coarse grid
const MAX_SWEEPS = 3;         // coordinate-descent sweep cap for couples
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
interface Assignment { person: PersonChoice; spouse?: PersonChoice; strategy?: WithdrawalStrategy; }

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
    strategyMatchesCurrent: boolean; // tie-break c (max-spend only)
}

function signatureOf(a: Assignment): string {
    const p = `${a.person.melt}/${a.person.cpp}/${a.person.oas}`;
    const s = a.spouse ? `${a.spouse.melt}/${a.spouse.cpp}/${a.spouse.oas}` : '-';
    const strat = a.strategy ? `#${a.strategy}` : '';
    return `${p}|${s}${strat}`;
}

function personChoices(melt: number[], cpp: number[], oas: number[]): PersonChoice[] {
    const out: PersonChoice[] = [];
    for (const m of melt) for (const c of cpp) for (const o of oas) out.push({ melt: m, cpp: c, oas: o });
    return out;
}

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
    if (a.strategy) next.withdrawalStrategy = a.strategy;
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
// and which household withdrawal strategies to search. Both modes reuse the same
// coordinate-descent loop; only these knobs differ. The estate objective is
// arranged to reproduce the pre-max-spend behaviour byte-for-byte.

interface ScoreOutput {
    inputs: SimulationInputs;   // possibly spend-adjusted
    score: number;
    results: SimulationResult[];
    metrics: SummaryMetrics;
    feasible: boolean;
    runs: number;
}

interface Objective {
    mode: 'estate' | 'max-spend';
    meltSteps: number;
    refine: boolean;
    strategies: (WithdrawalStrategy | undefined)[];
    score: (inputs: SimulationInputs) => ScoreOutput;
    cmp: (a: Evaluated, b: Evaluated) => number;
}

function estateObjective(): Objective {
    // Ranking: net estate desc, then closeness to current CPP/OAS, then smaller
    // melt (identical to the original cmp, which read metrics.netEstateValue).
    const cmp = (a: Evaluated, b: Evaluated): number => {
        const d = a.score - b.score;
        if (Math.abs(d) > TIE_EPS) return d > 0 ? -1 : 1;
        if (a.ageDist !== b.ageDist) return a.ageDist - b.ageDist;
        return a.totalMelt - b.totalMelt;
    };
    return {
        mode: 'estate',
        meltSteps: COARSE_STEPS,
        refine: true,
        strategies: [undefined], // estate never searches the withdrawal strategy
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

// --- Main entry point ----------------------------------------------------

export async function optimizeMeltdown(
    baseInputs: SimulationInputs,
    options: OptimizeMeltdownOptions = {},
): Promise<MeltdownResult> {
    const considerCppOas = options.considerCppOas ?? true;
    const mcIterations = options.mcIterations ?? 200;
    const mcSuccessTarget = options.mcSuccessTarget ?? DEFAULT_MC_TARGET;
    const { onProgress, signal } = options;
    const objective = (options.objective ?? 'estate') === 'max-spend' ? maxSpendObjective() : estateObjective();

    if (signal?.aborted) throw abortError();

    const base = structuredClone(baseInputs);
    const currentStrategy: WithdrawalStrategy = base.withdrawalStrategy ?? 'tax-efficient';

    // Baseline: the user's plan exactly as entered (its own rrspMeltStartAge and
    // amount), scored nominally for an apples-to-apples comparison.
    const baselineResults = runSimulation(base);
    const baselineMetrics = computeSummaryMetrics(baselineResults, base, false);

    // Per-person sub-grids (melt density comes from the objective).
    const p1Melt = buildMeltGrid(base.person, objective.meltSteps);
    const p1Cpp = buildCppCandidates(base.person, considerCppOas);
    const p1Oas = buildOasCandidates(base.person, considerCppOas);

    const hasSpouse = !!base.spouse;
    const p2Melt = hasSpouse ? buildMeltGrid(base.spouse!, objective.meltSteps) : [];
    const p2Cpp = hasSpouse ? buildCppCandidates(base.spouse!, considerCppOas) : [];
    const p2Oas = hasSpouse ? buildOasCandidates(base.spouse!, considerCppOas) : [];

    // Progress total estimate (deterministic sweeps × runs-per-candidate ×
    // strategies + a Monte Carlo buffer). Snaps to `total` on finish.
    const s1 = p1Melt.length * p1Cpp.length * p1Oas.length;
    const s2 = hasSpouse ? p2Melt.length * p2Cpp.length * p2Oas.length : 0;
    const REFINE_EST = objective.refine ? 3 : 0;
    const detPerStrategy = hasSpouse
        ? MAX_SWEEPS * (s1 + s2) + 2 * REFINE_EST
        : s1 + REFINE_EST;
    const runsPerCandidate = objective.mode === 'max-spend' ? AVG_BISECTION_RUNS : 1;
    const detEstimate = detPerStrategy * objective.strategies.length * runsPerCandidate;
    // Baseline MC (1) + up to MAX_STEPDOWN_PROBES step-down probes.
    const mcBuffer = objective.mode === 'max-spend' ? 1 + MAX_STEPDOWN_PROBES : 4;
    const total = detEstimate + mcBuffer;

    let done = 0;
    let sinceYield = 0;
    // Held in a ref so the closure below can update it without TS narrowing the
    // outer reads to `null` (control-flow analysis ignores closure writes).
    const bestRef: { current: Evaluated | null } = { current: null };
    const cache = new Map<string, Evaluated>();
    const allEvals: Evaluated[] = [];

    const report = () => onProgress?.(Math.min(done, total), total);

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
            strategyMatchesCurrent: (a.strategy ?? currentStrategy) === currentStrategy,
        };
        cache.set(sig, ev);
        allEvals.push(ev);
        if (ev.feasible && (bestRef.current === null || objective.cmp(ev, bestRef.current) < 0)) bestRef.current = ev;

        done += sc.runs;
        report();
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
    // The loop SHAPE is identical across modes; estate runs it once with no
    // strategy override (byte-identical to the original), max-spend runs it once
    // per withdrawal strategy, accumulating into the shared best/cache/allEvals.
    const runDescent = async (strategy: WithdrawalStrategy | undefined): Promise<void> => {
        const tag = (a: Assignment): Assignment => (strategy ? { ...a, strategy } : a);

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

            let sweeps = 0;
            let improvedSweep = true;
            while (improvedSweep && sweeps < MAX_SWEEPS) {
                const beforeSig = bestRef.current?.sig ?? null;

                const heldSpouse = bestRef.current?.a.spouse ?? init.spouse!;
                await evalList(personChoices(p1Melt, p1Cpp, p1Oas).map(pc => tag({ person: pc, spouse: heldSpouse })));

                const heldPerson = bestRef.current?.a.person ?? init.person;
                await evalList(personChoices(p2Melt, p2Cpp, p2Oas).map(pc => tag({ person: heldPerson, spouse: pc })));

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

    for (const strategy of objective.strategies) {
        await runDescent(strategy);
    }

    const winner = bestRef.current;

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

    // Adaptive MC step-down. We do NOT bisect on the raw MC rate — it wobbles a
    // few points at these iteration counts. Instead we probe spends, bracket the
    // target between a "clears" and a "misses" probe, and refine to precision. The
    // per-probe decision lives in planStepDownProbe; here we just run the MC and
    // feed it back. Warm-started from the baseline signal so a far-below-max answer
    // doesn't cost a long descent.
    const stepPlan: StepDownPlan = { target: mcSuccessTarget, ceiling: deterministicMax, floor: 0 };
    const probeAt = (spendValue: number): { spend: number; mc: MonteCarloResult } => {
        const atSpend = spendValue === deterministicMax ? winner.inputs : withSpend(winner.inputs, spendValue);
        const runMc = runMonteCarlo(atSpend, mcIterations);
        reportProbe();
        return { spend: spendValue, mc: runMc };
    };

    const probes: { spend: number; mc: MonteCarloResult }[] = [];
    probes.push(probeAt(initialStepDownSpend({
        ceiling: deterministicMax, floor: 0, currentSpend,
        baselineRate: baselineMonteCarlo.successRate, target: mcSuccessTarget,
    })));

    const asResults = () => probes.map(p => ({ spend: p.spend, successRate: p.mc.successRate }));
    let action = planStepDownProbe(stepPlan, asResults());
    while (action.kind === 'probe' && probes.length < MAX_STEPDOWN_PROBES) {
        if (signal?.aborted) throw abortError();
        probes.push(probeAt(action.spend));
        action = planStepDownProbe(stepPlan, asResults());
    }

    // Resolve the final spend. A 'done'/'capHit' action names a probed spend; if
    // we merely ran out of probe budget, fall back to the best clearing probe (or
    // the highest-success probe, flagged as a cap hit).
    let sustainableSpend: number;
    let stepDownCapHit: boolean;
    if (action.kind === 'done') {
        sustainableSpend = action.spend;
        stepDownCapHit = false;
    } else if (action.kind === 'capHit') {
        sustainableSpend = action.spend;
        stepDownCapHit = true;
    } else {
        const clearing = probes.filter(p => p.mc.successRate >= mcSuccessTarget);
        if (clearing.length) {
            sustainableSpend = clearing.reduce((b, p) => (p.spend > b.spend ? p : b)).spend;
            stepDownCapHit = false;
        } else {
            sustainableSpend = probes.reduce((b, p) => (p.mc.successRate > b.mc.successRate ? p : b)).spend;
            stepDownCapHit = true;
        }
    }

    // The MC result at the reported spend (it was probed). Recompute the nominal
    // projection/metrics at that spend, reusing the winner's at the deterministic max.
    const finalProbe = probes.find(p => p.spend === sustainableSpend)
        ?? probes.reduce((b, p) =>
            (Math.abs(p.spend - sustainableSpend) < Math.abs(b.spend - sustainableSpend) ? p : b));
    const mc = finalProbe.mc;

    const recommendedInputs = withSpend(winner.inputs, sustainableSpend);
    const recResults = sustainableSpend === deterministicMax ? winner.results : runSimulation(recommendedInputs);
    const recMetrics = sustainableSpend === deterministicMax
        ? winner.metrics
        : computeSummaryMetrics(recResults, recommendedInputs, false);

    const winningStrategy: WithdrawalStrategy = winner.a.strategy ?? currentStrategy;
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

// Merge only the fields the optimizer searched from `recommended` onto a fresh
// clone of `current`. Everything else — balances, any edits made while the
// optimizer was open — comes from `current`, so applying a stale recommendation
// never clobbers unrelated changes. Spouse fields are only copied when BOTH
// sides have a spouse; if the spouse was removed since the recommendation was
// computed, `current` (spouse-less) wins untouched.
//
// In 'max-spend' mode the search also owns the household postRetirementSpend and
// withdrawalStrategy, so those are carried over too — but ONLY for max-spend
// recommendations, so an estate apply never starts clobbering spend/strategy.
export function applyMeltdownRecommendation(
    current: SimulationInputs,
    recommended: SimulationInputs,
    objective: 'estate' | 'max-spend' = 'estate',
): SimulationInputs {
    const next = structuredClone(current);
    copySearchedFields(next.person, recommended.person);
    if (next.spouse && recommended.spouse) {
        copySearchedFields(next.spouse, recommended.spouse);
    }
    if (objective === 'max-spend') {
        next.postRetirementSpend = recommended.postRetirementSpend;
        next.withdrawalStrategy = recommended.withdrawalStrategy;
    }
    return next;
}

function copySearchedFields(target: Person, source: Person): void {
    target.rrspMeltAmount = source.rrspMeltAmount;
    target.rrspMeltStartAge = source.rrspMeltStartAge;
    target.cppStartAge = source.cppStartAge;
    target.oasStartAge = source.oasStartAge;
}

function buildDecision(
    who: 'person' | 'spouse',
    label: string,
    base: Person,
    choice: PersonChoice,
): PersonMeltdownDecision {
    return {
        who,
        label,
        hasRrsp: base.rrsp.balance > 0,
        meltAmount: choice.melt,
        meltStartAge: Math.max(base.retirementAge, base.age),
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
