import { TUTORIALS, type Tutorial } from './tutorials-data';

/**
 * 16:9 video frame for one tutorial. Renders, in order of preference, a YouTube
 * embed, a self-hosted <video>, or a "coming soon" placeholder when neither field
 * is set (the state every entry is in until hosting is decided). Nothing
 * autoplays: the embed has no autoplay param and the <video> has controls only.
 */
function TutorialVideo({ tutorial }: { tutorial: Tutorial }) {
    const frameClass = 'relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900';

    if (tutorial.youtubeId) {
        return (
            <div className={frameClass}>
                <iframe
                    className="absolute inset-0 h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${tutorial.youtubeId}`}
                    title={tutorial.title}
                    loading="lazy"
                    allow="encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                />
            </div>
        );
    }

    if (tutorial.videoSrc) {
        return (
            <div className={frameClass}>
                <video
                    className="absolute inset-0 h-full w-full"
                    src={tutorial.videoSrc}
                    poster={tutorial.posterSrc}
                    controls
                    preload="metadata"
                    playsInline
                />
            </div>
        );
    }

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

export function Tutorials() {
    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20">
            {/* Hero */}
            <section className="text-center space-y-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Canadian Retirement Asset Planning tool</p>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Video tutorials</h1>
                <p className="max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
                    Short, silent videos that show you how to use the tool, one task at a time. Each takes a
                    minute or two.
                </p>
            </section>

            <ol className="space-y-6">
                {TUTORIALS.map((tutorial, index) => (
                    <li
                        key={tutorial.id}
                        id={tutorial.id}
                        className="scroll-mt-24 bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-100 space-y-5"
                    >
                        <div className="flex items-start gap-4">
                            <span className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-sm font-bold">
                                {index + 1}
                            </span>
                            <div className="min-w-0 space-y-1.5">
                                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{tutorial.title}</h2>
                                <p className="text-base text-slate-600 leading-relaxed">{tutorial.description}</p>
                                {(tutorial.duration || tutorial.related) && (
                                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                                        {tutorial.duration && <span>About {tutorial.duration}</span>}
                                        {tutorial.related && (
                                            <a
                                                href={tutorial.related.href}
                                                className="font-medium text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-600 transition-colors"
                                            >
                                                {tutorial.related.label} →
                                            </a>
                                        )}
                                    </p>
                                )}
                            </div>
                        </div>
                        <TutorialVideo tutorial={tutorial} />
                    </li>
                ))}
            </ol>
        </div>
    );
}
