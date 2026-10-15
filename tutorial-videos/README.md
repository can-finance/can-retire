# Tutorial videos

Scripted, silent screen recordings of the app with a fake cursor, click ripples,
captions and title/end cards. Playwright, Chromium and ffmpeg all live in a
Docker image; nothing is installed on the host or in this folder.

## Run

The dev server container (`can-retire-app-1`) must be running. The recorder
joins its network namespace, so it reaches Vite at `http://localhost:5173`
without tripping Vite's Host-header check.

Build the image once (and again after changing `Dockerfile`):

```powershell
docker build -t can-retire-tutorials tutorial-videos
```

Record a tutorial (PowerShell, from anywhere; extra args go through to `node`):

```powershell
.\tutorial-videos\record.ps1 create-a-plan.mjs
.\tutorial-videos\record.ps1 rrsp-optimizer.mjs --scene results
```

`record.ps1` finds the main checkout, passes its commit and dirty state into the
container (`TUT_APP_COMMIT`, `TUT_APP_DIRTY`, for `versions.json`), and checks
`can-retire-app-1` is running. The raw alternative:

```powershell
docker run --rm --network container:can-retire-app-1 -e TUT_APP_COMMIT=<sha> -e TUT_APP_DIRTY=0 -v "${PWD}/tutorial-videos:/work/tutorials" can-retire-tutorials node create-a-plan.mjs
```

From Git Bash, prefix with `MSYS_NO_PATHCONV=1` and use `"$(pwd -W)/tutorial-videos:/work/tutorials"`.

Output: `out/<name>.mp4` (H.264, yuv420p, faststart, 1280x720). The raw
Playwright WebM is kept under `out/raw/<name>/`. If a run fails, a screenshot of
the failing moment goes to `out/<name>-failure.png`.

### Tutorials recorded as scenes

Longer tutorials (`dashboard-tour.mjs`) are split into scenes, each recorded as its
own clip and then joined with short crossfades, so changing one caption re-records
one scene instead of the whole video:

```powershell
# everything (first run, or after a UI change)
.\tutorial-videos\record.ps1 dashboard-tour.mjs
# just these scenes, then re-join from the cached clips
.\tutorial-videos\record.ps1 dashboard-tour.mjs --scene cashflow
# re-join only (no recording)
docker run --rm -v "${PWD}/tutorial-videos:/work/tutorials" can-retire-tutorials node dashboard-tour.mjs --concat
```

Scene ids are in the script; `title` and `end` are added by the recorder. Clips
are cached in `out/raw/<name>/scenes/<id>.mp4`, and the run prints where each scene
starts in the joined video. Each scene starts from a fresh page load with the
fixture's saved plan, under a black cover that is lifted once the page is ready;
the clip is trimmed where the black ends. It also starts at the scroll position and
cursor position the previous scene ended on (cached as `<id>.json`), so the joins
line up. Scenes should therefore end in a clean state (drawer closed, no tooltip
up). If you change where a scene ends, re-record the scene after it too.

### Starting from a saved plan (fixtures)

A tutorial that should open on the dashboard rather than in Guided Setup loads a
localStorage fixture from `fixtures/<name>.json` before the first paint. It is
built on first use by driving Guided Setup's Quick start (`quickStartPlan` in
`lib/app.mjs`) with no video, and then reused. Rebuild it after the app's storage
shape changes, by deleting the file or passing `--refresh-fixture`. The fixture
includes the onboarding-done flag, so no first-run prompt appears.

Check frames (no network needed):

```powershell
docker run --rm -v "${PWD}/tutorial-videos:/work/tutorials" can-retire-tutorials node frames.mjs create-a-plan 12
docker run --rm -v "${PWD}/tutorial-videos:/work/tutorials" can-retire-tutorials node frames.mjs create-a-plan 7.5,18.4,30.2
```

## Which app version each video shows

Videos show whatever the main checkout is serving, so they go stale as the app
changes. `versions.json` (committed) records what each take was recorded against:
`appVersion` (read from the app's footer), `appCommit` and `dirty` (from
`TUT_APP_COMMIT` / `TUT_APP_DIRTY`, set by `record.ps1`) and `recordedAt`. Single
takes have one record; scene videos have one per scene, since scenes are
re-recorded individually and can differ, plus `joined` (last join; `--concat`
updates only that). Missing version or commit is recorded as null with a warning,
and a `dirty: true` record doesn't match its commit exactly. Pre-tracking entries
are null with a `note`.

