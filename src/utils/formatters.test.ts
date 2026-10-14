import { describe, it, expect } from 'vitest';
import { formatSuccessRate } from './formatters';

// Pass/fail marks compare the unrounded rate with the target (rate >= target),
// so the shown percent must land on the same side of the target.
describe('formatSuccessRate', () => {
    it('rounds down, so a rate just under the target never reads as the target', () => {
        expect(formatSuccessRate(84.6, 85)).toBe('84%');
        expect(formatSuccessRate(84.6)).toBe('84%');
        expect(formatSuccessRate(84.99)).toBe('84%');
    });

    it('a rate exactly at the target shows the target', () => {
        expect(formatSuccessRate(85, 85)).toBe('85%');
        expect(formatSuccessRate(85.4, 85)).toBe('85%');
    });

    it('never contradicts the mark for any rate near any whole target', () => {
        for (let target = 50; target <= 99; target++) {
            for (let rate = target - 2; rate <= target + 2; rate += 0.05) {
                const shown = Number(formatSuccessRate(rate, target).replace('%', ''));
                expect(shown >= target).toBe(rate >= target);
            }
        }
    });

    it('does not show an exact rate a point low from float noise', () => {
        // 29 of 100 runs: (29 / 100) × 100 is 28.999… in floating point.
        expect(formatSuccessRate((29 / 100) * 100)).toBe('29%');
        expect(formatSuccessRate((170 / 200) * 100, 85)).toBe('85%');
    });

    it('keeps a missing rate under the target even inside the float allowance', () => {
        expect(formatSuccessRate(85 - 1e-12, 85)).toBe('84%');
    });

    it('handles the ends and a missing rate', () => {
        expect(formatSuccessRate(0)).toBe('0%');
        expect(formatSuccessRate(100)).toBe('100%');
        expect(formatSuccessRate(null)).toBe('—');
    });
});
