
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
    // Granular Net Cash Sources (Household Total)
    totalTFSAWithdrawal: number;
    totalNonRegWithdrawal: number; // Principal + Gains
    totalRRSPWithdrawal: number;   // RRIF + Melt + Extra
    // Split Sources for Visualization
    personTFSAWithdrawal: number;
    spouseTFSAWithdrawal: number;
    personNonRegWithdrawal: number;
    spouseNonRegWithdrawal: number;
    personRRSPWithdrawal: number;
    spouseRRSPWithdrawal: number;
    // Granular Income Components (Household Total)
    employmentIncome: number;
    investmentIncome: number; // Interest + Dividends Only
    totalRealizedCapGains: number;
    inflationFactor: number;
    householdSurplus: number;
}

export interface SimulationInputs {
    person: Person;
    spouse?: Person;
    province: string;
    inflationRate: number;
    preRetirementSpend: number; // Household spending pre-retirement
    postRetirementSpend: number; // Household spending post-retirement
    useIncomeSplitting?: boolean;
    withdrawalStrategy?: 'tax-efficient' | 'rrsp-first';
    returnRates: {
        interest: number;
        dividend: number;
        capitalGrowth: number;
    };
}
