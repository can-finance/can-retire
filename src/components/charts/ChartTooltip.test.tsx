import { describe, it, expect } from 'vitest';
import { ChartTooltip } from './ChartTooltip';
import type { TooltipRow } from './ChartTooltip';

// ChartTooltip is a pure function component — call it directly and inspect the
// element tree's text, no DOM needed.
function textOf(node: unknown): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (typeof node === 'object' && 'props' in node) {
        return textOf((node as { props: { children?: unknown } }).props.children);
    }
    return '';
}

const row = (dataKey: string, value: number): TooltipRow => ({
    dataKey, name: dataKey, value, color: '#000', payload: { age: 65 }
});

describe('ChartTooltip', () => {
    it('renders nothing when inactive or empty', () => {
        expect(ChartTooltip({ active: false, payload: [row('a', 100)] })).toBeNull();
        expect(ChartTooltip({ active: true, payload: [] })).toBeNull();
        expect(ChartTooltip({ active: true })).toBeNull();
    });

    it('shows age, mapped labels, and formatted values', () => {
        const text = textOf(ChartTooltip({
            active: true,
            payload: [row('pRRSP', 80_000)],
            labelMap: { pRRSP: 'RRSP/RRIF' }
        }));
        expect(text).toContain('Age 65');
        expect(text).toContain('RRSP/RRIF');
        expect(text).toContain('$80,000');
    });

    it('filters near-zero rows', () => {
        const text = textOf(ChartTooltip({
            active: true,
            payload: [row('big', 50_000), row('tiny', 0.4)]
        }));
        expect(text).toContain('big');
        expect(text).not.toContain('tiny');
    });

    it('shows the total row only when requested and positive', () => {
        const rows = [row('a', 30_000), row('b', 20_000)];
        const withTotal = textOf(ChartTooltip({ active: true, payload: rows, showTotal: true, totalLabel: 'Total Net Worth' }));
        expect(withTotal).toContain('Total Net Worth');
        expect(withTotal).toContain('$50,000');

        const withoutTotal = textOf(ChartTooltip({ active: true, payload: rows }));
        expect(withoutTotal).not.toContain('Total');
    });

    it('absValues displays negatives as positive (tax bars)', () => {
        const text = textOf(ChartTooltip({
            active: true,
            payload: [row('Taxes', -12_345)],
            absValues: true
        }));
        expect(text).toContain('$12,345');
        expect(text).not.toContain('-$12,345');
    });
});
