import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import type { PageId } from './components/layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';
import { HowItWorks } from './components/pages/HowItWorks';
import { CppCalculator } from './components/pages/CppCalculator';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { isOnboardingEligible, loadDraftSeed, markOnboardingDone } from './utils/onboarding';
import { scrollToAnchorSoon } from './utils/scrollToAnchor';

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

  // Whether the takeover is currently up. Once true it's a latch: nothing
  // outside of closeOnboarding sets it back to false, so it survives an
  // unrelated hashchange (back/forward, clicking around the nav) until the
  // user actually finishes or skips. Seeded synchronously so a visitor who's
  // eligible AND already landing on the dashboard never sees an unoverlaid
  // frame — no effect needed to "catch up" after the fact.
  const [active, setActive] = useState<boolean>(() => eligible && pageFromHash() === 'dashboard');

  // Whether the auto (first-run) takeover still has a decision to make. Only
  // relevant when the visitor was eligible at mount but landed somewhere
  // other than the dashboard (they may land on #cpp / #how-it-works first) —
  // if they landed straight on the dashboard, `active`'s initializer above
  // already resolved the decision. Flipped to false the first time
  // tryAutoActivate runs — whether that lands on "activate" or "cancel" (e.g.
  // data appeared mid-session). Once false, auto never fires again this
  // session; a later re-open can only be manual (the "Edit My Plan" button),
  // which sets `active` directly.
  const [autoPending, setAutoPending] = useState<boolean>(
    () => eligible && pageFromHash() !== 'dashboard'
  );

  // Bumped whenever onboarding closes so the always-mounted Dashboard remounts
  // and re-reads localStorage. This is what makes Finish reflect the freshly
  // committed draft, and preserves the #start= share-import (F5): the remount
  // re-runs Dashboard's mount-only hash-hydration effect.
  const [epoch, setEpoch] = useState(0);

  // Focus restore target: whatever was focused right before onboarding
  // activated (captured in launchOnboarding for a manual re-launch, or in
  // tryAutoActivate below for an auto takeover). Consumed and cleared by the
  // effect that watches `active` go false — by then the background tree's
  // `inert` has already been lifted, so `.focus()` succeeds.
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Bumps `epoch` (remounting Dashboard) only when the draft was actually
  // committed — Cancel/Skip with nothing saved leaves the live Dashboard alone
  // (no re-simulation, no chart re-animation, Monte Carlo/Real-Dollars/active-
  // scenario state preserved). The #start= mid-wizard hashchange handler below
  // closes via its own path and always bumps epoch regardless, since the
  // remounted Dashboard's mount effect is what performs the share import.
  const closeOnboarding = (committed: boolean) => {
    setActive(false);
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

  // Give the pending auto (first-run) takeover a chance to fire now that the
  // visitor is on the dashboard. A no-op once `autoPending` is false (already
  // decided, or never eligible). Re-checks eligibility at this exact moment:
  // if data appeared mid-session (e.g. the CPP Calculator's "Apply to plan"
  // wrote the sim key while parked elsewhere), cancel instead of taking over.
  // Called synchronously from the same event handler that lands currentPage
  // on 'dashboard' (a nav click, or a hashchange), so activation and the page
  // change land in the same commit — no frame where Dashboard is visible
  // without the overlay covering it, no effect required. Wrapped in
  // useCallback (keyed on its one real input, `autoPending`) so the
  // hashchange effect below can depend on it without resubscribing every
  // render.
  const tryAutoActivate = useCallback(() => {
    if (!autoPending) return;
    setAutoPending(false);
    if (!isOnboardingEligible()) return;
    // Capture focus here (nav click into the dashboard) — same point
    // activation state gets set.
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive(true);
  }, [autoPending]);

  // Wraps navigate() for the nav bar's own clicks so a pending auto takeover
  // gets its chance exactly when the user actually lands on the dashboard via
  // nav click. Deliberately NOT folded into navigate() itself — launchOnboarding
  // below also calls navigate('dashboard') as part of a MANUAL re-launch, which
  // must not incidentally resolve/retrigger the separate auto pathway.
  const handleNavigate = (page: PageId) => {
    navigate(page);
    if (page === 'dashboard') tryAutoActivate();
  };

  // Keep the page in sync with back/forward navigation. Re-subscribed when
  // `active` changes (for the #start= handler) or `tryAutoActivate` changes
  // identity (i.e. when `autoPending` changes) so neither closes over a
  // stale mount-time value.
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
      const next = pageFromHash();
      setCurrentPage(next);
      // Landing on the dashboard via back/forward or a share link is just as
      // much a legitimate auto trigger as a nav click (isOnboardingEligible's
      // own #start= check keeps a share link from ever activating it here).
      if (next === 'dashboard') tryAutoActivate();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [active, tryAutoActivate]);

  // Manual re-launch from the Setup nav button: always peek at the dashboard, so
  // navigate there first (if elsewhere), then open the intro over live data —
  // unlike auto, manual shows over any page, so it sets `active` directly.
  // Uses navigate() (not handleNavigate) so this never incidentally triggers
  // the auto pathway — see the comment on handleNavigate above.
  const launchOnboarding = () => {
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (currentPage !== 'dashboard') navigate('dashboard');
    setActive(true);
  };

  // Read the draft seed once per overlay activation, not on every App re-render
  // — OnboardingFlow only consumes `seed` in its useState initializers at mount,
  // so re-parsing + re-sanitizing localStorage on each keystroke-driven re-render
  // while the overlay is up is wasted work. Keyed on `active` so a second
  // activation (e.g. re-opening "Edit My Plan" after an earlier session
  // committed new data) re-reads fresh rather than reusing a stale first-mount
  // value. Null while hidden; only read where `active` is already true below.
  const seed = useMemo(() => (active ? loadDraftSeed() : null), [active]);

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
      <div inert={active || undefined}>
        <AppLayout currentPage={currentPage} onNavigate={handleNavigate} onLaunchOnboarding={launchOnboarding}>
          {currentPage === 'dashboard' && <Dashboard key={epoch} />}
          {currentPage === 'cpp-calculator' && <CppCalculator />}
          {currentPage === 'how-it-works' && <HowItWorks />}
        </AppLayout>
      </div>

      {active && (
        <OnboardingFlow
          seed={seed!}
          onDone={closeOnboarding}
          onOpenPrivacy={(committed) => {
            closeOnboarding(committed);
            navigate('how-it-works');
            // Scroll after the page has rendered (mirrors AppLayout's disclaimer link).
            scrollToAnchorSoon('privacy');
          }}
        />
      )}
    </>
  );
}

export default App;
