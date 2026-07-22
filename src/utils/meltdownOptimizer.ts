// RRSP meltdown optimizer — a search loop over EXISTING engine inputs.
//
// The engine (projection.ts / tax.ts / cpp.ts) is treated as a pure black box:
// this module only rewrites a handful of per-person fields (rrspMeltAmount,
// cppStartAge, oasStartAge) on deep clones of the base inputs and re-runs
// runSimulation / runMonteCarlo to score each candidate. Nothing here mutates
// the caller's inputs.
//
// Objective: maximize nominal netEstateValue subject to a $1k shortfall
// tolerance (mirrors runMonteCarlo's success threshold). A deterministic sweep
// picks a winner; a Monte Carlo pass then guards against a winner that looks
// great deterministically but is materially riskier than the baseline.

import { runSimulation, runMonteCarlo } from '../engine/projection';
import type { Person, SimulationInputs, SimulationResult, MonteCarloResult } from '../engine/types';
import { computeSummaryMetrics } from './summaryMetrics';
import type { SummaryMetrics } from './summaryMetrics';

// --- Public options / result types ---------------------------------------

export interface OptimizeMeltdownOptions {
    // Also search CPP/OAS start ages (default true). When false, both are pinned
    // to the user's current input values.
    considerCppOas?: boolean;
    // Monte Carlo iterations for the validation pass (default 200).
    mcIterations?: number;
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

export interface MeltdownResult {
    // False when nothing feasible beats the baseline — UI shows a "your plan
    // already looks good" state and `recommendedInputs` equals the baseline.
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
    // Set when the deterministic winner was kept despite a Monte Carlo success
    // rate materially (>1pt) below baseline and no safer runner-up qualified.
    mcWarning: boolean;
}

// --- Tunables ------------------------------------------------------------

const SHORTFALL_TOL = 1000;   // same $1k tolerance runMonteCarlo uses
const IMPROVE_EPS = 1;        // net-estate must beat baseline by >$1 to count
const TIE_EPS = 1;            // net-estate values within $1 are "tied"
const COARSE_STEPS = 8;       // ~8 nonzero melt values in the coarse grid
const MAX_SWEEPS = 3;         // coordinate-descent sweep cap for couples
const BATCH = 10;             // engine calls between event-loop yields
const MC_WARN_MARGIN = 1;     // pp the winner may trail baseline before warning

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

// Coarse annual-melt grid: 0 plus ~COARSE_STEPS values scaled to the person's
// RRSP balance and melt window. The natural upper anchor is "deplete the RRSP
// evenly across the window"; we extend 1.5× past it so faster drawdowns are
// also on the table (the engine caps each year at the remaining balance).
export function buildMeltGrid(person: Person): number[] {
    const balance = person.rrsp.balance;
    if (balance <= 0) return [0];
    const startAge = Math.max(person.retirementAge, person.age);
    const meltYears = 72 - startAge; // melt runs while age < 72
    if (meltYears <= 0) return [0];

    const fullDepletion = balance / meltYears;
    const max = fullDepletion * 1.5;
    const grid = [0];
    for (let i = 1; i <= COARSE_STEPS; i++) {
        grid.push(roundTo((max * i) / COARSE_STEPS, 500));
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

// --- Internal search plumbing --------------------------------------------

interface PersonChoice { melt: number; cpp: number; oas: number; }
interface Assignment { person: PersonChoice; spouse?: PersonChoice; }

interface Evaluated {
    a: Assignment;
    sig: string;
    inputs: SimulationInputs;
    results: SimulationResult[];
    metrics: SummaryMetrics;
    feasible: boolean;
    ageDist: number;   // |Δcpp|+|Δoas| vs current inputs (tie-break a)
    totalMelt: number; // household melt (tie-break b)
}

function signatureOf(a: Assignment): string {
    const p = `${a.person.melt}/${a.person.cpp}/${a.person.oas}`;
    const s = a.spouse ? `${a.spouse.melt}/${a.spouse.cpp}/${a.spouse.oas}` : '-';
    return `${p}|${s}`;
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

// Ranking comparator: net estate desc, then closeness to current CPP/OAS, then
// smaller melt. Negative → `a` ranks ahead of `b`.
function cmp(a: Evaluated, b: Evaluated): number {
    const d = a.metrics.netEstateValue - b.metrics.netEstateValue;
    if (Math.abs(d) > TIE_EPS) return d > 0 ? -1 : 1;
    if (a.ageDist !== b.ageDist) return a.ageDist - b.ageDist;
    return a.totalMelt - b.totalMelt;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function abortError(): DOMException {
    return new DOMException('Meltdown optimization aborted', 'AbortError');
}

// --- Main entry point ----------------------------------------------------

export async function optimizeMeltdown(
    baseInputs: SimulationInputs,
    options: OptimizeMeltdownOptions = {},
): Promise<MeltdownResult> {
    const considerCppOas = options.considerCppOas ?? true;
    const mcIterations = options.mcIterations ?? 200;
    const { onProgress, signal } = options;

    if (signal?.aborted) throw abortError();

    const base = structuredClone(baseInputs);

    // Baseline: the user's plan exactly as entered (its own rrspMeltStartAge and
    // amount), scored nominally for an apples-to-apples netEstate comparison.
    const baselineResults = runSimulation(base);
    const baselineMetrics = computeSummaryMetrics(baselineResults, base, false);

    // Per-person sub-grids.
    const p1Melt = buildMeltGrid(base.person);
    const p1Cpp = buildCppCandidates(base.person, considerCppOas);
    const p1Oas = buildOasCandidates(base.person, considerCppOas);

    const hasSpouse = !!base.spouse;
    const p2Melt = hasSpouse ? buildMeltGrid(base.spouse!) : [];
    const p2Cpp = hasSpouse ? buildCppCandidates(base.spouse!, considerCppOas) : [];
    const p2Oas = hasSpouse ? buildOasCandidates(base.spouse!, considerCppOas) : [];

    // Progress total estimate (deterministic sweeps + a small MC buffer).
    const s1 = p1Melt.length * p1Cpp.length * p1Oas.length;
    const s2 = hasSpouse ? p2Melt.length * p2Cpp.length * p2Oas.length : 0;
    const REFINE_EST = 3;
    const detEstimate = hasSpouse
        ? MAX_SWEEPS * (s1 + s2) + 2 * REFINE_EST
        : s1 + REFINE_EST;
    const total = detEstimate + 4; // +4 for up to four Monte Carlo runs

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

        const inputs = applyAssignment(base, a);
        const results = runSimulation(inputs);
        const metrics = computeSummaryMetrics(results, inputs, false);
        const ev: Evaluated = {
            a, sig, inputs, results, metrics,
            feasible: metrics.totalShortfall <= SHORTFALL_TOL,
            ageDist: ageDistance(base, a),
            totalMelt: householdMelt(a),
        };
        cache.set(sig, ev);
        allEvals.push(ev);
        if (ev.feasible && (bestRef.current === null || cmp(ev, bestRef.current) < 0)) bestRef.current = ev;

        done++;
        report();
        if (++sinceYield >= BATCH) {
            sinceYield = 0;
            await yieldToEventLoop();
            if (signal?.aborted) throw abortError();
        }
        return ev;
    };

    const evalList = async (assignments: Assignment[]): Promise<void> => {
        for (const a of assignments) await evaluate(a);
    };

    // --- Deterministic search ---
    if (!hasSpouse) {
        // Single person: exhaustive sweep, then a refinement pass around the melt.
        await evalList(personChoices(p1Melt, p1Cpp, p1Oas).map(pc => ({ person: pc })));
        const winnerSoFar = bestRef.current;
        if (winnerSoFar) {
            const refined = refineMeltGrid(winnerSoFar.a.person.melt, p1Melt);
            await evalList(refined.map(m => ({ person: { ...winnerSoFar.a.person, melt: m } })));
        }
    } else {
        // Couple: coordinate descent — sweep one person's sub-grid holding the
        // other at current-best, alternate, repeat until a full sweep yields no
        // improvement (capped at MAX_SWEEPS).
        const init: Assignment = {
            person: initialChoice(base.person, p1Melt, p1Cpp, p1Oas),
            spouse: initialChoice(base.spouse!, p2Melt, p2Cpp, p2Oas),
        };
        await evaluate(init);

        let sweeps = 0;
        let improvedSweep = true;
        while (improvedSweep && sweeps < MAX_SWEEPS) {
            const beforeSig = bestRef.current?.sig ?? null;

            const heldSpouse = bestRef.current?.a.spouse ?? init.spouse!;
            await evalList(personChoices(p1Melt, p1Cpp, p1Oas).map(pc => ({ person: pc, spouse: heldSpouse })));

            const heldPerson = bestRef.current?.a.person ?? init.person;
            await evalList(personChoices(p2Melt, p2Cpp, p2Oas).map(pc => ({ person: heldPerson, spouse: pc })));

            improvedSweep = (bestRef.current?.sig ?? null) !== beforeSig;
            sweeps++;
        }

        // Refinement: finer melt steps for each person around the descent winner.
        const bp = bestRef.current;
        if (bp) {
            const refP = refineMeltGrid(bp.a.person.melt, p1Melt);
            await evalList(refP.map(m => ({ person: { ...bp.a.person, melt: m }, spouse: bp.a.spouse })));

            const bs = bestRef.current!;
            const refS = refineMeltGrid(bs.a.spouse!.melt, p2Melt);
            await evalList(refS.map(m => ({ person: bs.a.person, spouse: { ...bs.a.spouse!, melt: m } })));
        }
    }

    const winner = bestRef.current;
    const improved = winner !== null && winner.metrics.netEstateValue > baselineMetrics.netEstateValue + IMPROVE_EPS;

    // --- Nothing feasible beats the baseline ---
    if (!improved || winner === null) {
        if (signal?.aborted) throw abortError();
        const baselineMonteCarlo = runMonteCarlo(base, mcIterations);
        done = total;
        report();
        return {
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
    const ranked = allEvals.filter(e => e.feasible).sort(cmp);
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

// Merge only the fields the optimizer actually searches (rrspMeltAmount,
// rrspMeltStartAge, cppStartAge, oasStartAge) from `recommended` onto a fresh
// clone of `current`. Everything else — balances, spending, any edits made
// while the optimizer was open — comes from `current`, so applying a stale
// recommendation never clobbers unrelated changes. Spouse fields are only
// copied when BOTH sides have a spouse; if the spouse was removed since the
// recommendation was computed, `current` (spouse-less) wins untouched.
export function applyMeltdownRecommendation(
    current: SimulationInputs,
    recommended: SimulationInputs,
): SimulationInputs {
    const next = structuredClone(current);
    copySearchedFields(next.person, recommended.person);
    if (next.spouse && recommended.spouse) {
        copySearchedFields(next.spouse, recommended.spouse);
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
