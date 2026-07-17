import { useEffect, useMemo, useRef, useState } from 'react';
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

  // Capture first-visit eligibility ONCE, synchronously, at mount. Dashboard is
  // always mounted when currentPage === 'dashboard' — even behind the intro
  // scrim it renders inert (see the `inert` wrapper below) and its effects DO
  // run — but that's no longer a hazard: usePersistentState (see the
  // `hasChanged` gate in src/hooks/usePersistentState.ts) never writes to
  // localStorage on mount, only after a real consumer-driven change. We still
  // capture eligibility lazily here, once, rather than re-deriving it on a
  // later render, so a page refresh mid-intro reads the "no existing data"
  // signal as it stood at load — before anything the user does this session
  // (including the eligibility re-check below) can change it.
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

  // Bumped whenever onboarding closes so the always-mounted Dashboard remounts
  // and re-reads localStorage. This is what makes Finish reflect the freshly
  // committed draft, and preserves the #start= share-import (F5): the remount
  // re-runs Dashboard's mount-only hash-hydration effect.
  const [epoch, setEpoch] = useState(0);

  // Focus restore target: whatever was focused right before onboarding activated
  // (manual launch click, or the render-phase auto activation below). Consumed
  // and cleared by the effect that watches `active` go false — by then the
  // background tree's `inert` has already been lifted, so `.focus()` succeeds.
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Bumps `epoch` (remounting Dashboard) only when the draft was actually
  // committed — Cancel/Skip with nothing saved leaves the live Dashboard alone
  // (no re-simulation, no chart re-animation, Monte Carlo/Real-Dollars/active-
  // scenario state preserved). The #start= mid-wizard hashchange handler below
  // closes via its own path and always bumps epoch regardless, since the
  // remounted Dashboard's mount effect is what performs the share import.
  const closeOnboarding = (committed: boolean) => {
    setActive(false);
    setOnboarding('off');
    if (committed) setEpoch((e) => e + 1);
  };

  // Runs after the DOM commits `active === false` (inert lifted from the
  // background tree), so focusing the captured element actually lands.
  useEffect(() => {
    if (active) return;
    const toFocus = lastFocusedRef.current;
    lastFocusedRef.current = null;
    if (toFocus && toFocus.isConnected) {
      try {
        toFocus.focus();
      } catch {
        // Ignore — best-effort focus restore.
      }
    }
  }, [active]);

  const navigate = (page: PageId) => {
    // No-op when we're already on `page` and the URL already reflects it —
    // otherwise repeated navigation to the current page (e.g. Edit My Plan's
    // dashboard-first hop) pushes a duplicate history entry and Back appears
    // dead the first time it's pressed.
    if (page === currentPage) {
      const strippedHash = window.location.hash.replace(/^#\/?/, '');
      const urlAlreadyMatches = page === 'dashboard' ? strippedHash === '' : strippedHash === page;
      if (urlAlreadyMatches) return;
    }
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
        // Force the epoch bump here regardless of commit status — nothing was
        // saved, but the remounted Dashboard's mount effect is what performs
        // the #start= share import.
        closeOnboarding(true);
      }
      setCurrentPage(pageFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [active]);

  // Decide synchronously whether the takeover is visible this render. Auto waits
  // until the user is on the dashboard (they may land on #cpp / #how-it-works
  // first); manual re-launch shows over any page. `show` mirrors the latch this
  // render so that on the very render where Dashboard first mounts (currentPage
  // becomes 'dashboard'), the overlay is already up too — Dashboard is never
  // visible without the inert scrim covering it, even for one paint. setActive
  // persists the decision for subsequent renders (updating state during render
  // re-runs App before committing, so `show` and `active` agree by the time
  // anything commits to the DOM).
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
        // Capture focus here too (nav click into the dashboard, or initial load
        // landing on it) — same point activation state gets set. If it's just
        // `body` (initial load), restoring to it later is a harmless no-op.
        lastFocusedRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setActive(true);
        show = true;
      }
    }
  }

  // Manual re-launch from the Setup nav button: always peek at the dashboard, so
  // navigate there first (if elsewhere), then open the intro over live data.
  const launchOnboarding = () => {
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (currentPage !== 'dashboard') navigate('dashboard');
    setOnboarding('manual');
  };

  // Read the draft seed once per overlay activation, not on every App re-render
  // — OnboardingFlow only consumes `seed` in its useState initializers at mount,
  // so re-parsing + re-sanitizing localStorage on each keystroke-driven re-render
  // while the overlay is up is wasted work. Keyed on `show` (not `[]`) so a
  // second activation (e.g. re-opening "Edit My Plan" after an earlier session
  // committed new data) re-reads fresh rather than reusing a stale first-mount
  // value. Null while hidden; only read where `show` is already true below.
  const seed = useMemo(() => (show ? loadDraftSeed() : null), [show]);

  // The app tree is always rendered; the onboarding overlay sits on top of it.
  // While the overlay is up, the background tree is made inert so the dashboard
  // behind the intro scrim can be seen but not touched or reached by assistive
  // tech — `inert` alone already removes the subtree from the a11y tree and
  // blocks focus (React 19 renders it as the bare attribute), so a separate
  // `aria-hidden` would only invite the two falling out of sync. Dashboard is
  // keyed by `epoch` so closing onboarding remounts it and it re-reads freshly
  // committed inputs (and re-runs its mount-only #start= hydration).
  return (
    <>
      <div inert={show || undefined}>
        <AppLayout currentPage={currentPage} onNavigate={navigate} onLaunchOnboarding={launchOnboarding}>
          {currentPage === 'dashboard' && <Dashboard key={epoch} />}
          {currentPage === 'cpp-calculator' && <CppCalculator />}
          {currentPage === 'how-it-works' && <HowItWorks />}
        </AppLayout>
      </div>

      {show && (
        <OnboardingFlow
          seed={seed!}
          onDone={closeOnboarding}
          onOpenPrivacy={(committed) => {
            closeOnboarding(committed);
            navigate('how-it-works');
            // Scroll after the page has rendered (mirrors AppLayout's disclaimer link).
            setTimeout(() => {
              document.getElementById('privacy')?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          }}
        />
      )}
    </>
  );
}

export default App;
