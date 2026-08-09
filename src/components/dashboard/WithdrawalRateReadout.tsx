import { HelpTooltip } from '../ui/HelpTooltip';

/*
 * The initial withdrawal rate, shown under the spending inputs because spending
 * is the only input that moves it much — it belongs next to the dial that
 * changes it, not in the outcome header.
 *
 * What computeSummaryMetrics actually computes (see summaryMetrics.ts), and
 * therefore what the copy below has to be honest about:
 *
 *   numerator   = totalRRSPWithdrawal + totalTFSAWithdrawal + totalNonRegWithdrawal
 *                 in the FIRST year of retirement — one year, not an average
 *   denominator = total account balances at the START of that year
 *                 (retiring later: the previous projected year's totalAssets;
 *                  already retired: the balances typed into the plan today)
 *
 * Both branches are the same sentence — "withdrawals in the first year of
 * retirement over savings at the start of that year" — which is what the label
 * and tooltip say. It is deliberately NOT a lifetime or average figure.
 *
 * On wording: this app is explicitly not financial, tax or investment advice
 * (see the footer). The 4% figure is presented as a widely cited reference
 * point and marked on the scale, and nothing here calls a rate safe, unsafe,
 * good or bad, or tells the reader to change anything.
 */

// The scale runs 0–8% so the 4% reference sits dead centre and is unmissable.
const SCALE_MAX = 8;
const REFERENCE = 4;

const pct = (v: number) => `${Math.max(0, Math.min(100, (v / SCALE_MAX) * 100))}%`;

export function WithdrawalRateReadout({ rate }: { rate: number }) {
    return (
        <div className="mt-4 pt-3 border-t border-emerald-200/50">
            <div className="flex items-baseline justify-between gap-3">
                <HelpTooltip
                    text={
                        'Everything withdrawn from RRSP/RRIF, TFSA and non-registered accounts in the first year of retirement, ' +
                        'divided by the total balance of those accounts at the start of that year.\n\n' +
                        'One year only. The rate in later years moves with spending, CPP/OAS starting, RRIF minimums and returns.'
                    }
                    className="w-fit"
                >
                    <span className="text-sm font-medium text-slate-700 cursor-help border-b border-dashed border-slate-300">
                        First-year withdrawal rate
                    </span>
                </HelpTooltip>
                <span className="text-2xl font-bold text-teal-700 tabular-nums">{rate.toFixed(1)}%</span>
            </div>

            {/* Purely a locator for the 4% reference — the figure and the note below
                carry the whole meaning, so screen readers skip the decoration. */}
            <div className="mt-3" aria-hidden="true">
                <div className="relative h-2.5 rounded-full bg-slate-200">
                    <div
                        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-slate-500"
                        style={{ left: pct(REFERENCE) }}
                    />
                    <div
                        className="absolute -top-1 w-1.5 -translate-x-1/2 rounded-sm bg-teal-600 ring-2 ring-white"
                        // 18px against the 10px track: 4px of overhang each side.
                        style={{ left: pct(rate), height: '1.125rem' }}
                    />
                </div>
                <div className="relative mt-1 h-4">
                    <span
                        className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-slate-500"
                        style={{ left: pct(REFERENCE) }}
                    >
                        4% reference
                    </span>
                </div>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Withdrawals in your first year of retirement as a share of savings at the start of that year.
                The widely cited 4% guideline is marked for comparison only — this tool does not judge what
                rate is right for you.
            </p>
        </div>
    );
}
