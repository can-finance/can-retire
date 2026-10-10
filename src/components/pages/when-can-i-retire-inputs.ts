import type { SimulationInputs } from '../../engine/types';
import { INITIAL_INPUTS } from '../../utils/inputSanitizer';
import { mergeSimpleAnswers, seedToSimpleAnswers, simpleAnswersErrors } from '../onboarding/simplePathMapping';
import type { SimpleAnswers } from '../onboarding/simplePathMapping';

/*
 * The /when-can-i-retire/ form and how it becomes a plan.
 *
 * The form is onboarding's Quick start answers (SimpleAnswers) with three
 * changes from the spec: the retirement age is the answer, so it is only an
 * optional "target, to compare"; a workplace pension can be added for each
 * person; and the confidence bar is chosen beside it (kept by the page, not
 * here). The plan is built exactly the way onboarding builds one —
 * mergeSimpleAnswers over the default plan — so everything the form doesn't
 * ask (CPP years, life expectancy, returns, inflation, asset mix) stays on the
 * planner's defaults and can be changed later in the full plan.
 */

/** The plan's retirement age when no target is given (the usual CPP/OAS age). */
export const DEFAULT_PLAN_RETIREMENT_AGE = 65;
/** Starting value for a pension's start age, before the visitor edits it. */
export const DEFAULT_PENSION_START_AGE = 65;

type BaseAnswers = Omit<SimpleAnswers, 'retirementAge' | 'spouseRetirementAge' | 'pension' | 'spousePension'>;

export interface RetireForm extends BaseAnswers {
    /** "Your target retirement age (to compare)" — null when left blank. */
    targetAge: number | null;
    hasPension: boolean;
    pensionAmount: number;     // per year, today's dollars
    pensionStartAge: number;
    spouseHasPension: boolean;
    spousePensionAmount: number;
    spousePensionStartAge: number;
}

/** The form's starting values: the planner's sample plan, no target, no pension. */
export function initialRetireForm(): RetireForm {
    const a = seedToSimpleAnswers(INITIAL_INPUTS);
    return {
        age: a.age,
        currentIncome: a.currentIncome,
        province: a.province,
        includeSpouse: a.includeSpouse,
        spouseAge: a.spouseAge,
        spouseIncome: a.spouseIncome,
        rrsp: a.rrsp,
        tfsa: a.tfsa,
        nonReg: a.nonReg,
        spouseRrsp: a.spouseRrsp,
        spouseTfsa: a.spouseTfsa,
        spouseNonReg: a.spouseNonReg,
        preRetirementSpend: a.preRetirementSpend,
        postRetirementSpend: a.postRetirementSpend,
        // The retirement age is the answer here, not an input.
        targetAge: null,
        hasPension: false,
        pensionAmount: 0,
        pensionStartAge: DEFAULT_PENSION_START_AGE,
        spouseHasPension: false,
        spousePensionAmount: 0,
        spousePensionStartAge: DEFAULT_PENSION_START_AGE,
    };
}

/**
 * The retirement age the plan is built with: the target when given, otherwise
 * 65 — or a year from now for someone already 65 or older, so they still count
 * as working and the search has an age to move. The search moves it either
 * way; this is only its starting point and the "your target" row.
 */
export function planRetirementAge(form: Pick<RetireForm, 'age' | 'targetAge'>): number {
    if (form.targetAge !== null) return form.targetAge;
    return form.age >= DEFAULT_PLAN_RETIREMENT_AGE ? form.age + 1 : DEFAULT_PLAN_RETIREMENT_AGE;
}

/**
 * The spouse's retirement age, which the form doesn't ask for. A spouse with
 * income stops working at the same age as you — or now, if they are already
 * past it. A spouse with no income counts as not working: otherwise the
 * household would keep its before-retirement spending until they "retired".
 * The search then moves everyone still working by the same number of years.
 */
export function spouseRetirementAge(form: Pick<RetireForm, 'spouseAge' | 'spouseIncome'>, planAge: number): number {
    return form.spouseIncome > 0 ? Math.max(planAge, form.spouseAge) : form.spouseAge;
}

function toSimpleAnswers(form: RetireForm): SimpleAnswers {
    const retirementAge = planRetirementAge(form);
    return {
        age: form.age,
        retirementAge,
        currentIncome: form.currentIncome,
        province: form.province,
        includeSpouse: form.includeSpouse,
        spouseAge: form.spouseAge,
        spouseIncome: form.spouseIncome,
        rrsp: form.rrsp,
        tfsa: form.tfsa,
        nonReg: form.nonReg,
        spouseRrsp: form.spouseRrsp,
        spouseTfsa: form.spouseTfsa,
        spouseNonReg: form.spouseNonReg,
        preRetirementSpend: form.preRetirementSpend,
        postRetirementSpend: form.postRetirementSpend,
        spouseRetirementAge: spouseRetirementAge(form, retirementAge),
        // null (not undefined) when off: the form asked, and the answer is "none".
        pension: form.hasPension
            ? { annualAmount: form.pensionAmount, startAge: form.pensionStartAge }
            : null,
        spousePension: form.spouseHasPension
            ? { annualAmount: form.spousePensionAmount, startAge: form.spousePensionStartAge }
            : null,
    };
}

/**
 * The plan the search runs on. Built like onboarding's Quick start (merged onto
 * a fresh copy of the default plan), with one deliberate difference: no early
 * RRSP withdrawals to start from. The search tries a range of them anyway, and
 * starting from none means the "To get there" line describes what the search
 * adds rather than changing a sample amount the visitor never chose.
 */
export function buildRetireInputs(form: RetireForm): SimulationInputs {
    const draft = JSON.parse(JSON.stringify(INITIAL_INPUTS)) as SimulationInputs;
    const plan = mergeSimpleAnswers(draft, toSimpleAnswers(form));
    plan.person.rrspMeltAmount = 0;
    if (plan.spouse) plan.spouse.rrspMeltAmount = 0;
    return plan;
}

/** Problems that stop the search from running, in plain words. Empty = OK. */
export function retireFormErrors(form: RetireForm): string[] {
    // Onboarding's checks on ages. The target is checked separately below (it
    // must be later than today, not just "not earlier"), so the retirement age
    // handed in here is one that always passes.
    const answers = toSimpleAnswers(form);
    const { person, spouse } = simpleAnswersErrors({ ...answers, retirementAge: Math.max(answers.retirementAge, form.age) });
    const out = [...person, ...spouse];
    if (form.targetAge !== null && (form.targetAge <= form.age || form.targetAge > 99)) {
        out.push(`Your target retirement age must be between ${form.age + 1} and 99`);
    }
    return out;
}
