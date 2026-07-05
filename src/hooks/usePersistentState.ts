import { useState, useEffect } from 'react';

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

    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(error);
        }
    }, [key, state]);

    return [state, setState];
}
