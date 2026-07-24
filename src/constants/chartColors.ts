// Chart color constants — shared across all chart components and PersonSection.
// These must stay in sync with Tailwind color names used in CollapsibleSection accents.
export const CHART_COLORS = {
    rrsp:     '#0ea5e9',  // sky-500
    tfsa:     '#10b981',  // emerald-500
    nonReg:   '#f59e0b',  // amber-500
    spRrsp:   '#7dd3fc',  // sky-300
    spTfsa:   '#6ee7b7',  // emerald-300
    spNonReg: '#fbbf24',  // amber-400
    // Workplace DB pension — a cash-source series (SpendingChart/YearlyBreakdownTable),
    // not an account, so it isn't paired with a CollapsibleSection accent like the
    // colors above. Kept here anyway as the single source of truth for chart colors.
    pension:  '#14b8a6',  // teal-500
} as const;

// Per-plan comparison colors — deliberately distinct from the account colors
// above so overlaid plans read as separate plans, not asset classes.
export const PLAN_COLORS = ['#4f46e5', '#e11d48', '#0d9488'] as const; // indigo-600, rose-600, teal-600
