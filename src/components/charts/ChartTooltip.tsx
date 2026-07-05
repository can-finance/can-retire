import { formatCurrencyCAD } from '../../utils/formatters';

export interface TooltipRow {
    dataKey: string;
    name: string;
    value: number;
    color: string;
    payload?: { age?: number };
}

interface ChartTooltipProps {
    active?: boolean;
    payload?: TooltipRow[];
    labelMap?: Record<string, string>;
    showTotal?: boolean;
    totalLabel?: string;
    /** If true, use Math.abs(value) for display (e.g. SpendingChart negative tax bars) */
    absValues?: boolean;
}

export function ChartTooltip({
    active,
    payload,
    labelMap = {},
    showTotal = false,
    totalLabel = 'Total',
    absValues = false,
}: ChartTooltipProps) {
    if (!active || !payload || !payload.length) return null;

    const age = payload[0]?.payload?.age;
    const rows = payload.filter(entry => Math.abs(entry.value) >= 1);
    const total = rows.reduce((sum, entry) => sum + entry.value, 0);

    return (
        <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200">
            <p className="font-semibold text-slate-900 mb-2">Age {age}</p>
            {rows.map((entry, index) => (
                <div key={index} className="flex justify-between gap-4 text-sm">
                    <span style={{ color: entry.color }}>
                        {labelMap[entry.dataKey] || entry.name}
                    </span>
                    <span className="font-semibold text-slate-900">
                        {formatCurrencyCAD(absValues ? Math.abs(entry.value) : entry.value)}
                    </span>
                </div>
            ))}
            {showTotal && total > 0 && (
                <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between gap-4 text-sm font-semibold">
                    <span className="text-slate-900">{totalLabel}</span>
                    <span className="text-slate-900">{formatCurrencyCAD(total)}</span>
                </div>
            )}
        </div>
    );
}
