import { AccountTypeVals } from '../engine/types';
import type { Person, SimulationInputs, NonRegisteredAccount, OneTimeEvent } from '../engine/types';

export const createDefaultPerson = (isSpouse = false): Person => ({
    age: isSpouse ? 45 : 48,
    retirementAge: 60,
    lifeExpectancy: 90,
    currentIncome: isSpouse ? 50000 : 85000,
    cppStartAge: 65,
    cppContributedYears: 35,
    oasStartAge: 65,
    rrspMeltStartAge: 55,
    rrspMeltAmount: isSpouse ? 10000 : 20000,
    rrsp: { type: AccountTypeVals.RRSP, balance: isSpouse ? 300000 : 500000 },
    tfsa: { type: AccountTypeVals.TFSA, balance: isSpouse ? 100000 : 150000 },
    nonRegistered: {
        type: 'NonRegistered',
        balance: isSpouse ? 100000 : 200000,
        adjustedCostBase: isSpouse ? 50000 : 100000,
        assetMix: { interest: 0.1, dividend: 0.3, foreignDividend: 0, capitalGain: 0.6 },
        equityTurnoverRate: 0.02
    } as NonRegisteredAccount
});

export const INITIAL_INPUTS: SimulationInputs = {
    person: createDefaultPerson(),
    spouse: undefined,
    province: 'ON',
    inflationRate: 0.025,
    preRetirementSpend: 60000,
    postRetirementSpend: 55000,
    oneTimeExpenses: [],
    withdrawalStrategy: 'rrsp-first',
    rebalanceNonRegAnnually: true,
    useIncomeSplitting: true,
    returnRates: {
        interest: 0.02,
        dividend: 0.03,
        foreignYield: 0.02,
        capitalGrowth: 0.05,
        rrspGrowth: 0.05,
        tfsaGrowth: 0.05,
        volatility: 0.10
    }
};

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const optNum = (v: unknown, fallback: number | undefined): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null;

function sanitizePerson(raw: unknown, defaults: Person): Person {
    const r = isObject(raw) ? raw : {};
    const rrsp = isObject(r.rrsp) ? r.rrsp : {};
    const tfsa = isObject(r.tfsa) ? r.tfsa : {};
    const nonReg = isObject(r.nonRegistered) ? r.nonRegistered : {};
    const mix = isObject(nonReg.assetMix) ? nonReg.assetMix : {};
    const defMix = defaults.nonRegistered.assetMix;

    // Clamp each share to [0,1]; scale down proportionally if they sum above 100%
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    let mixInterest = clamp01(num(mix.interest, defMix.interest));
    let mixDividend = clamp01(num(mix.dividend, defMix.dividend));
    let mixForeignDividend = clamp01(num(mix.foreignDividend, defMix.foreignDividend ?? 0));
    let mixCapitalGain = clamp01(num(mix.capitalGain, defMix.capitalGain));
    const mixSum = mixInterest + mixDividend + mixForeignDividend + mixCapitalGain;
    if (mixSum > 1) {
        mixInterest /= mixSum;
        mixDividend /= mixSum;
        mixForeignDividend /= mixSum;
        mixCapitalGain /= mixSum;
    }
    const equityTurnoverRate = clamp01(num(nonReg.equityTurnoverRate, defaults.nonRegistered.equityTurnoverRate ?? 0));

    return {
        age: num(r.age, defaults.age),
        retirementAge: num(r.retirementAge, defaults.retirementAge),
        lifeExpectancy: num(r.lifeExpectancy, defaults.lifeExpectancy),
        currentIncome: num(r.currentIncome, defaults.currentIncome),
        cppStartAge: num(r.cppStartAge, defaults.cppStartAge),
        cppContributedYears: num(r.cppContributedYears, defaults.cppContributedYears),
        cppAnnualOverride: optNum(r.cppAnnualOverride, undefined),
        oasStartAge: num(r.oasStartAge, defaults.oasStartAge),
        rrspMeltStartAge: optNum(r.rrspMeltStartAge, defaults.rrspMeltStartAge),
        rrspMeltAmount: optNum(r.rrspMeltAmount, defaults.rrspMeltAmount),
        rrsp: { type: AccountTypeVals.RRSP, balance: num(rrsp.balance, defaults.rrsp.balance) },
        tfsa: { type: AccountTypeVals.TFSA, balance: num(tfsa.balance, defaults.tfsa.balance) },
        nonRegistered: {
            type: 'NonRegistered',
            balance: num(nonReg.balance, defaults.nonRegistered.balance),
            adjustedCostBase: num(nonReg.adjustedCostBase, defaults.nonRegistered.adjustedCostBase),
            assetMix: {
                interest: mixInterest,
                dividend: mixDividend,
                foreignDividend: mixForeignDividend,
                capitalGain: mixCapitalGain
            },
            equityTurnoverRate
        }
    };
}

