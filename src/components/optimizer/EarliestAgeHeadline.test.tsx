// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EarliestAgeHeadline } from './EarliestAgeHeadline';
import { EarliestAgeTable } from './EarliestAgeTable';
import type { EarliestAgeComparison } from './EarliestAgeHeadline';
import type { EarliestAgeResult, EarliestAgeRow } from '../../utils/meltdownOptimizer';

// React's act() warns unless it knows it's running in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

// Which claims the answer box makes, not how it looks: every sentence has to be
// one the result can back up.

const row = (delta: number, over: Partial<EarliestAgeRow> = {}): EarliestAgeRow => ({
    delta, retirementAge: 60 + delta,
    successRate: 90, clearsTarget: true, deterministicFeasible: true,
    netEstate: 500_000, lifetimeTax: 300_000, couldSpend: null,
    isAnswer: false, isPlan: delta === 0,
    ...over,
});

// A single person, 50 today, planning to retire at 60, whose answer is 60.
const result = (over: Partial<EarliestAgeResult> = {}): EarliestAgeResult => ({
    status: 'found',
    reportedWho: 'person',
    people: [{
        who: 'person', label: 'You', currentAge: 50, planRetirementAge: 60,
        answerRetirementAge: 60, planCppYears: 35, answerCppYears: 35,
    }],
    currentAge: 50, planAge: 60, answerAge: 60, deltaYears: 0, deterministicAge: 60,
    minAge: 50, maxAge: 75, retiresNow: false, atLowerBound: false,
    mcSuccessTarget: 85, achievedSuccessRate: 90, stepUpCapHit: false, boundHit: false,
    onTrack: true, strategyChangeNeeded: false,
    postRetirementSpend: 50_000, cppOverrideHeld: false, pensionHeld: false,
    withdrawalStrategy: 'tax-efficient', strategyChanged: false,
    rows: [
        row(-2, { successRate: 55, clearsTarget: false, deterministicFeasible: false }),
        row(-1, { successRate: 70, clearsTarget: false, deterministicFeasible: false }),
        row(0, { isAnswer: true }),
        row(1), row(2),
    ],
    badMarketsAge: null,
    ...over,
});

const textOf = (r: EarliestAgeResult, compareTo?: EarliestAgeComparison, spendTip?: string): string =>
    render(<EarliestAgeHeadline result={r} compareTo={compareTo} spendTip={spendTip} />).container.textContent ?? '';

const YEAR_EARLIER = 'Retiring a year earlier would drop below';

describe('EarliestAgeHeadline: the "a year earlier" claim', () => {
    it('is made on track when the year before was tested and missed', () => {
        const text = textOf(result());
        expect(text).toContain('You can retire at 60 — right on your plan');
        expect(text).toContain(`${YEAR_EARLIER} your 85% target.`);
    });

    it('is not made when the year before actually cleared the bar', () => {
        const r = result({
            stepUpCapHit: true,
            rows: [row(-1, { successRate: 88, clearsTarget: true }), row(0, { isAnswer: true }), row(1)],
        });
        const text = textOf(r);
        expect(text).not.toContain(YEAR_EARLIER);
        expect(text).toContain('This is the earliest age at which your money lasts');
    });

    it('is not made when there is no tested year before', () => {
        const text = textOf(result({ rows: [row(0, { isAnswer: true }), row(1)] }));
        expect(text).not.toContain(YEAR_EARLIER);
    });

    it('is not made when retiring now — there is no earlier year', () => {
        const r = result({
            answerAge: 50, deltaYears: -10, retiresNow: true, atLowerBound: true, onTrack: false,
            people: [{ ...result().people[0], answerRetirementAge: 50 }],
            rows: [row(-10, { isAnswer: true }), row(-9), row(-8)],
        });
        const text = textOf(r);
        expect(text).toContain('You can retire now, at 50 — 10 years sooner than your plan');
        expect(text).toContain('even if you stop working now');
        expect(text).not.toContain(YEAR_EARLIER);
    });
});

describe('EarliestAgeHeadline: plan age that needs a different strategy', () => {
    it('says the age works only with the changes', () => {
        const text = textOf(result({ strategyChangeNeeded: true }));
        expect(text).toContain('You can retire at 60, right on your plan — with the changes below');
        expect(text).toContain('As it stands, your plan falls short of your 85% target');
        expect(text).not.toContain(YEAR_EARLIER);
    });
});

