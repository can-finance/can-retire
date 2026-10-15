// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SummaryHeader } from './SummaryHeader';
import type { SummaryMetrics } from '../../utils/summaryMetrics';
import type { MonteCarloResult } from '../../engine/types';

afterEach(cleanup);

// Only the fields the header reads; the rest of SummaryMetrics doesn't matter here.
const metrics = {
    outOfMoneyAge: null,
    totalShortfall: 0,
    totalSpending: 2_000_000,
    netEstateValue: 500_000,
    estateTax: 50_000,
    annualTaxRetirement: 10_000,
    effectiveTaxRateRetirement: 10,
    effectiveTaxRateEstate: 20,
    totalEffectiveTaxRate: 15,
    totalTaxPlusEstate: 400_000,
} as unknown as SummaryMetrics;

const mc = (successRate: number): MonteCarloResult => ({ percentiles: [], successRate, medianEndOfPlanAssets: 0 });

describe('SummaryHeader success rate', () => {
    it('shows a whole percent rounded down, like the optimizer and comparison', () => {
        render(<SummaryHeader metrics={metrics} monteCarlo={mc(93.5)} />);
        expect(screen.getByText('93%')).toBeInTheDocument();
        expect(screen.queryByText('93.5%')).toBeNull();
        expect(screen.queryByText('94%')).toBeNull();
    });

    it('shows an exact rate as is', () => {
        render(<SummaryHeader metrics={metrics} monteCarlo={mc(100)} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
    });
});
