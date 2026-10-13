import type { SimulationInputs } from '../../engine/types';
import {
    DEFAULT_PLAN_RETIREMENT_AGE,
    buildPlanInputs,
    calculatorFormErrors,
    initialCalculatorForm,
} from './when-can-i-retire-inputs';
import type { CalculatorForm } from './when-can-i-retire-inputs';

/*
 * The /how-much-do-i-need-to-retire/ form and how it becomes a plan.
 *
 * The same questions as /when-can-i-retire/ (see when-can-i-retire-inputs.ts),
 * turned around: the retirement age is a required input and the savings are the
 * answer, so the target age is gone. The plan is built the same way, with the
 * retirement age the visitor typed. The savings in the plan are only the
 * starting point the solver scales (it keeps the visitor's mix of accounts), so
 * entering none is fine.
 */

export interface NeedForm extends CalculatorForm {
    /** The age you plan to stop working. Equal to your current age means retiring now. */
    retirementAge: number;
}

/**
 * The form's starting values: the planner's sample plan, no pension, retiring
 * at 65 — or now, for someone already 65 or older.
 */
export function initialNeedForm(): NeedForm {
    const base = initialCalculatorForm();
    return {
        ...base,
        retirementAge: Math.max(base.age, DEFAULT_PLAN_RETIREMENT_AGE),
    };
}

/** The plan the savings search runs on: retiring at the age entered. */
export function buildNeedInputs(form: NeedForm): SimulationInputs {
    return buildPlanInputs(form, form.retirementAge);
}

/** Problems that stop the search from running, in plain words. Empty = OK. */
export function needFormErrors(form: NeedForm): string[] {
    const out = calculatorFormErrors(form, form.retirementAge);
    if (!Number.isFinite(form.retirementAge) || form.retirementAge < form.age || form.retirementAge > 99) {
        out.push(`Your retirement age must be between ${form.age} and 99`);
    }
    return out;
}
