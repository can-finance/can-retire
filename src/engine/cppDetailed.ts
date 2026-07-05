// Detailed CPP retirement benefit calculation using the actual Service Canada
// method: each year's pensionable earnings are expressed as a ratio of that
// year's YMPE, low years are dropped (general drop-out + child-rearing
// provision), and the average ratio is scaled by 25% of the five-year average
// YMPE at retirement.
//
// Simplifications vs. the real calculation (documented in the UI):
// - Annual granularity (real CPP works in months, from the month after the
//   18th birthday to the month before the pension starts)
// - No disability drop-out, no post-retirement benefit (PRB)
// - Base CPP only — the 2019+ enhancement components are not modelled
// - Results are in today's dollars

export const LATEST_DATA_YEAR = 2026;
const EARLIEST_CPP_YEAR = 1966; // CPP contributions began Jan 1, 1966
const MIN_CONTRIBUTORY_YEARS = 10; // 120-month legislative minimum
const GENERAL_DROPOUT_RATE = 0.17;
const REPLACEMENT_RATE = 0.25;

// Year's Maximum Pensionable Earnings, 1966–2026 (2026 announced Nov 2025).
export const YMPE_BY_YEAR: Record<number, number> = {
    1966: 5000, 1967: 5000, 1968: 5100, 1969: 5200, 1970: 5300,
    1971: 5400, 1972: 5500, 1973: 5900, 1974: 6600, 1975: 7400,
    1976: 8300, 1977: 9300, 1978: 10400, 1979: 11700, 1980: 13100,
    1981: 14700, 1982: 16500, 1983: 18500, 1984: 20800, 1985: 23400,
    1986: 25800, 1987: 25900, 1988: 26500, 1989: 27700, 1990: 28900,
    1991: 30500, 1992: 32200, 1993: 33400, 1994: 34400, 1995: 34900,
    1996: 35400, 1997: 35800, 1998: 36900, 1999: 37400, 2000: 37600,
    2001: 38300, 2002: 39100, 2003: 39900, 2004: 40500, 2005: 41100,
    2006: 42100, 2007: 43700, 2008: 44900, 2009: 46300, 2010: 47200,
    2011: 48300, 2012: 50100, 2013: 51100, 2014: 52500, 2015: 53600,
    2016: 54900, 2017: 55300, 2018: 55900, 2019: 57400, 2020: 58700,
    2021: 61600, 2022: 64900, 2023: 66600, 2024: 68500, 2025: 71300,
    2026: 74600,
};

/**
 * YMPE for a given calendar year. Future years use the latest known YMPE,
 * which means future earnings should be entered in today's dollars (the
 * ratio then assumes salary keeps pace with wage growth).
 */
export function ympeFor(year: number): number {
    if (year >= LATEST_DATA_YEAR) return YMPE_BY_YEAR[LATEST_DATA_YEAR];
    return YMPE_BY_YEAR[year] ?? YMPE_BY_YEAR[EARLIEST_CPP_YEAR];
}

/** Maximum annual base CPP at 65 in today's dollars: 25% × five-year average YMPE. */
export function maxAnnualBenefitAt65(): number {
    let sum = 0;
    for (let y = LATEST_DATA_YEAR - 4; y <= LATEST_DATA_YEAR; y++) sum += ympeFor(y);
    return REPLACEMENT_RATE * (sum / 5);
}

/** Actuarial adjustment: -0.6%/month before 65, +0.7%/month after (capped at 70). */
export function startAgeAdjustment(startAge: number): number {
    const months = (Math.min(Math.max(startAge, 60), 70) - 65) * 12;
    if (months < 0) return 1 + months * 0.006;
    return 1 + months * 0.007;
}

export interface CppDetailedInput {
    birthYear: number;
    /** Age the pension starts, 60–70 (whole years) */
    startAge: number;
    /**
     * Pensionable earnings by calendar year — nominal dollars for past years
     * (as shown on the Statement of Contributions), today's dollars for
     * future years. Missing years count as zero earnings.
     */
    earningsByYear: Record<number, number>;
    /**
     * Calendar years in which the person was the primary caregiver of a
     * child under 7 (child-rearing provision). Low-earning flagged years are
     * excluded from the average instead of dragging it down.
     */
    childRearingYears?: number[];
}

