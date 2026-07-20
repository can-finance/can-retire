import type { Person } from '../engine/types';

export function getValidationErrors(person: Person): string[] {
    const errors: string[] = [];

    if (person.age < 18 || person.age > 99)
        errors.push('Current age must be between 18 and 99');
    if (person.retirementAge < person.age)
        errors.push("Retirement age can't be earlier than current age");
    if (person.lifeExpectancy <= person.age)
        errors.push('Life expectancy must be later than current age');
    if (person.lifeExpectancy <= person.retirementAge)
        errors.push('Life expectancy must be later than retirement age');
    if (person.cppStartAge < 60 || person.cppStartAge > 70)
        errors.push('CPP start age must be between 60 and 70');
    if (person.oasStartAge < 65 || person.oasStartAge > 70)
        errors.push('OAS start age must be between 65 and 70');
    if (person.cppContributedYears < 0 || person.cppContributedYears > 47)
        errors.push('Years contributed must be between 0 and 47');
    if (person.rrspMeltStartAge && person.rrspMeltStartAge < person.age)
        errors.push("RRSP melt can't start before current age");

    return errors;
}
