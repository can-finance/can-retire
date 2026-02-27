interface LegendEntry {
    value: string;
    color: string;
}

interface ChartLegendProps {
    payload?: LegendEntry[];
    desiredOrder?: string[];
    dotSize?: 'sm' | 'md';
}

export function ChartLegend({ payload, desiredOrder, dotSize = 'md' }: ChartLegendProps) {
    if (!payload) return null;

    const sorted = desiredOrder
        ? [...payload].sort((a, b) => {
            const ia = desiredOrder.indexOf(a.value);
            const ib = desiredOrder.indexOf(b.value);
            return ia - ib;
        })
        : payload;

    const dotClass = dotSize === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

    return (
        <ul className="flex flex-wrap justify-center gap-4 mt-4 p-0 list-none">
            {sorted.map((entry, index) => (
                <li key={`item-${index}`} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span
                        className={`${dotClass} rounded-full`}
                        style={{ backgroundColor: entry.color }}
                    />
                    {entry.value}
                </li>
            ))}
        </ul>
    );
}
