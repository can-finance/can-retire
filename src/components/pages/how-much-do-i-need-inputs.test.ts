import { describe, it, expect } from 'vitest';
import {
    buildNeedInputs,
    initialNeedForm,
    needFormErrors,
} from './how-much-do-i-need-inputs';
import type { NeedForm } from './how-much-do-i-need-inputs';
import { buildRetireInputs, initialRetireForm } from './when-can-i-retire-inputs';
import { INITIAL_INPUTS, sanitizeSimulationInputs } from '../../utils/inputSanitizer';

const form = (over: Partial<NeedForm> = {}): NeedForm => ({ ...initialNeedForm(), ...over });

const nonRegTotal = (accts: { balance: number }[]) => accts.reduce((s, a) => s + a.balance, 0);

describe('/how-much-do-i-need-to-retire/ form → plan', () => {
    it('starts from the planner’s sample plan, retiring at 65, with no pension', () => {
        const f = initialNeedForm();
        expect(f.age).toBe(INITIAL_INPUTS.person.age);
        expect(f.rrsp).toBe(INITIAL_INPUTS.person.rrsp.balance);
        expect(f.postRetirementSpend).toBe(INITIAL_INPUTS.postRetirementSpend);
        expect(f.includeSpouse).toBe(false);
        expect(f.hasPension).toBe(false);
        // 65, or the current age (retiring now) for someone already past it.
        expect(f.retirementAge).toBe(Math.max(INITIAL_INPUTS.person.age, 65));
        expect(needFormErrors(f)).toEqual([]);
        // No target age here: the retirement age is the input.
        expect('targetAge' in f).toBe(false);
    });

    it('carries every answer into the plan and leaves the rest on the planner defaults', () => {
        const f = form({
            age: 52, retirementAge: 60, currentIncome: 110_000, province: 'BC',
            rrsp: 400_000, tfsa: 90_000, nonReg: 60_000,
            preRetirementSpend: 70_000, postRetirementSpend: 62_000,
        });
        const plan = buildNeedInputs(f);
        expect(plan.person.age).toBe(52);
        expect(plan.person.retirementAge).toBe(60);
        expect(plan.person.currentIncome).toBe(110_000);
        expect(plan.province).toBe('BC');
        expect(plan.person.rrsp.balance).toBe(400_000);
        expect(plan.person.tfsa.balance).toBe(90_000);
        expect(nonRegTotal(plan.person.nonRegisteredAccounts)).toBe(60_000);
        expect(plan.preRetirementSpend).toBe(70_000);
        expect(plan.postRetirementSpend).toBe(62_000);
        // Not asked: planner defaults.
        expect(plan.returnRates).toEqual(INITIAL_INPUTS.returnRates);
        expect(plan.inflationRate).toBe(INITIAL_INPUTS.inflationRate);
        expect(plan.person.cppContributedYears).toBe(INITIAL_INPUTS.person.cppContributedYears);
        expect(plan.person.lifeExpectancy).toBe(90);
        expect(plan.spouse).toBeUndefined();
        // Like the earliest-age page: no early RRSP withdrawals to start from.
        expect(plan.person.rrspMeltAmount).toBe(0);
        expect(sanitizeSimulationInputs(plan)).not.toBeNull();
    });

    it('builds the same plan as the earliest-age page when the target is the retirement age', () => {
        const need = buildNeedInputs(form({ age: 48, retirementAge: 58 }));
        const retire = buildRetireInputs({ ...initialRetireForm(), age: 48, targetAge: 58 });
        expect(need).toEqual(retire);
    });

    it('lets you retire now: a retirement age equal to your age builds a valid plan', () => {
        const f = form({ age: 67, retirementAge: 67 });
        expect(needFormErrors(f)).toEqual([]);
        const plan = buildNeedInputs(f);
        expect(plan.person.retirementAge).toBe(67);
        expect(sanitizeSimulationInputs(plan)).not.toBeNull();
    });

    it('adds a workplace pension only when switched on, rising with inflation', () => {
        const off = buildNeedInputs(form({ hasPension: false, pensionAmount: 30_000, pensionStartAge: 60 }));
        expect(off.person.pension).toBeUndefined();
        const on = buildNeedInputs(form({ hasPension: true, pensionAmount: 30_000, pensionStartAge: 60 }));
        expect(on.person.pension).toEqual({ annualAmount: 30_000, startAge: 60, indexedToInflation: true });
    });

    describe('spouse', () => {
        const couple = (over: Partial<NeedForm> = {}) => form({
            includeSpouse: true, spouseAge: 46, spouseIncome: 60_000,
            spouseRrsp: 150_000, spouseTfsa: 40_000, spouseNonReg: 10_000,
            ...over,
        });

        it('carries the spouse’s numbers, with no early RRSP withdrawals', () => {
            const plan = buildNeedInputs(couple({ spouseHasPension: true, spousePensionAmount: 15_000, spousePensionStartAge: 62 }));
            const s = plan.spouse!;
            expect(s.age).toBe(46);
            expect(s.currentIncome).toBe(60_000);
            expect(s.rrsp.balance).toBe(150_000);
            expect(s.tfsa.balance).toBe(40_000);
            expect(nonRegTotal(s.nonRegisteredAccounts)).toBe(10_000);
            expect(s.pension).toEqual({ annualAmount: 15_000, startAge: 62, indexedToInflation: true });
            expect(s.rrspMeltAmount).toBe(0);
        });

        it('with income, retires at the same age as you, or now if already past it', () => {
            expect(buildNeedInputs(couple({ age: 48, retirementAge: 60 })).spouse!.retirementAge).toBe(60);
            expect(buildNeedInputs(couple({ age: 48, retirementAge: 60, spouseAge: 63 })).spouse!.retirementAge).toBe(63);
        });

        it('with no income, counts as already retired', () => {
            expect(buildNeedInputs(couple({ spouseIncome: 0 })).spouse!.retirementAge).toBe(46);
        });

        it('ignores spouse fields when no spouse is included', () => {
            expect(buildNeedInputs(couple({ includeSpouse: false, spouseHasPension: true, spousePensionAmount: 15_000 })).spouse).toBeUndefined();
        });
    });

    describe('errors', () => {
        it('needs a retirement age from your current age (inclusive) to 99', () => {
            expect(needFormErrors(form({ age: 50, retirementAge: 49 }))).toEqual(['Your retirement age must be between 50 and 99']);
            expect(needFormErrors(form({ age: 50, retirementAge: 100 }))).toHaveLength(1);
            expect(needFormErrors(form({ age: 50, retirementAge: NaN }))).toHaveLength(1);
            expect(needFormErrors(form({ age: 50, retirementAge: 50 }))).toEqual([]);
            expect(needFormErrors(form({ age: 50, retirementAge: 99 }))).toEqual([]);
        });

        it('uses onboarding’s age checks for you and your spouse', () => {
            expect(needFormErrors(form({ age: 17, retirementAge: 65 }))).toHaveLength(1);
            expect(needFormErrors(form({ includeSpouse: true, spouseAge: 120 }))).toHaveLength(1);
            expect(needFormErrors(form({ includeSpouse: false, spouseAge: 120 }))).toEqual([]);
        });
    });
});
