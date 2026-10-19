import { Tutorials } from './components/pages/Tutorials';
import { AppLayout } from './components/layout/AppLayout';

/**
 * The /tutorials/ page body — AppLayout chrome (header, nav, footer) wrapping
 * the Tutorials video list. Extracted into a side-effect-free module so it can be
 * imported by BOTH the client entry (`tutorials-standalone.tsx`, which mounts it
 * with createRoot) and the build-time SSR entry (`prerender/tutorials-ssr.tsx`,
 * which renders it to static HTML).
 */
export function StandaloneTutorialsPage() {
    return (
        <AppLayout activePage="tutorials">
            <Tutorials />
        </AppLayout>
    );
}
