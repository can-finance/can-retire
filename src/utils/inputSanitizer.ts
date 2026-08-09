import { AccountTypeVals } from '../engine/types';
import type { Person, SimulationInputs, NonRegisteredAccount, OneTimeEvent, DBPension } from '../engine/types';

// Single source for new non-registered accounts — shared by the default person
// and the UI's "+ Add account"
export const createNonRegAccount = (overrides: Partial<NonRegisteredAccount> = {}): NonRegisteredAccount => ({
    type: 'NonRegistered',
    id: crypto.randomUUID(),
    name: 'Non-Registered',
    balance: 0,
    adjustedCostBase: 0,
    assetMix: { cash: 0.1, bonds: 0, dividend: 0.3, foreignDividend: 0, capitalGain: 0.6 },
    equityTurnoverRate: 0.02,
    rebalanceAnnually: true,
    receivesSurplus: false,
    ...overrides
});

// Exactly one surplus target per person: first flagged wins, else the first account
export const normalizeSurplusTarget = (accounts: NonRegisteredAccount[]): NonRegisteredAccount[] => {
    const surplusIdx = Math.max(0, accounts.findIndex(a => a.receivesSurplus));
    return accounts.map((a, i) => ({ ...a, receivesSurplus: i === surplusIdx }));
};

export const createDefaultPerson = (isSpouse = false): Person => ({
    age: isSpouse ? 45 : 48,
    retirementAge: 60,
    lifeExpectancy: 90,
    currentIncome: isSpouse ? 50000 : 85000,
    cppStartAge: 65,
    cppContributedYears: 35,
    oasStartAge: 65,
    // Melt at retirement, not before it. A meltdown is only worth doing in the
    // low-income window between retiring and CPP/OAS starting — starting it while
    // a full salary is still coming in taxes the draw at a peak marginal rate on
    // money the household does not need.
    rrspMeltStartAge: 60, // == retirementAge above
    rrspMeltAmount: isSpouse ? 10000 : 20000,
    rrsp: { type: AccountTypeVals.RRSP, balance: isSpouse ? 300000 : 500000 },
    tfsa: { type: AccountTypeVals.TFSA, balance: isSpouse ? 100000 : 150000 },
    nonRegisteredAccounts: [createNonRegAccount({
        balance: isSpouse ? 100000 : 200000,
        adjustedCostBase: isSpouse ? 50000 : 100000,
        receivesSurplus: true
    })]
});

// Household spending defaults. A second adult does not double a household's
// costs — housing, utilities and durables are shared — so the couple figures
// use the OECD square-root equivalence scale (~1.4x), not 2x. Without this,
// adding a spouse leaves a two-earner household modelled as spending a single
// person's budget, which makes it implausibly over-funded: the RRSPs are never
// drawn down and compound until mandatory RRIF minimums force them out.
export const DEFAULT_SPEND = {
    single: { pre: 60000, post: 55000 },
    couple: { pre: 84000, post: 77000 }
} as const;

