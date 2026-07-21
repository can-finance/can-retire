import { RrspWithdrawalStrategy } from './components/pages/RrspWithdrawalStrategy';
import { AppLayout } from './components/layout/AppLayout';

/**
 * The /rrsp-withdrawal-strategy/ page body — AppLayout chrome (header, nav,
 * footer) wrapping the RrspWithdrawalStrategy prose. Extracted into a
 * side-effect-free module so it can be imported by BOTH the client entry
 * (`rrsp-withdrawal-strategy-standalone.tsx`, which mounts it with createRoot)
 * and the build-time SSR entry (`prerender/rrsp-withdrawal-strategy-ssr.tsx`,
 * which renders it to static HTML). No onLaunchOnboarding — the standalone MPA
 * pages have no onboarding overlay, so the "Guided Setup" control links to the
 * dashboard instead (see AppLayout).
 */
export function StandaloneRrspWithdrawalStrategyPage() {
    return (
        <AppLayout activePage="rrsp-withdrawal-strategy">
            <RrspWithdrawalStrategy />
        </AppLayout>
    );
}
