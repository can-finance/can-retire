/**
 * The /tutorials/ page's video list — single source for the cards, in display
 * order. Adding or reordering a video is an edit here only.
 *
 * Hosting is decided: the videos are self-hosted. The MP4s are attachments on the
 * `tutorial-videos` GitHub Release and the deploy workflow copies them into
 * dist/tutorials/ (see "Publishing" in tutorial-videos/README.md), so each
 * `videoSrc` below is a path next to the page. The deploy fails if a listed file
 * is missing from the release (scripts/check-tutorial-videos.mjs).
 *
 * An entry with no video field shows a "coming soon" frame. To publish a video,
 * fill in ONE of:
 *   - `videoSrc`  — a URL to a self-hosted file (e.g. '/tutorials/create-a-plan.mp4');
 *   - `youtubeId` — the 11-character YouTube video id;
 * plus `posterSrc`, the card image. Posters are committed under
 * public/tutorials/posters/ and generated from the MP4 and `title` by
 * tutorial-videos/posters.mjs (see "Posters" in tutorial-videos/README.md).
 * The grid shows only posters; a video loads, and plays, once its card is clicked.
 */
export interface Tutorial {
    /** Stable slug, also used as the card's anchor (/tutorials/#<id>). */
    id: string;
    title: string;
    /** One sentence, in the site's plain voice. */
    description: string;
    /** The page the video is about, when it has its own page. */
    related?: { label: string; href: string };
    /** YouTube video id, when hosted on YouTube. */
    youtubeId?: string;
    /** Self-hosted video URL, when served from the site. */
    videoSrc?: string;
    /** Card image (16:9). Without one, a video card shows a plain dark frame. */
    posterSrc?: string;
}

export const TUTORIALS: Tutorial[] = [
    {
        id: 'create-a-plan',
        title: 'Create a plan',
        description:
            'Use Guided Setup\'s Quick start to turn a few numbers about you into a full plan on the dashboard.',
        videoSrc: '/tutorials/create-a-plan.mp4',
        posterSrc: '/tutorials/posters/create-a-plan.jpg',
        related: { label: 'Go to Guided Setup', href: '/?setup=1' },
    },
    {
        id: 'dashboard-tour',
        title: 'Dashboard tour',
        description:
            'Read the net worth chart and the annual cash flow (click any bar for that year in full), see how surplus in retirement works, and find the year-by-year breakdown.',
        videoSrc: '/tutorials/dashboard-tour.mp4',
        posterSrc: '/tutorials/posters/dashboard-tour.jpg',
        related: { label: 'Go to the dashboard', href: '/' },
    },
    {
        id: 'all-inputs',
        title: 'All inputs explained',
        description:
            'A walk through every input on the dashboard and what each one changes, including moving your retirement age and watching the plan update.',
        videoSrc: '/tutorials/all-inputs.mp4',
        posterSrc: '/tutorials/posters/all-inputs.jpg',
        related: { label: 'Go to the dashboard', href: '/' },
    },
    {
        id: 'rrsp-meltdown-optimizer',
        title: 'RRSP meltdown optimizer',
        description:
            'Pick a goal, run the optimizer, and see how much to draw from your RRSP each year, why, and how the result compares with your current plan.',
        videoSrc: '/tutorials/rrsp-optimizer.mp4',
        posterSrc: '/tutorials/posters/rrsp-optimizer.jpg',
        related: { label: 'Go to the RRSP withdrawal strategy page', href: '/rrsp-withdrawal-strategy/' },
    },
    {
        id: 'cpp-calculator',
        title: 'CPP calculator',
        description:
            'Enter your earnings, compare your CPP pension if you start it at 60, 65 or 70, see how it was worked out, and use the estimate in your plan.',
        videoSrc: '/tutorials/cpp-calculator.mp4',
        posterSrc: '/tutorials/posters/cpp-calculator.jpg',
        related: { label: 'Go to the CPP calculator', href: '/cpp-calculator/' },
    },
    {
        id: 'when-can-i-retire',
        title: 'When can I retire?',
        description:
            'Enter what you want to spend and read the earliest age your savings can support, then use the table to see what you could spend retiring earlier or later.',
        videoSrc: '/tutorials/when-can-i-retire.mp4',
        posterSrc: '/tutorials/posters/when-can-i-retire.jpg',
        related: { label: 'Go to When can I retire?', href: '/when-can-i-retire/' },
    },
    {
        id: 'how-much-do-i-need',
        title: 'How much do I need to retire?',
        description:
            'Enter your target spending and retirement age, see the savings you need and how far you are from them, and two ways to close the gap.',
        videoSrc: '/tutorials/how-much-do-i-need.mp4',
        posterSrc: '/tutorials/posters/how-much-do-i-need.jpg',
        related: { label: 'Go to How much do I need?', href: '/how-much-do-i-need-to-retire/' },
    },
    {
        id: 'compare-plans',
        title: 'Compare plans',
        description:
            'Copy a plan, change one thing, like retiring at 60 instead of 62, and compare the two side by side: success rate, estate, spending and tax.',
        videoSrc: '/tutorials/compare-plans.mp4',
        posterSrc: '/tutorials/posters/compare-plans.jpg',
        related: { label: 'Go to the dashboard', href: '/' },
    },
    {
        id: 'planning-as-a-couple',
        title: 'Planning as a couple',
        description:
            'Add a spouse or partner, see how their income, pension and accounts feed into the plan, and how pension income splitting cuts your household tax.',
        videoSrc: '/tutorials/planning-as-a-couple.mp4',
        posterSrc: '/tutorials/posters/planning-as-a-couple.jpg',
        related: { label: 'Go to the dashboard', href: '/' },
    },
];
