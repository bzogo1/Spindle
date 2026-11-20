# Lab run snapshots & visual diff

Pixel-perfect visual regression for Lab run outputs. Captures are produced by a
pluggable `SnapshotProvider`, compared against approved baselines with
[pixelmatch](https://github.com/mapbox/pixelmatch), and gated in CI by
`scripts/lab-snapshot-diff.ts`.

> The Lab feature is currently a client-side mock (`src/components/app/lab-mock.ts`,
> `lab-screen.tsx`) — there is no backend run model yet. Everything below is
> backend-agnostic and slots in once runs have previewable output.

## Layout

```
src/lib/lab-snapshots/
  types.ts         SnapshotProvider contract, DiffOptions, DiffResult
  diff.ts          compareSnapshots() — pixelmatch + pngjs, masks, regions
  baseline.ts      baseline keys (config hash), .lab-snapshots/ storage
  providers.ts     registry + MockSnapshotProvider (deterministic dev renderer)
  analyze.ts       heuristic diff analyzer (categories, significance, summary)
  perceptual.ts    luminance diff %, SSIM-lite, region heatmap, overlay PNG
  perf.ts          capture-metrics baselines + regression/threshold reports
  a11y.ts          dependency-free static a11y checks on snapshot HTML
  flaky.ts         flakiness scoring over run history + quarantine verdicts
  *.test.ts        vitest coverage for all of the above
src/components/lab/
  snapshot-diff-viewer.tsx   diff viewer (side / overlay / heatmap views)
  snapshot-analysis-panel.tsx  analysis report panel
  perf-report-panel.tsx        perf report panel
  a11y-report-panel.tsx        a11y report panel
scripts/lab-snapshot-diff.ts   CI entry point (run via tsx)
scripts/lab-analyze-runs.ts    post-run analysis over run artifacts
scripts/lab-viewport-matrix.ts cross-device viewport capture matrix
scripts/lab-network-throttle.ts  CDP network-throttle probe
scripts/lab-geolocation.ts     geolocation-emulation probe
scripts/lab-schedule.ts        interval/once scheduler for the suite
scripts/lab-snapshot-shard.ts  parallel sharded runner
scripts/lab-flaky-report.ts    flaky-test report + quarantine list
e2e/lab-a11y.spec.ts           axe-core audit of lab routes
src/app/(app)/app/lab/snapshots/page.tsx  live demo of all panels
```

Artifacts live under `.lab-snapshots/` (gitignored, override with
`LAB_SNAPSHOT_DIR`):

```
.lab-snapshots/
  baselines/<name>-<hash>.png     approved baselines, keyed by config hash
  runs/<runId>/<name>-actual.png  latest actual capture
  runs/<runId>/<name>-diff.png    last diff visualization
  runs/<runId>/<name>-baseline.png baseline used for the last comparison
  runs/<runId>/<name>-analysis.json  written by lab-analyze-runs.ts
  history.jsonl                 per-case run records (diff script appends)
  flaky-report.json             output of lab-flaky-report.ts
  quarantine.md                 quarantine list (output of flaky report)
  schedule-history.jsonl        output of lab-schedule.ts
  analysis-report.json          combined output of lab-analyze-runs.ts
  viewport/                     captures + manifest from lab-viewport-matrix.ts
  network/throttle-report.json  output of lab-network-throttle.ts
  geolocation/geolocation-report.json  output of lab-geolocation.ts (+ PNGs)
```

## SnapshotProvider contract

```ts
interface SnapshotProvider {
  readonly name: string
  capture(request: SnapshotCaptureRequest): Promise<SnapshotCaptureResult>
}
```

`SnapshotCaptureRequest` carries `runId`, `toolId`, `params`, `projectId`, and a
`config` bag (viewport, theme, fonts, `mockPerturb`, …). A real implementation —
e.g. a **Playwright sidecar** or hosted screenshot service — must:

1. Resolve the run's preview URL/state from `runId`.
2. Render deterministically: fixed viewport, fonts, theme; apply
   `config.masks`/`maskRegions` for dynamic regions.
3. Wait for quiescence (network idle, fonts loaded, animations settled).
4. Return PNG `SnapshotImage`s with **stable `name`s** — names must be
   deterministic per config so baselines line up.

Register a real provider via `registerSnapshotProvider(name, factory)` or the
`LAB_SNAPSHOT_PROVIDER` env var; `getSnapshotProvider()` resolves it. The
`mock` provider renders a deterministic seeded PNG and supports
`config.mockPerturb` (pixel count) to exercise the diff pipeline.

## Baseline keys

`computeBaselineKey({ name, config, viewport, theme })` →
`<name>-<sha256[:16]>` over the canonical (key-sorted) config. Same name + same
config ⇒ same baseline; **any config change intentionally produces a new key**
(and therefore a missing-baseline failure until approved).

## Diff engine

`compareSnapshots(actualPng, baselinePng, options)` returns `{ pass, diffPixels,
diffRatio, diffPng, regions }`:

- `threshold` (0–1, default `0.1`) — per-pixel OKLab color threshold.
- `maxDiffRatio` (default `0`) — max fraction of changed pixels for `pass`.
- `includeAA` (default `false`) — pixelmatch detects and ignores anti-aliased
  pixels; set `true` to count them.
- `maskRegions` — rectangles excluded via pixelmatch's `ignoreMask`.
- `regionColumns` — optional grid breakdown (`RegionDiff[]`).

Dimension mismatches throw `SnapshotDimensionError` (hard fail).

## CI usage

Manifest (`snapshots.json`):

```json
{
  "cases": [
    {
      "name": "tide-analysis",
      "runId": "ci-1",
      "config": { "viewport": { "width": 800, "height": 600 }, "theme": "light" },
      "params": { "window": 30 },
      "maskRegions": [{ "x": 700, "y": 10, "width": 90, "height": 20 }]
    }
  ]
}
```

```bash
# Approve/update baselines locally, then commit nothing — .lab-snapshots is local.
# In CI, baselines must be produced by a trusted job and stored as artifacts/cache.
npm run lab:snapshots:update -- --manifest snapshots.json
npm run lab:snapshots:diff   -- --manifest snapshots.json
```

Cases may set `actual: "path.png"` to diff an existing capture, or omit it to
capture via `provider` (default `mock` / `LAB_SNAPSHOT_PROVIDER`). Per-case
`threshold`, `maxDiffRatio`, `includeAA`, `maskRegions` override CLI defaults
(`--threshold`, `--max-diff-ratio`, `--region-columns`). `--shard <i>/<n>`
runs only shard `i` of `n` (round-robin over manifest order) for parallel
execution — see "Parallelization". Every non-update case appends a record to
`history.jsonl` (see "Flaky-test detection"). Exit code is 1 when any case
fails or lacks a baseline.

## Diff analysis (heuristic "AI")

`analyzeSnapshotDiff(diffResult, { name, gridColumns })` (`analyze.ts`) turns a
`DiffResult` into a structured report — no external AI:

- **Categories**: `layout` (edge/top-strip concentration), `content`
  (localized interior blocks / broad content change), `visual` (low-level
  pixel churn), `noise` (sub-threshold residue).
- **Significance**: 0–100 score blending diff ratio, grid coverage, and peak
  cell concentration.
- **Summary**: rule-based natural-language sentences plus per-finding reasons.

When the diff has no `regions` (no `regionColumns`), the analyzer derives its
own coarse grid by scanning the diff PNG for pixelmatch highlight colors.

`scripts/lab-analyze-runs.ts` re-runs this over stored artifacts:

```bash
npx tsx scripts/lab-analyze-runs.ts --dir .lab-snapshots [--run <runId>] [--grid 16]
```

It writes `<name>-analysis.json` per case and a combined
`analysis-report.json`. UI: `SnapshotAnalysisPanel` (used on
`/app/lab/snapshots`).

## Perceptual comparison

`comparePerceptual(actualPng, baselinePng, options)` (`perceptual.ts`)
complements the pixel-exact diff with human-perception signals:

- `pixelDiffRatio` — fraction of pixels whose Rec.601 luminance delta exceeds
  `epsilon` (default 0.05).
- `meanLuminanceDelta` — average |Δluma|, 0–1.
- `ssim` — SSIM-lite over the heatmap grid's mean-luminance map (single-window,
  coarse; degenerate on perfectly flat images — treat as a trend signal).
