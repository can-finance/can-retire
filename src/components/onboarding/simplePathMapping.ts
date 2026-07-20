import { createDefaultPerson, createNonRegAccount } from '../../utils/inputSanitizer';
import type { NonRegisteredAccount, Person, SimulationInputs } from '../../engine/types';

/**
 * The handful of answers the Quick start path collects. Everything else in the
 * simulation is carried through from the draft (CPP/OAS ages, melt amounts,
 * asset mix, return rates, inflation, strategy toggles, one-time events, …).
 */
export interface SimpleAnswers {
    age: number;
    retirementAge: number;
    currentIncome: number;
    province: string;
    includeSpouse: boolean;
    spouseAge: number;
    spouseIncome: number;
    rrsp: number;
    tfsa: number;
    nonReg: number;
    spouseRrsp: number;
    spouseTfsa: number;
    spouseNonReg: number;
    preRetirementSpend: number;
    postRetirementSpend: number;
}

const sumNonReg = (person: Person): number =>
    person.nonRegisteredAccounts.reduce((acc, a) => acc + a.balance, 0);

/** Pre-fill the quick form from the current draft (defaults on first run). */
export function seedToSimpleAnswers(seed: SimulationInputs): SimpleAnswers {
    const spouseDefaults = createDefaultPerson(true);
    return {
        age: seed.person.age,
        retirementAge: seed.person.retirementAge,
        currentIncome: seed.person.currentIncome,
        province: seed.province,
        includeSpouse: !!seed.spouse,
        spouseAge: seed.spouse?.age ?? spouseDefaults.age,
        spouseIncome: seed.spouse?.currentIncome ?? spouseDefaults.currentIncome,
        rrsp: seed.person.rrsp.balance,
        tfsa: seed.person.tfsa.balance,
        nonReg: sumNonReg(seed.person),
        spouseRrsp: seed.spouse?.rrsp.balance ?? spouseDefaults.rrsp.balance,
        spouseTfsa: seed.spouse?.tfsa.balance ?? spouseDefaults.tfsa.balance,
        spouseNonReg: seed.spouse ? sumNonReg(seed.spouse) : sumNonReg(spouseDefaults),
        preRetirementSpend: seed.preRetirementSpend,
        postRetirementSpend: seed.postRetirementSpend,
    };
}

/**
 * Merge a quick-form aggregate non-registered balance back into a person's
 * existing accounts. If the aggregate is unchanged the accounts are returned
 * untouched (same reference) so nothing the quick form doesn't collect — asset
 * mix, ACB ratios, turnover, multiple accounts — is disturbed.
 */
function mergeNonReg(existing: NonRegisteredAccount[], newTotal: number): NonRegisteredAccount[] {
    const oldTotal = existing.reduce((s, a) => s + a.balance, 0);
    if (newTotal === oldTotal) return existing; // untouched

    if (existing.length >= 1) {
        if (oldTotal === 0) {
            // Can't scale from zero — put the full amount in the first account (ACB 50%).
            return existing.map((a, i) =>
                i === 0 ? { ...a, balance: newTotal, adjustedCostBase: newTotal * 0.5 } : a);
        }
        const scale = newTotal / oldTotal;
        return existing.map((a) => ({
            ...a,
            balance: a.balance * scale,
            adjustedCostBase: a.adjustedCostBase * scale,
        }));
    }

    // No existing accounts (sanitizer normally guarantees at least one).
    return [createNonRegAccount({ balance: newTotal, adjustedCostBase: newTotal * 0.5, receivesSurplus: true })];
}

interface MergeOpts {
    age: number;
    retirementAge: number;
    income: number;
    rrsp: number;
    tfsa: number;
    nonRegAggregate: number;
}

/**
 * Merge the quick-collected fields onto an existing person, overwriting ONLY
 * those fields and applying the consistency clamps. Every other field (CPP/OAS,
 * melt amount, asset mix, …) is preserved from `base`.
 */
function mergePerson(base: Person, opts: MergeOpts): Person {
    const age = opts.age;
    const retirementAge = Math.max(opts.retirementAge, age);
    // lifeExpectancy ≥ max(90, retirementAge + 5), but never lower a seeded value.
    const lifeExpectancy = Math.max(base.lifeExpectancy, 90, retirementAge + 5);
    // rrspMeltStartAge ≥ max(55, age), without lowering a seeded value.
    const rrspMeltStartAge = Math.max(base.rrspMeltStartAge ?? 0, 55, age);

    return {
        ...base,
        age,
        retirementAge,
        lifeExpectancy,
        rrspMeltStartAge,
        currentIncome: opts.income,
        rrsp: { ...base.rrsp, balance: opts.rrsp },
        tfsa: { ...base.tfsa, balance: opts.tfsa },
        nonRegisteredAccounts: mergeNonReg(base.nonRegisteredAccounts, opts.nonRegAggregate),
    };
}

/**
 * Merge the Quick start answers back into the draft. The draft is the single
 * source of truth: only the quick-collected fields are overwritten; everything
 * else survives unchanged. Spouse is merged into the existing spouse object (a
 * default spouse is created only when none existed); toggling the spouse off
 * removes it.
 */
export function mergeSimpleAnswers(draft: SimulationInputs, a: SimpleAnswers): SimulationInputs {
    const person = mergePerson(draft.person, {
        age: a.age,
        retirementAge: a.retirementAge,
        income: a.currentIncome,
        rrsp: a.rrsp,
        tfsa: a.tfsa,
        nonRegAggregate: a.nonReg,
    });

    let spouse: Person | undefined;
    if (a.includeSpouse) {
        const spouseBase = draft.spouse ?? createDefaultPerson(true);
        spouse = mergePerson(spouseBase, {
            age: a.spouseAge,
            // The quick form doesn't collect the spouse's retirement age — keep it.
            retirementAge: spouseBase.retirementAge,
            income: a.spouseIncome,
            rrsp: a.spouseRrsp,
            tfsa: a.spouseTfsa,
            nonRegAggregate: a.spouseNonReg,
        });
    }

    return {
        ...draft,
        person,
        spouse,
        province: a.province,
        preRetirementSpend: a.preRetirementSpend,
        postRetirementSpend: a.postRetirementSpend,
    };
}

/**
 * Validate the RAW quick-form answers (not the clamped preview) so a typed
 * inconsistency surfaces the amber banner instead of being silently replaced by
 * a clamp. Only fields the quick form actually lets the user edit are checked;
 * auto-derived fields (life expectancy, melt start, CPP/OAS) are clamped safely
 * at commit and never produce a warning the user can't act on.
 */
export function simpleAnswersErrors(a: SimpleAnswers): { person: string[]; spouse: string[] } {
    const person: string[] = [];
    if (a.age < 18 || a.age > 99) person.push('Current age must be between 18 and 99');
    if (a.retirementAge < a.age) person.push("Retirement age can't be earlier than current age");

    const spouse: string[] = [];
    if (a.includeSpouse && (a.spouseAge < 18 || a.spouseAge > 99))
        spouse.push("Spouse's age must be between 18 and 99");

    return { person, spouse };
}
