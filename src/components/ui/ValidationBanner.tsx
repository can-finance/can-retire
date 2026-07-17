interface ValidationBannerProps {
    /** Amber warning lines. Renders nothing when empty. */
    errors: string[];
}

/**
 * Shared non-blocking amber validation banner. Used by the dashboard person
 * cards and both onboarding paths so the same inconsistencies read identically.
 */
export function ValidationBanner({ errors }: ValidationBannerProps) {
    if (errors.length === 0) return null;
    return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
            {errors.map((error, i) => (
                <p key={i} className="text-xs text-amber-700 flex items-center gap-1">
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                </p>
            ))}
        </div>
    );
}