- `heatmap` — per-cell `{ diffRatio, meanDelta }` grid for region overlays.
- `overlayPng` — baseline with perceptually-changed pixels tinted.

`SnapshotDiffViewer` accepts `heatmap` + `perceptual` props and adds a
**Heatmap** view mode (CSS-grid overlay, no canvas required).

## Performance profiling

`perf.ts` models capture metrics (`CaptureMetrics`: `durationMs`, `bytes`,
optional dimensions) and produces `PerfReport`s via `evaluatePerfReport`:

- Absolute gates: `maxDurationMs`, `maxBytes` → critical findings.
- Baseline regression: vs `buildPerfBaselines()` medians, gated by
  `maxRegressionRatio` (default 0.25). Severity scales with the gate —
  `≥ max(50%, 2×gate)` is critical, otherwise warning. Warnings don't fail
  the report; criticals do.

Providers should emit `CaptureMetrics` per capture; store baselines as JSON
and feed both into `evaluatePerfReport`. `PerfReportPanel` renders the report.

## Accessibility testing

Two layers:

1. **Static** (`a11y.ts`): `analyzeHtmlForA11y(html)` runs dependency-free
   checks on stored snapshot markup — `lang`, `img` alt, form-control labels,
   inline-style WCAG contrast (4.5:1 AA), heading-order skips. Returns a
   0–100 score + findings. Heuristic only; `A11yReportPanel` renders it.
