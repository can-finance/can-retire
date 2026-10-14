import type { ReactNode } from 'react';
import type { SimulationInputs } from '../../engine/types';
import type { SavingsNeededResult, SavingsPerYearResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyApprox, formatCurrencyCAD, formatSuccessRate, roundCurrencyApprox } from '../../utils/formatters';
import {
    SAVE_AS_YOU_GO_SMALL,
    saveAsYouGoAmount,
    saveAsYouGoPlan,
    savingsAnswerClears,
    savingsStrategyNote,
} from './savingsNeededSummary';
import type { SavingsAnswer } from './savingsNeededSummary';
import { describeStrategyChanges } from './strategySummary';

/*
 * The answer box for the "How much do I need to retire?" search: the amount,
 * how it compares with what you have, the other way to get there (saving as
 * you go), the success rate at that amount, your odds today, the bad-markets
 * line, how the amount splits across accounts and the disclosure notes. Pure
 * presentation over the optimizer's savings-needed result, so the in-app
 * optimizer and the landing page render the same words from the same data —
 * the "To get there: …" line included (see savingsStrategyNote).
 *
 * Every amount is in today's dollars. Separate runs of market simulations move
 * the answer by a few percent, so amounts are rounded (formatCurrencyApprox)
 * and gaps are taken between the rounded figures, so the sentence adds up.
 */

type Tone = 'good' | 'warn';

const TONE_BOX: Record<Tone, string> = {
    good: 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50',
    warn: 'border-amber-200 bg-amber-50',
};
const TONE_TITLE: Record<Tone, string> = {
    good: 'text-emerald-900',
    warn: 'text-amber-900',
};
const TONE_BODY: Record<Tone, string> = {
    good: 'text-emerald-800',
    warn: 'text-amber-800',
};

// "Your odds today" is only worth a line when it differs from the odds at the
// answer by more than market simulations wobble between runs.
const ODDS_GAP_PP = 5;

const money = formatCurrencyApprox;

