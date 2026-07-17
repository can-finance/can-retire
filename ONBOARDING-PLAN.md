# First-Time-User Onboarding (intro + quick start + full setup wizard)

## Context

New visitors land straight on a dashboard pre-filled with sample numbers and no explanation of what the tool does, what to change, or that their data stays in the browser. This feature adds: an **intro screen** (purpose + how to use), a **Quick start** path (a handful of questions, defaults for everything else), a **Full setup** path (step-by-step through all options with defaults pre-filled), and a shared **closing screen** explaining browser localStorage persistence and the share-link feature. Decided with the user: detailed path is a full-screen step wizard (not coach-marks), and onboarding is re-launchable later from a small entry point.

## Architecture

**Full-screen takeover, no new hash route.** `App.tsx` renders `<OnboardingFlow/>` *instead of* the `<AppLayout>` tree when active. Rationale: the hash namespace is load-bearing (`#start=` share payloads, `#cpp`, `#how-it-works`), and keeping `Dashboard` unmounted during first-run onboarding is critical — `usePersistentState` writes `retirement_sim_v2` on mount, which would destroy the "no existing data" signal.

**First-visit detection.** New localStorage key `retirement_onboarding_v1` = `'1'`, written on Finish or Skip (never on merely viewing the intro). Eligibility computed **synchronously in a lazy `useState` initializer in App.tsx** (before Dashboard can mount):

```
eligible = no onboarding flag && no retirement_sim_v2 key && !hash.startsWith('#start=')
```

Show automatically when `eligible && currentPage === 'dashboard'`. If the user arrives at `#cpp`/`#how-it-works`, onboarding appears when they later click Dashboard. All localStorage access wrapped in try/catch; on error, treat as **not eligible** (fail closed — never trap the user).

**Draft-then-commit state.** `OnboardingFlow` holds a local `draft: SimulationInputs`, seeded via `sanitize(localStorage.retirement_sim_v2) ?? INITIAL_INPUTS` — one code path handles both first-run (defaults) and re-launch (current data pre-filled, so re-running never wipes anything). **Finish** → sanitize + write `retirement_sim_v2` + set flag + close (Dashboard then mounts and reads it — no new state plumbing into Dashboard). **Skip** (available on every screen) → set flag, close, write nothing.

## New files

| File | Responsibility |
|---|---|
| `src/utils/onboarding.ts` | `ONBOARDING_KEY`, `isOnboardingEligible()`, `markOnboardingDone()`, `loadDraftSeed()`, `commitOnboardingInputs(inputs)`. Pure, unit-testable. |
| `src/utils/personValidation.ts` | `getValidationErrors(person)` **moved** from [PersonSection.tsx:31](src/components/dashboard/PersonSection.tsx:31)-52 so wizard steps show identical amber warnings. |
| `src/components/onboarding/OnboardingFlow.tsx` | Orchestrator + shell. Props `{seed, isRelaunch, onDone}`. State: `screen: 'intro'\|'simple'\|'detailed'\|'closing'`, `stepIndex`, `draft`. Shell: same slate gradient bg as AppLayout, `CrapLogo` (exported from AppLayout.tsx) top-left, "Skip setup" top-right, progress dots, centered `max-w-2xl` column of `SectionCard`s, Back/Next footer. Single column → mobile-fine. |
| `src/components/onboarding/OnboardingIntro.tsx` | Purpose blurb + two path cards + skip link. |
| `src/components/onboarding/SimplePathStep.tsx` | The 2-screen quick form (below). |
| `src/components/onboarding/detailedSteps.tsx` | `buildDetailedSteps(draft): WizardStep[]` (`{id, title, blurb, render(draft, setDraft)}`). Rebuilt when spouse toggles so spouse steps splice in/out and progress dots stay honest. |
| `src/components/onboarding/OnboardingClosing.tsx` | Closing screen (both paths). |
| `src/components/inputs/AssumptionsFields.tsx` | **Extraction refactor**: province select + inflation + return-rate inputs + income-splitting / withdrawal-strategy toggles currently inline at [Dashboard.tsx:345](src/components/dashboard/Dashboard.tsx:345)-505. Props `{inputs, onChange(partial)}`. Only way to reuse the assumptions grid without copy-paste. Dashboard keeps its view-only toggles (Monte Carlo, Real Dollars) beside it. |