2. **Browser** (`e2e/lab-a11y.spec.ts`): axe-core (`@axe-core/playwright`,
   already a dev dependency) audits `/lab` and `/app/lab/snapshots`, failing
   on serious/critical violations. `color-contrast` is excluded for the same
   known decorative-mockup issues as `e2e/a11y.spec.ts`.

Run: `npx playwright test e2e/lab-a11y.spec.ts`.

## Cross-device testing

`scripts/lab-viewport-matrix.ts` captures screenshots across a device/viewport
preset matrix using Playwright directly:

```bash
npx tsx scripts/lab-viewport-matrix.ts                 # default /lab × 6 presets
npx tsx scripts/lab-viewport-matrix.ts --routes /,/lab,/pricing --url /docs
npx tsx scripts/lab-viewport-matrix.ts --list          # show presets
```

Presets: mobile-s (320×568), mobile-l (414×896), tablet (768×1024), laptop
(1280×800), desktop (1440×900), wide (1920×1080). Override with
`LAB_VIEWPORT_PRESETS` (JSON array of `{name,width,height,deviceScaleFactor,
isMobile,hasTouch,userAgent}`). Output: PNGs + `manifest.json` under
`.lab-snapshots/viewport/`. Requires a running server (`PLAYWRIGHT_BASE_URL`,
default `http://localhost:3000`). Compare captures across presets with the
diff pipeline (`actual:` manifest field) or eyeball the manifest timings.

## Network throttling

`scripts/lab-network-throttle.ts` applies Chromium CDP
`Network.emulateNetworkConditions` per preset and records navigation timings:

```bash
npx tsx scripts/lab-network-throttle.ts                 # /lab × all presets
npx tsx scripts/lab-network-throttle.ts --preset slow-3g --routes /,/lab
```

Presets: `none`, `offline` (expected to fail navigation — recorded as an
error entry, which is itself the signal), `slow-3g` (400ms/50KB·s⁻¹),
`fast-3g` (150ms/200KB·s⁻¹), `lte` (70ms/1.6MB·s⁻¹). Output:
`.lab-snapshots/network/throttle-report.json` with
`domContentLoadedMs`/`loadMs`/`transferSize`/`resourceCount` per probe.

## Geolocation testing

`scripts/lab-geolocation.ts` emulates `navigator.geolocation` via Playwright
context options (`geolocation` + `permissions`), reads back coordinates inside
the page, and optionally screenshots:

```bash
npx tsx scripts/lab-geolocation.ts                  # /lab × nyc/london/tokyo/sydney/denied
npx tsx scripts/lab-geolocation.ts --preset tokyo --no-screenshot
```

Custom presets via `LAB_GEO_PRESETS` JSON
(`[{name,latitude,longitude,accuracy,denied}]`). The `denied` preset omits the
permission grant to exercise the error path. Output:
`.lab-snapshots/geolocation/geolocation-report.json` + per-preset PNGs.