function pct(rate: number | null, target?: number): string {
    return formatSuccessRate(rate, target);
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// "CPP and OAS", plus whichever workplace pensions the plan has.
function guaranteedIncome(inputs: SimulationInputs): string {
    const has = (p: SimulationInputs['person'] | undefined) => !!p?.pension && p.pension.annualAmount > 0;
    const mine = has(inputs.person);
    const spouse = has(inputs.spouse);
    if (mine && spouse) return 'CPP, OAS and your pensions';
    if (mine) return 'CPP, OAS and your pension';
    if (spouse) return 'CPP, OAS and your spouse’s pension';
    return 'CPP and OAS';
}

interface Copy {
    tone: Tone;
    title: string;
    lead?: string;   // the first line under the title
    sub?: string;    // a quieter line under that
    fix?: string;    // no amount works: what to do about it
}

// The plan as entered misses the bar while the answer — same strategy, no
// more savings — clears it: two unseeded runs of market simulations
// disagreeing by a few points, not a real shortfall. Say "about enough"
// rather than contradict the odds shown.
function isNoise(r: SavingsAnswer, sn: SavingsNeededResult): boolean {
    return sn.haveEnough && !sn.strategyChangeNeeded
        && r.baselineSuccessRate !== null && r.baselineSuccessRate < sn.mcSuccessTarget;
}

function headlineCopy(r: SavingsAnswer, sn: SavingsNeededResult, spendTip?: string): Copy {
    const target = sn.mcSuccessTarget;
    const spend = `${formatCurrencyCAD(sn.postRetirementSpend)}/yr`;
    const age = sn.retirementAge;
    const isSpouse = sn.reportedWho === 'spouse';
    const current = sn.currentSavings;

    if (!savingsAnswerClears(sn)) {
        const fix = spendTip
            ? `${capitalize(spendTip)}.`
            : age !== null
                ? 'Spend less or retire later: try “Spend the most in retirement” or “Retire as early as possible”.'
                : 'Spend less: try “Spend the most in retirement”.';
        if (sn.status === 'unreachable') {
            return {
                tone: 'warn',
                title: 'Savings alone can’t fund this spending',
                lead: `We tried up to ${money(sn.searchCap)}. At ${spend}, your money still runs out before the plan ends, even with average returns.`,
                fix,
            };
        }
        const best = `The best, ${money(sn.neededSavings!)}, lasts in ${pct(sn.achievedSuccessRate, target)} of market simulations at ${spend}.`;
        return {
            tone: 'warn',
            title: `Savings alone can’t fund this spending at your ${target}% target`,
            lead: sn.boundHit
                ? `We tried up to ${money(sn.searchCap)}. ${best}`
                : `The calculator stopped checking before any amount met your target. ${best}`,
            fix: `${fix} Or choose a lower target.`,
        };
    }

    const needed = sn.neededSavings!;

    // --- Need more ---
    if (!sn.haveEnough) {
        const neededAtRet = sn.neededAtRetirement;
        const currentAtRet = sn.currentAtRetirement;
        if (age !== null && neededAtRet !== null && currentAtRet !== null) {
            const gap = roundCurrencyApprox(neededAtRet) - roundCurrencyApprox(currentAtRet);
            if (gap > 0) {
                const by = isSpouse ? `when your spouse retires at ${age}` : `by ${age}`;
                return {
                    tone: 'warn',
                    title: `You need about ${money(neededAtRet)} saved ${by}`,
                    lead: roundCurrencyApprox(currentAtRet) > 0
                        ? `You’re on track for about ${money(currentAtRet)}, so about ${money(gap)} more.`
                        : 'You’re not on track to have any savings by then.',
                    sub: current > 0
                        ? `That’s like having ${money(needed)} today instead of ${money(current)}.`
                        : `That’s like having ${money(needed)} today.`,
                };
            }
        }
        // Already retired (or retiring now): today's amount is the one that matters.
        const gap = roundCurrencyApprox(needed) - roundCurrencyApprox(current);
        return {
            tone: 'warn',
            title: current > 0 && gap > 0
                ? `You need about ${money(needed)} saved — ${money(gap)} more than you have`
                : `You need about ${money(needed)} saved`,
        };
    }

    // --- Have enough ---
    const enoughFor = age === null
        ? 'to fund your retirement'
        : isSpouse ? `for your spouse to retire at ${age}` : `to retire at ${age}`;

    if (isNoise(r, sn)) {
        return {
            tone: 'good',
            title: `You have about enough ${enoughFor}`,
            lead: `As entered, your money lasts in ${pct(r.baselineSuccessRate, target)} of market simulations, under your ${target}% target. Results shift a few points between runs, so this is about as close as the calculator can tell.`,
        };
    }

    if (sn.needIsZero) {
        const income = guaranteedIncome(r.baselineInputs);
        const cushion = current > 0 ? ` Your ${money(current)} saved is extra cushion.` : '';
        // Only with a different strategy: say so before the "To get there" line.
        const withChanges = sn.strategyChangeNeeded ? 'With the changes below, ' : '';
        if (age !== null) {
            const before = isSpouse ? `before your spouse retires at ${age}` : `before retiring at ${age}`;
            return {
                tone: 'good',
                title: 'You don’t need any savings today',
                lead: `${capitalize(`${withChanges}what you save from your pay ${before}, plus ${income}, covers your spending.`)}${cushion}`,
            };
        }
        return {
            tone: 'good',
            title: `${income} cover your spending on their own`,
            lead: `${capitalize(`${withChanges}even with no savings, your spending is covered in at least ${target}% of market simulations.`)}${cushion}`,
        };
    }

    // needed > 0 and needed ≤ current, so current > 0 here.
    const pctLower = Math.round(((current - needed) / current) * 100);
    const changes = sn.strategyChangeNeeded
        ? `As entered, your plan falls short of your ${target}% target. With the changes below, your`
        : 'Your';
    return {
        tone: 'good',
        title: sn.strategyChangeNeeded ? `You have enough ${enoughFor} — with the changes below` : `You have enough ${enoughFor}`,
        lead: pctLower < 1
            ? `${changes} savings are about what you need, with little to spare.`
            : `${changes} savings could be about ${pctLower}% lower (about ${money(needed)} instead of ${money(current)}) and still meet your ${target}% target.`,
    };
}

// How far the save-as-you-go years run. The planner charges before-retirement
// spending until the LAST earner retires, so with a spouse who works on after
// the reported person, the saving does too.
function saveAsYouGoSpan(sn: SavingsNeededResult, p: SavingsPerYearResult): { until: string; before: string } {
    const age = sn.retirementAge!;
    if (p.yearsOfSaving > age - sn.currentAge) {
        return { until: 'until you both retire', before: 'before you both retire' };
    }
    if (sn.reportedWho === 'spouse') {
        return { until: `until your spouse retires at ${age}`, before: 'before your spouse retires' };
    }
    return { until: `until you retire at ${age}`, before: 'before you retire' };
}

// The other way to get there, for someone still working who needs more:
// spend less each year before retiring and save the difference, at today's
// balances. Or, when even spending nothing before retiring falls short, say
// that saving from pay alone can't do it. The yearly plan has its own
// strategy, worded against the lump sum's "To get there" line just above it.
function saveAsYouGoLine(r: SavingsAnswer, sn: SavingsNeededResult, lumpNote: string | null): string | null {
    const p = sn.perYear;
    if (!p || sn.retirementAge === null || sn.haveEnough || !savingsAnswerClears(sn)) return null;
    const target = sn.mcSuccessTarget;
    const { until, before } = saveAsYouGoSpan(sn, p);

    const plan = saveAsYouGoPlan(sn);
    if (!plan) {
        if (p.status === 'unreachable') {
            return `Saving from your pay alone can’t close the gap: saving everything you now spend ${until} isn’t enough, even with average returns.`;
        }
        if (p.boundHit) {
            return `Saving from your pay alone can’t close the gap: even saving everything you now spend ${until}, your money lasts in ${pct(p.achievedSuccessRate, target)} of market simulations (target ${target}%).`;
        }
        return `Saving from your pay instead: the calculator stopped checking before any yearly amount met your ${target}% target.`;
    }

    const ownNote = describeStrategyChanges(
        plan.decisions,
        r.baselineInputs.withdrawalStrategy ?? 'tax-efficient',
        plan.withdrawalStrategy,
    );
    let lead = 'Or save as you go';
    let tail = '';
    if (ownNote && ownNote === lumpNote) lead += ', with the same changes';
    else if (ownNote) tail = ` ${ownNote.replace(/^To get there:/, 'To do this:')}`;
    else if (lumpNote) lead += ', without those changes';

    const body = saveAsYouGoAmount(plan.extraPerYear) === null
        ? `spending a little less ${before} (under ${formatCurrencyCAD(SAVE_AS_YOU_GO_SMALL)} a year) would close the gap.`
        : `spend about ${money(plan.extraPerYear)} less a year ${until}.`;
    return `${lead}: ${body}${tail}`;
}

// The lines under a found answer: the odds at the answer, your odds today,
// how the amount splits, and the bad-markets line.
function contextLines(r: SavingsAnswer, sn: SavingsNeededResult): string[] {
    if (!savingsAnswerClears(sn)) return [];
    const out: string[] = [];
    const target = sn.mcSuccessTarget;

    out.push(sn.needIsZero
        ? `With no savings, your spending is covered in ${pct(sn.achievedSuccessRate, target)} of market simulations (target ${target}%).`
        : `With the savings needed, your money lasts in ${pct(sn.achievedSuccessRate, target)} of market simulations (target ${target}%).`);

    const today = r.baselineSuccessRate;
    if (!isNoise(r, sn) && today !== null && sn.achievedSuccessRate !== null
        && Math.abs(today - sn.achievedSuccessRate) >= ODDS_GAP_PP) {
        out.push(`Your odds today: ${pct(today)}.`);
    }

    const split = splitLine(sn);
    if (split) out.push(split);

    out.push(sn.badMarketsAge === null
        ? 'Even in the worst 5% of markets, money lasts the whole plan.'
        : `In the worst 5% of markets, money lasts until ${sn.reportedWho === 'spouse'
            ? `your spouse is about ${sn.badMarketsAge}`
            : `you’re about ${sn.badMarketsAge}`}.`);
    return out;
}

// "How that splits: RRSP $a · TFSA $b · Non-registered $c" — household totals,
// or per person when the spouse holds part of it. Accounts that round to $0
// are left out.
function splitLine(sn: SavingsNeededResult): string | null {
    if (sn.needIsZero || sn.neededAccounts.length === 0) return null;
    const accounts = (a: { rrsp: number; tfsa: number; nonReg: number }): string =>
        ([['RRSP', a.rrsp], ['TFSA', a.tfsa], ['Non-registered', a.nonReg]] as const)
            .filter(([, v]) => roundCurrencyApprox(v) > 0)
            .map(([label, v]) => `${label} ${money(v)}`)
            .join(' · ');

    const spouse = sn.neededAccounts.find(a => a.who === 'spouse');
    if (spouse && roundCurrencyApprox(spouse.total) > 0) {
        const people = sn.neededAccounts
            .filter(a => roundCurrencyApprox(a.total) > 0)
            .map(a => `${a.label}: ${accounts(a)}`);
        return `How that splits: ${people.join('; ')}`;
    }
    const sum = (k: 'rrsp' | 'tfsa' | 'nonReg') => sn.neededAccounts.reduce((s, a) => s + a[k], 0);
    const household = accounts({ rrsp: sum('rrsp'), tfsa: sum('tfsa'), nonReg: sum('nonReg') });
    return household ? `How that splits: ${household}` : null;
}

function disclosureNotes(r: SavingsAnswer, sn: SavingsNeededResult): string[] {
    const out: string[] = [];
    if (sn.stepUpCapHit && savingsAnswerClears(sn)) {
        out.push('The calculator stopped checking early, so this may be a little more than you need.');
    }
    if (!sn.needIsZero) {
        const mix = sn.basis === 'default'
            ? `Assumes a TFSA first, then an RRSP${r.baselineInputs.spouse ? ', split evenly with your spouse' : ''}.`
            : 'Keeps your current mix of accounts.';
        out.push(`${mix} Today’s dollars.`);
    } else {
        out.push('All amounts are in today’s dollars.');
    }
    const plan = saveAsYouGoPlan(sn);
    if (plan && sn.retirementAge !== null) {
        if (plan.stepUpCapHit) {
            out.push('The calculator stopped checking early, so the yearly amount may be a little more than you need.');
        }
        out.push('Yearly savings rise with inflation and go to your TFSA first, then RRSP, then non-registered.');
    }
    return out;
}

export function SavingsNeededHeadline({ result, spendTip, fixLink }: {
    result: SavingsAnswer;
    /**
     * Replaces the pointer to the optimizer's "Spend the most in retirement" /
     * "Retire as early as possible" goals when no amount works, for pages
     * without them. A lowercase verb phrase with no full stop, e.g. "try lower
     * spending after retirement or a later retirement age".
     */
    spendTip?: string;
    /** One more line when no amount works, e.g. a link to the earliest-age page. */
    fixLink?: ReactNode;
}) {
    const sn = result.savingsNeeded;
    if (!sn) return null;
    const c = headlineCopy(result, sn, spendTip);
    const strategyNote = savingsStrategyNote(result);
    const saveAsYouGo = saveAsYouGoLine(result, sn, strategyNote);
    const lines = contextLines(result, sn);
    const notes = disclosureNotes(result, sn);
    const failed = !savingsAnswerClears(sn);

    return (
        <div className={`rounded-2xl border p-6 ${TONE_BOX[c.tone]}`}>
            <p className={`text-base font-bold ${TONE_TITLE[c.tone]}`}>{c.title}</p>
            {c.lead && <p className={`mt-1.5 text-sm font-medium ${TONE_BODY[c.tone]}`}>{c.lead}</p>}
            {c.sub && <p className={`mt-1 text-sm ${TONE_BODY[c.tone]} opacity-90`}>{c.sub}</p>}
            {c.fix && <p className={`mt-1.5 text-sm ${TONE_BODY[c.tone]}`}>{c.fix}</p>}
            {failed && fixLink && <div className={`mt-1.5 text-sm ${TONE_BODY[c.tone]}`}>{fixLink}</div>}
            {strategyNote && <p className={`mt-2 text-sm ${TONE_BODY[c.tone]}`}>{strategyNote}</p>}
            {saveAsYouGo && <p className={`mt-2 text-sm font-medium ${TONE_BODY[c.tone]}`}>{saveAsYouGo}</p>}
            {lines.length > 0 && (
                <div className="mt-2 space-y-1">
                    {lines.map(l => (
                        <p key={l} className={`text-sm ${TONE_BODY[c.tone]}`}>{l}</p>
                    ))}
                </div>
            )}
            <ul className="mt-3 space-y-1">
                {notes.map(n => (
                    <li key={n} className="text-xs text-slate-600 leading-relaxed">{n}</li>
                ))}
            </ul>
        </div>
    );
}
