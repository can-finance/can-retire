import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    ONBOARDING_KEY,
    SIM_KEY,
    isOnboardingEligible,
    markOnboardingDone,
    commitOnboardingInputs,
    loadDraftSeed,
    hasSavedPlan,
} from './onboarding';
import { INITIAL_INPUTS, createDefaultPerson, createNonRegAccount } from './inputSanitizer';
import {
    mergeSimpleAnswers,
    seedToSimpleAnswers,
    simpleAnswersErrors,
    type SimpleAnswers,
} from '../components/onboarding/simplePathMapping';
import type { SimulationInputs } from '../engine/types';

// --- lightweight localStorage + hash stubs (vitest runs in a Node env) --------

function installStorage(initial: Record<string, string> = {}): Map<string, string> {
    const store = new Map<string, string>(Object.entries(initial));
    const mock = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => store.clear(),
    };
    vi.stubGlobal('localStorage', mock);
    return store;
}

function setHash(hash: string) {
    vi.stubGlobal('window', { location: { hash } });
}

describe('isOnboardingEligible — flag × sim data × hash matrix', () => {
    beforeEach(() => setHash(''));
    afterEach(() => vi.unstubAllGlobals());

    it('is eligible: no flag, no sim data, plain URL', () => {
        installStorage({});
        expect(isOnboardingEligible()).toBe(true);
    });

    it('is NOT eligible when the onboarding flag is present', () => {
        installStorage({ [ONBOARDING_KEY]: '1' });
        expect(isOnboardingEligible()).toBe(false);
    });

    it('is NOT eligible when saved simulation data exists', () => {
        installStorage({ [SIM_KEY]: '{"person":{}}' });
        expect(isOnboardingEligible()).toBe(false);
    });

    it('is NOT eligible on a #start= share link, even with an otherwise clean profile', () => {
        installStorage({});
        setHash('#start=abc123');
        expect(isOnboardingEligible()).toBe(false);
    });

    it('flag takes precedence even if data is also absent and hash is clean', () => {
        installStorage({ [ONBOARDING_KEY]: '1', [SIM_KEY]: '{}' });
        expect(isOnboardingEligible()).toBe(false);
    });

    it('fails closed (not eligible) when localStorage throws', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('SecurityError: storage disabled'); },
        });
        setHash('');
        expect(isOnboardingEligible()).toBe(false);
    });
});

describe('markOnboardingDone', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('writes the flag', () => {
        const store = installStorage({});
        markOnboardingDone();
        expect(store.get(ONBOARDING_KEY)).toBe('1');
    });

    it('does not throw when storage is unavailable', () => {
        vi.stubGlobal('localStorage', {
            setItem: () => { throw new Error('quota'); },
        });
        expect(() => markOnboardingDone()).not.toThrow();
    });
});

describe('commitOnboardingInputs', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sanitizes before persisting and marks onboarding done', () => {
        const store = installStorage({});
        // A dirty payload: bad numbers and an unknown province should be scrubbed.
        const dirty = {
            ...INITIAL_INPUTS,
            province: 'TX',
            person: { ...createDefaultPerson(), age: NaN as unknown as number },
        } as SimulationInputs;

        commitOnboardingInputs(dirty);

        expect(store.get(ONBOARDING_KEY)).toBe('1');
        const saved = JSON.parse(store.get(SIM_KEY)!);
        expect(saved.province).toBe('ON'); // unknown province defaulted
        expect(saved.person.age).toBe(createDefaultPerson().age); // NaN scrubbed to default
    });

    it('does not throw when storage is unavailable', () => {
        vi.stubGlobal('localStorage', {
            setItem: () => { throw new Error('quota'); },
            getItem: () => null,
        });
        expect(() => commitOnboardingInputs(INITIAL_INPUTS)).not.toThrow();
    });
});

describe('loadDraftSeed', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('returns defaults (deep clone) when no saved data', () => {
        installStorage({});
        const seed = loadDraftSeed();
        expect(seed.province).toBe(INITIAL_INPUTS.province);
        // Must not alias the shared defaults — editing the seed can't leak.
        expect(seed).not.toBe(INITIAL_INPUTS);
        expect(seed.person).not.toBe(INITIAL_INPUTS.person);
    });

    it('returns sanitized saved data when present (re-launch)', () => {
        installStorage({
            [SIM_KEY]: JSON.stringify({ person: { age: 55 }, province: 'BC' }),
        });
        const seed = loadDraftSeed();
        expect(seed.person.age).toBe(55);
        expect(seed.province).toBe('BC');
    });
});

