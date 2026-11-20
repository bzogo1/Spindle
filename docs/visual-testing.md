# Visual regression testing

Spindle uses **Playwright's built-in screenshot comparison** (`toHaveScreenshot`)
for visual regression testing. It runs locally with zero extra accounts and in
CI via `.github/workflows/visual.yml`.

> **Optional upgrade path — Chromatic:** if the project later adopts Chromatic
> (or another visual-review service), the same specs can feed it: Chromatic's
> Playwright integration (`chromatic` CLI with `playwright` config) accepts
> `snapshotPathTemplate`-style baselines or can diff against its own cloud
> baselines. Treat it as a CI/review upgrade, not a prerequisite — the local
> pipeline below is fully self-contained.

## Layout

| Path                                 | Purpose                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.visual.config.ts`        | Dedicated config: own dev server on port `3100` with `NEXT_PUBLIC_MOCK_AUTH=1`, fixed 1440×900 viewport, `reducedMotion: "reduce"`, CI retries + HTML reporter                                                               |
| `e2e/visual/*.spec.ts`               | Specs grouped by surface: `site-pages.spec.ts` (marketing), `content-pages.spec.ts` (docs/changelog/contact/solutions), `auth-pages.spec.ts` (`(auth)`), `app-pages.spec.ts` (`(app)` shell + seeded `prj_01` project pages) |
| `e2e/visual/visual-helpers.ts`       | Determinism helpers (fixed clock, fonts/networkidle wait, mock-session cookie, shared `toHaveScreenshot` options)                                                                                                            |
| `e2e/visual/baselines/`              | Committed golden screenshots (`<name>-<project>-<platform>.png`)                                                                                                                                                             |
| `scripts/visual/update-baselines.sh` | One-shot baseline regeneration for both suites; warns when not run on Linux                                                                                                                                                  |
| `.github/workflows/visual.yml`       | CI job: runs comparisons, uploads diff artifacts on failure                                                                                                                                                                  |

### Storybook component visuals

A second, self-contained suite diffs **every Storybook story** (dark + light
themes) against baselines — no Chromatic or `storybook-addon-vrt` required:

| Path                                    | Purpose                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.storybook.visual.config.ts` | Serves `storybook-static/` via `scripts/serve-static.mjs` on port `3200` (`STORYBOOK_VISUAL_PORT` / `STORYBOOK_VISUAL_BASE_URL` to override) |
| `scripts/serve-static.mjs`              | Dependency-free static server with MIME types + path-traversal guard                                                                         |
| `e2e/storybook-visual/stories.spec.ts`  | Reads `storybook-static/index.json`, one test per `type==="story"` entry per theme                                                           |
| `e2e/storybook-visual/baselines/`       | Committed golden screenshots (`<story-id>-<theme>-<project>-<platform>.png`)                                                                 |

```bash
npm run build-storybook              # required first — produces storybook-static/
npm run test:storybook:visual        # compare stories against baselines
npm run test:storybook:visual:update # regenerate story baselines
```

Each test loads `iframe.html?id=<story-id>&viewMode=story&globals=theme:<dark|light>`
directly (no manager chrome) and reuses the same determinism helpers
(`gotoVisual`/`expectVisual`) as the page suite. Run `build-storybook` after
changing components or stories, then `test:storybook:visual:update` to refresh
baselines.

## Commands

```bash
npm run test:visual          # compare current UI against baselines (fails on diffs)
npm run test:visual:update   # regenerate page baselines (= --update-snapshots)
scripts/visual/update-baselines.sh  # regenerate BOTH suites (pages + Storybook); warns off-Linux
npx playwright test -c playwright.visual.config.ts --ui   # interactive debug
```

The visual config boots its own dev server (`npm run dev -- --port 3100`) with
`NEXT_PUBLIC_MOCK_AUTH=1`, so the `(app)` screens are reachable. Set
`PLAYWRIGHT_BASE_URL` to point at an already-running server instead (the config
then skips spawning one — make sure that server has mock auth enabled).

## Baseline workflow

1. Make your UI change.
2. Run `npm run test:visual`. Passing tests need no action.
3. On intentional visual changes, run `npm run test:visual:update` (pages) and/or
   `npm run test:storybook:visual:update` (stories — run `npm run build-storybook`
   first), or `scripts/visual/update-baselines.sh` for both at once. Review the
   new PNGs in `e2e/visual/baselines/` and `e2e/storybook-visual/baselines/`
   (`git diff` won't show pixels — open the files), and commit them with the change.
4. On CI failures, download the `visual-test-results` artifact: each failed
   test folder contains `*-actual.png`, `*-expected.png`, and `*-diff.png`
   (diff pixels highlighted). If the change is intended, run
   `npm run test:visual:update` locally and push the updated baselines.

### Platform note

Baseline filenames include the platform (`-linux`, `-darwin`, `-win32`) because
font rasterisation and antialiasing differ across OSes. **Generate and review
baselines on Linux** (matching CI) or on the same OS you compare on; each
platform keeps its own set under `baselines/`.

## Determinism measures (keep these when adding specs)

- `gotoVisual()` installs a **fixed clock** (`2026-01-15T12:00:00Z`) before
  navigation and resumes it, so mock-store timestamps and relative times
  ("8m ago") are identical every run.
- `reducedMotion: "reduce"` makes the marketing demos (typing loops, counters,
  agent trace) render final state instantly; `animations: "disabled"` in
  `toHaveScreenshot` neutralises CSS animation/transition frames.
- `document.fonts.ready` + best-effort `networkidle` wait before capture.
- `<canvas>` elements (WebGL globe, dither fields) are **masked** — GPU output
  is driver-dependent.
- Thresholds: `threshold: 0.25`, `maxDiffPixelRatio: 0.01` tolerate minor
  rasterisation noise while catching real layout/colour regressions.
- App screens authenticate by planting the `spindle_mock_session` cookie
  directly (see `signInToMockApp`); no UI sign-in flow needed.

When adding a spec, prefer surfaces with static mock data. Avoid pages with
random-per-browser content (e.g. `/referral` generates a random referral code)
or mask the dynamic region with the `mask` option.

## CI

`.github/workflows/visual.yml` runs on PRs and pushes to `main`:

- installs deps + Playwright Chromium, runs `npm run test:visual`
- builds Storybook (`npm run build-storybook`) and runs
  `npm run test:storybook:visual` (15-minute step timeout)
- on failure uploads `test-results/` (actual/expected/diff PNGs) and both HTML
  reports (`playwright-report-visual/`, `playwright-report-storybook/`) as the
  `visual-test-results` artifact (14-day retention)

Note: baselines must exist for the `linux` platform or every test fails on CI.
Generate them once with `npm run test:visual:update` on Linux (e.g. in a
container/CI) and commit the results.
