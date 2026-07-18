/**
 * Scroll a just-navigated-to page to an in-page anchor. Callers first switch
 * pages (e.g. via a nav/router `navigate` call), then invoke this — the
 * timeout gives the new page a chance to render before we look up the
 * element by id, so `getElementById` doesn't run against the outgoing page.
 */
export function scrollToAnchorSoon(id: string): void {
    setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
}
