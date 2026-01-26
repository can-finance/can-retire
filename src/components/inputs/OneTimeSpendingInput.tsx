import { useState } from 'react';
import type { OneTimeExpense } from '../../engine/types';

interface Props {
    expenses: OneTimeExpense[];
    onChange: (expenses: OneTimeExpense[]) => void;
}

export function OneTimeSpendingInput({ expenses, onChange }: Props) {
    const [newName, setNewName] = useState('');
    const [newAmount, setNewAmount] = useState<number>(0);
    const [newAge, setNewAge] = useState<number>(65);

    const handleAdd = () => {
        if (!newName || newAmount <= 0) return;

        const newExpense: OneTimeExpense = {
            id: Math.random().toString(36).substr(2, 9),
            name: newName,
            amount: newAmount,
            age: newAge
        };

        onChange([...expenses, newExpense]);
        setNewName('');
        setNewAmount(0);
        // keep age as is for convenience
    };

    const handleRemove = (id: string) => {
        onChange(expenses.filter(e => e.id !== id));
    };

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">One-Time Expenses</h3>

            {/* List of existing expenses */}
            {expenses.length > 0 && (
                <div className="space-y-2 mb-4">
                    {expenses.map(expense => (
                        <div key={expense.id} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 text-sm">
                            <div className="flex gap-3">
                                <span className="font-medium text-slate-700 w-32 truncate" title={expense.name}>{expense.name}</span>
                                <span className="text-slate-500">Age {expense.age}</span>
                                <span className="text-slate-900 font-semibold">${expense.amount.toLocaleString()}</span>
                            </div>
                            <button
                                onClick={() => handleRemove(expense.id)}
                                className="text-red-400 hover:text-red-600 p-1"
                                title="Remove"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add New Form */}
            <div className="grid grid-cols-12 gap-2 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="col-span-5">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                    <input
                        type="text"
                        className="w-full rounded border-slate-300 text-sm px-2 py-1.5 focus:ring-emerald-500 focus:border-emerald-500"
                        placeholder="e.g. New Car"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                    />
                </div>
                <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Age</label>
                    <input
                        type="number"
                        className="w-full rounded border-slate-300 text-sm px-2 py-1.5 focus:ring-emerald-500 focus:border-emerald-500"
                        value={newAge}
                        onChange={(e) => setNewAge(Number(e.target.value))}
                    />
                </div>
                <div className="col-span-3">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Amount</label>
                    <input
                        type="number"
                        className="w-full rounded border-slate-300 text-sm px-2 py-1.5 focus:ring-emerald-500 focus:border-emerald-500"
                        value={newAmount || ''}
                        onChange={(e) => setNewAmount(Number(e.target.value))}
                        placeholder="$"
                    />
                </div>
                <div className="col-span-2">
                    <button
                        onClick={handleAdd}
                        disabled={!newName || newAmount <= 0}
                        className="w-full bg-emerald-600 text-white rounded py-1.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>
    );
}