## Modified files

- **[App.tsx](src/App.tsx)** — capture eligibility in a lazy initializer; `onboarding: 'auto'|'manual'|'off'` state; when active return `<OnboardingFlow seed={loadDraftSeed()} isRelaunch={!eligible} onDone={...}/>` instead of the AppLayout tree (lines 37–43); pass `onLaunchOnboarding` to `<Dashboard/>`. Hash changes while active do not dismiss; only Finish/Skip do.
- **[Dashboard.tsx](src/components/dashboard/Dashboard.tsx)** — accept optional `onLaunchOnboarding` prop, forward to `<ScenarioManager/>` (line 508); replace the Assumptions inputs block (345–505) with `<AssumptionsFields/>`.
- **[ScenarioManager.tsx](src/components/dashboard/ScenarioManager.tsx)** — re-launch entry point: small **"Guided setup"** button next to "Reset to Default", with a HelpTooltip ("Your current numbers are pre-filled — nothing changes unless you finish"). Chosen over the header nav pill (that's a 3-page navigator; ScenarioManager is already the manage-my-data surface).
- **[ErrorBoundary.tsx](src/components/ui/ErrorBoundary.tsx)** — add `ONBOARDING_KEY` (imported from utils/onboarding.ts) to `STORAGE_KEYS`, so "Reset saved data & reload" re-triggers onboarding. Intended.
- **[PersonSection.tsx](src/components/dashboard/PersonSection.tsx)** — delete local `getValidationErrors` (31–52), import from utils. No behavior change.
- **[HowItWorks.tsx](src/components/pages/HowItWorks.tsx)** — add `id="privacy"` to the Privacy & Data Security section so the closing screen can deep-link it (only `#full-disclaimer` has an id today).
- No changes to `vite.config.ts` / `cpp-standalone.tsx` / the `cpp-calculator/` entry.

## Simple path — 2 screens, exact mapping

**S1 "About your household":** your age, retirement age, annual income, province; Toggle "Include a spouse/partner" → spouse age + income.
**S2 "Savings and spending":** RRSP / TFSA / non-registered balances (spouse column if on); pre- & post-retirement spending.

Mapping onto `SimulationInputs` (start from `createDefaultPerson()` per person, override answers):
- Direct: `age`, `retirementAge`, `currentIncome`, `province`, `preRetirementSpend`, `postRetirementSpend`, `rrsp.balance`, `tfsa.balance`.
- Non-reg: one `createNonRegAccount({balance, adjustedCostBase: balance * 0.5, receivesSurplus: true})` — mirrors the default 50% ACB ratio; tooltip says it can be refined later.
- **Consistency clamps** (so the dashboard doesn't open with amber validation banners): `retirementAge = max(retirementAge, age)`; `lifeExpectancy = max(90, retirementAge + 5)`; `rrspMeltStartAge = max(55, age)`.
- Everything else stays default (CPP 65/35 yrs, OAS 65, melt amounts, asset mix, return rates, inflation, `withdrawalStrategy 'rrsp-first'`, `useIncomeSplitting true`).

## Detailed path — dynamic step list

Each step: short title + one-line blurb + **existing leaf components** bound to `draft` (`FinancialInput`, `NonRegAccountsInput`, `OneTimeSpendingInput`, `Toggle`, `HelpTooltip`, new `AssumptionsFields`). Per-person steps show the shared `getValidationErrors` amber banner; validation is **non-blocking** (matches the dashboard; commit is sanitized anyway).

1. **About you** — age, retirement age, death age, income.
2. **Government benefits** — CPP start/years, OAS start. Plain-text note "refine later with the CPP Calculator" — no link (navigating away mid-wizard isn't supported).
3. **Your accounts** — RRSP + TFSA inputs, then `NonRegAccountsInput` wholesale (ACB, asset mix, turnover, rebalancing, multi-account for free).
4. **RRSP meltdown** — melt start age + amount, 2-sentence explainer.
5. **Spouse?** — Toggle; on → `draft.spouse = createDefaultPerson(true)` and steps 5a–5d (mirror of 1–4) splice in; off → removed, `stepIndex` clamped if needed.
6. **Household spending** — pre/post spend + `OneTimeSpendingInput`.
7. **Assumptions** — `AssumptionsFields`. Blurb: "Defaults are reasonable — these are rough estimates, don't over-optimize."
8. **Closing** (shared).

(Not reusing `PersonSection` wholesale: it's a collapsible mega-card bundling four topics — that would collapse "step through all options" into two giant steps. Reuse is at the leaf-input + validation level.)

## Copy outlines (plain-spoken, privacy-forward tone)

**Intro:** H1 "Plan your Canadian retirement in a few minutes." Two sentences: projects accounts, taxes, CPP & OAS year-by-year to compare strategies; everything runs in your browser, numbers never leave your device. Cards: **Quick start** (~2 min, sensible defaults for the rest) / **Full setup** (~10 min, every option, defaults pre-filled). Footer: "Skip — explore with sample numbers instead" (re-launch variant: "Cancel — keep my current numbers"). Micro-line: "Rough estimates for planning — not financial advice."

**Closing:** H1 "You're set." Saved-data para: plan saved in this browser's local storage on this device, nothing sent to any server, it'll be here next visit; clearing browser data removes it. Share para: the **Share** button encodes the whole scenario into a link (numbers live in the link itself — anyone with it can see them). Link "More on privacy and how the math works →" → `onDone()` then navigate to How It Works + scroll to `#privacy` (deferred-scroll pattern already in AppLayout's disclaimer link). Primary button "Go to my dashboard" (commits draft). Small line: re-run anytime from Scenarios → Guided setup.

## Edge cases

| Case | Behavior |
|---|---|
| `#start=` share link | Never shows (hash check captured pre-mount); Dashboard hydration runs unobstructed; next visit blocked by the data check. |
| Existing user | Never auto-shown; Guided setup pre-fills from current inputs; Skip/Cancel leaves data untouched. |
| Refresh mid-wizard, first run | Draft is memory-only, flag unset, Dashboard never mounted → onboarding restarts from intro. Self-consistent. |
| Refresh mid-wizard, re-launch | Sim key exists → back to dashboard, data intact. |
| Spouse on→off mid-wizard | Spouse steps spliced out, `stepIndex` clamped. |
| localStorage throws | try/catch everywhere; fail closed (not eligible). |
| ErrorBoundary reset | Clears all three keys → onboarding shows again. |

## Verification

Manual script (`npm run dev`, DevTools → Application → Local Storage between cases):
1. **Fresh visit**: clear keys → intro shows, no `retirement_sim_v2` written yet. Quick start with age 62 → dashboard shows entered values, **no amber banner** (clamps), flag set; reload → no onboarding.
2. **Fresh + Skip** → dashboard with sample defaults; reload → no onboarding.
3. **Fresh + Full setup**: walk all steps; spouse on → steps appear, off → vanish; refresh at step 4 → restarts from intro, nothing half-saved.
4. **Share link** in a cleared profile → scenario hydrates, no onboarding, reload → still none.
5. **`/#cpp-calculator` arrival** with cleared keys → no onboarding on CPP page; click Dashboard → onboarding appears.
6. **Re-launch**: Guided setup pre-filled with *current* values; Cancel → unchanged; Finish after edit → edit applied.
7. **Mobile 375px**: intro cards stack, wizard + footer buttons usable.
8. **ErrorBoundary reset** clears onboarding key; reload shows onboarding.
9. `npm run build` (both Vite entries), `tsc`, full existing test suite (nothing currently tests App/Dashboard/PersonSection/ScenarioManager, but the `getValidationErrors` move and `AssumptionsFields` extraction could catch import slips).
10. New tests: `src/utils/onboarding.test.ts` (eligibility matrix: flag × data × hash; commit sanitizes) and a simple-path mapping test (answers → full `SimulationInputs` incl. clamps).

## Implementation order

1. `utils/onboarding.ts` + `personValidation.ts` move + ErrorBoundary key
2. `AssumptionsFields` extraction (verify dashboard unchanged)
3. `OnboardingFlow` shell + intro + closing wired into App (skip-only works end-to-end)
4. Simple path
5. Detailed steps
6. "Guided setup" button + HowItWorks `#privacy` anchor
7. Tests + manual script
