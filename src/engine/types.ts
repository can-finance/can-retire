
export interface TaxRates {
    federalBrackets: TaxBracket[];
    provincialBrackets: Record<string, TaxBracket[]>;
    basicPersonalAmount: {
        federal: number;
        [province: string]: number;
    };
    cpp: {
        maxPensionableEarnings: number;
        basicExemption: number;
        maxContribution: number;
    };
    oas: {
        maxAnnualBenefit: number;
        clawbackThreshold: number;
    };
}

export interface TaxBracket {
    threshold: number;
    rate: number;
}

export type AccountType = 'RRSP' | 'TFSA' | 'NonRegistered';
export const AccountTypeVals = {
    RRSP: 'RRSP' as AccountType,
    TFSA: 'TFSA' as AccountType,
    NonRegistered: 'NonRegistered' as AccountType,
};



export interface AssetAccount {
    type: AccountType;
    balance: number;
    contributionRoom?: number; // For RRSP/TFSA
}

export interface NonRegisteredAccount extends AssetAccount {
    type: 'NonRegistered';
    id: string;
    name: string;
    adjustedCostBase: number; // For accurate capital gains calculation
    assetMix: {
        bonds: number; // 0-1
        cash: number; // 0-1
        dividend: number; // 0-1: Canadian eligible dividends (gross-up + dividend tax credit)
        foreignDividend?: number; // 0-1: foreign dividends, fully taxable as ordinary income
        capitalGain: number; // 0-1
    };
    // Fraction of unrealized gains realized each year by fund turnover /
    // distributions (0-1). Taxed annually and added to ACB (reinvested).
    equityTurnoverRate?: number;
    // Rebalance this account back to its target weights each year (default true).
    // When false, only the Equity slice compounds: income slices stay flat in
    // dollars and the equity share drifts up over time.
    rebalanceAnnually?: boolean;
    // Surplus cash is swept into this account. At most one per person; when none
    // is flagged the first account receives surplus.
    receivesSurplus?: boolean;
}

// Balance-weighted asset-class weights across a set of non-registered accounts
export interface NonRegMix {
    bonds: number;
    cash: number;
    dividend: number;
    foreignDividend: number;
    capitalGain: number;
}

export interface Person {
    age: number;
    retirementAge: number;
    lifeExpectancy: number; // death age
    currentIncome: number;
    cppStartAge: number;
    cppContributedYears: number; // Years contributed to CPP (Max 40)
    cppAnnualOverride?: number; // Annual CPP in today's dollars from the CPP Calculator page; replaces the simple estimate
    oasStartAge: number; // Usually 65
    rrspMeltStartAge?: number; // When to start voluntary RRSP meltdown (default: retirementAge)
    rrspMeltAmount?: number; // Annual voluntary withdrawal amount
    rrsp: AssetAccount;
    tfsa: AssetAccount;
    nonRegisteredAccounts: NonRegisteredAccount[]; // At least one; sanitizer guarantees it
}

export interface SimulationResult {
    year: number;
    age: number;
    spouseAge?: number;
    totalAssets: number;
    grossIncome: number; // Pre-tax total income (household)
    cppIncome: number; // Combined CPP
    oasIncome: number; // Combined OAS
    netIncome: number;
    spending: number; // Desired spend for the year (household)
    taxPaid: number; // Combined tax
    personTaxPaid: number; // Primary person's share (post-split when splitting applies)
    spouseTaxPaid: number; // Spouse's share (post-split when splitting applies)
    oasClawbackPaid: number; // Household OAS recovery tax included in taxPaid (pre-split)
    // Investment tax by source (marginal attribution: extra tax that source adds
    // on top of all other income). dividendTaxPaid can be negative — the dividend
    // tax credit can shelter other income at low incomes.
    capGainsTaxPaid: number;
    // Gains deemed realized at death this year (full gain amount). Nonzero only
    // in a death year with no surviving spouse (rollover branches contribute 0,
    // since ACB transfers and the gains surface at the second death).
    terminalRealizedGains: number;
    dividendTaxPaid: number;
    interestTaxPaid: number; // Bonds + cash interest + foreign dividends (all ordinary income)
    accounts: {
        rrsp: number;
        tfsa: number;
        nonRegistered: number;
        nonRegisteredACB: number;
    };
    spouseAccounts?: {
        rrsp: number;
        tfsa: number;
        nonRegistered: number;
        spouseNonRegisteredACB: number;
    };
    // Granular Net Cash Sources (Household Total) for Visualization
    netEmploymentIncome: number;
    netCPPIncome: number;
    netOASIncome: number;
    netInvestmentIncome: number; // Interest + Dividends
    // Per-person benefit nets (You/Spouse breakdown in the table)
    personNetCPP: number;
    spouseNetCPP: number;
    personNetOAS: number;
    spouseNetOAS: number;