## Scheduling

`scripts/lab-schedule.ts` runs the suite on an interval or once:

```bash
# single pass (also the cron-friendly mode)
npx tsx scripts/lab-schedule.ts --once --manifest snapshots.json

# every 30 minutes, 4 sharded workers
npx tsx scripts/lab-schedule.ts --manifest snapshots.json --interval-minutes 30 --workers 4
```

Per-run outcomes append to `.lab-snapshots/schedule-history.jsonl`. Interval
mode survives red runs (failures are recorded, not fatal). For real
scheduling prefer cron/systemd rather than a long-lived process:

```cron
# /etc/cron.d/spindle-lab — every 30 min
*/30 * * * * ci cd /path/to/repo && npx tsx scripts/lab-schedule.ts --once --manifest snapshots.json >> /var/log/lab-snapshots.log 2>&1
```

```ini
# lab-snapshots.service / .timer equivalent:
# [Service] ExecStart=/usr/bin/npx tsx scripts/lab-schedule.ts --once --manifest snapshots.json
# [Timer]   OnCalendar=*:0/30
```

## Parallelization

`scripts/lab-snapshot-shard.ts` splits the manifest across N workers; each
worker runs `lab-snapshot-diff.ts --shard i/N` (round-robin over manifest
order, deterministic). Artifacts and `history.jsonl` appends are per-case, so
shards are safe to run concurrently:

```bash
npx tsx scripts/lab-snapshot-shard.ts --manifest snapshots.json --workers 4
# or inside the scheduler: --workers 4 routes through the sharded runner
```

For very large manifests you can also shard manually:
`npx tsx scripts/lab-snapshot-diff.ts --manifest m.json --shard 0/4` … `3/4`.

## Flaky-test detection

Every diff run appends one JSONL record per case to `history.jsonl`
(`{timestamp, caseName, runId, pass, diffRatio, durationMs, ...}`).

`scripts/lab-flaky-report.ts` analyzes the history:

```bash
npx tsx scripts/lab-flaky-report.ts                 # table + writes reports
npx tsx scripts/lab-flaky-report.ts --json          # machine-readable stdout
npx tsx scripts/lab-flaky-report.ts --min-runs 5 --quarantine known-bad-case
```

`analyzeFlakiness` (`flaky.ts`) scores each case on pass rate, diff-ratio
coefficient of variation, retry counts, and sample size → verdicts
`stable` / `watch` / `flaky` / `quarantined`. Outputs:
`flaky-report.json` + `quarantine.md` (a markdown table ready to paste into a
tracking issue). See the quarantine list below.

### Quarantine list

_Cases currently recommended for quarantine — regenerated by
`lab-flaky-report.ts`; keep this section in sync with `quarantine.md`._

| Case                                                        | Verdict | Runs | Pass rate | Flaky score | Reasons |
| ----------------------------------------------------------- | ------- | ---- | --------- | ----------- | ------- |
| _(none yet — populate from `.lab-snapshots/quarantine.md`)_ |         |      |           |             |         |

To exclude a quarantined case from gating, remove it from the manifest (or
mark it `"quarantine": true` and filter before running) until the underlying
nondeterminism is fixed; re-run `--update` deliberately, never blanket.

Suggested CI shape: a `snapshots` job runs the suite with the real provider,
then `lab:snapshots:diff`; on failure upload `.lab-snapshots/runs/` artifacts.

## Flaky-test handling

- **Retries**: wrap the _capture_ step in retries (provider-side), not the diff —
  a flaky capture should never reach the comparator. Keep `maxDiffRatio: 0`
  semantics strict once captures are deterministic.
- **Threshold tuning**: raise `threshold` (per-pixel, ≤ ~0.2) for cross-platform
  font/AA noise; prefer `maskRegions` over a high `maxDiffRatio` so real changes
  still fail.
- **Masking dynamic regions**: timestamps, live counters, randomized data-viz
  seeds, avatars → add `maskRegions` rectangles (or render them deterministic
  via `config`). Mask generously around the region; the ignore mask is
  pixel-exact.
- **Nondeterministic ordering**: sort run outputs before capture; keep `name`s
  stable.
- **Baseline drift**: re-approve deliberately via `--update` and review the
  `*-diff.png` artifacts; never blanket-update in CI.
