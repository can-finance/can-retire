import { useEffect, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import type { PageId } from './components/layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';
import { HowItWorks } from './components/pages/HowItWorks';
import { CppCalculator } from './components/pages/CppCalculator';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { isOnboardingEligible, loadDraftSeed, markOnboardingDone } from './utils/onboarding';

// Pages are addressable via the URL hash (e.g. /#cpp-calculator) so they can
// be linked to directly. The dashboard's share links use #start=... and must
// keep resolving to the dashboard.
function pageFromHash(): PageId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash === 'cpp-calculator' || hash === 'cpp') return 'cpp-calculator';
  if (hash === 'how-it-works') return 'how-it-works';
  return 'dashboard';
}

function App() {
  const [currentPage, setCurrentPage] = useState<PageId>(pageFromHash);

  // Capture first-visit eligibility ONCE, synchronously, before any child can
  // mount. Dashboard's usePersistentState writes retirement_sim_v2 on mount,
  // which would destroy the "no existing data" signal — so this must be read
  // before Dashboard ever renders (the takeover renders instead of Dashboard).
  const [eligible] = useState(isOnboardingEligible);
  // 'auto'  — first-run takeover, shows only on the dashboard page.
  // 'manual' — re-launched via "Guided setup"; shows over any page.
  // 'off'   — dismissed (Finish/Skip) or never eligible.
  const [onboarding, setOnboarding] = useState<'auto' | 'manual' | 'off'>(eligible ? 'auto' : 'off');
  // Latch: once the takeover becomes visible it stays mounted regardless of
  // hashchange / back / forward, until Finish or Skip. Seeded synchronously so
  // Dashboard can't mount for a frame first — for auto, only when the landing
  // page is already the dashboard.
  const [active, setActive] = useState<boolean>(() => eligible && pageFromHash() === 'dashboard');

  const closeOnboarding = () => {
    setActive(false);
    setOnboarding('off');
  };

  const navigate = (page: PageId) => {
    setCurrentPage(page);
    if (page === 'dashboard') {
      window.history.pushState(null, '', window.location.pathname + window.location.search);
    } else {
      window.location.hash = page;
    }
  };

  // Keep the page in sync with back/forward navigation. Re-subscribed when
  // `active` changes so the #start= handler sees the current latch state.
  useEffect(() => {
    const onHashChange = () => {
      // A #start= share link arriving mid-wizard reflects the user's latest
      // intent: close the wizard WITHOUT committing (mark done so it can't
      // re-trigger) and let Dashboard mount and hydrate the shared scenario. This
      // also guarantees a stale #start= can never clobber a just-committed plan.
      if (active && window.location.hash.startsWith('#start=')) {
        markOnboardingDone();
        closeOnboarding();
      }
      setCurrentPage(pageFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [active]);

  // Decide synchronously whether the takeover is visible this render. Auto waits
  // until the user is on the dashboard (they may land on #cpp / #how-it-works
  // first); manual re-launch shows over any page. `show` mirrors the latch this
  // render so Dashboard is never rendered on the activation transition; setActive
  // persists it for subsequent renders (updating state during render re-runs App
  // before committing — Dashboard's effects, and thus its sim-key write, never run).
  let show = active;
  if (!active) {
    const wantsToShow =
      onboarding === 'manual' || (onboarding === 'auto' && currentPage === 'dashboard');
    if (wantsToShow) {
      // Re-check eligibility at the moment auto would first show: if data appeared
      // mid-session (e.g. the CPP Calculator's "Apply to plan" wrote the sim key),
      // cancel the pending auto takeover instead of taking over.
      if (onboarding === 'auto' && !isOnboardingEligible()) {
        setOnboarding('off');
      } else {
        setActive(true);
        show = true;
      }
    }
  }

  if (show) {
    return (
      <OnboardingFlow
        seed={loadDraftSeed()}
        onDone={closeOnboarding}
        onOpenPrivacy={() => {
          closeOnboarding();
          navigate('how-it-works');
          // Scroll after the page has rendered (mirrors AppLayout's disclaimer link).
          setTimeout(() => {
            document.getElementById('privacy')?.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        }}
      />
    );
  }

  return (
    <AppLayout currentPage={currentPage} onNavigate={navigate}>
      {currentPage === 'dashboard' && (
        <Dashboard onLaunchOnboarding={() => setOnboarding('manual')} />
      )}
      {currentPage === 'cpp-calculator' && <CppCalculator />}
      {currentPage === 'how-it-works' && <HowItWorks />}
    </AppLayout>
  );
}

export default App;
