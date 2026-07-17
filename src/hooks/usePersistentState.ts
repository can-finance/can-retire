import { useState, useEffect, useRef, useCallback } from 'react';

export function usePersistentState<T>(
    key: string,
    initialValue: T,
    sanitize?: (raw: unknown) => T | null
): [T, (value: T) => void] {
    const [state, setState] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            if (!item) return initialValue;
            const parsed = JSON.parse(item);
            return sanitize ? (sanitize(parsed) ?? initialValue) : parsed;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    // Persist only after the CONSUMER actually changes the value — never on
    // mount. Writing on mount would clobber the "no existing data" signal that
    // first-run onboarding eligibility relies on (a Dashboard mounted behind the
    // intro scrim would otherwise stamp sample defaults into localStorage before
    // the user ever chose a path). Existing keys are already loaded into `state`,
    // so re-writing them on mount would be a redundant no-op anyway.
    //
    // We gate on a `hasChanged` ref that is flipped ONLY by a real setState call
    // from a consumer (via the wrapped setter below), not on effect-run count.
    // This is React StrictMode–safe: StrictMode double-invokes effects in dev,
    // which would defeat any "skip the first effect run" scheme, but it never
    // calls the setter — so the ref stays false until the consumer genuinely
    // changes the value, at which point the resulting re-render runs the effect
    // with `hasChanged.current === true` and the write goes through.
    const hasChanged = useRef(false);

    const setValue = useCallback((value: T) => {
        hasChanged.current = true;
        setState(value);
    }, []);

    useEffect(() => {
        if (!hasChanged.current) return;
        try {
            window.localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(error);
        }
    }, [key, state]);

    return [state, setValue];
}
