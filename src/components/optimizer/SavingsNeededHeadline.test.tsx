// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SavingsNeededHeadline } from './SavingsNeededHeadline';
import type { SavingsAnswer } from './savingsNeededSummary';
import type { PersonMeltdownDecision, SavingsNeededResult } from '../../utils/meltdownOptimizer';
import { INITIAL_INPUTS } from '../../utils/inputSanitizer';
import { formatCurrencyApprox } from '../../utils/formatters';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

// Which claims the answer box makes in each state, not how it looks. Results
// are hand-built fixtures: no solver runs.

// A single person, 50 today, retiring at 60 with $500k saved, who needs $700k
// today — about $1.2M by 60, against the $850k they're on track for.
const sn = (over: Partial<SavingsNeededResult> = {}): SavingsNeededResult => ({
    status: 'found', basis: 'proportional',
    currentSavings: 500_000, neededSavings: 700_000, deterministicSavings: 650_000,
    searchCap: 10_000_000, savingsGap: 200_000,
    haveEnough: false, needIsZero: false, strategyChangeNeeded: false,
    neededAccounts: [{ who: 'person', label: 'You', rrsp: 420_000, tfsa: 210_000, nonReg: 70_000, total: 700_000 }],
    stillWorking: true, reportedWho: 'person', currentAge: 50, retirementAge: 60,
    neededAtRetirement: 1_203_000, currentAtRetirement: 851_000,
    mcSuccessTarget: 85, achievedSuccessRate: 87, stepUpCapHit: false, boundHit: false,
    postRetirementSpend: 60_000, withdrawalStrategy: 'tax-efficient', strategyChanged: false,
    badMarketsAge: null,
    ...over,
});

const answer = (over: Partial<SavingsNeededResult> = {}, rest: Partial<SavingsAnswer> = {}): SavingsAnswer => {
    const baselineInputs = structuredClone(INITIAL_INPUTS);
    baselineInputs.person.pension = undefined;
    return { savingsNeeded: sn(over), baselineInputs, baselineSuccessRate: 62, decisions: [], ...rest };
};

const withPension = (): SavingsAnswer['baselineInputs'] => {
    const inputs = structuredClone(INITIAL_INPUTS);
    inputs.person.pension = { annualAmount: 30_000, startAge: 60, indexedToInflation: true };
    return inputs;
};

const decision = (over: Partial<PersonMeltdownDecision> = {}): PersonMeltdownDecision => ({
    who: 'person', label: 'You', hasRrsp: true,
    meltAmount: 0, meltStartAge: 60, meltEndAge: 71,
    originalMeltAmount: 0, originalMeltStartAge: 60,
    cppStartAge: 65, cppChanged: false, originalCppStartAge: 65,
    oasStartAge: 65, oasChanged: false, originalOasStartAge: 65,
    ...over,
});
const cppTo70 = [decision({ cppStartAge: 70, cppChanged: true })];

const textOf = (r: SavingsAnswer, spendTip?: string, fixLink?: ReactNode): string =>
    render(<SavingsNeededHeadline result={r} spendTip={spendTip} fixLink={fixLink} />).container.textContent ?? '';

describe('formatCurrencyApprox: the rounding every headline amount uses', () => {
    it.each([
        [1_234_567, '$1.23M'], [1_200_000, '$1.2M'], [2_000_000, '$2M'], [995_000, '$1M'],
        [853_421, '$850k'], [99_600, '$100k'], [45_400, '$45k'], [400, '$0'], [-353_000, '-$350k'],
    ])('%d → %s', (v, s) => {
        expect(formatCurrencyApprox(v)).toBe(s);
    });
});

