import type { ReactNode } from 'react';
import type { SimulationInputs } from '../../engine/types';
import type { SavingsNeededResult } from '../../utils/meltdownOptimizer';
import { formatCurrencyApprox, formatCurrencyCAD, roundCurrencyApprox } from '../../utils/formatters';
import { savingsAnswerClears, savingsStrategyNote } from './savingsNeededSummary';
import type { SavingsAnswer } from './savingsNeededSummary';

/*
 * The answer box for the "How much do I need to retire?" search: the amount,
 * how it compares with what you have, the success rate at that amount, your
 * odds today, the bad-markets line, how the amount splits across accounts and
 * the disclosure notes. Pure presentation over the optimizer's savings-needed
 * result, so the in-app optimizer and the landing page render the same words
 * from the same data — the "To get there: …" line included (see
 * savingsStrategyNote).
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

function pct(rate: number | null): string {
    return rate === null ? '—' : `${rate.toFixed(0)}%`;
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
                ? 'Spend less or retire later to close the gap: try “Spend the most in retirement” or “Retire as early as possible”.'
                : 'Spend less to close the gap: try “Spend the most in retirement”.';
        if (sn.status === 'unreachable') {
            return {
                tone: 'warn',
                title: 'Savings alone can’t fund this spending',
                lead: `We tried savings of up to ${money(sn.searchCap)}, and your money still runs out before the end of the plan at ${spend}, even with average returns every year.`,
                fix,
            };
        }
        const best = `With ${money(sn.neededSavings!)}, the best we found, your money lasts in ${pct(sn.achievedSuccessRate)} of market simulations at ${spend}.`;
        return {
            tone: 'warn',
            title: `Savings alone can’t fund this spending at your ${target}% target`,
            lead: sn.boundHit
                ? `We tried savings of up to ${money(sn.searchCap)}. ${best}`
                : `The calculator stopped checking before any amount reached your target. ${best}`,
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
                        ? `That’s like having ${money(needed)} today instead of the ${money(current)} you have now.`
                        : `That’s like having ${money(needed)} saved today.`,
                };
            }
        }
        // Already retired (or retiring now): today's amount is the one that matters.
        const gap = roundCurrencyApprox(needed) - roundCurrencyApprox(current);
        return {
            tone: 'warn',
            title: current > 0 && gap > 0
                ? `You need about ${money(needed)} saved — about ${money(gap)} more than you have`
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
            lead: `As entered, your money lasts in ${pct(r.baselineSuccessRate)} of market simulations, under your ${target}% target. Separate runs of market simulations differ by a few points, so this is about as close as the calculator can tell.`,
        };
    }

    if (sn.needIsZero) {
        const income = guaranteedIncome(r.baselineInputs);
        const cushion = current > 0 ? ` The ${money(current)} you have saved is extra cushion.` : '';
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
        ? `As it stands, your plan falls short of your ${target}% target. With the changes below, your`
        : 'Your';
    return {
        tone: 'good',
        title: sn.strategyChangeNeeded ? `You have enough ${enoughFor} — with the changes below` : `You have enough ${enoughFor}`,
        lead: pctLower < 1
            ? `${changes} savings are about what it takes for your money to last in at least ${target}% of market simulations, with little to spare.`
            : `${changes} savings could be about ${pctLower}% lower (about ${money(needed)} instead of ${money(current)}) and still last in at least ${target}% of market simulations.`,
    };
}

// The lines under a found answer: the odds at the answer, your odds today,
// how the amount splits, and the bad-markets line.
function contextLines(r: SavingsAnswer, sn: SavingsNeededResult): string[] {
    if (!savingsAnswerClears(sn)) return [];
    const out: string[] = [];
    const target = sn.mcSuccessTarget;
    const spend = `${formatCurrencyCAD(sn.postRetirementSpend)}/yr`;

    out.push(sn.needIsZero
        ? `With no savings, your spending is covered in ${pct(sn.achievedSuccessRate)} of market simulations at ${spend} (your target: ${target}%).`
        : `With the savings needed, your money lasts in ${pct(sn.achievedSuccessRate)} of market simulations at ${spend} (your target: ${target}%).`);

    const today = r.baselineSuccessRate;
    if (!isNoise(r, sn) && today !== null && sn.achievedSuccessRate !== null
        && Math.abs(today - sn.achievedSuccessRate) >= ODDS_GAP_PP) {
        out.push(`Your odds today, with what you have saved: ${pct(today)}.`);
    }

    const split = splitLine(sn);
    if (split) out.push(split);

    out.push(sn.badMarketsAge === null
        ? 'In the worst 5% of market simulations, your money still lasts the whole plan.'
        : `In the worst 5% of market simulations, your money lasts ${sn.reportedWho === 'spouse'
            ? `until your spouse is about ${sn.badMarketsAge}`
            : `until you’re about ${sn.badMarketsAge}`}.`);
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
        out.push('The calculator stopped checking before narrowing it down, so this amount may be a little more than you need.');
    }
    if (!sn.needIsZero) {
        if (sn.basis === 'default') {
            const couple = !!r.baselineInputs.spouse;
            out.push(`You have no savings entered, so this assumes a TFSA first, up to the room you could have built up by now, then an RRSP${couple ? ', split evenly between you and your spouse' : ''}.`);
        } else {
            out.push('This keeps the mix of RRSP, TFSA and non-registered savings you have now, scaled to the amount.');
        }
    }
    out.push('All amounts are in today’s dollars.');
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
