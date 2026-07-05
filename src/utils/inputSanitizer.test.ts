import { describe, it, expect } from 'vitest';
import { sanitizeSimulationInputs, INITIAL_INPUTS, createDefaultPerson } from './inputSanitizer';

describe('sanitizeSimulationInputs', () => {
    it('rejects payloads that are not an object with a person', () => {
        expect(sanitizeSimulationInputs(null)).toBeNull();
        expect(sanitizeSimulationInputs('garbage')).toBeNull();
        expect(sanitizeSimulationInputs(42)).toBeNull();
        expect(sanitizeSimulationInputs({})).toBeNull();
        expect(sanitizeSimulationInputs({ person: 'not-an-object' })).toBeNull();
    });

    it('fills a minimal payload entirely with defaults', () => {
        const result = sanitizeSimulationInputs({ person: {} })!;
        expect(result.person).toEqual(createDefaultPerson());
        expect(result.spouse).toBeUndefined();
        expect(result.province).toBe(INITIAL_INPUTS.province);
        expect(result.returnRates).toEqual(INITIAL_INPUTS.returnRates);
        expect(result.oneTimeExpenses).toEqual([]);
    });

    it('keeps valid fields and defaults the rest (truncated share link case)', () => {
        const result = sanitizeSimulationInputs({
            person: { age: 52, retirementAge: 61 },
            spouse: { age: 50 }
        })!;
        expect(result.person.age).toBe(52);
        expect(result.person.retirementAge).toBe(61);
        expect(result.person.lifeExpectancy).toBe(90); // defaulted
        expect(result.spouse!.age).toBe(50);
        expect(result.spouse!.rrsp.balance).toBe(createDefaultPerson(true).rrsp.balance);
    });

    it('replaces non-finite and wrong-typed numbers', () => {
        const result = sanitizeSimulationInputs({
            person: { age: NaN, currentIncome: 'lots', rrsp: { balance: Infinity } },
            inflationRate: '2%'
        })!;
        expect(result.person.age).toBe(createDefaultPerson().age);
        expect(result.person.currentIncome).toBe(createDefaultPerson().currentIncome);
        expect(result.person.rrsp.balance).toBe(createDefaultPerson().rrsp.balance);
        expect(result.inflationRate).toBe(INITIAL_INPUTS.inflationRate);
    });

    it('rejects unknown provinces and withdrawal strategies', () => {
        const result = sanitizeSimulationInputs({ person: {}, province: 'TX', withdrawalStrategy: 'yolo' })!;
        expect(result.province).toBe('ON');
        expect(result.withdrawalStrategy).toBe('rrsp-first');
    });

    it('scales down an asset mix that sums above 100%', () => {
        const result = sanitizeSimulationInputs({
            person: { nonRegistered: { assetMix: { interest: 2, dividend: 2, capitalGain: 2 } } }
        })!;
        const mix = result.person.nonRegistered.assetMix;
        // Each clamped to 1, then normalized: 1/3 each
        expect(mix.interest + mix.dividend + mix.capitalGain).toBeCloseTo(1, 10);
        expect(mix.interest).toBeCloseTo(1 / 3, 10);
    });

    it('allows an asset mix that sums below 100% (uninvested remainder)', () => {
        const result = sanitizeSimulationInputs({
            person: { nonRegistered: { assetMix: { interest: 0.1, dividend: 0.1, capitalGain: 0.3 } } }
        })!;
        const mix = result.person.nonRegistered.assetMix;
        expect(mix.interest + mix.dividend + mix.capitalGain).toBeCloseTo(0.5, 10);
    });

    it('filters malformed one-time events and normalizes types', () => {
        const result = sanitizeSimulationInputs({
            person: {},
            oneTimeExpenses: [
                { name: 'Roof', amount: 30_000, age: 70 },
                { name: 'bad', amount: 'lots', age: 70 },
                'garbage',
                { amount: 10_000, age: 75, type: 'inflow' }
            ]
        })!;
        expect(result.oneTimeExpenses).toHaveLength(2);
        expect(result.oneTimeExpenses![0]).toMatchObject({ name: 'Roof', amount: 30_000, age: 70, type: 'expense' });
        expect(result.oneTimeExpenses![1].type).toBe('inflow');
        expect(result.oneTimeExpenses![1].id).toBeTruthy();
    });
});