describe('SavingsNeededHeadline: need more', () => {
    it('leads with the amount at retirement, then today’s equivalent', () => {
        const text = textOf(answer());
        expect(text).toContain('You need about $1.2M saved by 60');
        expect(text).toContain('You’re on track for about $850k, so about $350k more.');
        expect(text).toContain('That’s like having $700k today instead of the $500k you have now.');
        expect(text).toContain('With the savings needed, your money lasts in 87% of market simulations at $60,000/yr (your target: 85%).');
        expect(text).toContain('Your odds today, with what you have saved: 62%.');
        expect(text).toContain('How that splits: RRSP $420k · TFSA $210k · Non-registered $70k');
        expect(text).toContain('In the worst 5% of market simulations, your money still lasts the whole plan.');
        expect(text).toContain('keeps the mix of RRSP, TFSA and non-registered savings you have now');
    });

    it('frames it on the spouse’s retirement when only they still work', () => {
        const text = textOf(answer({ reportedWho: 'spouse', badMarketsAge: 84 }));
        expect(text).toContain('You need about $1.2M saved when your spouse retires at 60');
        expect(text).toContain('your money lasts until your spouse is about 84.');
    });

    it('uses today’s amount when already retired', () => {
        const retired = { stillWorking: false, retirementAge: null, neededAtRetirement: null, currentAtRetirement: null };
        expect(textOf(answer(retired))).toContain('You need about $700k saved — about $200k more than you have');
    });

    it('drops "more than you have" when nothing is saved, and says which mix it assumed', () => {
        const text = textOf(answer({
            stillWorking: false, retirementAge: null, neededAtRetirement: null, currentAtRetirement: null,
            currentSavings: 0, basis: 'default',
        }));
        expect(text).toContain('You need about $700k saved');
        expect(text).not.toContain('more than you have');
        expect(text).toContain('You have no savings entered, so this assumes a TFSA first');
    });

    it('carries the strategy the amount assumes', () => {
        expect(textOf(answer({}, { decisions: cppTo70 }))).toContain('To get there: start your CPP at 70 instead of 65.');
    });

    it('splits per person when the spouse holds part of it, leaving out empty accounts', () => {
        const text = textOf(answer({
            neededAccounts: [
                { who: 'person', label: 'You', rrsp: 400_000, tfsa: 100_000, nonReg: 0, total: 500_000 },
                { who: 'spouse', label: 'Spouse', rrsp: 0, tfsa: 200_000, nonReg: 0, total: 200_000 },
            ],
        }));
        expect(text).toContain('How that splits: You: RRSP $400k · TFSA $100k; Spouse: TFSA $200k');
        expect(text).not.toContain('Non-registered $0');
    });
});

describe('SavingsNeededHeadline: have enough', () => {
    const enough = { haveEnough: true, neededSavings: 440_000, savingsGap: -60_000 };

    it('says how much lower the savings could be', () => {
        const text = textOf(answer(enough, { baselineSuccessRate: 95 }));
        expect(text).toContain('You have enough to retire at 60');
        expect(text).toContain('Your savings could be about 12% lower (about $440k instead of $500k) and still last in at least 85% of market simulations.');
        expect(text).not.toContain('To get there');
    });

    it('says "to fund your retirement" when already retired', () => {
        const text = textOf(answer({ ...enough, stillWorking: false, retirementAge: null }, { baselineSuccessRate: 95 }));
        expect(text).toContain('You have enough to fund your retirement');
    });

    it('needs the changes when the plan as entered misses the bar', () => {
        const text = textOf(answer({ ...enough, strategyChangeNeeded: true }, { baselineSuccessRate: 78, decisions: cppTo70 }));
        expect(text).toContain('You have enough to retire at 60 — with the changes below');
        expect(text).toContain('As it stands, your plan falls short of your 85% target. With the changes below, your savings could be about 12% lower');
        expect(text).toContain('To get there: start your CPP at 70 instead of 65.');
        expect(text).toContain('Your odds today, with what you have saved: 78%.');
    });

    it('says "about enough" when only market-simulation noise separates the two', () => {
        // Same strategy, no more savings, yet the plan as entered scored 83%.
        const text = textOf(answer(enough, { baselineSuccessRate: 83, decisions: cppTo70 }));
        expect(text).toContain('You have about enough to retire at 60');
        expect(text).toContain('As entered, your money lasts in 83% of market simulations, under your 85% target.');
        expect(text).not.toContain('could be about');
        expect(text).not.toContain('Your odds today');
        expect(text).not.toContain('To get there');
    });
});

