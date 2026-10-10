import { describe, it, expect } from 'vitest';
import { describeStrategyChanges } from './strategySummary';
import { strategyDiffersFromPlan } from '../../utils/meltdownOptimizer';
import type { PersonMeltdownDecision } from '../../utils/meltdownOptimizer';

// The earliest-age Apply decision (strategyDiffersFromPlan) and the "To get
// there: …" line (describeStrategyChanges) must agree on whether anything
// changed — otherwise the headline could promise "the changes below" with no
// line under it, or show a line for a result with nothing to apply.

const decision = (over: Partial<PersonMeltdownDecision> = {}): PersonMeltdownDecision => ({
    who: 'person', label: 'You', hasRrsp: true,
    meltAmount: 20_000, meltStartAge: 60, meltEndAge: 71,
    originalMeltAmount: 20_000, originalMeltStartAge: 60,
    cppStartAge: 65, cppChanged: false, originalCppStartAge: 65,
    oasStartAge: 65, oasChanged: false, originalOasStartAge: 65,
    ...over,
});

type Case = [string, PersonMeltdownDecision[], 'tax-efficient' | 'rrsp-first'];

const CASES: Case[] = [
    ['nothing changed', [decision()], 'tax-efficient'],
    ['CPP start moved', [decision({ cppStartAge: 70, cppChanged: true })], 'tax-efficient'],
    ['OAS start moved', [decision({ oasStartAge: 70, oasChanged: true })], 'tax-efficient'],
    ['melt amount changed', [decision({ meltAmount: 35_000 })], 'tax-efficient'],
    ['melt stopped', [decision({ meltAmount: 0 })], 'tax-efficient'],
    ['melt "changed" with no RRSP (does nothing)', [decision({ hasRrsp: false, meltAmount: 0 })], 'tax-efficient'],
    ['only the melt start moved (not a searched change)', [decision({ meltStartAge: 58 })], 'tax-efficient'],
    ['withdrawal order flipped', [decision()], 'rrsp-first'],
    ['spouse CPP moved', [decision(), decision({ who: 'spouse', label: 'Spouse', cppStartAge: 60, cppChanged: true })], 'tax-efficient'],
];

describe('strategyDiffersFromPlan agrees with describeStrategyChanges', () => {
    it.each(CASES)('%s', (_name, decisions, suggested) => {
        const differs = strategyDiffersFromPlan(decisions, 'tax-efficient', suggested);
        const line = describeStrategyChanges(decisions, 'tax-efficient', suggested);
        expect(line !== null).toBe(differs);
    });

    it('spot-checks the expected answers', () => {
        const differs = (name: string) => {
            const c = CASES.find(x => x[0] === name)!;
            return strategyDiffersFromPlan(c[1], 'tax-efficient', c[2]);
        };
        expect(differs('nothing changed')).toBe(false);
        expect(differs('melt "changed" with no RRSP (does nothing)')).toBe(false);
        expect(differs('only the melt start moved (not a searched change)')).toBe(false);
        expect(differs('CPP start moved')).toBe(true);
        expect(differs('melt stopped')).toBe(true);
        expect(differs('withdrawal order flipped')).toBe(true);
        expect(differs('spouse CPP moved')).toBe(true);
    });
});