export interface CppDetailedResult {
    /** Annual benefit at the chosen start age, today's dollars */
    annualBenefit: number;
    monthlyBenefit: number;
    /** Benefit before the start-age adjustment, as a share of the max at 65 (0–1) */
    percentOfMax: number;
    /** Average pensionable-earnings ratio after drop-outs (0–1) */
    averageRatio: number;
    /** Length of the contributory period in years (before drop-outs) */
    contributoryYears: number;
    /** Years removed by the 17% general drop-out (fractional) */
    generalDropoutYears: number;
    /** Calendar years excluded by the child-rearing provision */
    childRearingDropped: number[];
    /** Start-age actuarial adjustment factor */
    adjustmentFactor: number;
    maxAnnualAt65: number;
}

function earningsRatio(year: number, earnings: number): number {
    const ympe = ympeFor(year);
    return Math.min(Math.max(earnings, 0), ympe) / ympe;
}

/**
 * Average after dropping `dropYears` (possibly fractional) of the lowest
 * values. The fractional part partially down-weights the next-lowest year,
 * mirroring the month-level precision of the real calculation.
 */
function averageWithDropout(ratios: number[], dropYears: number): number {
    const sorted = [...ratios].sort((a, b) => a - b);
    const whole = Math.floor(dropYears);
    const frac = dropYears - whole;
    let sum = 0;
    let totalWeight = 0;
    sorted.forEach((r, i) => {
        const w = i < whole ? 0 : i === whole ? 1 - frac : 1;
        sum += r * w;
        totalWeight += w;
    });
    return totalWeight > 0 ? sum / totalWeight : 0;
}

export function calculateDetailedCPP(input: CppDetailedInput): CppDetailedResult {
    const startAge = Math.min(Math.max(Math.round(input.startAge), 60), 70);
    const earnings = input.earningsByYear;

    // Contributory period: age 18 (or 1966) up to the year before the pension
    // starts. Years from 65 to a later start age are handled separately below —
    // they can only improve the benefit, never dilute it.
    const firstYear = Math.max(input.birthYear + 18, EARLIEST_CPP_YEAR);
    const baseEndAge = Math.min(startAge, 65);
    const lastYear = input.birthYear + baseEndAge - 1;

    const years: number[] = [];
    for (let y = firstYear; y <= lastYear; y++) years.push(y);

    if (years.length === 0) {
        return {
            annualBenefit: 0, monthlyBenefit: 0, percentOfMax: 0, averageRatio: 0,
            contributoryYears: 0, generalDropoutYears: 0, childRearingDropped: [],
            adjustmentFactor: startAgeAdjustment(startAge),
            maxAnnualAt65: maxAnnualBenefitAt65(),
        };
    }

    let ratios = years.map(y => ({ year: y, ratio: earningsRatio(y, earnings[y] ?? 0) }));

    // Child-rearing provision: remove flagged years whose ratio is below the
    // provisional average, worst first, keeping at least the 10-year minimum
    // contributory period.
    const childRearingDropped: number[] = [];
    const flagged = new Set(input.childRearingYears ?? []);
    if (flagged.size > 0) {
        const provisionalAvg = ratios.reduce((s, r) => s + r.ratio, 0) / ratios.length;
        const candidates = ratios
            .filter(r => flagged.has(r.year) && r.ratio < provisionalAvg)
            .sort((a, b) => a.ratio - b.ratio);
        for (const c of candidates) {
            if (ratios.length <= MIN_CONTRIBUTORY_YEARS) break;
            ratios = ratios.filter(r => r.year !== c.year);
            childRearingDropped.push(c.year);
        }
    }

    // Post-65 substitution: earnings between 65 and a later start age replace
    // the lowest remaining years when they are higher (the "over-65 drop-out").
    if (startAge > 65) {
        const post65 = [];
        for (let y = input.birthYear + 65; y <= input.birthYear + startAge - 1; y++) {
            post65.push(earningsRatio(y, earnings[y] ?? 0));
        }
        post65.sort((a, b) => b - a);
        for (const r of post65) {
            let minIdx = 0;
            for (let i = 1; i < ratios.length; i++) {
                if (ratios[i].ratio < ratios[minIdx].ratio) minIdx = i;
            }
            if (r > ratios[minIdx].ratio) ratios[minIdx] = { ...ratios[minIdx], ratio: r };
        }
    }

    const n = ratios.length;
    const generalDropoutYears = Math.max(0, Math.min(GENERAL_DROPOUT_RATE * n, n - MIN_CONTRIBUTORY_YEARS));
    const averageRatio = averageWithDropout(ratios.map(r => r.ratio), generalDropoutYears);

    const maxAt65 = maxAnnualBenefitAt65();
    const adjustmentFactor = startAgeAdjustment(startAge);
    const annualBenefit = averageRatio * maxAt65 * adjustmentFactor;

    return {
        annualBenefit,
        monthlyBenefit: annualBenefit / 12,
        percentOfMax: averageRatio,
        averageRatio,
        contributoryYears: years.length,
        generalDropoutYears,
        childRearingDropped: childRearingDropped.sort((a, b) => a - b),
        adjustmentFactor,
        maxAnnualAt65: maxAt65,
    };
}

