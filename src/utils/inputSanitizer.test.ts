import { describe, it, expect } from 'vitest';
import { sanitizeSimulationInputs, INITIAL_INPUTS, createDefaultPerson } from './inputSanitizer';

describe('sanitizeSimulationInputs', () => {
    it('rejects payloads that are not an object with a person', () => {
        expect(sanitizeSimulationInputs(null)).toBeNull();
        expect(sanitizeSimulationInputs('garbage')).toBeNull();
        expect(sanitizeSimulationInputs(42)).toBeNull();
        expect(sanitizeSimulationInputs({})).toBeNull();
        expect(sanitizeSimulationInputs({ person: 'not-an-object' })).toBeNull();
    });

    it('fills a minimal payload entirely with defaults', () => {
        const result = sanitizeSimulationInputs({ person: {} })!;
        // Account ids are freshly generated UUIDs — normalize them before comparing
        const stripIds = (p: ReturnType<typeof createDefaultPerson>) => ({
            ...p,
            nonRegisteredAccounts: p.nonRegisteredAccounts.map(a => ({ ...a, id: '' }))
        });
        expect(stripIds(result.person)).toEqual(stripIds(createDefaultPerson()));
        expect(result.person.nonRegisteredAccounts[0].id).toBeTruthy();
        expect(result.spouse).toBeUndefined();
        expect(result.province).toBe(INITIAL_INPUTS.province);
        expect(result.returnRates).toEqual(INITIAL_INPUTS.returnRates);
        expect(result.oneTimeExpenses).toEqual([]);
    });

    it('keeps valid fields and defaults the rest (truncated share link case)', () => {
        const result = sanitizeSimulationInputs({
            person: { age: 52, retirementAge: 61 },
            spouse: { age: 50 }
        })!;
        expect(result.person.age).toBe(52);
        expect(result.person.retirementAge).toBe(61);
        expect(result.person.lifeExpectancy).toBe(90); // defaulted
        expect(result.spouse!.age).toBe(50);
        expect(result.spouse!.rrsp.balance).toBe(createDefaultPerson(true).rrsp.balance);
    });

    it('replaces non-finite and wrong-typed numbers', () => {
        const result = sanitizeSimulationInputs({
            person: { age: NaN, currentIncome: 'lots', rrsp: { balance: Infinity } },
            inflationRate: '2%'
        })!;
        expect(result.person.age).toBe(createDefaultPerson().age);
        expect(result.person.currentIncome).toBe(createDefaultPerson().currentIncome);
        expect(result.person.rrsp.balance).toBe(createDefaultPerson().rrsp.balance);
        expect(result.inflationRate).toBe(INITIAL_INPUTS.inflationRate);
    });

    it('rejects unknown provinces and withdrawal strategies', () => {
        const result = sanitizeSimulationInputs({ person: {}, province: 'TX', withdrawalStrategy: 'yolo' })!;
        expect(result.province).toBe('ON');
        expect(result.withdrawalStrategy).toBe('tax-efficient');
    });

    it('keeps an explicit rrsp-first, and defaults a payload with no strategy to tax-efficient', () => {
        expect(sanitizeSimulationInputs({ person: {}, withdrawalStrategy: 'rrsp-first' })!.withdrawalStrategy)
            .toBe('rrsp-first');
        expect(sanitizeSimulationInputs({ person: {} })!.withdrawalStrategy).toBe('tax-efficient');
    });

    it('scales down an asset mix that sums above 100%', () => {
        const result = sanitizeSimulationInputs({
            person: { nonRegistered: { assetMix: { cash: 2, bonds: 2, dividend: 2, capitalGain: 2 } } }
        })!;
        const mix = result.person.nonRegisteredAccounts[0].assetMix;
        // Each clamped to 1, then normalized: 1/4 each
        expect(mix.cash + mix.bonds + mix.dividend + mix.capitalGain).toBeCloseTo(1, 10);
        expect(mix.cash).toBeCloseTo(1 / 4, 10);
    });

    it('normalizes across all 5 mix fields when they sum above 100%', () => {
        const result = sanitizeSimulationInputs({
            person: { nonRegistered: { assetMix: { cash: 1, bonds: 1, dividend: 1, foreignDividend: 1, capitalGain: 1 } } }
        })!;
        const mix = result.person.nonRegisteredAccounts[0].assetMix;
        expect(mix.cash).toBeCloseTo(0.2, 10);
        expect(mix.bonds).toBeCloseTo(0.2, 10);
        expect(mix.dividend).toBeCloseTo(0.2, 10);
        expect(mix.foreignDividend).toBeCloseTo(0.2, 10);
        expect(mix.capitalGain).toBeCloseTo(0.2, 10);
    });

    it('allows an asset mix that sums below 100% (uninvested remainder)', () => {
        const result = sanitizeSimulationInputs({
            person: { nonRegistered: { assetMix: { cash: 0.1, bonds: 0, dividend: 0.1, capitalGain: 0.3 } } }
        })!;
        const mix = result.person.nonRegisteredAccounts[0].assetMix;
        expect(mix.cash + mix.bonds + mix.dividend + mix.capitalGain).toBeCloseTo(0.5, 10);
    });

    it('passes a new-format bonds/cash mix through unchanged', () => {
        const result = sanitizeSimulationInputs({
            person: { nonRegistered: { assetMix: { bonds: 0.2, cash: 0.1, dividend: 0.3, foreignDividend: 0, capitalGain: 0.4 } } }
        })!;
        expect(result.person.nonRegisteredAccounts[0].assetMix).toEqual({
            bonds: 0.2, cash: 0.1, dividend: 0.3, foreignDividend: 0, capitalGain: 0.4
        });
    });

    describe('legacy single-account migration', () => {
        it('wraps a legacy nonRegistered object into a one-element account list', () => {
            const result = sanitizeSimulationInputs({
                person: {
                    nonRegistered: {
                        balance: 350_000, adjustedCostBase: 120_000,
                        assetMix: { interest: 0.2, dividend: 0.2, capitalGain: 0.6 },
                        equityTurnoverRate: 0.05
                    }
                }
            })!;
            const accounts = result.person.nonRegisteredAccounts;
            expect(accounts).toHaveLength(1);
            expect(accounts[0]).toMatchObject({
                name: 'Non-Registered',
                balance: 350_000,
                adjustedCostBase: 120_000,
                equityTurnoverRate: 0.05,
                rebalanceAnnually: true,
                receivesSurplus: true
            });
            expect(accounts[0].id).toBeTruthy();
            // Legacy `interest` slice migrates to Cash; Bonds start at 0
            expect(accounts[0].assetMix).toEqual({
                bonds: 0, cash: 0.2, dividend: 0.2, foreignDividend: 0, capitalGain: 0.6
            });
        });

        it('migrates a legacy returnRates.interest to cashInterest with the default bondReturn', () => {
            const result = sanitizeSimulationInputs({
                person: {},
                returnRates: { interest: 0.04, dividend: 0.03, capitalGrowth: 0.05 }
            })!;
            expect(result.returnRates.cashInterest).toBe(0.04);
            expect(result.returnRates.bondReturn).toBe(INITIAL_INPUTS.returnRates.bondReturn);
        });

        it('folds the legacy global rebalance flag into the migrated account', () => {
            const result = sanitizeSimulationInputs({
                person: { nonRegistered: { balance: 100_000 } },
                rebalanceNonRegAnnually: false
            })!;
            expect(result.person.nonRegisteredAccounts[0].rebalanceAnnually).toBe(false);
        });

        it("copies the person's mix onto the spouse (legacy household-mix behavior)", () => {
            const result = sanitizeSimulationInputs({
                person: {
                    nonRegistered: { assetMix: { interest: 0.5, dividend: 0.5, capitalGain: 0 }, equityTurnoverRate: 0.1 }
                },
                spouse: {
                    nonRegistered: { balance: 75_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
                }
            })!;
            const spouseAcct = result.spouse!.nonRegisteredAccounts[0];
            expect(spouseAcct.assetMix).toEqual({ bonds: 0, cash: 0.5, dividend: 0.5, foreignDividend: 0, capitalGain: 0 });
            expect(spouseAcct.equityTurnoverRate).toBe(0.1);
            expect(spouseAcct.balance).toBe(75_000); // balance is the spouse's own
        });
    });

    describe('multi-account payloads', () => {
        it('keeps all accounts and their per-account settings', () => {
            const result = sanitizeSimulationInputs({
                person: {
                    nonRegisteredAccounts: [
                        { id: 'a', name: 'GIC Ladder', balance: 50_000, adjustedCostBase: 50_000, assetMix: { bonds: 0, cash: 1, dividend: 0, capitalGain: 0 }, rebalanceAnnually: true },
                        { id: 'b', name: 'Growth ETF', balance: 250_000, adjustedCostBase: 90_000, assetMix: { bonds: 0, cash: 0, dividend: 0, capitalGain: 1 }, rebalanceAnnually: false, receivesSurplus: true }
                    ]
                }
            })!;
            const accounts = result.person.nonRegisteredAccounts;
            expect(accounts).toHaveLength(2);
            expect(accounts[0]).toMatchObject({ id: 'a', name: 'GIC Ladder', balance: 50_000, receivesSurplus: false });
            expect(accounts[1]).toMatchObject({ id: 'b', name: 'Growth ETF', rebalanceAnnually: false, receivesSurplus: true });
        });

        it('a malformed extra account degrades to a zero-balance account, not the defaults', () => {
            const result = sanitizeSimulationInputs({
                person: {
                    nonRegisteredAccounts: [
                        { balance: 10_000, adjustedCostBase: 10_000 },
                        'garbage'
                    ]
                }
            })!;
            const accounts = result.person.nonRegisteredAccounts;
            expect(accounts).toHaveLength(2);
            expect(accounts[1].balance).toBe(0);
            expect(accounts[1].adjustedCostBase).toBe(0);
            expect(accounts[1].name).toBe('Non-Registered 2');
        });

        it('an explicit empty account list yields one zero-balance account, not the defaults', () => {
            const result = sanitizeSimulationInputs({
                person: { nonRegisteredAccounts: [] }
            })!;
            const accounts = result.person.nonRegisteredAccounts;
            expect(accounts).toHaveLength(1);
            expect(accounts[0].balance).toBe(0);
            expect(accounts[0].adjustedCostBase).toBe(0);
            expect(accounts[0].receivesSurplus).toBe(true);
        });

        it('re-keys duplicate account ids (UI edits/removals target by id)', () => {
            const result = sanitizeSimulationInputs({
                person: {
                    nonRegisteredAccounts: [
                        { id: 'dup', balance: 1 },
                        { id: 'dup', balance: 2 },
                        { id: 'dup', balance: 3 }
                    ]
                }
            })!;
            const ids = result.person.nonRegisteredAccounts.map(a => a.id);
            expect(new Set(ids).size).toBe(3);
            expect(ids[0]).toBe('dup'); // first occurrence keeps its id
        });

        it("a legacy spouse alongside a new-format person keeps the spouse's own mix", () => {
            const result = sanitizeSimulationInputs({
                person: {
                    nonRegisteredAccounts: [
                        { balance: 100_000, assetMix: { bonds: 0, cash: 1, dividend: 0, capitalGain: 0 } }
                    ]
                },
                spouse: {
                    nonRegistered: { balance: 75_000, assetMix: { interest: 0, dividend: 0, capitalGain: 1 } }
                }
            })!;
            // The household-mix bake-in only applies to fully legacy payloads —
            // the person's first account must not clobber the spouse's mix
            const spouseAcct = result.spouse!.nonRegisteredAccounts[0];
            expect(spouseAcct.assetMix.capitalGain).toBe(1);
            expect(spouseAcct.assetMix.cash).toBe(0);
        });

        it('enforces exactly one surplus target (first flagged wins, defaults to first)', () => {
            const twoFlagged = sanitizeSimulationInputs({
                person: {
                    nonRegisteredAccounts: [
                        { balance: 1, receivesSurplus: true },
                        { balance: 2, receivesSurplus: true }
                    ]
                }
            })!;
            expect(twoFlagged.person.nonRegisteredAccounts.map(a => a.receivesSurplus)).toEqual([true, false]);

            const noneFlagged = sanitizeSimulationInputs({
                person: { nonRegisteredAccounts: [{ balance: 1 }, { balance: 2 }] }
            })!;
            expect(noneFlagged.person.nonRegisteredAccounts.map(a => a.receivesSurplus)).toEqual([true, false]);
        });
    });

    describe('pension', () => {
        it('is absent when not provided', () => {
            const result = sanitizeSimulationInputs({ person: {} })!;
            expect(result.person.pension).toBeUndefined();
        });

        it('degrades to absent for garbage or non-positive amounts', () => {
            expect(sanitizeSimulationInputs({ person: { pension: 'garbage' } })!.person.pension).toBeUndefined();
            expect(sanitizeSimulationInputs({ person: { pension: {} } })!.person.pension).toBeUndefined();
            expect(sanitizeSimulationInputs({ person: { pension: { annualAmount: 0 } } })!.person.pension).toBeUndefined();
            expect(sanitizeSimulationInputs({ person: { pension: { annualAmount: -5000 } } })!.person.pension).toBeUndefined();
            expect(sanitizeSimulationInputs({ person: { pension: { annualAmount: 'lots' } } })!.person.pension).toBeUndefined();
        });

        it('passes a valid pension through with defaults for omitted fields', () => {
            const result = sanitizeSimulationInputs({
                person: { retirementAge: 62, pension: { annualAmount: 24_000 } }
            })!;
            expect(result.person.pension).toEqual({
                annualAmount: 24_000,
                startAge: 62, // defaults to the person's retirement age
                indexedToInflation: true
            });
        });

        it('clamps annualAmount and startAge to their valid ranges', () => {
            const result = sanitizeSimulationInputs({
                person: { pension: { annualAmount: 5_000_000, startAge: 200 } }
            })!;
            expect(result.person.pension!.annualAmount).toBe(1_000_000);
            expect(result.person.pension!.startAge).toBe(80);

            const low = sanitizeSimulationInputs({
                person: { pension: { annualAmount: 10_000, startAge: 10 } }
            })!;
            expect(low.person.pension!.startAge).toBe(40);
        });

        it('respects an explicit indexedToInflation: false', () => {
            const result = sanitizeSimulationInputs({
                person: { pension: { annualAmount: 10_000, indexedToInflation: false } }
            })!;
            expect(result.person.pension!.indexedToInflation).toBe(false);
        });

        it('omits the bridge fields when bridgeAmount is absent or zero', () => {
            const result = sanitizeSimulationInputs({
                person: { pension: { annualAmount: 10_000, bridgeAmount: 0, bridgeEndAge: 65 } }
            })!;
            expect(result.person.pension!.bridgeAmount).toBeUndefined();
            expect(result.person.pension!.bridgeEndAge).toBeUndefined();
        });

        it('includes a clamped bridge when bridgeAmount is positive, defaulting bridgeEndAge to 65', () => {
            const result = sanitizeSimulationInputs({
                person: { pension: { annualAmount: 10_000, bridgeAmount: 999_999 } }
            })!;
            expect(result.person.pension!.bridgeAmount).toBe(500_000);
            expect(result.person.pension!.bridgeEndAge).toBe(65);
        });

        it('clamps bridgeEndAge to [55, 75]', () => {
            const result = sanitizeSimulationInputs({
                person: { pension: { annualAmount: 10_000, bridgeAmount: 5_000, bridgeEndAge: 90 } }
            })!;
            expect(result.person.pension!.bridgeEndAge).toBe(75);
        });
    });

    it('filters malformed one-time events and normalizes types', () => {
        const result = sanitizeSimulationInputs({
            person: {},
            oneTimeExpenses: [
                { name: 'Roof', amount: 30_000, age: 70 },
                { name: 'bad', amount: 'lots', age: 70 },
                'garbage',
                { amount: 10_000, age: 75, type: 'inflow' }
            ]
        })!;
        expect(result.oneTimeExpenses).toHaveLength(2);
        expect(result.oneTimeExpenses![0]).toMatchObject({ name: 'Roof', amount: 30_000, age: 70, type: 'expense' });
        expect(result.oneTimeExpenses![1].type).toBe('inflow');
        expect(result.oneTimeExpenses![1].id).toBeTruthy();
    });
});
