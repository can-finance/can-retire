import type { ReactNode } from 'react';
import type { EarliestAgeResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyCAD, formatSuccessRate } from '../../utils/formatters';

/*
 * The answer box for the "When can I retire?" search: the age, how it compares
 * with the plan, the success rate at the planned spending, the bad-markets line
 * and the disclosure notes. Pure presentation over EarliestAgeResult, so the
 * in-app optimizer and the landing page render the same words from the same
 * data. `strategyNote` slots in under the headline (the optimizer passes a
 * one-line summary of the CPP/melt/order changes).
 */

type Tone = 'good' | 'warn' | 'muted';

const TONE_BOX: Record<Tone, string> = {
    good: 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50',
    warn: 'border-amber-200 bg-amber-50',
    muted: 'border-slate-200 bg-slate-50',
};
const TONE_TITLE: Record<Tone, string> = {
    good: 'text-emerald-900',
    warn: 'text-amber-900',
    muted: 'text-slate-900',
};
const TONE_BODY: Record<Tone, string> = {
    good: 'text-emerald-800',
    warn: 'text-amber-800',
    muted: 'text-slate-600',
};

function years(n: number): string {
    return `${n} ${n === 1 ? 'year' : 'years'}`;
}

function pct(rate: number | null, target?: number): string {
    return formatSuccessRate(rate, target);
}

interface Copy {
    tone: Tone;
    title: string;
    body?: string;
    successLine?: string;
    notes: string[];
}

/**
 * What the headline compares the answer with: the plan's own retirement age
 * (the optimizer), a target age the visitor typed in (the landing page), or
 * nothing at all (the landing page with no target — the plan's age there is
 * just a default, so "sooner than your plan" would mean nothing).
 */
export type EarliestAgeComparison = 'plan' | 'target' | 'none';

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function headlineCopy(r: EarliestAgeResult, compareTo: EarliestAgeComparison, spendTip?: string): Copy {
    const spend = `${formatCurrencyCAD(r.postRetirementSpend)}/yr`;
    const isSpouse = r.reportedWho === 'spouse';
    const subject = isSpouse ? 'Your spouse' : 'You';
    const MAX_SPEND = '“Spend the most in retirement”';

    if (r.status === 'unavailable') {
        return r.unavailableReason === 'no-common-range'
            ? {
                tone: 'muted',
                title: 'Your retirement ages can’t move together',
                body: 'Both retirement ages move by the same number of years, and your ages leave no room to do that. Change one of the retirement ages and try again.',
                notes: [],
            }
            : {
                tone: 'muted',
                title: 'Everyone in this plan is already retired',
                body: `There’s no retirement age left to move. Try ${MAX_SPEND} to see what your savings can support.`,
                notes: [],
            };
    }

    if (r.status === 'unreachable') {
        return {
            tone: 'warn',
            title: `Your plan can’t fund ${spend} at any retirement age up to ${r.maxAge}`,
            body: `Even if ${isSpouse ? 'your spouse works' : 'you work'} until ${r.maxAge}, your money runs out before the end of the plan at this spending. ${spendTip ? `${capitalize(spendTip)}.` : `Try ${MAX_SPEND} to see how much your savings can support.`}`,
            notes: [],
        };
    }

    const age = r.answerAge!;
    const delta = r.deltaYears!;
    const target = r.mcSuccessTarget;
    const notes: string[] = [];

    if (r.boundHit) {
        return {
            tone: 'warn',
            title: `Even retiring at ${age}, your plan falls short of your ${target}% target`,
            body: `At ${age}, your money lasts in ${pct(r.achievedSuccessRate, target)} of market simulations at ${spend}. Choose a lower target, or ${spendTip ?? `try ${MAX_SPEND} to see what spending your savings can support`}.`,
            notes,
        };
    }

    // Both people move (only possible when the primary is the reported one):
    // name the spouse too — together when they land on the same age. "Now"
    // is only together when the spouse is also that age today; otherwise the
    // spouse reaches it later, so name their age separately.
    const other = r.people.find(p => p.who !== r.reportedWho && p.answerRetirementAge !== null);
    const together = other !== undefined && other.answerRetirementAge === age
        && (!r.retiresNow || other.currentAge === r.currentAge);
    const who = together ? 'You and your spouse' : subject;
    const otherPart = other && !together ? ` (your spouse at ${other.answerRetirementAge})` : '';
    const when = r.retiresNow ? `now, at ${age}` : `at ${age}`;
    const ref = compareTo === 'target' ? 'your target' : 'your plan';
    const comparison = compareTo === 'none'
        ? null
        : delta < 0
            ? `${years(-delta)} sooner than ${ref}`
            : delta > 0
                ? `${years(delta)} later than ${ref}`
                : `right on ${ref}`;
    // The plan's own age, but only with a different strategy: say so up front.
    const title = r.strategyChangeNeeded
        ? `${who} can retire ${when}${otherPart}${comparison ? `, ${comparison}` : ''} — with the changes below`
        : `${who} can retire ${when}${otherPart}${comparison ? ` — ${comparison}` : ''}`;

    // At the lower bound without retiring now, the spouse is the one already
    // at today's age (a spouse-only search always retires "now" at its bound).
    if (r.atLowerBound && !r.retiresNow) {
        notes.push('That’s as early as it can go: it has your spouse retiring right away.');
    }
    if (r.stepUpCapHit) {
        notes.push('The calculator stopped checking before narrowing it down, so this age may be a year or so later than you need.');
    }

    return {
        // Later than a chosen age is a warning; with nothing to compare against
        // there is no "later" to warn about.
        tone: delta > 0 && compareTo !== 'none' ? 'warn' : 'good',
        title,
        body: answerBody(r, together),
        successLine: `Your money lasts in ${pct(r.achievedSuccessRate, target)} of market simulations at ${spend} (your target: ${target}%).`,
        notes,
    };
}

