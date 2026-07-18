/**
 * Boot-time redirect for legacy hash routes.
 *
 * The app used to be a single-page hash router (/#cpp-calculator,
 * /#how-it-works). The CPP Calculator and How-It-Works pages are now real,
 * crawlable MPA pages at /cpp-calculator/ and /how-it-works/, and the SPA at /
 * is dashboard-only. Old bookmarks and shared links using the legacy hashes
 * still need to land on the right page, so on boot we translate a legacy hash
 * into a path redirect.
 *
 * `#start=...` share links (mid-wizard scenario imports) and everything else
 * belong on the dashboard and are left untouched.
 *
 * Pure and side-effect-free so it can be unit-tested without jsdom navigation;
 * the caller in main.tsx performs the actual `window.location.replace`.
 */
export function redirectTargetForHash(hash: string): string | null {
    // Mirror the old pageFromHash: accept both `#cpp-calculator` and the
    // `#/cpp-calculator` router-style form by stripping a leading `#` and an
    // optional `/`.
    const stripped = hash.replace(/^#\/?/, '');
    if (stripped === 'cpp-calculator' || stripped === 'cpp') return '/cpp-calculator/';
    if (stripped === 'how-it-works') return '/how-it-works/';
    return null;
}
