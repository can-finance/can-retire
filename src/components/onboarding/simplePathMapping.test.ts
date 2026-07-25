import { describe, it, expect } from 'vitest';
import { seedToSimpleAnswers, mergeSimpleAnswers } from './simplePathMapping';
import { INITIAL_INPUTS, createDefaultPerson } from '../../utils/inputSanitizer';
import type { SimulationInputs } from '../../engine/types';

describe('seedToSimpleAnswers', () => {
    it('defaults spouse MONEY fields to 0 when the seed has no spouse (no fabricated sample money)', () => {
        const answers = seedToSimpleAnswers(INITIAL_INPUTS);
        expect(answers.includeSpouse).toBe(false);
        expect(answers.spouseIncome).toBe(0);
        expect(answers.spouseRrsp).toBe(0);
        expect(answers.spouseTfsa).toBe(0);
        expect(answers.spouseNonReg).toBe(0);
        // Age still needs a plausible non-zero default -- it isn't money.
        expect(answers.spouseAge).toBe(createDefaultPerson(true).age);
        expect(answers.spouseAge).toBeGreaterThan(0);
    });

    it('reads every spouse value from a real spouse unchanged (regression guard)', () => {
        const seed: SimulationInputs = {
            ...INITIAL_INPUTS,
            spouse: {
                ...createDefaultPerson(true),
                age: 52,
                currentIncome: 65000,
                rrsp: { ...createDefaultPerson(true).rrsp, balance: 123000 },
                tfsa: { ...createDefaultPerson(true).tfsa, balance: 45000 },
            },
        };
        const answers = seedToSimpleAnswers(seed);
        expect(answers.includeSpouse).toBe(true);
        expect(answers.spouseAge).toBe(52);
        expect(answers.spouseIncome).toBe(65000);
        expect(answers.spouseRrsp).toBe(123000);
        expect(answers.spouseTfsa).toBe(45000);
        expect(answers.spouseNonReg).toBe(
            seed.spouse!.nonRegisteredAccounts.reduce((s, a) => s + a.balance, 0),
        );
    });

    it('round trip with includeSpouse true and the zero defaults introduces no invented spouse money', () => {
        const answers = { ...seedToSimpleAnswers(INITIAL_INPUTS), includeSpouse: true };
        const out = mergeSimpleAnswers(INITIAL_INPUTS, answers);
        expect(out.spouse).toBeDefined();
        expect(out.spouse!.rrsp.balance).toBe(0);
        expect(out.spouse!.tfsa.balance).toBe(0);
        const spouseNonRegTotal = out.spouse!.nonRegisteredAccounts.reduce((s, a) => s + a.balance, 0);
        expect(spouseNonRegTotal).toBe(0);
    });

    it('round trip with includeSpouse false drops the spouse entirely', () => {
        const answers = seedToSimpleAnswers(INITIAL_INPUTS); // includeSpouse is already false
        const out = mergeSimpleAnswers(INITIAL_INPUTS, answers);
        expect(out.spouse).toBeUndefined();
    });
});
