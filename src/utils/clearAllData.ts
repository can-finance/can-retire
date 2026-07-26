import { ONBOARDING_KEY, SIM_KEY } from './onboarding';
import { PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY } from '../hooks/usePlans';

// Kept in its own module rather than onboarding.ts: usePlans.ts already imports
// from onboarding.ts (readStoredSimInputs), so pulling PLANS_STORAGE_KEY /
// ACTIVE_PLAN_STORAGE_KEY the other way — from usePlans.ts into onboarding.ts —
// would create a circular import between the two.

/** Prefix shared by every localStorage key this app writes — swept as a safety
 * net below for any key added after this list was last updated. */
const APP_KEY_PREFIX = 'retirement_';

/**
 * Permanently remove every trace of this app's data from localStorage: the
 * four known keys (onboarding flag, saved simulation, plan list, active plan
 * id) plus any other key beginning with `retirement_`, so newly added storage
 * keys are covered without this list needing to be kept in sync by hand.
 * Deliberately does NOT call localStorage.clear() — that would destroy
 * unrelated data on the same origin. Wrapped in try/catch: localStorage access
 * throws in some privacy modes, and the caller must not be left in a broken
 * state if it does.
 */
export function clearAllAppData(): void {
    try {
        const keysToRemove = new Set<string>([
            ONBOARDING_KEY,
            SIM_KEY,
            PLANS_STORAGE_KEY,
            ACTIVE_PLAN_STORAGE_KEY,
        ]);
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith(APP_KEY_PREFIX)) keysToRemove.add(key);
        }
        for (const key of keysToRemove) {
            localStorage.removeItem(key);
        }
    } catch {
        // Ignore — localStorage may be unavailable (e.g. some privacy modes).
    }
}
