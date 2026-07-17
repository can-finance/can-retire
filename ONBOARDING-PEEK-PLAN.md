# Onboarding: peek-first intro + Setup nav button

## Context

Today the onboarding intro is a full-screen opaque takeover — new users are asked to
enter data before seeing what the tool produces. Change it so the **intro/choice screen
is a scrim (semi-transparent dim) over the live sample dashboard** — users see charts and
projections behind a welcome card before choosing a path. The **wizard steps stay
full-screen and opaque** (no dimmed dashboard, no live updates — partial drafts would
render misleading projections). Also add a **Setup button to the header nav** as the
always-visible re-launch entry point, replacing the "Guided setup" button buried in the
Scenarios panel.

## Architecture (minimal, preserves the draft-then-commit contract and all 10 review fixes)

`OnboardingFlow` stays ONE component, mounted the whole time onboarding is active (so its
draft / screen / spouse-stash / F8 path-switch behavior are untouched). Two structural
changes:

1. **App renders the app tree BEHIND the overlay** (instead of instead-of it). While
   onboarding is active, App renders the normal current page (incl. `<Dashboard>`) AND
   `<OnboardingFlow>` on top.
2. **OnboardingFlow's background depends on screen:** `screen === 'intro'` → a SCRIM
   (semi-transparent, e.g. `bg-slate-900/40`, high z-index above header z-50 and tooltip
   z-100, so use `z-[200]`); all other screens (`simple`/`detailed`/`closing`) → the
   current OPAQUE gradient that fully covers the app. Intro card, skip link, copy
   unchanged except where noted.

### Two enabling changes

- **`src/hooks/usePersistentState.ts` — do not persist the initial value on mount.**
  Only write on an actual change (skip the first effect run via a ref). Rationale: with
  Dashboard now mounted behind the intro scrim, its `usePersistentState('retirement_sim_v2', …)`
  would otherwise write sample defaults on mount and destroy the "no existing data"
  eligibility signal (a refresh during the intro would then skip the auto-invite). Skipping
  the initial write preserves eligibility across a refresh-during-intro AND removes the
  fragile mount-order invariant the earlier review flagged. Blast radius: only Dashboard
  consumes this hook for the sim key (confirm via grep). Existing users (key present) are
  unaffected; edits still persist; share/scenario loads call setInputs (a change) so still
  persist.

- **`<Dashboard key={epoch}/>` + bump `epoch` whenever onboarding closes.** Because
  Dashboard is now always mounted while onboarding is active, forcing a remount on close is
  how it re-reads freshly committed inputs (replaces today's unmount→mount-on-finish
  mechanism, which we keep the spirit of). Bumping on EVERY close (Finish, Skip, and the
  `#start=` mid-wizard handler) is cheap and:
  - makes Finish reflect the committed draft,
  - keeps Skip/Cancel showing unchanged data (harmless re-animate),
  - **preserves F5**: the `#start=` mid-wizard handler already closes onboarding without
    committing; the epoch bump remounts Dashboard so its mount-only `#start=` hydration
    effect runs and imports the shared scenario. Keep the existing F5 logic; just add the
    bump.

### Interaction hardening
- Set the background app tree inert during onboarding (prefer the `inert` attribute;
  fallback: `aria-hidden` + the scrim/opaque overlay's own `pointer-events`). During the
  intro the dashboard must be visible but non-interactive; during steps it's fully covered.
- Clicking the scrim does NOT dismiss the intro (user must choose a path or Skip).
- Manual relaunch (Setup button): if not already on the dashboard, `navigate('dashboard')`
  first so the peek is always the dashboard, then open the intro.

## Setup nav button

- **`src/components/layout/AppLayout.tsx`** — add a "Setup" button in the header nav row,
  next to Dashboard / CPP Calculator / How does this work?. Style it as an ACTION, visually
  distinct from the page-segment pill and never showing the active-page state (it opens an
  overlay, it's not a page). New prop `onLaunchOnboarding: () => void`. Verify it fits at
  375px (short label "Setup"; collapse/wrap gracefully).
- App passes `onLaunchOnboarding` to AppLayout (→ sets onboarding to manual, navigates to
  dashboard, opens intro).

## Consolidate entry points (remove the Scenarios button)

- **`src/components/dashboard/ScenarioManager.tsx`** — remove the "Guided setup" button and
  its `onLaunchOnboarding` prop. **`Dashboard.tsx`** — drop the now-unused prop threading.
  One always-visible entry point (the nav button) beats two. (Reversible; flag in report.)
- **Copy updates** — `OnboardingIntro.tsx` and `OnboardingClosing.tsx`: change the two
  "Scenarios → Guided setup" references to "the Setup button in the top menu".

## Files
- `src/hooks/usePersistentState.ts` (skip initial write) + test
- `src/App.tsx` (render-behind + overlay; epoch key; inert; epoch bump on every close;
  manual-launch navigates to dashboard; keep F2/F3/F5)
- `src/components/onboarding/OnboardingFlow.tsx` (scrim vs opaque background by screen; z-[200])
- `src/components/layout/AppLayout.tsx` (Setup button)
- `src/components/dashboard/ScenarioManager.tsx` + `Dashboard.tsx` (remove Guided setup button/prop)
- `src/components/onboarding/OnboardingIntro.tsx`, `OnboardingClosing.tsx` (copy)

## Verification
Docker only (`docker compose exec -T app sh -c "npm test … ; npm run build …"`): full suite
+ `tsc -b` + both Vite entries green; add a usePersistentState test (initial value NOT
written on mount; a change IS written). Browser (localhost:5174):
1. Fresh load (clear keys) → dashboard visible, DIMMED, behind the intro card; no
   `retirement_sim_v2` written.
2. Refresh during intro → intro still auto-shows (eligibility preserved).
3. Pick Full setup → opaque full-screen steps, dashboard hidden. Finish → dashboard
   reflects entered values (age/province/etc.).
4. Skip → dashboard (samples), no data written; flag set; reload → no intro.
5. Setup nav button relaunches over live data (real numbers behind scrim); Cancel leaves
   data intact; Finish after edit applies it.
6. `#start=` share link → no intro; mid-wizard `#start=` → wizard closes, scenario imports.
7. Mobile 375px: Setup button usable; intro card + dimmed dashboard render cleanly.