describe('EarliestAgeHeadline: what the answer is compared with', () => {
    const sooner = () => result({
        answerAge: 58, deltaYears: -2, onTrack: false,
        people: [{ ...result().people[0], answerRetirementAge: 58 }],
    });

    it('defaults to the plan (the optimizer’s wording)', () => {
        expect(textOf(sooner())).toContain('You can retire at 58 — 2 years sooner than your plan');
    });

    it('can compare with a target instead', () => {
        expect(textOf(sooner(), 'target')).toContain('You can retire at 58 — 2 years sooner than your target');
    });

    it('can leave the comparison out when there is nothing to compare with', () => {
        const later = result({
            answerAge: 63, deltaYears: 3, onTrack: false,
            people: [{ ...result().people[0], answerRetirementAge: 63 }],
        });
        const text = textOf(later, 'none');
        expect(text).toContain('You can retire at 63');
        expect(text).not.toMatch(/later than|sooner than|right on/);
    });

    it('points at the page’s own tip instead of the optimizer goal when given one', () => {
        const unreachable = result({ status: 'unreachable', answerAge: null, deltaYears: null, rows: [] });
        expect(textOf(unreachable)).toContain('Spend the most in retirement');
        const text = textOf(unreachable, 'none', 'try lower spending after retirement');
        expect(text).toContain('Try lower spending after retirement.');
        expect(text).not.toContain('Spend the most in retirement');
    });
});

describe('EarliestAgeHeadline: couples retiring "now"', () => {
    it('only says "you and your spouse … now" when the spouse is that age today too', () => {
        const spouse = {
            who: 'spouse' as const, label: 'Spouse', currentAge: 48, planRetirementAge: 60,
            answerRetirementAge: 52, planCppYears: 30, answerCppYears: 22,
        };
        const base = {
            answerAge: 52, deltaYears: -8, retiresNow: true, atLowerBound: true, onTrack: false,
            currentAge: 52,
            rows: [row(-8, { isAnswer: true })],
        };
        // You are 52 and stop now; your spouse is 48 and stops at 52, in 4 years.
        const apart = textOf(result({
            ...base,
            people: [{ ...result().people[0], currentAge: 52, answerRetirementAge: 52 }, spouse],
        }));
        expect(apart).toContain('You can retire now, at 52 (your spouse at 52)');
        expect(apart).not.toContain('You and your spouse can retire now');

        // Both 52 today: you really do stop together.
        const together = textOf(result({
            ...base,
            people: [
                { ...result().people[0], currentAge: 52, answerRetirementAge: 52 },
                { ...spouse, currentAge: 52 },
            ],
        }));
        expect(together).toContain('You and your spouse can retire now, at 52');
        expect(together).toContain('even if you both stop working now');
    });
});

// The ✓/✗ marks compare the unrounded rate with the target; the shown percent
// must never say otherwise, and the headline and table must agree.
describe('success rates never contradict the target', () => {
    const tableText = (r: EarliestAgeResult): string[] => {
        const { container } = render(<EarliestAgeTable result={r} />);
        return [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');
    };

    it('a rate just under the target is shown below it, in the table and the headline', () => {
        const r = result({
            boundHit: true, achievedSuccessRate: 84.6,
            rows: [row(0, { isAnswer: true, successRate: 84.6, clearsTarget: false })],
        });
        const [only] = tableText(r);
        expect(only).toContain('✗ 84%');
        expect(only).not.toContain('85%');
        cleanup();
        const text = textOf(r);
        expect(text).toContain('lasts in 84% of market simulations');
    });

    it('a rate exactly at the target shows the target with a ✓', () => {
        const r = result({
            achievedSuccessRate: 85,
            rows: [row(0, { isAnswer: true, successRate: 85, clearsTarget: true })],
        });
        expect(tableText(r)[0]).toContain('✓ 85%');
        cleanup();
        expect(textOf(r)).toContain('lasts in 85% of market simulations');
    });

    it('marks ages skipped between the target row and the rows around the answer', () => {
        const r = result({
            answerAge: 65, deltaYears: 5, onTrack: false,
            rows: [row(0, { successRate: 40, clearsTarget: false }), row(3), row(4), row(5, { isAnswer: true })],
        });
        const rows = tableText(r);
        expect(rows).toHaveLength(5);
        expect(rows[0]).toContain('60');
        expect(rows[1].trim()).toBe('⋯');
        expect(rows[2]).toContain('63');
    });
});
