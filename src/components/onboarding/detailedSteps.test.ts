import { describe, it, expect } from 'vitest';
import { buildDetailedSteps } from './detailedSteps';
import { INITIAL_INPUTS, createDefaultPerson } from '../../utils/inputSanitizer';
import { getValidationErrors } from '../../utils/personValidation';
import type { SimulationInputs } from '../../engine/types';

// buildDetailedSteps only reads `draft` to decide the *shape* of the returned
// list (which steps exist, in what order); it never invokes any `render`
// function itself. These tests only inspect that shape, never call `.render`.
const noop = () => {};

const withoutSpouse: SimulationInputs = { ...INITIAL_INPUTS, spouse: undefined };
const withSpouse: SimulationInputs = { ...INITIAL_INPUTS, spouse: createDefaultPerson(true) };

const NO_SPOUSE_IDS = [
    'about-you', 'benefits-you', 'pension-you', 'accounts-you', 'meltdown-you',
    'spending', 'assumptions',
];
const SPOUSE_IDS = [
    'about-you', 'benefits-you', 'pension-you', 'accounts-you', 'meltdown-you',
    'about-spouse', 'benefits-spouse', 'pension-spouse', 'accounts-spouse', 'meltdown-spouse',
    'spending', 'assumptions',
];

describe('buildDetailedSteps', () => {
    it('without a spouse: 7 steps in the documented order, no spouse steps', () => {
        const steps = buildDetailedSteps(withoutSpouse, noop);
        expect(steps).toHaveLength(7);
        expect(steps.map((s) => s.id)).toEqual(NO_SPOUSE_IDS);
        // No dedicated "toggle spouse" step -- the toggle lives inside 'about-you'.
        expect(steps.some((s) => s.id === 'spouse-toggle')).toBe(false);
        expect(steps.some((s) => s.id.includes('spouse'))).toBe(false);
    });

    it('with a spouse: the 5 spouse steps splice in between meltdown-you and spending', () => {
        const steps = buildDetailedSteps(withSpouse, noop);
        expect(steps).toHaveLength(12);
        expect(steps.map((s) => s.id)).toEqual(SPOUSE_IDS);
    });

    it('the workplace pension is collected for each person present', () => {
        expect(buildDetailedSteps(withoutSpouse, noop).map((s) => s.id)).toContain('pension-you');
        const withSpouseIds = buildDetailedSteps(withSpouse, noop).map((s) => s.id);
        expect(withSpouseIds).toContain('pension-you');
        expect(withSpouseIds).toContain('pension-spouse');
    });

    it('toggling the spouse changes only the spliced middle -- prefix/suffix ids are identical', () => {
        const idsNoSpouse = buildDetailedSteps(withoutSpouse, noop).map((s) => s.id);
        const idsWithSpouse = buildDetailedSteps(withSpouse, noop).map((s) => s.id);

        const prefix = ['about-you', 'benefits-you', 'pension-you', 'accounts-you', 'meltdown-you'];
        const suffix = ['spending', 'assumptions'];

        expect(idsNoSpouse.slice(0, 5)).toEqual(prefix);
        expect(idsWithSpouse.slice(0, 5)).toEqual(prefix);
        expect(idsNoSpouse.slice(-2)).toEqual(suffix);
        expect(idsWithSpouse.slice(-2)).toEqual(suffix);

        // The only difference is the spliced spouse block.
        expect(idsNoSpouse.slice(5, -2)).toEqual([]);
        expect(idsWithSpouse.slice(5, -2)).toEqual([
            'about-spouse', 'benefits-spouse', 'pension-spouse', 'accounts-spouse', 'meltdown-spouse',
        ]);
    });

    it('every step exposes a non-empty title, blurb, an errors fn, and a render fn', () => {
        for (const step of buildDetailedSteps(withSpouse, noop)) {
            expect(typeof step.title).toBe('string');
            expect(step.title.length).toBeGreaterThan(0);
            expect(typeof step.blurb).toBe('string');
            expect(step.blurb.length).toBeGreaterThan(0);
            expect(typeof step.errors).toBe('function');
            expect(typeof step.render).toBe('function');
        }
    });

    // The gate in OnboardingFlow reads these; a step that silently returned []
    // for a broken person would let the wizard commit an unrunnable plan.
    describe('step validators', () => {
        it('a valid draft yields no errors on any step', () => {
            for (const step of buildDetailedSteps(withSpouse, noop)) {
                expect(step.errors(withSpouse)).toEqual([]);
            }
        });

        it("person steps report only their OWN group's inconsistencies; spouse steps stay quiet", () => {
            const broken: SimulationInputs = {
                ...withSpouse,
                person: { ...withSpouse.person, retirementAge: 30, age: 50 },
            };
            const steps = buildDetailedSteps(broken, noop);
            const errorsFor = (id: string) => steps.find((s) => s.id === id)!.errors(broken);

            // The retirement-vs-current-age problem is fixable on "About you"...
            expect(errorsFor('about-you').length).toBeGreaterThan(0);
            // ...and must NOT leak onto steps that render none of those fields,
            // or Next would block somewhere the user can't act.
            expect(errorsFor('pension-you')).toEqual([]);
            expect(errorsFor('accounts-you')).toEqual([]);
            expect(errorsFor('about-spouse')).toEqual([]);
        });

        // Regression: gating on the whole person's errors trapped the user on
        // step 0 — a current age past the default melt start age (60) tripped a
        // check whose only editable field sits four steps later.
        it('a current age past the melt start age blocks the meltdown step, not "About you"', () => {
            const person = { ...withoutSpouse.person, age: 70, retirementAge: 72, lifeExpectancy: 90 };
            expect(person.rrspMeltStartAge).toBeLessThan(person.age); // precondition
            const broken: SimulationInputs = { ...withoutSpouse, person };
            const steps = buildDetailedSteps(broken, noop);
            const errorsFor = (id: string) => steps.find((s) => s.id === id)!.errors(broken);

            expect(errorsFor('about-you')).toEqual([]);
            expect(errorsFor('benefits-you')).toEqual([]);
            expect(errorsFor('meltdown-you')).toContain("RRSP melt can't start before current age");
        });

        // If a future check picks a scope no step renders, it would silently stop
        // blocking anywhere while still failing the whole-draft check at Save —
        // an unreachable dead end. Every error must be owned by some step.
        it('every person-level error is reachable on exactly one step', () => {
            const person = {
                ...withoutSpouse.person,
                age: 70, retirementAge: 60, lifeExpectancy: 65,
                cppStartAge: 55, oasStartAge: 80, cppContributedYears: 99,
            };
            const broken: SimulationInputs = { ...withoutSpouse, person };
            const all = getValidationErrors(person);
            expect(all.length).toBeGreaterThan(3); // fixture really is broken

            const surfaced = buildDetailedSteps(broken, noop).flatMap((s) => s.errors(broken));
            expect([...surfaced].sort()).toEqual([...all].sort());
        });

        it('spouse steps report the spouse, and yield nothing when there is no spouse', () => {
            const brokenSpouse: SimulationInputs = {
                ...withSpouse,
                spouse: { ...withSpouse.spouse!, age: 5 },
            };
            const steps = buildDetailedSteps(brokenSpouse, noop);
            expect(steps.find((s) => s.id === 'about-spouse')!.errors(brokenSpouse).length).toBeGreaterThan(0);
            expect(steps.find((s) => s.id === 'about-you')!.errors(brokenSpouse)).toEqual([]);

            // Spouse steps aren't built at all without a spouse, but their
            // validator must still be safe if called with a spouse-less draft.
            const spouseStep = buildDetailedSteps(withSpouse, noop).find((s) => s.id === 'about-spouse')!;
            expect(spouseStep.errors(withoutSpouse)).toEqual([]);
        });

        it('steps that collect nothing validatable never block', () => {
            const broken: SimulationInputs = {
                ...withoutSpouse,
                person: { ...withoutSpouse.person, retirementAge: 30, age: 50 },
            };
            const steps = buildDetailedSteps(broken, noop);
            expect(steps.find((s) => s.id === 'spending')!.errors(broken)).toEqual([]);
            expect(steps.find((s) => s.id === 'assumptions')!.errors(broken)).toEqual([]);
        });
    });
});
