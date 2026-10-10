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

// The optional extras the /when-can-i-retire/ page passes (onboarding never
// sets them). Left out, each keeps the draft's value — so onboarding is
// unaffected; given, each overwrites only what it names.
describe('mergeSimpleAnswers: optional pension and spouse retirement age', () => {
    const existingPension = { annualAmount: 30_000, startAge: 63, indexedToInflation: false, bridgeAmount: 8_000, bridgeEndAge: 65 };
    const draftWithPensions = (): SimulationInputs => ({
        ...INITIAL_INPUTS,
        person: { ...INITIAL_INPUTS.person, pension: existingPension },
        spouse: { ...createDefaultPerson(true), retirementAge: 62, pension: { annualAmount: 12_000, startAge: 65, indexedToInflation: true } },
    });

    it('leaves pensions and the spouse retirement age alone when the answers omit them (onboarding)', () => {
        const draft = draftWithPensions();
        const out = mergeSimpleAnswers(draft, seedToSimpleAnswers(draft));
        expect(out.person.pension).toEqual(existingPension);
        expect(out.spouse!.pension).toEqual(draft.spouse!.pension);
        expect(out.spouse!.retirementAge).toBe(62);
        // And a draft with no pension doesn't grow a `pension` key.
        const plain = mergeSimpleAnswers(INITIAL_INPUTS, seedToSimpleAnswers(INITIAL_INPUTS));
        expect('pension' in plain.person).toBe(false);
    });

    it('sets a new pension that rises with inflation by default', () => {
        const out = mergeSimpleAnswers(INITIAL_INPUTS, {
            ...seedToSimpleAnswers(INITIAL_INPUTS),
            pension: { annualAmount: 24_000, startAge: 61.6 },
        });
        expect(out.person.pension).toEqual({ annualAmount: 24_000, startAge: 62, indexedToInflation: true });
    });

    it('overwrites only the amount and start age of an existing pension', () => {
        const draft = draftWithPensions();
        const out = mergeSimpleAnswers(draft, {
            ...seedToSimpleAnswers(draft),
            pension: { annualAmount: 40_000, startAge: 60 },
        });
        expect(out.person.pension).toEqual({ ...existingPension, annualAmount: 40_000, startAge: 60 });
    });

    it('removes a pension on null or a $0 amount', () => {
        const draft = draftWithPensions();
        const a = seedToSimpleAnswers(draft);
        expect(mergeSimpleAnswers(draft, { ...a, pension: null }).person.pension).toBeUndefined();
        expect(mergeSimpleAnswers(draft, { ...a, pension: { annualAmount: 0, startAge: 65 } }).person.pension).toBeUndefined();
        expect(mergeSimpleAnswers(draft, { ...a, spousePension: null }).spouse!.pension).toBeUndefined();
    });

    it('applies the spouse pension and retirement age only when a spouse is included', () => {
        const a = {
            ...seedToSimpleAnswers(INITIAL_INPUTS),
            includeSpouse: true,
            spouseAge: 50,
            spouseRetirementAge: 64,
            spousePension: { annualAmount: 18_000, startAge: 64 },
        };
        const out = mergeSimpleAnswers(INITIAL_INPUTS, a);
        expect(out.spouse!.retirementAge).toBe(64);
        expect(out.spouse!.pension).toEqual({ annualAmount: 18_000, startAge: 64, indexedToInflation: true });
        // Same consistency clamp as the person's: never before today's age.
        expect(mergeSimpleAnswers(INITIAL_INPUTS, { ...a, spouseRetirementAge: 45 }).spouse!.retirementAge).toBe(50);

        expect(mergeSimpleAnswers(INITIAL_INPUTS, { ...a, includeSpouse: false }).spouse).toBeUndefined();
    });
});
