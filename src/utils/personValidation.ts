import type { Person } from '../engine/types';

/**
 * Which group of fields a check belongs to — i.e. where the user can actually
 * FIX it. The onboarding wizard gates each step on its own scope only; without
 * that, a check whose field lives on a later step traps the user on an earlier
 * one with no way to reach the input. (Concretely: raising current age past the
 * melt start age is reported by the 'meltdown' check, but the melt start field
 * is four steps after "About you".)
 *
 * The dashboard shows every person's whole error list at once, so it omits the
 * scope and gets all of them.
 */
export type ValidationScope = 'about' | 'benefits' | 'meltdown';

interface Check {
    /** The field group that owns the input(s) this check reads. */
    scope: ValidationScope;
    failed: (person: Person) => boolean;
    message: string;
}

// Order here is the order errors surface in. Cross-field checks live in the
// scope of the field the user should change to resolve them.
const CHECKS: Check[] = [
    {
        scope: 'about',
        failed: (p) => p.age < 18 || p.age > 99,
        message: 'Current age must be between 18 and 99',
    },
    {
        scope: 'about',
        failed: (p) => p.retirementAge < p.age,
        message: "Retirement age can't be earlier than current age",
    },
    {
        scope: 'about',
        failed: (p) => p.lifeExpectancy <= p.age,
        message: 'Life expectancy must be later than current age',
    },
    {
        scope: 'about',
        failed: (p) => p.lifeExpectancy <= p.retirementAge,
        message: 'Life expectancy must be later than retirement age',
    },
    {
        scope: 'benefits',
        failed: (p) => p.cppStartAge < 60 || p.cppStartAge > 70,
        message: 'CPP start age must be between 60 and 70',
    },
    {
        scope: 'benefits',
        failed: (p) => p.oasStartAge < 65 || p.oasStartAge > 70,
        message: 'OAS start age must be between 65 and 70',
    },
    {
        scope: 'benefits',
        failed: (p) => p.cppContributedYears < 0 || p.cppContributedYears > 47,
        message: 'Years contributed must be between 0 and 47',
    },
    {
        // Depends on `age`, but the melt start age is the field to change — the
        // user's current age isn't wrong just because a default melt start
        // predates it.
        scope: 'meltdown',
        failed: (p) => !!p.rrspMeltStartAge && p.rrspMeltStartAge < p.age,
        message: "RRSP melt can't start before current age",
    },
];

/**
 * Inconsistencies in a person's inputs. Pass a `scope` to get only the checks
 * whose fields that group owns (the wizard's per-step gate); omit it for the
 * whole list (the dashboard's banner).
 */
export function getValidationErrors(person: Person, scope?: ValidationScope): string[] {
    return CHECKS
        .filter((check) => (scope === undefined || check.scope === scope) && check.failed(person))
        .map((check) => check.message);
}