describe('hasSavedPlan', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is true when a saved, sanitizable plan exists', () => {
        installStorage({ [SIM_KEY]: JSON.stringify(INITIAL_INPUTS) });
        expect(hasSavedPlan()).toBe(true);
    });

    it('is false when no saved plan exists', () => {
        installStorage({});
        expect(hasSavedPlan()).toBe(false);
    });

    it('is false when the stored value is corrupt JSON', () => {
        installStorage({ [SIM_KEY]: '{not valid json' });
        expect(hasSavedPlan()).toBe(false);
    });

    it('is false when the stored value is valid JSON but not a sanitizable plan', () => {
        installStorage({ [SIM_KEY]: JSON.stringify({ foo: 1 }) });
        expect(hasSavedPlan()).toBe(false);
    });

    it('fails closed to false when storage throws', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('storage disabled'); },
        });
        expect(hasSavedPlan()).toBe(false);
    });
});

// --- simple-path merge --------------------------------------------------------

const baseAnswers: SimpleAnswers = {
    age: 40,
    retirementAge: 60,
    currentIncome: 90000,
    province: 'BC',
    includeSpouse: false,
    spouseAge: 38,
    spouseIncome: 40000,
    rrsp: 200000,
    tfsa: 80000,
    nonReg: 120000,
    spouseRrsp: 50000,
    spouseTfsa: 20000,
    spouseNonReg: 10000,
    preRetirementSpend: 70000,
    postRetirementSpend: 55000,
};

// A plain no-spouse draft to merge onto (the default person has one $200k non-reg account).
const baseDraft = (): SimulationInputs => JSON.parse(JSON.stringify(INITIAL_INPUTS));