    // Net Withdrawals (After Tax, Actual Cash in Hand)
    netRRSPWithdrawal: number;
    netTFSAWithdrawal: number;
    netNonRegWithdrawal: number;

    // Granular Reinvestments (Surplus Allocation)
    reinvestedTFSA: number;
    reinvestedRRSP: number;
    reinvestedNonReg: number;

    // Split Net Sources for Visualization
    personNetRRSP: number;
    spouseNetRRSP: number;
    personNetTFSA: number;
    spouseNetTFSA: number;
    personNetNonReg: number;
    spouseNetNonReg: number;

    // Raw tracking
    totalTFSAWithdrawal: number;
    totalNonRegWithdrawal: number; // Principal + Gains
    totalRRSPWithdrawal: number;   // RRIF + Melt + Extra
    employmentIncome: number;
    investmentIncome: number; // Interest + Dividends Only
    // Household capital gains realized this year from non-reg sales while living
    // (the full gain, not the 50% taxable portion). Terminal (at-death) deemed
    // gains are reported separately in terminalRealizedGains.
    totalRealizedCapGains: number;
    inflationFactor: number;
    householdSurplus: number;
    shortfall: number; // Target spending the household could NOT fund after draining all accounts

    // Income Splitting
    pensionSplitAmount?: number;     // Amount of pension income split to spouse
    taxSavingsFromSplit?: number;    // Tax savings achieved from income splitting

    // Non-reg composition at end of year, per person: balance-weighted blend of
    // that person's accounts (drifts when an account's annual rebalancing is off).
    // Undefined once the person has no accounts (dead / rolled over to survivor).
    nonRegMix?: NonRegMix;
    spouseNonRegMix?: NonRegMix;
    // Same blends restricted to accounts with rebalancing OFF — the only ones
    // that actually drift. Feeds the UI drift readout so rebalanced accounts
    // (whose weights move only via selling/surplus) don't register as drift.
    nonRegDriftMix?: NonRegMix;
    spouseNonRegDriftMix?: NonRegMix;

    // Estate / Death Year Calculations
    isDeathYear?: boolean;                    // True if this is the final year for person or spouse
    personDeathThisYear?: boolean;            // Primary person died this year
    spouseDeathThisYear?: boolean;            // Spouse died this year
    terminalTaxOnRRSP?: number;               // Tax on deemed disposition of RRSP/RRIF at death
    terminalTaxOnCapGains?: number;           // Tax on unrealized Non-Reg gains at death
    totalTerminalTax?: number;                // Combined terminal tax bill
    grossEstateValue?: number;                // Total assets before terminal tax
    netEstateValue?: number;                  // Assets minus terminal tax (what heirs receive)
    rrspRolledToSpouse?: number;              // RRSP amount rolled over tax-free to surviving spouse
}

export interface OneTimeEvent {
    id: string;
    name: string;
    amount: number;
    age: number; // Age of primary person when expense occurs
    type?: 'expense' | 'inflow';
}

export interface SimulationInputs {
    person: Person;
    spouse?: Person;
    province: string;
    inflationRate: number;
    preRetirementSpend: number; // Household spending pre-retirement
    postRetirementSpend: number; // Household spending post-retirement
    oneTimeExpenses?: OneTimeEvent[];
    useIncomeSplitting?: boolean;
    withdrawalStrategy?: 'tax-efficient' | 'rrsp-first';
    returnRates: {
        bondReturn: number;
        cashInterest: number;
        dividend: number;
        foreignYield?: number; // Yield on the foreign-dividend slice; falls back to `dividend`
        capitalGrowth: number; // Non-registered Equity (Growth) slice appreciation
        rrspGrowth?: number; // Whole-account RRSP return; falls back to capitalGrowth
        tfsaGrowth?: number; // Whole-account TFSA return; falls back to capitalGrowth
        volatility?: number; // Standard Deviation (e.g., 0.1 for 10% std dev)
    };
}

export interface MonteCarloPercentile {
    year: number;
    age: number;
    p5: number;   // 5th percentile (Worst case)
    p25: number;
    p50: number;  // Median
    p75: number;
    p95: number;  // 95th percentile (Best case)
}

export interface MonteCarloResult {
    percentiles: MonteCarloPercentile[];
    successRate: number; // 0-100% of runs that didn't run out of money
    medianEndOfPlanAssets: number;
}
