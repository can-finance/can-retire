/**
 * The /tutorials/ page's video list — single source for the cards, in display
 * order. Adding or reordering a video is an edit here only.
 *
 * Hosting isn't decided yet, so every entry leaves both video fields empty and
 * the page shows a "coming soon" frame. To publish a video, fill in ONE of:
 *   - `youtubeId` — the 11-character YouTube video id (embedded, click-to-play);
 *   - `videoSrc`  — a URL to a self-hosted file (e.g. '/tutorials/create-a-plan.mp4'),
 *                   optionally with `posterSrc` for the still shown before play.
 * Neither ever autoplays.
 */
export interface Tutorial {
    /** Stable slug, also used as the card's anchor (/tutorials/#<id>). */
    id: string;
    title: string;
    /** One sentence, in the site's plain voice. */
    description: string;
    /** Approximate running time for display, e.g. '1:30'. Omit until known. */
    duration?: string;
    /** The page the video is about, when it has its own page. */
    related?: { label: string; href: string };
    /** YouTube video id, when hosted on YouTube. */
    youtubeId?: string;
    /** Self-hosted video URL, when served from the site. */
    videoSrc?: string;
    /** Poster image for a self-hosted video. */
    posterSrc?: string;
}

export const TUTORIALS: Tutorial[] = [
    {
        id: 'create-a-plan',
        title: 'Create a plan',
        description:
            'Go through Guided Setup from start to finish and land on a dashboard built from your own numbers.',
        related: { label: 'Start Guided Setup', href: '/?setup=1' },
    },
    {
        id: 'dashboard-tour',
        title: 'Dashboard tour',
        description:
            'Read the net worth chart and the annual cash flow (click any bar for that year in full), see how surplus in retirement works, and find the year-by-year breakdown.',
        related: { label: 'Open the dashboard', href: '/' },
    },
    {
        id: 'all-inputs',
        title: 'All inputs explained',
        description: 'A walk through every input on the dashboard and what each one changes in your plan.',
    },
    {
        id: 'rrsp-meltdown-optimizer',
        title: 'RRSP meltdown optimizer',
        description:
            'Pick a goal, run the optimizer, and see how much to draw from your RRSP each year and why.',
        related: { label: 'RRSP withdrawal strategy', href: '/rrsp-withdrawal-strategy/' },
    },
    {
        id: 'cpp-calculator',
        title: 'CPP calculator',
        description: 'Enter your earnings and compare your CPP pension if you start it at 60, 65 or 70.',
        related: { label: 'CPP calculator', href: '/cpp-calculator/' },
    },
    {
        id: 'when-can-i-retire',
        title: 'When can I retire?',
        description:
            'Enter what you want to spend and read the earliest age your savings can support, and what you could spend instead.',
        related: { label: 'When can I retire?', href: '/when-can-i-retire/' },
    },
    {
        id: 'how-much-do-i-need',
        title: 'How much do I need to retire?',
        description: 'Enter your target spending and retirement age, and see the savings you need to get there.',
        related: { label: 'How much do I need?', href: '/how-much-do-i-need-to-retire/' },
    },
    {
        id: 'compare-plans',
        title: 'Compare plans',
        description: 'Copy a plan, change one thing, like retiring at 60 instead of 62, and compare the two side by side.',
    },
    {
        id: 'planning-as-a-couple',
        title: 'Planning as a couple',
        description:
            "Add a spouse or partner, see how their age, CPP and accounts feed into the plan, and how pension income splitting can cut your tax.",
    },
];