function sanitizeOneTimeEvents(raw: unknown): OneTimeEvent[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((e): e is Record<string, unknown> =>
            isObject(e) && typeof e.amount === 'number' && Number.isFinite(e.amount) &&
            typeof e.age === 'number' && Number.isFinite(e.age))
        .map(e => ({
            id: typeof e.id === 'string' ? e.id : crypto.randomUUID(),
            name: typeof e.name === 'string' ? e.name : 'Event',
            amount: e.amount as number,
            age: e.age as number,
            type: e.type === 'inflow' ? 'inflow' as const : 'expense' as const
        }));
}

/**
 * Validate an untrusted SimulationInputs payload (share-URL hash, localStorage)
 * by merging it field-by-field with defaults. Returns null only if the payload
 * is not even an object with a `person` — anything else degrades gracefully to
 * defaults rather than crashing the render or the engine.
 */
export function sanitizeSimulationInputs(raw: unknown): SimulationInputs | null {
    if (!isObject(raw) || !isObject(raw.person)) return null;

    const rates = isObject(raw.returnRates) ? raw.returnRates : {};
    const defRates = INITIAL_INPUTS.returnRates;

    return {
        person: sanitizePerson(raw.person, createDefaultPerson()),
        spouse: isObject(raw.spouse) ? sanitizePerson(raw.spouse, createDefaultPerson(true)) : undefined,
        province: typeof raw.province === 'string' && PROVINCES.includes(raw.province)
            ? raw.province
            : INITIAL_INPUTS.province,
        inflationRate: num(raw.inflationRate, INITIAL_INPUTS.inflationRate),
        preRetirementSpend: num(raw.preRetirementSpend, INITIAL_INPUTS.preRetirementSpend),
        postRetirementSpend: num(raw.postRetirementSpend, INITIAL_INPUTS.postRetirementSpend),
        oneTimeExpenses: sanitizeOneTimeEvents(raw.oneTimeExpenses),
        useIncomeSplitting: typeof raw.useIncomeSplitting === 'boolean'
            ? raw.useIncomeSplitting
            : INITIAL_INPUTS.useIncomeSplitting,
        withdrawalStrategy: raw.withdrawalStrategy === 'tax-efficient' ? 'tax-efficient' : 'rrsp-first',
        rebalanceNonRegAnnually: typeof raw.rebalanceNonRegAnnually === 'boolean'
            ? raw.rebalanceNonRegAnnually
            : true,
        returnRates: {
            interest: num(rates.interest, defRates.interest),
            dividend: num(rates.dividend, defRates.dividend),
            // Payloads predating this field keep their old behavior (foreign = dividend yield)
            foreignYield: num(rates.foreignYield, num(rates.dividend, defRates.foreignYield!)),
            capitalGrowth: num(rates.capitalGrowth, defRates.capitalGrowth),
            // Payloads predating these fields keep their old behavior (RRSP/TFSA = capitalGrowth)
            rrspGrowth: num(rates.rrspGrowth, num(rates.capitalGrowth, defRates.capitalGrowth)),
            tfsaGrowth: num(rates.tfsaGrowth, num(rates.capitalGrowth, defRates.capitalGrowth)),
            volatility: optNum(rates.volatility, defRates.volatility)
        }
    };
}