To find stale videos, see what changed in the app since a video or scene was
recorded, using its `appCommit`:

```powershell
git log --oneline <appCommit>..main -- src
git diff --stat <appCommit>..main -- src
```

Commit `versions.json` along with the videos' scripts.

## Output format

1280×720, 24 fps, H.264 at CRF 23, no audio. CRF 23 was chosen over 20 (about
twice the size, no visible gain) and 26 (half the size again, but smears during
caption fades and scrolling). To trial other settings without overwriting the
real output, pass `-e TUT_FPS=30 -e TUT_CRF=20 -e TUT_SUFFIX=-trial` to
`docker run`. 720p is a hard limit: Playwright records at the viewport's CSS size
and never upscales.

## Layout

- `lib/overlay.mjs` — the in-page layer (cursor, ripple, highlight, caption, cards), injected with `addInitScript`. Nothing in `src/` is touched.
- `lib/tutor.mjs` — human-paced actions: `move`, `moveTo`, `click`, `clickAt`, `type`, `select`, `caption`, `card`, `scroll`, `scrollToTop`, `pause`. Shared pacing lives in `PACE`.
- `lib/recorder.mjs` — `record({ name, url, title, end, ready, run })`: one take from a fresh context (empty localStorage), title card over the page load, trim, MP4. `recordScenes({ name, url, storage, title, end, ready, scenes })`: the scene workflow above.
- `lib/fixture.mjs` — `ensureFixture` (build or load a localStorage fixture) and `seedStorage`.
- `lib/versions.mjs` — `versions.json` read/write helpers and the footer version reader; the recorder calls them after each take, scene and join.
- `record.ps1` — the usual way to record: passes the main checkout's commit into the container.
- `lib/app.mjs` — app-specific helpers: `field(scope, label)` for the unlabelled `FinancialInput`s, `guidedSetup(page)`, `quickStartPlan(page, persona)`, the pilot persona `MARIA`, and for the dashboard `chartCard(page, title)`, `chartPoint(card, age, yFrac)` (a point on a chart's age axis) and `yearDrawer(page)`.
- `create-a-plan.mjs` — single-take tutorial. Copy it to start a short one.
- `dashboard-tour.mjs` — scene-based tutorial starting from a saved plan. Copy it to start a long one.
- `rrsp-optimizer.mjs` — scene-based optimizer walkthrough. Scenes that start inside the optimizer re-open it and re-run the search under the black cover; `Math.random` is seeded so Monte Carlo rates match across scenes, and the script stops if the recommendation it quotes changes.
- `all-inputs.mjs` — scene-based walk through every dashboard input, one scene per input section. Captions use `{ pos: 'right' }` (bottom of the chart column) so they never cover the inputs, and it hides help tooltips except where it hovers one on purpose.

## Bug hunting

Every video doubles as a bug hunt. While reading the app's code to write
captions, and while checking frames, note anything wrong or confusing: numbers
that look off, behaviour that contradicts a label, tooltip or How It Works,
broken or cramped layout, duplicated or stale copy, controls that do nothing in
the state shown. Record each with `file:line` and report it with the video. Don't
fix app code from here: app fixes happen on main, once they've been agreed. The
first videos found several real bugs this way, including one-time events not
being adjusted for inflation and the RRSP melt starting at 60.

## Notes for new tutorials

- Personas are fictional. Alternate between male and female names across videos,
  and avoid pronouns in captions.
- The run prints each click and caption with an approximate timestamp in the final
  video. Under load the recorded video runs somewhat longer than wall-clock time,
  so later timestamps drift early; use them to find frames, not as exact cues.
- Native `<select>` popups don't appear in recordings; use `t.select()`, which shows
  the click and sets the value directly.
- Captions sit bottom-centre. Hide them before clicking anything in the bottom ~100px
  (the wizard's Next/Save buttons live there at 720p). On the dashboard, pass
  `{ pos: 'top' }` to put the caption over the sticky summary bar instead of over a
  chart, or `{ pos: 'left' }` to centre it on the left half while the year drawer
  covers the right. `{ pos: 'right' }` centres it at the bottom of the chart column, clear of the
  inputs column.
- Hovering a chart's plot pops its tooltip. To point at a series without one
  covering the bars, point at its legend entry, and move the cursor off the plot
  before a scene ends.
- On the dashboard the summary bar turns sticky once scrolled and covers ~220px of the
  top, so scroll by small amounts when showing a chart.
