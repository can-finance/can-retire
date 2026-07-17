# Peek-first review fixes (3 groups, sequential)

Fixes for the confirmed findings from the peek-first onboarding review. Core contract to
preserve throughout: the wizard edits a seeded draft; Skip/Cancel writes nothing; untouched
fields keep saved values; `#start=` mid-wizard closes without committing and imports the
shared scenario.

## Group 1 — user-facing blockers

**1a. Mobile/tablet header layout** (`src/components/layout/AppLayout.tsx`)
Problem: the inner header row is fixed `h-16` while the right-side group is `flex-wrap`;
below ~700px the group wraps to two rows and spills symmetrically out of the 64px box —
the nav pill ends up above the document origin (unreachable) and "Edit My Plan" overlaps
`<main>`.
Fix: let the header grow — replace the fixed `h-16` with `min-h-16` + vertical padding
(e.g. `py-2`) so wrapped rows stay inside the header box; allow the title block to shrink
(`min-w-0`, truncate if needed) and keep the right group's wrap. Header must still look
identical at ≥1024px (single 64px row, `lg:sticky` unchanged). Verify at 375px and ~768px:
nav pill and Edit My Plan both fully visible and clickable, no content above y=0, no
overlap with main.

**1b. Copy fix** (`src/components/onboarding/OnboardingIntro.tsx` ~71,
`OnboardingClosing.tsx` ~57)
"the Setup button in the top menu" → "the Edit My Plan button in the top menu" (both spots).

**1c. Make Save actually commit** (`src/components/onboarding/OnboardingFlow.tsx`)
Problem: the last-step "Save" button only advances to the closing screen; the commit
happens on the closing screen's buttons — close the tab at "You're set." and nothing was
saved, contradicting the label and the tooltip ("nothing changes until you save the plan").
Fix: clicking **Save** (last content step, BOTH paths — check the simple path's S2 button
label/flow too, not just the detailed path) runs the commit (current `finalInputs()` →
`commitOnboardingInputs`, which also sets the onboarding flag) and THEN shows the closing
screen as pure confirmation. Closing screen buttons no longer commit: "Go to my dashboard"
just closes; the privacy link just closes + navigates. Back from the closing screen to the
steps stays allowed; a second Save re-commits (idempotent). Track `hasCommitted` state in
OnboardingFlow once Save fires (needed by Group 3's epoch change; also: after a Save, a
later "Skip setup" must still be treated as "committed" for close purposes since data WAS
written). Adjust closing-screen copy if it implies saving is still pending.

## Group 2 — scroll lock + dialog semantics

(`src/components/onboarding/OnboardingFlow.tsx`, `src/App.tsx`)

**2a. Scroll lock.** Nothing locks document scroll while the overlay is up; `inert` blocks
pointer/focus but not scrolling, so wheel/touch over the intro scrim scroll-chains to the
dashboard behind it, and during opaque steps the window scrollbar scrolls invisible
content. Fix: while OnboardingFlow is mounted, set `overflow: hidden` on `document.body`
(effect with cleanup restoring the previous value), and add `overscroll-contain` to the
overlay's scroll container. The dashboard then reappears at its original scroll position
on close.

**2b. Dialog semantics.** Overlay root gets `role="dialog"` `aria-modal="true"` and an
`aria-label` ("Retirement plan setup"). On open, move focus into the overlay (panel
container with `tabIndex={-1}` + `.focus()` in a mount effect). On close, restore focus:
App captures `document.activeElement` (ref) right before activating onboarding (both the
Edit My Plan click and the auto path) and refocuses it on close if still connected. Add
an Escape handler = the existing skip/cancel action. While touching this: drop the
redundant `aria-hidden` from App's background wrapper — `inert` alone already removes the
subtree from the a11y tree and blocks focus (React 19 renders it as the bare attribute);
keeping both invites desync.

## Group 3 — small fixes

**3a. History guard** (`src/App.tsx`): `launchOnboarding` calls `navigate('dashboard')`
unconditionally and `navigate`'s dashboard branch always `pushState`s — each Edit My Plan
click on the dashboard adds a duplicate history entry (Back then appears dead). Fix: in
`launchOnboarding`, only navigate when `currentPage !== 'dashboard'`; additionally make
`navigate` a no-op when the target page equals the current page and the URL wouldn't
change.

**3b. Stale comments** (`src/App.tsx` ~23-26 and ~77-82): they still describe the old
architecture ("Dashboard's usePersistentState writes retirement_sim_v2 on mount", "the
takeover renders instead of Dashboard", "Dashboard's effects never run"). Rewrite to match
reality: Dashboard renders inert behind the overlay; the no-write-on-mount invariant lives
in `usePersistentState`'s hasChanged gate (cross-reference it); the lazy eligibility
capture remains for refresh-during-intro. Also delete/simplify any now-vestigial
render-phase machinery ONLY if trivially safe — otherwise just fix the comments.

**3c. Epoch bump only when needed** (`src/App.tsx` + `OnboardingFlow.tsx`): today every
close remounts Dashboard (re-simulation + chart re-animation + Monte Carlo/Real-Dollars/
active-scenario state wipe) even for Cancel/Skip that wrote nothing. Fix: change `onDone`
to `onDone(committed: boolean)` — OnboardingFlow passes its `hasCommitted` flag (from
Group 1c; finish/openPrivacy imply true, skip passes whatever hasCommitted is). App bumps
`epoch` only when `committed === true` OR on the `#start=` mid-wizard close (share import
needs the remount). Cancel/Skip with no commit: no remount, dashboard untouched.

**3d. HelpTooltip on Edit My Plan** (`src/components/layout/AppLayout.tsx`): replace the
native `title=` attribute with the repo's `HelpTooltip` component (`{text, children}`),
same text ("Re-run the guided setup. Your current numbers are pre-filled — nothing changes
until you save the plan."). Keep the pencil icon and button styling unchanged.

## Verification (each group, then end-to-end)

Docker only: `docker compose exec -T app sh -c "npm test 2>&1 | tail -10; npm run build 2>&1 | tail -6"`
— full suite (146) + tsc + both Vite entries green after each group; no new lint errors.

End-to-end (browser, localhost:5174): fresh-profile intro → scrim doesn't scroll the
dashboard (wheel over intro), Save on last step writes `retirement_sim_v2` BEFORE the
closing screen ("You're set." visible + key present), closing "Go to my dashboard" just
closes; Cancel from Edit My Plan → no chart re-animation (no remount); Edit My Plan on
dashboard N times → Back leaves the page on first press; Escape closes the wizard; focus
returns to Edit My Plan on close; 375px: nav + Edit My Plan visible/clickable; copy says
"Edit My Plan button"; tooltip renders via HelpTooltip on hover.
