
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

export type AccountType = 'RRSP' | 'TFSA' | 'NonRegistered' | 'Corp';
export const AccountTypeVals = {
    RRSP: 'RRSP' as AccountType,
    TFSA: 'TFSA' as AccountType,
    NonRegistered: 'NonRegistered' as AccountType,
    Corp: 'Corp' as AccountType
};



export interface AssetAccount {
    type: AccountType;
    balance: number;
    contributionRoom?: number; // For RRSP/TFSA
}

export interface NonRegisteredAccount extends AssetAccount {
    type: 'NonRegistered';
    adjustedCostBase: number; // For accurate capital gains calculation
    assetMix: {
        interest: number; // 0-1
        dividend: number; // 0-1
        capitalGain: number; // 0-1
    };
}

export interface Person {
    age: number;
    retirementAge: number;
    lifeExpectancy: number; // death age
    currentIncome: number;
    cppStartAge: number;
    cppContributedYears: number; // Years contributed to CPP (Max 40)
    oasStartAge: number; // Usually 65
    rrspMeltStartAge?: number; // When to start voluntary RRSP meltdown (default: retirementAge)
    rrspMeltAmount?: number; // Annual voluntary withdrawal amount
    rrsp: AssetAccount;
    tfsa: AssetAccount;
    nonRegistered: NonRegisteredAccount;
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
    totalRealizedCapGains: number;
    inflationFactor: number;
    householdSurplus: number;

    // Income Splitting
    pensionSplitAmount?: number;     // Amount of pension income split to spouse
    taxSavingsFromSplit?: number;    // Tax savings achieved from income splitting

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
        interest: number;
        dividend: number;
        capitalGrowth: number;
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