export const INITIAL_INPUTS: SimulationInputs = {
    person: createDefaultPerson(),
    spouse: undefined,
    province: 'ON',
    inflationRate: 0.025,
    preRetirementSpend: DEFAULT_SPEND.single.pre,
    postRetirementSpend: DEFAULT_SPEND.single.post,
    oneTimeExpenses: [],
    // "RRSP last" (draw non-registered, then TFSA, then RRSP). Across 13 test
    // plans this left the larger estate in 11 — but the winner is plan-dependent,
    // which is why the optimizer searches both orders rather than assuming one.
    withdrawalStrategy: 'tax-efficient',
    useIncomeSplitting: true,
    returnRates: {
        bondReturn: 0.035,
        cashInterest: 0.02,
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

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function sanitizeNonRegAccount(raw: unknown, defaults: NonRegisteredAccount, index: number): NonRegisteredAccount {
    const a = isObject(raw) ? raw : {};
    const mix = isObject(a.assetMix) ? a.assetMix : {};
    const defMix = defaults.assetMix;

    // Legacy payloads had a single `interest` slice — migrate it to Cash (bonds
    // start at 0) so pre-split results are unchanged
    const isLegacyMix = !('bonds' in mix) && !('cash' in mix);

    // Clamp each share to [0,1]; scale down proportionally if they sum above 100%
    let mixBonds = isLegacyMix ? 0 : clamp01(num(mix.bonds, defMix.bonds));
    let mixCash = isLegacyMix
        ? clamp01(num(mix.interest, defMix.cash))
        : clamp01(num(mix.cash, defMix.cash));
    let mixDividend = clamp01(num(mix.dividend, defMix.dividend));
    let mixForeignDividend = clamp01(num(mix.foreignDividend, defMix.foreignDividend ?? 0));
    let mixCapitalGain = clamp01(num(mix.capitalGain, defMix.capitalGain));
    const mixSum = mixBonds + mixCash + mixDividend + mixForeignDividend + mixCapitalGain;
    if (mixSum > 1) {
        mixBonds /= mixSum;
        mixCash /= mixSum;
        mixDividend /= mixSum;
        mixForeignDividend /= mixSum;
        mixCapitalGain /= mixSum;
    }

    return {
        type: 'NonRegistered',
        id: typeof a.id === 'string' && a.id ? a.id : crypto.randomUUID(),
        name: typeof a.name === 'string' && a.name.trim()
            ? a.name.trim()
            : (index === 0 ? 'Non-Registered' : `Non-Registered ${index + 1}`),
        balance: num(a.balance, defaults.balance),
        adjustedCostBase: num(a.adjustedCostBase, defaults.adjustedCostBase),
        assetMix: {
            bonds: mixBonds,
            cash: mixCash,
            dividend: mixDividend,
            foreignDividend: mixForeignDividend,
            capitalGain: mixCapitalGain
        },
        equityTurnoverRate: clamp01(num(a.equityTurnoverRate, defaults.equityTurnoverRate ?? 0)),
        rebalanceAnnually: typeof a.rebalanceAnnually === 'boolean' ? a.rebalanceAnnually : true,
        receivesSurplus: a.receivesSurplus === true
    };
}

function sanitizeNonRegAccounts(r: Record<string, unknown>, defaults: Person, legacyRebalance?: boolean): NonRegisteredAccount[] {
    const defAcct = defaults.nonRegisteredAccounts[0];
    let accounts: NonRegisteredAccount[];

    if (Array.isArray(r.nonRegisteredAccounts)) {
        if (r.nonRegisteredAccounts.length === 0) {
            // An explicit empty list means "no accounts declared" — produce one
            // zero-balance account, not the person defaults ($200k would appear
            // out of nowhere)
            accounts = [createNonRegAccount({ receivesSurplus: true })];
        } else {
            // Extra accounts fall back to an empty account, not the person defaults —
            // a malformed second entry must not conjure the default $200k balance
            const emptyDefaults: NonRegisteredAccount = {
                ...defAcct, balance: 0, adjustedCostBase: 0, assetMix: { ...defAcct.assetMix }
            };
            accounts = r.nonRegisteredAccounts.map((a, i) =>
                sanitizeNonRegAccount(a, i === 0 ? defAcct : emptyDefaults, i));
        }
    } else {
        // Legacy payload (pre multi-account): single `nonRegistered` object plus a
        // global rebalance flag — wrap it into a one-element list
        const acct = sanitizeNonRegAccount(r.nonRegistered, defAcct, 0);
        if (legacyRebalance === false) acct.rebalanceAnnually = false;
        accounts = [acct];
    }

    // The UI patches/removes/keys by id, so duplicate ids in an untrusted payload
    // must be re-keyed (per person is enough — the engine never reads ids)
    const seenIds = new Set<string>();
    for (const a of accounts) {
        if (seenIds.has(a.id)) a.id = crypto.randomUUID();
        seenIds.add(a.id);
    }

    return normalizeSurplusTarget(accounts);
}

// Absent/invalid/non-positive amount => omit the field entirely (undefined, not
// a default object) so old payloads stay byte-identical through
// sanitize -> JSON.stringify (see usePlans' inputsEqual).
function sanitizePension(raw: unknown, resolvedRetirementAge: number): DBPension | undefined {
    if (!isObject(raw)) return undefined;

    const annualAmount = Math.min(1_000_000, Math.max(0, num(raw.annualAmount, 0)));
    if (annualAmount <= 0) return undefined;

    const startAge = Math.min(80, Math.max(40, num(raw.startAge, resolvedRetirementAge)));
    const indexedToInflation = typeof raw.indexedToInflation === 'boolean' ? raw.indexedToInflation : true;
    // Bridge is only meaningful alongside a nonzero amount — omit both bridge
    // fields (not just default them) when the amount clamps to 0
    const bridgeAmount = Math.min(500_000, Math.max(0, num(raw.bridgeAmount, 0)));

    return {
        annualAmount,
        startAge,
        indexedToInflation,
        ...(bridgeAmount > 0 ? {
            bridgeAmount,
            bridgeEndAge: Math.min(75, Math.max(55, num(raw.bridgeEndAge, 65)))
        } : {})
    };
}

function sanitizePerson(raw: unknown, defaults: Person, legacyRebalance?: boolean): Person {
    const r = isObject(raw) ? raw : {};
    const rrsp = isObject(r.rrsp) ? r.rrsp : {};
    const tfsa = isObject(r.tfsa) ? r.tfsa : {};
    const retirementAge = num(r.retirementAge, defaults.retirementAge);

    return {
        age: num(r.age, defaults.age),
        retirementAge,
        lifeExpectancy: num(r.lifeExpectancy, defaults.lifeExpectancy),
        currentIncome: num(r.currentIncome, defaults.currentIncome),
        cppStartAge: num(r.cppStartAge, defaults.cppStartAge),
        cppContributedYears: num(r.cppContributedYears, defaults.cppContributedYears),
        cppAnnualOverride: optNum(r.cppAnnualOverride, undefined),
        oasStartAge: num(r.oasStartAge, defaults.oasStartAge),
        rrspMeltStartAge: optNum(r.rrspMeltStartAge, defaults.rrspMeltStartAge),
        rrspMeltAmount: optNum(r.rrspMeltAmount, defaults.rrspMeltAmount),
        pension: sanitizePension(r.pension, retirementAge),
        rrsp: { type: AccountTypeVals.RRSP, balance: num(rrsp.balance, defaults.rrsp.balance) },
        tfsa: { type: AccountTypeVals.TFSA, balance: num(tfsa.balance, defaults.tfsa.balance) },
        nonRegisteredAccounts: sanitizeNonRegAccounts(r, defaults, legacyRebalance)
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
 *
 * SCHEMA CHANGES — read before editing the shape of SimulationInputs.
 *
 * There is deliberately NO version field in the stored payload. Migrations are
 * inferred structurally (see `isLegacyMix` and the legacy-household-mix block
 * below), which is fine for the two cheap kinds of change:
 *   - ADDING a field      → the defaults merge handles it for free.
 *   - RENAMING a field    → explicit old-key lookup, e.g.
 *                           num(rates.cashInterest, num(rates.interest, def)).
 *
 * It is NOT fine for the expensive kind: changing the MEANING, UNITS, or
 * old-vs-new DEFAULT of a field whose name and type stay the same. That is
 * invisible to structural inspection, and the fallback chains here (foreignYield
 * → dividend, rrspGrowth/tfsaGrowth → capitalGrowth) already conflate "this
 * payload predates the field" with "this payload is truncated or broken" —
 * which share links routinely are.
 *
 * So: if you make a change of that kind, add a `schemaVersion` integer IN THE
 * SAME COMMIT. Deferring until then is free — everything written before that
 * commit shares one schema, so an absent version unambiguously means "pre-that-
 * change". What is NOT free is making the change and forgetting: two different
 * schemas both reading as absent leaves structural sniffing as the only recourse.
 *
 * If you do add it, put it in the RETURN VALUE here, not just at write time.
 * usePlans' inputsEqual compares JSON.stringify(sanitize(a)) against
 * JSON.stringify(sanitize(b)); a field present on only one side makes every
 * mount look like a change and churns lastSaved on reconciliation row 5.
 */
export function sanitizeSimulationInputs(raw: unknown): SimulationInputs | null {
    if (!isObject(raw) || !isObject(raw.person)) return null;

    const rates = isObject(raw.returnRates) ? raw.returnRates : {};
    const defRates = INITIAL_INPUTS.returnRates;

    // Pre multi-account payloads carried one global rebalance flag — fold it into
    // each migrated account
    const legacyRebalance = typeof raw.rebalanceNonRegAnnually === 'boolean'
        ? raw.rebalanceNonRegAnnually
        : undefined;

    const person = sanitizePerson(raw.person, createDefaultPerson(), legacyRebalance);
    const spouse = isObject(raw.spouse) ? sanitizePerson(raw.spouse, createDefaultPerson(true), legacyRebalance) : undefined;

    // Legacy payloads had a single household asset mix: the engine used to
    // overwrite the spouse's stored mix with the person's at run time. Bake that
    // override in during migration so results don't change — but only when the
    // WHOLE payload is legacy. A new-format person means the person's first
    // account is just one account of several, not "the household mix".
    if (spouse && isObject(raw.spouse) && !Array.isArray(raw.spouse.nonRegisteredAccounts)
        && !Array.isArray(raw.person.nonRegisteredAccounts)) {
        const src = person.nonRegisteredAccounts[0];
        const dst = spouse.nonRegisteredAccounts[0];
        dst.assetMix = { ...src.assetMix };
        dst.equityTurnoverRate = src.equityTurnoverRate;
        dst.rebalanceAnnually = src.rebalanceAnnually;
    }

    return {
        person,
        spouse,
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
        // Unrecognised (or absent) values fall back to the default order. Every
        // payload the app has ever written carries an explicit value — the field
        // predates the save/import feature — so this only catches hand-edited or
        // third-party JSON.
        withdrawalStrategy: raw.withdrawalStrategy === 'rrsp-first' ? 'rrsp-first' : 'tax-efficient',
        returnRates: {
            bondReturn: num(rates.bondReturn, defRates.bondReturn),
            // Legacy payloads had a single `interest` rate — it becomes the cash rate
            cashInterest: num(rates.cashInterest, num(rates.interest, defRates.cashInterest)),
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
