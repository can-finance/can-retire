import type { ReactNode } from 'react';
import type { FaqItem } from './how-it-works-faq';

const linkClass = 'underline decoration-dotted underline-offset-2 hover:text-slate-900';

/*
 * An FAQ answer as text, with the first occurrence of each of the item's link
 * texts turned into a link. The answer itself stays a plain string (it also
 * feeds the FAQPage JSON-LD); a link whose text isn't found in it is skipped.
 */
export function FaqAnswer({ answer, links }: Pick<FaqItem, 'answer' | 'links'>) {
    const found = (links ?? [])
        .map((link) => ({ ...link, start: answer.indexOf(link.text) }))
        .filter((link) => link.start >= 0)
        .sort((a, b) => a.start - b.start);

    const parts: ReactNode[] = [];
    let at = 0;
    for (const link of found) {
        // Skip a link that overlaps the one before it.
        if (link.start < at) continue;
        if (link.start > at) parts.push(answer.slice(at, link.start));
        parts.push(
            <a key={link.start} href={link.href} className={linkClass}>{link.text}</a>,
        );
        at = link.start + link.text.length;
    }
    if (at < answer.length) parts.push(answer.slice(at));

    return <>{parts}</>;
}
