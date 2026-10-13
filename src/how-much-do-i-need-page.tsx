import { HowMuchDoINeed } from './components/pages/HowMuchDoINeed';
import { AppLayout } from './components/layout/AppLayout';

/**
 * The /how-much-do-i-need-to-retire/ page body — AppLayout chrome (header, nav,
 * footer) wrapping the HowMuchDoINeed calculator and prose. Extracted into a
 * side-effect-free module so it can be imported by BOTH the client entry
 * (`how-much-do-i-need-standalone.tsx`, which mounts it with createRoot) and the
 * build-time SSR entry (`prerender/how-much-do-i-need-ssr.tsx`, which renders it
 * to static HTML). No onLaunchOnboarding — the standalone MPA pages have no
 * onboarding overlay, so the "Guided Setup" control links to the dashboard
 * instead (see AppLayout).
 */
export function StandaloneHowMuchDoINeedPage() {
    return (
        <AppLayout activePage="how-much-do-i-need-to-retire">
            <HowMuchDoINeed />
        </AppLayout>
    );
}
