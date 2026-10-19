import { useCallback, useEffect, useRef, useState } from 'react';
import { TUTORIALS, type Tutorial } from './tutorials-data';

const hasVideo = (t: Tutorial) => Boolean(t.youtubeId || t.videoSrc);

/**
 * The player inside the popup. Only mounted while the popup is open, so closing
 * it unmounts the <video>/<iframe> and playback stops.
 */
function TutorialPlayer({ tutorial }: { tutorial: Tutorial }) {
    const frameClass = 'relative aspect-video w-full overflow-hidden bg-slate-900';

    if (tutorial.youtubeId) {
        return (
            <div className={frameClass}>
                <iframe
                    className="absolute inset-0 h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${tutorial.youtubeId}?autoplay=1`}
                    title={tutorial.title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                />
            </div>
        );
    }

    return (
        <div className={frameClass}>
            <video
                className="absolute inset-0 h-full w-full"
                src={tutorial.videoSrc}
                poster={tutorial.posterSrc}
                controls
                autoPlay
                // The videos are silent; muted also keeps autoplay allowed everywhere.
                muted
                playsInline
                // Safe only because this mounts on a card click: the MP4 is never
                // fetched for a page visit, so Cloudflare's per-file request
                // counts for /tutorials/*.mp4 track plays. Keep it that way.
                preload="auto"
            />
        </div>
    );
}

/** "Coming soon" frame for an entry with no video yet. Not clickable. */
function ComingSoon() {
    return (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-2 text-slate-400">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
            </svg>
            <p className="text-sm font-medium">Video coming soon</p>
        </div>
    );
}

/**
 * Grid of poster cards; clicking one opens its video in a native <dialog>
 * (showModal gives the focus trap, Esc and an inert page for free). The grid
 * loads only the poster images: no video bytes are fetched until a card is
 * clicked. The open video is mirrored in the URL hash (/tutorials/#<id>), so a
 * link to a card opens its video. The page is prerendered, so every touch of
 * window, history or the dialog stays in effects and handlers.
 */
export function Tutorials() {
    const [openId, setOpenId] = useState<string | null>(null);
    const openIdRef = useRef<string | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    // Card buttons by tutorial id, to hand focus back to on close.
    const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
    const openTutorial = TUTORIALS.find((t) => t.id === openId);

    const open = useCallback((id: string) => {
        setOpenId(id);
        history.replaceState(null, '', `#${id}`);
    }, []);

    const close = useCallback(() => dialogRef.current?.close(), []);

    // Every way out (Esc, the X, a backdrop click, a hash change) ends in the
    // dialog's close event, which clears the state and the hash and returns focus.
    const handleClosed = useCallback(() => {
        const id = openIdRef.current;
        setOpenId(null);
        history.replaceState(null, '', location.pathname + location.search);
        if (id) buttonRefs.current.get(id)?.focus();
    }, []);

    // Show the dialog and lock page scroll while a video is open.
    useEffect(() => {
        openIdRef.current = openId;
        const dialog = dialogRef.current;
        if (!dialog || !openId) return;
        if (!dialog.open) dialog.showModal();
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = overflow;
        };
    }, [openId]);

    // Deep links: open the video named by the hash, on load and on hash changes.
    useEffect(() => {
        const sync = () => {
            const id = decodeURIComponent(location.hash.slice(1));
            const tutorial = TUTORIALS.find((t) => t.id === id);
            if (tutorial && hasVideo(tutorial)) setOpenId(id);
            else if (dialogRef.current?.open) dialogRef.current.close();
        };
        sync();
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, []);

    return (
        <div className="max-w-6xl mx-auto space-y-12 pb-20">
            {/* Hero */}
            <section className="text-center space-y-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Video tutorials</h1>
                <p className="max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
                    Start with “Create a plan” and “Dashboard tour”, then come back to learn more about
                    building a complete retirement plan.
                </p>
            </section>

            <ol className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {TUTORIALS.map((tutorial, index) => (
                    <li
                        key={tutorial.id}
                        id={tutorial.id}
                        className="scroll-mt-24 bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-100 space-y-4"
                    >
                        {hasVideo(tutorial) ? (
                            <button
                                type="button"
                                ref={(el) => {
                                    if (el) buttonRefs.current.set(tutorial.id, el);
                                    else buttonRefs.current.delete(tutorial.id);
                                }}
                                onClick={() => open(tutorial.id)}
                                aria-label={`Play video: ${tutorial.title}`}
                                aria-haspopup="dialog"
                                className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-slate-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                            >
                                {tutorial.posterSrc && (
                                    <img
                                        src={tutorial.posterSrc}
                                        alt={tutorial.title}
                                        loading="lazy"
                                        width={1280}
                                        height={720}
                                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]"
                                    />
                                )}
                                <span className="absolute inset-0 bg-slate-950/0 transition-colors group-hover:bg-slate-950/20 group-focus-visible:bg-slate-950/20" />
                                <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-700 shadow-lg transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110">
                                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28A1 1 0 008 5.14z" />
                                    </svg>
                                </span>
                            </button>
                        ) : (
                            <ComingSoon />
                        )}
                        <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-bold">
                                {index + 1}
                            </span>
                            <div className="min-w-0 space-y-1">
                                <h2 className="text-lg font-bold text-slate-900">{tutorial.title}</h2>
                                <p className="text-sm text-slate-600 leading-relaxed">{tutorial.description}</p>
                            </div>
                        </div>
                    </li>
                ))}
            </ol>

            <dialog
                ref={dialogRef}
                onClose={handleClosed}
                // A click on the dialog element itself (not its content) is a click on the backdrop.
                onClick={(e) => {
                    if (e.target === e.currentTarget) close();
                }}
                aria-label={openTutorial?.title}
                className="m-auto max-w-none max-h-none overflow-visible bg-transparent p-0 backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm"
                // As wide as fits, and short enough to leave room for the close button and title.
                style={{ width: 'min(1100px, 92vw, calc((100vh - 13rem) * 16 / 9))' }}
            >
                {openTutorial && (
                    <div className="space-y-3">
                        {/* Click-through row, so clicks beside the X count as backdrop clicks */}
                        <div className="pointer-events-none flex justify-end">
                            <button
                                type="button"
                                onClick={close}
                                aria-label="Close"
                                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 transition-colors"
                            >
                                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
                            <TutorialPlayer tutorial={openTutorial} />
                            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-4 sm:px-6">
                                <h2 className="text-lg sm:text-xl font-bold text-slate-900">{openTutorial.title}</h2>
                                {/* Read, watch, then go: the link leaves this page, so it sits after the video */}
                                {openTutorial.related && (
                                    <a
                                        href={openTutorial.related.href}
                                        className="text-sm font-medium text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-600 transition-colors"
                                    >
                                        {openTutorial.related.label} →
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </dialog>
        </div>
    );
}
