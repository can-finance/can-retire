import type { SimulationInputs } from '../engine/types';
import { INITIAL_INPUTS, sanitizeSimulationInputs } from './inputSanitizer';

/** First-visit flag — written on onboarding Finish or Skip, never on merely viewing. */
export const ONBOARDING_KEY = 'retirement_onboarding_v1';

/** Single source of truth for the saved-plan localStorage key (used app-wide). */
export const SIM_KEY = 'retirement_sim_v2';

/**
 * Eligible only when there is no onboarding flag, no saved simulation data, and
 * the URL is not a share link. All storage access is wrapped so any error means
 * NOT eligible (fail closed — never trap the user in onboarding).
 */
export function isOnboardingEligible(): boolean {
    try {
        if (localStorage.getItem(ONBOARDING_KEY) !== null) return false;
        if (localStorage.getItem(SIM_KEY) !== null) return false;
        if (window.location.hash.startsWith('#start=')) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse + sanitize whatever is currently stored under SIM_KEY, or null if
 * absent/corrupt/unsanitizable. Shared by hasSavedPlan (existence check) and
 * loadDraftSeed (actual seed value) so the "is this a real plan" logic lives
 * in exactly one place.
 */
function readSavedPlan(): SimulationInputs | null {
    try {
        const raw = localStorage.getItem(SIM_KEY);
        if (!raw) return null;
        return sanitizeSimulationInputs(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * Whether a saved plan currently exists. Read live (not captured at mount) so a
 * first-run user who finishes/skips and then reopens Guided setup is correctly
 * treated as a re-launch. Existence alone isn't enough — the stored value must
 * parse and sanitize into a real plan, otherwise a corrupt/unrelated SIM_KEY
 * value would incorrectly present as a re-launch ("keep my current numbers").
 * Fails closed to false on any storage error.
 */
export function hasSavedPlan(): boolean {
    return readSavedPlan() !== null;
}

export function markOnboardingDone(): void {
    try {
        localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
        // Ignore — worst case onboarding shows again next visit
    }
}

/**
 * Seed for the wizard draft: current saved data when present (re-launch), else
 * defaults. Always returns a fresh object tree — sanitizeSimulationInputs
 * builds new objects throughout, and the defaults fallback is deep-cloned so
 * wizard edits can never alias INITIAL_INPUTS.
 */
export function loadDraftSeed(): SimulationInputs {
    return readSavedPlan() ?? (JSON.parse(JSON.stringify(INITIAL_INPUTS)) as SimulationInputs);
}

/** Sanitize and persist the finished draft, then mark onboarding done. */
export function commitOnboardingInputs(inputs: SimulationInputs): void {
    try {
        const clean = sanitizeSimulationInputs(inputs) ?? INITIAL_INPUTS;
        localStorage.setItem(SIM_KEY, JSON.stringify(clean));
        markOnboardingDone();
    } catch {
        // Ignore — Dashboard will fall back to defaults
    }
}
