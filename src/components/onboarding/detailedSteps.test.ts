import { describe, it, expect } from 'vitest';
import { buildDetailedSteps } from './detailedSteps';
import { INITIAL_INPUTS, createDefaultPerson } from '../../utils/inputSanitizer';
import type { SimulationInputs } from '../../engine/types';

// buildDetailedSteps only reads `draft` to decide the *shape* of the returned
// list (which steps exist, in what order); it never invokes any `render`
// function itself. These tests only inspect that shape, never call `.render`.
const noop = () => {};

const withoutSpouse: SimulationInputs = { ...INITIAL_INPUTS, spouse: undefined };
const withSpouse: SimulationInputs = { ...INITIAL_INPUTS, spouse: createDefaultPerson(true) };

const NO_SPOUSE_IDS = ['about-you', 'benefits-you', 'accounts-you', 'meltdown-you', 'spending', 'assumptions'];
const SPOUSE_IDS = [
    'about-you', 'benefits-you', 'accounts-you', 'meltdown-you',
    'about-spouse', 'benefits-spouse', 'accounts-spouse', 'meltdown-spouse',
    'spending', 'assumptions',
];

describe('buildDetailedSteps', () => {
    it('without a spouse: 6 steps in the documented order, no spouse steps', () => {
        const steps = buildDetailedSteps(withoutSpouse, noop);
        expect(steps).toHaveLength(6);
        expect(steps.map((s) => s.id)).toEqual(NO_SPOUSE_IDS);
        // No dedicated "toggle spouse" step -- the toggle lives inside 'about-you'.
        expect(steps.some((s) => s.id === 'spouse-toggle')).toBe(false);
        expect(steps.some((s) => s.id.includes('spouse'))).toBe(false);
    });

    it('with a spouse: the 4 spouse steps splice in between meltdown-you and spending', () => {
        const steps = buildDetailedSteps(withSpouse, noop);
        expect(steps).toHaveLength(10);
        expect(steps.map((s) => s.id)).toEqual(SPOUSE_IDS);
    });

    it('toggling the spouse changes only the spliced middle -- prefix/suffix ids are identical', () => {
        const idsNoSpouse = buildDetailedSteps(withoutSpouse, noop).map((s) => s.id);
        const idsWithSpouse = buildDetailedSteps(withSpouse, noop).map((s) => s.id);

        const prefix = ['about-you', 'benefits-you', 'accounts-you', 'meltdown-you'];
        const suffix = ['spending', 'assumptions'];

        expect(idsNoSpouse.slice(0, 4)).toEqual(prefix);
        expect(idsWithSpouse.slice(0, 4)).toEqual(prefix);
        expect(idsNoSpouse.slice(-2)).toEqual(suffix);
        expect(idsWithSpouse.slice(-2)).toEqual(suffix);

        // The only difference is the spliced spouse block.
        expect(idsNoSpouse.slice(4, -2)).toEqual([]);
        expect(idsWithSpouse.slice(4, -2)).toEqual([
            'about-spouse', 'benefits-spouse', 'accounts-spouse', 'meltdown-spouse',
        ]);
    });

    it('every step exposes a non-empty title, blurb, and a render function', () => {
        for (const step of buildDetailedSteps(withSpouse, noop)) {
            expect(typeof step.title).toBe('string');
            expect(step.title.length).toBeGreaterThan(0);
            expect(typeof step.blurb).toBe('string');
            expect(step.blurb.length).toBeGreaterThan(0);
            expect(typeof step.render).toBe('function');
        }
    });
});