// The line under a found answer. Each claim is one the result can back up:
// "a year earlier would drop below" only when that year was actually tested
// and missed (it may not exist — retiring now has no earlier year).
function answerBody(r: EarliestAgeResult, together: boolean): string {
    const target = r.mcSuccessTarget;
    if (r.strategyChangeNeeded) {
        return `As it stands, your plan falls short of your ${target}% target at this age. With the changes below, it meets it.`;
    }
    if (r.retiresNow) {
        const stop = r.reportedWho === 'spouse'
            ? 'your spouse stops'
            : together ? 'you both stop' : 'you stop';
        return `Your money lasts in at least ${target}% of market simulations even if ${stop} working now, spending the same amount each year (adjusted for inflation).`;
    }
    if (r.onTrack) {
        const yearEarlier = r.rows.find(row => row.delta === r.deltaYears! - 1);
        if (yearEarlier && !yearEarlier.clearsTarget) {
            return `Retiring a year earlier would drop below your ${target}% target.`;
        }
    }
    return `This is the earliest age at which your money lasts in at least ${target}% of market simulations, spending the same amount each year (adjusted for inflation).`;
}

function badMarketsLine(r: EarliestAgeResult): string | null {
    if (r.status !== 'found') return null;
    if (r.badMarketsAge === null) return 'In the worst 5% of market simulations, your money still lasts the whole plan.';
    const until = r.reportedWho === 'spouse'
        ? `until your spouse is about ${r.badMarketsAge}`
        : `until you’re about ${r.badMarketsAge}`;
    return `In the worst 5% of market simulations, your money lasts ${until}.`;
}

function disclosureNotes(r: EarliestAgeResult): string[] {
    if (r.status === 'unavailable') return [];
    const out: string[] = [];
    if (r.cppOverrideHeld) {
        out.push('Your CPP Calculator estimate changes with when CPP starts, but not with your retirement age here, so it may be a little high for an earlier age.');
    }
    if (r.pensionHeld) {
        out.push('This assumes your workplace pension amount doesn’t change with your retirement date.');
    }
    return out;
}

export function EarliestAgeHeadline({
    result, strategyNote, compareTo = 'plan', spendTip,
}: {
    result: EarliestAgeResult;
    strategyNote?: ReactNode;
    /** What the answer is compared with in the title (default: the plan's age). */
    compareTo?: EarliestAgeComparison;
    /**
     * Replaces the pointer to the optimizer's "Spend the most in retirement"
     * goal when no age works, for pages without that goal. A lowercase verb
     * phrase with no full stop, e.g. "try lower spending after retirement".
     */
    spendTip?: string;
}) {
    const c = headlineCopy(result, compareTo, spendTip);
    const bad = badMarketsLine(result);
    const notes = [...c.notes, ...disclosureNotes(result)];

    return (
        <div className={`rounded-2xl border p-6 ${TONE_BOX[c.tone]}`}>
            <p className={`text-base font-bold ${TONE_TITLE[c.tone]}`}>{c.title}</p>
            {c.successLine && (
                <p className={`mt-1.5 text-sm font-medium ${TONE_BODY[c.tone]}`}>{c.successLine}</p>
            )}
            {c.body && <p className={`mt-1.5 text-sm ${TONE_BODY[c.tone]}`}>{c.body}</p>}
            {strategyNote && <div className={`mt-2 text-sm ${TONE_BODY[c.tone]}`}>{strategyNote}</div>}
            {bad && <p className={`mt-2 text-sm ${TONE_BODY[c.tone]}`}>{bad}</p>}
            {notes.length > 0 && (
                <ul className="mt-3 space-y-1">
                    {notes.map(n => (
                        <li key={n} className="text-xs text-slate-600 leading-relaxed">{n}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