describe('mergeSimpleAnswers', () => {
    it('overwrites the quick-collected fields onto the draft', () => {
        const out = mergeSimpleAnswers(baseDraft(), baseAnswers);
        expect(out.person.age).toBe(40);
        expect(out.person.retirementAge).toBe(60);
        expect(out.person.currentIncome).toBe(90000);
        expect(out.province).toBe('BC');
        expect(out.preRetirementSpend).toBe(70000);
        expect(out.postRetirementSpend).toBe(55000);
        expect(out.person.rrsp.balance).toBe(200000);
        expect(out.person.tfsa.balance).toBe(80000);
        expect(out.spouse).toBeUndefined();
    });

    it('scales the single default account proportionally to the new aggregate', () => {
        // Default person has one $200k account (ACB $100k); new aggregate $120k -> ×0.6.
        const out = mergeSimpleAnswers(baseDraft(), baseAnswers);
        expect(out.person.nonRegisteredAccounts).toHaveLength(1);
        const acct = out.person.nonRegisteredAccounts[0];
        expect(acct.balance).toBe(120000);
        expect(acct.adjustedCostBase).toBe(60000);
        expect(acct.receivesSurplus).toBe(true);
    });

    it('applies consistency clamps (retirementAge, lifeExpectancy, meltStart)', () => {
        const out = mergeSimpleAnswers(baseDraft(), { ...baseAnswers, age: 67, retirementAge: 60 });
        expect(out.person.retirementAge).toBe(67); // max(retire, age)
        expect(out.person.lifeExpectancy).toBe(90); // max(seeded 90, 90, 72)
        expect(out.person.rrspMeltStartAge).toBe(67); // max(seeded 55, 55, age)
    });

    it('lifeExpectancy uses retirementAge+5 when that exceeds 90', () => {
        const out = mergeSimpleAnswers(baseDraft(), { ...baseAnswers, age: 88, retirementAge: 88 });
        expect(out.person.retirementAge).toBe(88);
        expect(out.person.lifeExpectancy).toBe(93); // max(90, 88+5)
    });

    it('never lowers a seeded lifeExpectancy', () => {
        const seed = baseDraft();
        seed.person.lifeExpectancy = 95;
        const out = mergeSimpleAnswers(seed, seedToSimpleAnswers(seed));
        expect(out.person.lifeExpectancy).toBe(95); // max(95, 90, retire+5) stays 95
    });

    it('never lowers a seeded rrspMeltStartAge', () => {
        const seed = baseDraft();
        seed.person.age = 40;
        seed.person.rrspMeltStartAge = 62;
        const out = mergeSimpleAnswers(seed, seedToSimpleAnswers(seed));
        expect(out.person.rrspMeltStartAge).toBe(62); // max(62, 55, 40) stays 62
    });

    it('merges into an existing spouse rather than replacing it, preserving uncollected fields', () => {
        const seed = baseDraft();
        seed.spouse = { ...createDefaultPerson(true), cppAnnualOverride: 9000, oasStartAge: 68 };
        const out = mergeSimpleAnswers(seed, {
            ...seedToSimpleAnswers(seed),
            includeSpouse: true,
            spouseAge: 38,
            spouseIncome: 41000,
        });
        expect(out.spouse!.age).toBe(38);
        expect(out.spouse!.currentIncome).toBe(41000);
        // Fields the quick form never touches survive the merge.
        expect(out.spouse!.cppAnnualOverride).toBe(9000);
        expect(out.spouse!.oasStartAge).toBe(68);
    });

    it('creates a default spouse only when none existed', () => {
        const out = mergeSimpleAnswers(baseDraft(), { ...baseAnswers, includeSpouse: true });
        expect(out.spouse).toBeDefined();
        expect(out.spouse!.age).toBe(38);
        expect(out.spouse!.currentIncome).toBe(40000);
        expect(out.spouse!.rrsp.balance).toBe(50000);
        expect(out.spouse!.tfsa.balance).toBe(20000);
        // Default spouse account is $100k (ACB $50k); new aggregate $10k -> ×0.1.
        expect(out.spouse!.nonRegisteredAccounts[0].balance).toBe(10000);
        expect(out.spouse!.nonRegisteredAccounts[0].adjustedCostBase).toBe(5000);
    });

    it('drops the spouse when the toggle is off', () => {
        const seed = baseDraft();
        seed.spouse = createDefaultPerson(true);
        const out = mergeSimpleAnswers(seed, { ...seedToSimpleAnswers(seed), includeSpouse: false });
        expect(out.spouse).toBeUndefined();
    });

    it('preserves non-collected household fields (strategy, splitting, return rates, one-time events)', () => {
        const seed = baseDraft();
        seed.oneTimeExpenses = [{ id: 'e1', name: 'Reno', amount: 30000, age: 60, type: 'expense' }];
        const out = mergeSimpleAnswers(seed, baseAnswers);
        expect(out.withdrawalStrategy).toBe('rrsp-first');
        expect(out.useIncomeSplitting).toBe(true);
        expect(out.returnRates).toEqual(INITIAL_INPUTS.returnRates);
        expect(out.oneTimeExpenses).toEqual(seed.oneTimeExpenses);
    });

    it('leaves a rich relaunch seed completely unchanged through an untouched quick commit', () => {
        // cppAnnualOverride + custom returnRates + oneTimeExpenses + TWO non-reg accounts.
        const seed: SimulationInputs = {
            ...baseDraft(),
            person: {
                ...createDefaultPerson(),
                cppAnnualOverride: 14000,
                nonRegisteredAccounts: [
                    createNonRegAccount({ balance: 120000, adjustedCostBase: 60000, receivesSurplus: true, id: 'acc-a' }),
                    createNonRegAccount({ balance: 80000, adjustedCostBase: 25000, id: 'acc-b' }),
                ],
            },
            oneTimeExpenses: [{ id: 'e1', name: 'Reno', amount: 30000, age: 60, type: 'expense' }],
            returnRates: { ...INITIAL_INPUTS.returnRates, capitalGrowth: 0.06, cashInterest: 0.03 },
        };
        // Derive the answers from the seed, change nothing, merge back.
        const out = mergeSimpleAnswers(seed, seedToSimpleAnswers(seed));
        expect(out).toEqual(seed);
        // In particular, the two accounts (and their independent ACB ratios) are untouched.
        expect(out.person.nonRegisteredAccounts).toEqual(seed.person.nonRegisteredAccounts);
    });

    it('scales every account proportionally when the aggregate is edited', () => {
        const seed: SimulationInputs = {
            ...baseDraft(),
            person: {
                ...createDefaultPerson(),
                nonRegisteredAccounts: [
                    createNonRegAccount({ balance: 120000, adjustedCostBase: 60000, receivesSurplus: true }),
                    createNonRegAccount({ balance: 80000, adjustedCostBase: 40000 }),
                ],
            },
        };
        // Old total 200k -> new total 400k, scale ×2.
        const out = mergeSimpleAnswers(seed, { ...seedToSimpleAnswers(seed), nonReg: 400000 });
        const [a, b] = out.person.nonRegisteredAccounts;
        expect(a.balance).toBe(240000);
        expect(a.adjustedCostBase).toBe(120000);
        expect(b.balance).toBe(160000);
        expect(b.adjustedCostBase).toBe(80000);
    });

    it('puts the full amount in the first account when the old aggregate is zero', () => {
        const seed: SimulationInputs = {
            ...baseDraft(),
            person: {
                ...createDefaultPerson(),
                nonRegisteredAccounts: [
                    createNonRegAccount({ balance: 0, adjustedCostBase: 0, receivesSurplus: true }),
                    createNonRegAccount({ balance: 0, adjustedCostBase: 0 }),
                ],
            },
        };
        const out = mergeSimpleAnswers(seed, { ...seedToSimpleAnswers(seed), nonReg: 50000 });
        expect(out.person.nonRegisteredAccounts[0].balance).toBe(50000);
        expect(out.person.nonRegisteredAccounts[0].adjustedCostBase).toBe(25000);
        expect(out.person.nonRegisteredAccounts[1].balance).toBe(0);
    });

    it('round-trips through the sanitizer without validation errors', () => {
        const out = mergeSimpleAnswers(baseDraft(), { ...baseAnswers, age: 67, retirementAge: 55 });
        expect(out.person.retirementAge).toBeGreaterThanOrEqual(out.person.age);
        expect(out.person.lifeExpectancy).toBeGreaterThan(out.person.retirementAge);
        expect(out.person.lifeExpectancy).toBeGreaterThan(out.person.age);
    });
});

