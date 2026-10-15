import { describe, it, expect } from 'vitest';
import { runSimulation } from '../engine/projection';
import { preRetirementDeficit } from './preRetirementDeficit';
import { buildNeedInputs, initialNeedForm } from '../components/pages/how-much-do-i-need-inputs';
import type { NeedForm } from '../components/pages/how-much-do-i-need-inputs';

// The "How much do I need to retire?" page's defaults: 48 in Ontario on $85k,
// $850k saved, $60k a year before retiring at 62.
const plan = (over: Partial<NeedForm> = {}) => buildNeedInputs({
    ...initialNeedForm(),
    age: 48, province: 'ON', currentIncome: 85_000, includeSpouse: false,
    rrsp: 500_000, tfsa: 150_000, nonReg: 200_000,
    preRetirementSpend: 60_000, postRetirementSpend: 55_000, retirementAge: 62,
    ...over,
});

// Take-home pay as the engine sees it: with nothing saved and nothing spent,
// year one's whole after-tax pay is left over as surplus.
const engineTakeHome = (over: Partial<NeedForm>): number => {
    const inputs = buildNeedInputs({
        ...initialNeedForm(), age: 48, province: 'ON', includeSpouse: false,
        rrsp: 0, tfsa: 0, nonReg: 0, preRetirementSpend: 0, postRetirementSpend: 0, retirementAge: 62,
        ...over,
    });
    const year = runSimulation(inputs)[0];
    expect(year.shortfall).toBe(0);
    return year.householdSurplus;
};

describe('preRetirementDeficit', () => {
    it('spending above take-home pay: the difference, against the engine’s own tax', () => {
        const d = preRetirementDeficit(plan({ currentIncome: 120_000, preRetirementSpend: 200_000 }));
        const takeHome = engineTakeHome({ currentIncome: 120_000 });
        expect(takeHome).toBeGreaterThan(60_000);
        expect(takeHome).toBeLessThan(120_000);
        expect(d.takeHome).toBeCloseTo(takeHome, 2);
        expect(d.deficit).toBeCloseTo(200_000 - takeHome, 2);
    });

    it('the page defaults: pay covers spending, no deficit', () => {
        const d = preRetirementDeficit(plan());
        expect(d.deficit).toBe(0);
        expect(d.takeHome).toBeCloseTo(engineTakeHome({ currentIncome: 85_000 }), 2);
        expect(d.takeHome).toBeGreaterThan(60_000);
    });

    it('a couple: household pay against household spending', () => {
        const couple = { includeSpouse: true, spouseAge: 46, spouseIncome: 60_000 };
        const d = preRetirementDeficit(plan({ ...couple, currentIncome: 85_000, preRetirementSpend: 200_000 }));
        const takeHome = engineTakeHome({ ...couple, currentIncome: 85_000 });
        expect(takeHome).toBeGreaterThan(engineTakeHome({ currentIncome: 85_000 }));
        expect(d.deficit).toBeCloseTo(200_000 - takeHome, 2);
    });

    it('already retired: nothing to compare', () => {
        expect(preRetirementDeficit(plan({ age: 66, retirementAge: 66, preRetirementSpend: 200_000 })))
            .toEqual({ deficit: 0, takeHome: 0 });
    });
});