/** Benefit at every start age 60–70, for the comparison chart. */
export function calculateAtAllStartAges(
    input: Omit<CppDetailedInput, 'startAge'>
): Array<{ startAge: number; annualBenefit: number; monthlyBenefit: number }> {
    const out = [];
    for (let age = 60; age <= 70; age++) {
        const r = calculateDetailedCPP({ ...input, startAge: age });
        out.push({ startAge: age, annualBenefit: r.annualBenefit, monthlyBenefit: r.monthlyBenefit });
    }
    return out;
}

/**
 * Generate a synthetic nominal earnings table from the simple inputs. The
 * salary is interpreted in today's dollars: it is converted to a constant
 * ratio of the current YMPE and applied to each year's historical YMPE, so
 * the table shows plausible nominal amounts the user can then refine.
 */
export function generateEarningsFromSimple(opts: {
    birthYear: number;
    workStartAge: number;
    workEndAge: number; // last age with earnings (inclusive)
    avgSalaryTodayDollars: number;
}): Record<number, number> {
    const ratio = Math.min(Math.max(opts.avgSalaryTodayDollars, 0) / ympeFor(LATEST_DATA_YEAR), 1);
    const result: Record<number, number> = {};
    const from = Math.max(opts.birthYear + opts.workStartAge, EARLIEST_CPP_YEAR);
    const to = opts.birthYear + opts.workEndAge;
    for (let y = from; y <= to; y++) {
        result[y] = Math.round(ratio * ympeFor(y));
    }
    return result;
}

/**
 * Parse pensionable earnings pasted from a Service Canada Statement of
 * Contributions. Handles the full statement table (year, contribution
 * columns, then pensionable-earnings columns with "M" maximum markers) as
 * well as simple "2004  $39,000" lines.
 *
 * The base pensionable earnings is taken as the LARGEST amount on the line:
 * contributions are only ~5% of earnings, and the first/second-additional
 * earnings columns never exceed the base portion, so the maximum is always
 * the base pensionable earnings regardless of how the columns survive
 * copy-paste. A line with an "M" marker but no amounts maps to that year's
 * YMPE. Lines without a recognizable year (headers, totals) are ignored.
 */
export function parseStatementEarnings(text: string): Record<number, number> {
    const result: Record<number, number> = {};
    for (const line of text.split(/\r?\n/)) {
        const yearMatch = line.match(/\b(19[4-9]\d|20\d\d)\b/);
        if (!yearMatch || yearMatch.index === undefined) continue;
        const year = Number(yearMatch[1]);
        if (year < EARLIEST_CPP_YEAR || year > LATEST_DATA_YEAR + 10) continue;
        const rest = line.slice(yearMatch.index + 4);
        const amounts = [...rest.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)/g)]
            .map(m => parseFloat(m[1].replace(/,/g, '')))
            .filter(n => Number.isFinite(n));
        if (amounts.length > 0) {
            result[year] = Math.max(...amounts);
        } else if (/(^|\s)M(\s|$)/.test(rest)) {
            result[year] = ympeFor(year);
        }
    }
    return result;
}
