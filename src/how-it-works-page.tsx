import { HowItWorks } from './components/pages/HowItWorks';
import { AppLayout } from './components/layout/AppLayout';

/**
 * The /how-it-works/ page body — AppLayout chrome (header, nav, footer) wrapping
 * the HowItWorks prose. Extracted into a side-effect-free module so it can be
 * imported by BOTH the client entry (`how-it-works-standalone.tsx`, which mounts
 * it with createRoot) and the build-time SSR entry (`prerender/how-it-works-ssr.tsx`,
 * which renders it to static HTML). No onLaunchOnboarding — the standalone MPA
 * pages have no onboarding overlay, so the "Guided Setup" control links to the
 * dashboard instead (see AppLayout).
 */
export function StandaloneHowItWorksPage() {
    return (
        <AppLayout activePage="how-it-works">
            <HowItWorks />
        </AppLayout>
    );
}
