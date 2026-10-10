import { WhenCanIRetire } from './components/pages/WhenCanIRetire';
import { AppLayout } from './components/layout/AppLayout';

/**
 * The /when-can-i-retire/ page body — AppLayout chrome (header, nav, footer)
 * wrapping the WhenCanIRetire calculator and prose. Extracted into a
 * side-effect-free module so it can be imported by BOTH the client entry
 * (`when-can-i-retire-standalone.tsx`, which mounts it with createRoot) and the
 * build-time SSR entry (`prerender/when-can-i-retire-ssr.tsx`, which renders it
 * to static HTML). No onLaunchOnboarding — the standalone MPA pages have no
 * onboarding overlay, so the "Guided Setup" control links to the dashboard
 * instead (see AppLayout).
 */
export function StandaloneWhenCanIRetirePage() {
    return (
        <AppLayout activePage="when-can-i-retire">
            <WhenCanIRetire />
        </AppLayout>
    );
}
