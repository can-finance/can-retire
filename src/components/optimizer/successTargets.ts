/*
 * The Monte Carlo success bars a spending or retirement-age answer can be held
 * to, with their labels and one-line explanations. Shared by the in-app
 * optimizer and the /when-can-i-retire/ page so both offer the same choices in
 * the same words.
 *
 * `blurb` is the spending framing (max-spend); `ageBlurb` the retirement-age one.
 */
export interface SuccessTarget {
    value: number;
    label: string;
    blurb: string;
    ageBlurb: string;
}

export const SUCCESS_TARGETS: SuccessTarget[] = [
    {
        value: 75, label: 'Aggressive',
        blurb: 'Spend more, accept more risk of falling short.',
        ageBlurb: 'Retire sooner, accept more risk of falling short.',
    },
    {
        value: 85, label: 'Balanced',
        blurb: 'A sensible middle ground (recommended).',
        ageBlurb: 'A sensible middle ground (recommended).',
    },
    {
        value: 95, label: 'Conservative',
        blurb: 'Spend less, stay funded in almost every scenario.',
        ageBlurb: 'Retire later, stay funded in almost every scenario.',
    },
];

/** The recommended bar, selected by default. */
export const DEFAULT_SUCCESS_TARGET = 85;
