import { useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { isOnboardingEligible, loadDraftSeed, markOnboardingDone } from './utils/onboarding';

// The SPA at / is dashboard-only. The CPP Calculator and How-It-Works pages are
// real MPA routes (/cpp-calculator/, /how-it-works/) reached via the nav's
// static links; legacy #cpp-calculator / #how-it-works hashes are redirected to
// those paths at boot (see src/utils/bootRedirect.ts + main.tsx) before React
// mounts. Besides that, this component cares about two URL signals at boot:
// #start=... (share links that import a scenario into the dashboard) and
// ?setup=1 (a manual "Guided Setup" launch, e.g. from the standalone MPA
// pages' header link — see the `setupRequested` capture below).
function App() {
  // Capture first-visit eligibility ONCE, synchronously, at mount. Dashboard is
  // always mounted — even behind the intro scrim it renders inert (see the
  // `inert` wrapper below) and its effects DO run — but that's not a hazard:
  // usePersistentState (see the `hasChanged` gate in
  // src/hooks/usePersistentState.ts) never writes to localStorage on mount,
  // only after a real consumer-driven change. We still capture eligibility
  // lazily here, once, so a page refresh mid-intro reads the "no existing data"
  // signal as it stood at load.
  const [eligible] = useState(isOnboardingEligible);

  // Capture a manual "Guided Setup" launch via `?setup=1` ONCE, synchronously,
  // at mount, alongside `eligible` above. This is how the standalone MPA
  // pages' header link (AppLayout's `<a href="/?setup=1">`, rendered when
  // `onLaunchOnboarding` is absent) opens the overlay after navigating back to
  // the dashboard. A #start= share link always wins over it — isOnboardingEligible
  // has the same guard for the auto-takeover case, and mirroring it here means
  // a share link's hash never gets swallowed by an unrelated `setup=1` that
  // happened to tag along. The param is stripped immediately (preserving the
  // hash) so a refresh or bookmark of the resulting URL doesn't keep re-opening
  // the overlay.
  const [setupRequested] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const hadSetupParam = params.has('setup');
    const requested = params.get('setup') === '1' && !window.location.hash.startsWith('#start=');
    if (hadSetupParam) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    return requested;
  });

  // Whether the takeover is currently up. Once true it's a latch: nothing
  // outside of closeOnboarding sets it back to false, so it survives an
  // unrelated hashchange until the user actually finishes or skips. Seeded
  // synchronously from `eligible` or `setupRequested` — a visitor always lands
  // on the dashboard, so an eligible first-timer (or a manual ?setup=1 launch)
  // sees the intro immediately with no unoverlaid frame and no effect needed
  // to "catch up". `loadDraftSeed()` below already loads the saved plan when
  // one exists, so a `setupRequested` launch with existing data pre-fills the
  // wizard exactly like the manual "Guided Setup" relaunch does.
  const [active, setActive] = useState<boolean>(() => eligible || setupRequested);

  // Bumped whenever onboarding closes with a commit so the always-mounted
  // Dashboard remounts and re-reads localStorage. This is what makes Finish
  // reflect the freshly committed draft, and preserves the #start= share-import:
  // the remount re-runs Dashboard's mount-only hash-hydration effect.
  const [epoch, setEpoch] = useState(0);

  // Focus restore target: whatever was focused right before onboarding
  // activated (captured in launchOnboarding). Consumed and cleared by the
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

  // The only routing concern left: a #start= share link arriving while the
  // wizard is open reflects the user's latest intent. Close the wizard WITHOUT
  // committing (mark done so it can't re-trigger) and let the remounted
  // Dashboard mount and hydrate the shared scenario. This also guarantees a
  // stale #start= can never clobber a just-committed plan. Re-subscribed when
  // `active` changes so it never closes over a stale value.
  useEffect(() => {
    const onHashChange = () => {
      if (active && window.location.hash.startsWith('#start=')) {
        markOnboardingDone();
        // Force the epoch bump regardless of commit status — nothing was saved,
        // but the remounted Dashboard's mount effect is what performs the
        // #start= share import.
        closeOnboarding(true);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [active]);

  // Manual re-launch from the "Guided Setup" nav button: open the intro over
  // the live dashboard. Captures focus so it can be restored on close. No
  // navigation — the dashboard is the only page this SPA renders.
  const launchOnboarding = () => {
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive(true);
  };

  // Read the draft seed once per overlay activation, not on every App re-render
  // — OnboardingFlow only consumes `seed` in its useState initializers at mount,
  // so re-parsing + re-sanitizing localStorage on each keystroke-driven re-render
  // while the overlay is up is wasted work. Keyed on `active` so a second
  // activation (e.g. re-opening "Guided Setup" after an earlier session
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
        <AppLayout activePage="dashboard" onLaunchOnboarding={launchOnboarding}>
          <Dashboard key={epoch} />
        </AppLayout>
      </div>

      {active && (
        <OnboardingFlow
          seed={seed!}
          onDone={closeOnboarding}
          onOpenPrivacy={(committed) => {
            // If the wizard committed, the draft is already in localStorage
            // before this fires. Close (preserving that commit semantics), then
            // do a real navigation to the How-It-Works page — the native page
            // load scrolls to the #privacy anchor without any timer.
            closeOnboarding(committed);
            window.location.assign('/how-it-works/#privacy');
          }}
        />
      )}
    </>
  );
}

export default App;
