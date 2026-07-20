import { useEffect, useId, useState } from 'react';
import { FinancialInput } from './FinancialInput';
import { AssetMixInput } from './AssetMixInput';
import { HelpTooltip } from '../ui/HelpTooltip';
import { createNonRegAccount, normalizeSurplusTarget } from '../../utils/inputSanitizer';
import type { NonRegisteredAccount } from '../../engine/types';

interface Props {
    accounts: NonRegisteredAccount[];
    onChange: (accounts: NonRegisteredAccount[]) => void;
    /** Hex color — matches the person's non-reg chart color */
    accentColor: string;
    /** Blended drift readout (primary person only, when any account drifts) */
    driftSummary?: string | null;
}

// The engine never reads names, so commit on blur/Enter (like FinancialInput) —
// committing per keystroke would re-run the full simulation on every letter typed
function AccountNameInput({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
    const [draft, setDraft] = useState(name);

    // Sync with external updates (scenario load, sanitizer rename)
    useEffect(() => { setDraft(name); }, [name]);

    const commit = () => {
        const trimmed = draft.trim();
        if (!trimmed) setDraft(name); // don't commit an empty name
        else if (trimmed !== name) onCommit(trimmed);
    };

    return (
        <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="flex-1 min-w-0 text-sm font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-500 focus:outline-none"
            aria-label="Account name"
        />
    );
}

// One-line composition summary for a collapsed account card, e.g. "60% eq · 30% bond · 10% div"
function mixSummary(a: NonRegisteredAccount): string {
    const parts: string[] = [];
    const pct = (v: number) => Math.round(v * 100);
    if (a.assetMix.capitalGain > 0) parts.push(`${pct(a.assetMix.capitalGain)}% eq`);
    if (a.assetMix.bonds > 0) parts.push(`${pct(a.assetMix.bonds)}% bond`);
    if (a.assetMix.dividend > 0) parts.push(`${pct(a.assetMix.dividend)}% div`);
    if ((a.assetMix.foreignDividend || 0) > 0) parts.push(`${pct(a.assetMix.foreignDividend!)}% fgn`);
    if (a.assetMix.cash > 0) parts.push(`${pct(a.assetMix.cash)}% cash`);
    if (parts.length === 0) parts.push('uninvested');
    if (a.rebalanceAnnually === false) parts.push('drifts');
    return parts.join(' · ');
}

export function NonRegAccountsInput({ accounts, onChange, accentColor, driftSummary }: Props) {
    const surplusGroup = useId();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const toggleExpanded = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const patch = (id: string, p: Partial<NonRegisteredAccount>) =>
        onChange(accounts.map(a => a.id === id ? { ...a, ...p } : a));

    const addAccount = () => {
        // New accounts start from the last account's settings — adding "another
        // brokerage account" is the common case. The sanitizer guarantees at
        // least one account, so the template always exists.
        const template = accounts[accounts.length - 1];
        onChange([...accounts, createNonRegAccount({
            name: `Non-Registered ${accounts.length + 1}`,
            assetMix: { ...template.assetMix },
            equityTurnoverRate: template.equityTurnoverRate,
            rebalanceAnnually: template.rebalanceAnnually,
            receivesSurplus: false
        })]);
    };

    const removeAccount = (id: string) => {
        const remaining = accounts.filter(a => a.id !== id);
        if (remaining.length === 0) return; // the engine expects at least one account
        onChange(normalizeSurplusTarget(remaining));
    };

    const setSurplusTarget = (id: string) =>
        onChange(accounts.map(a => ({ ...a, receivesSurplus: a.id === id })));

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <label className="text-sm font-semibold" style={{ color: accentColor }}>
                    Non-Registered
                </label>
                <button
                    onClick={addAccount}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                >
                    + Add account
                </button>
            </div>

            {accounts.map(account => {
                const expanded = expandedIds.has(account.id);
                return (
                    <div key={account.id} className="rounded-lg border border-slate-200 bg-white"
                        style={{ borderLeftColor: accentColor, borderLeftWidth: '3px' }}>
                        <div className="p-2.5 space-y-2">
                            <div className="flex items-center gap-2">
                                <AccountNameInput
                                    name={account.name}
                                    onCommit={(name) => patch(account.id, { name })}
                                />
                                {accounts.length > 1 && (
                                    <HelpTooltip text="Surplus cash left over each year (after TFSA/RRSP contributions) is invested into this account.">
                                        <label className="flex items-center gap-1 text-xs font-medium text-slate-500 cursor-pointer whitespace-nowrap">
                                            <input
                                                type="radio"
                                                name={surplusGroup}
                                                checked={account.receivesSurplus === true}
                                                onChange={() => setSurplusTarget(account.id)}
                                                className="accent-brand-600"
                                            />
                                            Surplus
                                        </label>
                                    </HelpTooltip>
                                )}
                                {accounts.length > 1 && (
                                    <button
                                        onClick={() => removeAccount(account.id)}
                                        className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                                        title="Remove account"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <FinancialInput label="Balance" value={account.balance} accentColor={accentColor}
                                    onChange={(e) => patch(account.id, { balance: Number(e.target.value) })} />
                                <FinancialInput label="ACB" value={account.adjustedCostBase} accentColor={accentColor}
                                    onChange={(e) => patch(account.id, { adjustedCostBase: Number(e.target.value) })}
                                    tooltip="Adjusted cost base — the total amount originally invested (book value). Gains above this are taxed when realized." />
                            </div>

                            <button
                                onClick={() => toggleExpanded(account.id)}
                                className="w-full flex items-center justify-between transition-colors"
                            >
                                <span className="text-sm font-medium text-brand-600 hover:text-brand-700">{expanded ? '▾' : '▸'} Adjust asset mix</span>
                                {!expanded && <span className="text-xs text-slate-400 truncate ml-2">{mixSummary(account)}</span>}
                            </button>

                            {expanded && (
                                <AssetMixInput
                                    mix={account.assetMix}
                                    turnoverRate={account.equityTurnoverRate}
                                    rebalanceAnnually={account.rebalanceAnnually !== false}
                                    onChange={(newMix) => patch(account.id, { assetMix: newMix })}
                                    onTurnoverChange={(rate) => patch(account.id, { equityTurnoverRate: rate })}
                                    onRebalanceChange={(rebalance) => patch(account.id, { rebalanceAnnually: rebalance })}
                                />
                            )}
                        </div>
                    </div>
                );
            })}

            {driftSummary && (
                <p className="text-xs text-indigo-600 font-medium">{driftSummary}</p>
            )}
        </div>
    );
}