describe('SavingsNeededHeadline: no savings needed', () => {
    const zero = { haveEnough: true, needIsZero: true, neededSavings: 0, neededAccounts: [] };

    it('still working: pay before retiring plus CPP and OAS covers it', () => {
        const text = textOf(answer(zero, { baselineSuccessRate: 99 }));
        expect(text).toContain('You don’t need any savings today');
        expect(text).toContain('What you save from your pay before retiring at 60, plus CPP and OAS, covers your spending.');
        expect(text).toContain('The $500k you have saved is extra cushion.');
        expect(text).not.toContain('How that splits');
        expect(text).not.toContain('keeps the mix');
    });

    it('says when it only works with the changes', () => {
        const text = textOf(answer({ ...zero, strategyChangeNeeded: true }, { baselineSuccessRate: 80, decisions: cppTo70 }));
        expect(text).toContain('With the changes below, what you save from your pay before retiring at 60');
        expect(text).toContain('To get there: start your CPP at 70 instead of 65.');
    });

    it('names the pension when there is one', () => {
        const text = textOf(answer(zero, { baselineSuccessRate: 99, baselineInputs: withPension() }));
        expect(text).toContain('plus CPP, OAS and your pension, covers your spending.');
    });

    it('retired: CPP and OAS (and a pension) cover it on their own', () => {
        const retired = { ...zero, stillWorking: false, retirementAge: null };
        expect(textOf(answer(retired, { baselineSuccessRate: 99 }))).toContain('CPP and OAS cover your spending on their own');
        cleanup();
        expect(textOf(answer(retired, { baselineSuccessRate: 99, baselineInputs: withPension() })))
            .toContain('CPP, OAS and your pension cover your spending on their own');
    });
});

describe('SavingsNeededHeadline: no amount works', () => {
    const unreachable = {
        status: 'unreachable' as const, neededSavings: null, deterministicSavings: null, savingsGap: null,
        neededAccounts: [], neededAtRetirement: null, achievedSuccessRate: null,
    };

    it('unreachable: says what was tried and points at the optimizer goals', () => {
        const text = textOf(answer(unreachable, { decisions: cppTo70 }));
        expect(text).toContain('Savings alone can’t fund this spending');
        expect(text).toContain('We tried savings of up to $10M, and your money still runs out before the end of the plan at $60,000/yr');
        expect(text).toContain('“Spend the most in retirement” or “Retire as early as possible”');
        expect(text).not.toContain('market simulations at $60,000/yr (your target');
        expect(text).not.toContain('To get there');
    });

    it('uses the page’s own tip and link when given', () => {
        const text = textOf(answer(unreachable), 'try lower spending after retirement or a later retirement age', <a href="/when-can-i-retire/">Find the earliest age</a>);
        expect(text).toContain('Try lower spending after retirement or a later retirement age.');
        expect(text).toContain('Find the earliest age');
        expect(text).not.toContain('Spend the most in retirement');
    });

    it('bound hit: gives the best result found and suggests a lower target', () => {
        const text = textOf(answer({ boundHit: true, neededSavings: 10_000_000, achievedSuccessRate: 72 }));
        expect(text).toContain('Savings alone can’t fund this spending at your 85% target');
        expect(text).toContain('We tried savings of up to $10M. With $10M, the best we found, your money lasts in 72% of market simulations');
        expect(text).toContain('Or choose a lower target.');
        expect(text).not.toContain('You need about');
    });

    it('a probe budget that ran out short of the bar reads like a bound hit', () => {
        const text = textOf(answer({ stepUpCapHit: true, achievedSuccessRate: 80 }));
        expect(text).toContain('Savings alone can’t fund this spending at your 85% target');
        expect(text).toContain('The calculator stopped checking before any amount reached your target.');
    });

    it('a probe budget that ran out after clearing the bar is still an answer', () => {
        const text = textOf(answer({ stepUpCapHit: true, achievedSuccessRate: 86 }));
        expect(text).toContain('You need about $1.2M saved by 60');
        expect(text).toContain('may be a little more than you need');
    });
});
