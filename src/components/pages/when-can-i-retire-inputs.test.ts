import { describe, it, expect } from 'vitest';
import {
    buildRetireInputs,
    initialRetireForm,
    planRetirementAge,
    retireFormErrors,
    DEFAULT_PLAN_RETIREMENT_AGE,
} from './when-can-i-retire-inputs';
import type { RetireForm } from './when-can-i-retire-inputs';
import { INITIAL_INPUTS, sanitizeSimulationInputs } from '../../utils/inputSanitizer';
import { MAX_SEARCH_RETIREMENT_AGE, planAgeShift } from '../../utils/retirementAgeSearch';

const form = (over: Partial<RetireForm> = {}): RetireForm => ({ ...initialRetireForm(), ...over });

const nonRegTotal = (accts: { balance: number }[]) => accts.reduce((s, a) => s + a.balance, 0);

describe('/when-can-i-retire/ form → plan', () => {
    it('starts from the planner’s sample plan, with no target and no pension', () => {
        const f = initialRetireForm();
        expect(f.age).toBe(INITIAL_INPUTS.person.age);
        expect(f.rrsp).toBe(INITIAL_INPUTS.person.rrsp.balance);
        expect(f.postRetirementSpend).toBe(INITIAL_INPUTS.postRetirementSpend);
        expect(f.includeSpouse).toBe(false);
        expect(f.targetAge).toBeNull();
        expect(f.hasPension).toBe(false);
        expect(retireFormErrors(f)).toEqual([]);
    });

    it('carries every answer into the plan and leaves the rest on the planner defaults', () => {
        const f = form({
            age: 52, currentIncome: 110_000, province: 'BC',
            rrsp: 400_000, tfsa: 90_000, nonReg: 60_000,
            preRetirementSpend: 70_000, postRetirementSpend: 62_000,
        });
        const plan = buildRetireInputs(f);
        expect(plan.person.age).toBe(52);
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
        expect(plan.withdrawalStrategy).toBe(INITIAL_INPUTS.withdrawalStrategy);
        expect(plan.person.cppContributedYears).toBe(INITIAL_INPUTS.person.cppContributedYears);
        expect(plan.person.cppStartAge).toBe(65);
        expect(plan.person.lifeExpectancy).toBe(90);
        expect(plan.spouse).toBeUndefined();
        // Deliberate difference from onboarding: no early RRSP withdrawals to start from.
        expect(plan.person.rrspMeltAmount).toBe(0);
        // A valid plan the rest of the app accepts as-is.
        expect(sanitizeSimulationInputs(plan)).not.toBeNull();
    });

    it('uses the target as the plan’s retirement age, else 65, else a year from now', () => {
        expect(buildRetireInputs(form({ age: 48, targetAge: 58 })).person.retirementAge).toBe(58);
        expect(buildRetireInputs(form({ age: 48, targetAge: null })).person.retirementAge).toBe(DEFAULT_PLAN_RETIREMENT_AGE);
        expect(planRetirementAge({ age: 64, targetAge: null })).toBe(65);
        expect(planRetirementAge({ age: 65, targetAge: null })).toBe(66);
        expect(planRetirementAge({ age: 71, targetAge: null })).toBe(72);
        // Either way the person is still working, so the search has an age to move.
        for (const age of [30, 64, 65, 80]) {
            const plan = buildRetireInputs(form({ age }));
            expect(planAgeShift(plan).shifted).toContain('person');
        }
    });

    it('adds a workplace pension only when switched on, rising with inflation', () => {
        const off = buildRetireInputs(form({ hasPension: false, pensionAmount: 30_000, pensionStartAge: 60 }));
        expect(off.person.pension).toBeUndefined();
        const on = buildRetireInputs(form({ hasPension: true, pensionAmount: 30_000, pensionStartAge: 60 }));
        expect(on.person.pension).toEqual({ annualAmount: 30_000, startAge: 60, indexedToInflation: true });
        // Switched on with no amount: nothing to add.
        expect(buildRetireInputs(form({ hasPension: true, pensionAmount: 0 })).person.pension).toBeUndefined();
    });

    describe('spouse', () => {
        const couple = (over: Partial<RetireForm> = {}) => form({
            includeSpouse: true, spouseAge: 46, spouseIncome: 60_000,
            spouseRrsp: 150_000, spouseTfsa: 40_000, spouseNonReg: 10_000,
            ...over,
        });

        it('carries the spouse’s numbers, with no early RRSP withdrawals', () => {
            const plan = buildRetireInputs(couple({ spouseHasPension: true, spousePensionAmount: 15_000, spousePensionStartAge: 62 }));
            const s = plan.spouse!;
            expect(s.age).toBe(46);
            expect(s.currentIncome).toBe(60_000);
            expect(s.rrsp.balance).toBe(150_000);
            expect(s.tfsa.balance).toBe(40_000);
            expect(nonRegTotal(s.nonRegisteredAccounts)).toBe(10_000);
            expect(s.pension).toEqual({ annualAmount: 15_000, startAge: 62, indexedToInflation: true });
            expect(s.rrspMeltAmount).toBe(0);
        });

        it('with income, retires at the same age as you, and both move together', () => {
            const plan = buildRetireInputs(couple({ age: 48, targetAge: 60 }));
            expect(plan.spouse!.retirementAge).toBe(60);
            expect(planAgeShift(plan).shifted).toEqual(['person', 'spouse']);
        });

        it('with income but already past your retirement age, stops now', () => {
            const plan = buildRetireInputs(couple({ age: 48, targetAge: 60, spouseAge: 63 }));
            expect(plan.spouse!.retirementAge).toBe(63);
            expect(planAgeShift(plan).shifted).toEqual(['person']);
        });

        it('with no income, counts as not working', () => {
            const plan = buildRetireInputs(couple({ spouseIncome: 0 }));
            expect(plan.spouse!.retirementAge).toBe(46);
            expect(planAgeShift(plan).shifted).toEqual(['person']);
        });

        it('ignores spouse fields (and the spouse pension) when no spouse is included', () => {
            const plan = buildRetireInputs(couple({ includeSpouse: false, spouseHasPension: true, spousePensionAmount: 15_000 }));
            expect(plan.spouse).toBeUndefined();
        });
    });

    describe('errors', () => {
        it('needs a target later than today, and no later than the search goes', () => {
            const max = MAX_SEARCH_RETIREMENT_AGE;
            expect(retireFormErrors(form({ age: 50, targetAge: 50 }))).toHaveLength(1);
            expect(retireFormErrors(form({ age: 50, targetAge: 45 }))).toHaveLength(1);
            expect(retireFormErrors(form({ age: 50, targetAge: 100 }))).toHaveLength(1);
            expect(retireFormErrors(form({ age: 50, targetAge: 51 }))).toEqual([]);
            expect(retireFormErrors(form({ age: 50, targetAge: max }))).toEqual([]);
            expect(retireFormErrors(form({ age: 50, targetAge: max + 1 })))
                .toEqual([`Your target retirement age must be between 51 and ${max}`]);
        });

        it('says plainly when no target can be compared at your age', () => {
            const max = MAX_SEARCH_RETIREMENT_AGE;
            const errs = retireFormErrors(form({ age: max, targetAge: max + 2 }));
            expect(errs).toHaveLength(1);
            expect(errs[0]).toContain(`only be compared up to ${max}`);
            expect(retireFormErrors(form({ age: max, targetAge: null }))).toEqual([]);
        });

        it('uses onboarding’s age checks for you and your spouse', () => {
            expect(retireFormErrors(form({ age: 17 }))).toHaveLength(1);
            expect(retireFormErrors(form({ includeSpouse: true, spouseAge: 120 }))).toHaveLength(1);
            expect(retireFormErrors(form({ includeSpouse: false, spouseAge: 120 }))).toEqual([]);
        });
    });
});