describe('simpleAnswersErrors (raw quick-form validation)', () => {
    it('flags retirement age below current age from the RAW answers (no clamp hiding it)', () => {
        const { person } = simpleAnswersErrors({ ...baseAnswers, age: 60, retirementAge: 55 });
        expect(person).toContain("Retirement age can't be earlier than current age");
    });

    it('is clean for consistent answers', () => {
        const { person, spouse } = simpleAnswersErrors(baseAnswers);
        expect(person).toHaveLength(0);
        expect(spouse).toHaveLength(0);
    });

    it('flags an out-of-range age', () => {
        expect(simpleAnswersErrors({ ...baseAnswers, age: 120 }).person)
            .toContain('Current age must be between 18 and 99');
    });

    it('flags the spouse age only when the spouse is included', () => {
        expect(simpleAnswersErrors({ ...baseAnswers, includeSpouse: false, spouseAge: 120 }).spouse)
            .toHaveLength(0);
        expect(simpleAnswersErrors({ ...baseAnswers, includeSpouse: true, spouseAge: 120 }).spouse.length)
            .toBeGreaterThan(0);
    });
});

describe('seedToSimpleAnswers', () => {
    it('pre-fills from the current inputs (re-launch case)', () => {
        const seed: SimulationInputs = {
            ...INITIAL_INPUTS,
            province: 'AB',
            spouse: createDefaultPerson(true),
        };
        const answers = seedToSimpleAnswers(seed);
        expect(answers.age).toBe(seed.person.age);
        expect(answers.province).toBe('AB');
        expect(answers.includeSpouse).toBe(true);
        expect(answers.spouseAge).toBe(createDefaultPerson(true).age);
        expect(answers.nonReg).toBe(seed.person.nonRegisteredAccounts[0].balance);
    });

    it('reports no spouse when the seed has none', () => {
        const answers = seedToSimpleAnswers(INITIAL_INPUTS);
        expect(answers.includeSpouse).toBe(false);
    });
});
