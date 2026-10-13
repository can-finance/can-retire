import { describe, it, expect } from 'vitest';
import { needHandoff } from './how-much-do-i-need-handoff';
import { buildNeedInputs, initialNeedForm } from './how-much-do-i-need-inputs';
import type { SavingsNeededResult } from '../../utils/meltdownOptimizer';

// Which plan the "See the full plan" link opens, under what name. Results are
// hand-built fixtures: no solver runs.

// The plan as entered: 50 today, retiring at 60, $500k saved, CPP at 65.
const baseline = () => buildNeedInputs({
    ...initialNeedForm(), age: 50, retirementAge: 60,
    rrsp: 300_000, tfsa: 150_000, nonReg: 50_000,
});

// The answer's plan: more savings, and CPP at 70.
const recommended = () => {
    const r = baseline();
    r.person.rrsp.balance = 420_000;
    r.person.tfsa.balance = 210_000;
    r.person.cppStartAge = 70;
    return r;
};

const sn = (over: Partial<SavingsNeededResult> = {}): SavingsNeededResult => ({
    status: 'found', basis: 'proportional',
    currentSavings: 500_000, neededSavings: 700_000, deterministicSavings: 650_000,
    searchCap: 10_000_000, savingsGap: 200_000,
    haveEnough: false, needIsZero: false, strategyChangeNeeded: false,
    neededAccounts: [],
    stillWorking: true, reportedWho: 'person', currentAge: 50, retirementAge: 60,
    neededAtRetirement: 1_203_000, currentAtRetirement: 851_000,
    mcSuccessTarget: 85, achievedSuccessRate: 87, stepUpCapHit: false, boundHit: false,
    postRetirementSpend: 60_000, withdrawalStrategy: 'tax-efficient', strategyChanged: false,
    badMarketsAge: null,
    ...over,
});

const handoff = (over: Partial<SavingsNeededResult> = {}) => needHandoff({
    savingsNeeded: sn(over), baselineInputs: baseline(), recommendedInputs: recommended(),
});

describe('/how-much-do-i-need-to-retire/ hand-off to the full planner', () => {
    it('need more: opens the plan at the savings needed, named after the amount at retirement', () => {
        const h = handoff()!;
        expect(h.inputs.person.rrsp.balance).toBe(420_000);
        expect(h.inputs.person.cppStartAge).toBe(70);
        expect(h.name).toBe('Retire at 60 with $1.2M');
        expect(h.buttonLabel).toBe('See the full plan');
    });

    it('need more, retiring now: named after today’s amount', () => {
        const h = handoff({ stillWorking: false, retirementAge: null, neededAtRetirement: null, currentAtRetirement: null })!;
        expect(h.name).toBe('Retire now with $700k');
    });

    it('need more, spouse still working: named after the spouse', () => {
        expect(handoff({ reportedWho: 'spouse' })!.name).toBe('Spouse retires at 60 with $1.2M');
    });

    it('have enough: opens the plan as entered, balances untouched', () => {
        const h = handoff({ haveEnough: true, neededSavings: 440_000 })!;
        expect(h.inputs).toEqual(baseline());
        expect(h.name).toBe('Retire at 60');
        expect(h.buttonLabel).toBe('See the full plan');
    });

    it('have enough with a strategy change: merges only the strategy, never the balances', () => {
        const h = handoff({ haveEnough: true, neededSavings: 440_000, strategyChangeNeeded: true })!;
        expect(h.inputs.person.cppStartAge).toBe(70);
        expect(h.inputs.person.rrsp.balance).toBe(300_000);
        expect(h.inputs.person.tfsa.balance).toBe(150_000);
        expect(h.name).toBe('Retire at 60');
    });

    it('have enough, already retired: "My plan"', () => {
        expect(handoff({ haveEnough: true, neededSavings: 440_000, stillWorking: false, retirementAge: null })!.name).toBe('My plan');
    });

    it('no amount works: the plan as entered, to open in the planner', () => {
        const unreachable = handoff({ status: 'unreachable', neededSavings: null, achievedSuccessRate: null })!;
        expect(unreachable.inputs).toEqual(baseline());
        expect(unreachable.name).toBe('Retire at 60');
        expect(unreachable.buttonLabel).toBe('Open in the full planner');

        const boundHit = handoff({ boundHit: true, achievedSuccessRate: 72 })!;
        expect(boundHit.inputs).toEqual(baseline());
        expect(boundHit.buttonLabel).toBe('Open in the full planner');

        const capHitShort = handoff({ stepUpCapHit: true, achievedSuccessRate: 80 })!;
        expect(capHitShort.inputs.person.rrsp.balance).toBe(300_000);
        expect(capHitShort.buttonLabel).toBe('Open in the full planner');
    });

    it('nothing to hand off without a savings answer', () => {
        expect(needHandoff({ baselineInputs: baseline(), recommendedInputs: recommended() })).toBeNull();
    });
});
