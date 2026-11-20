# Performance benchmarks

A lightweight benchmark suite that turns the `.next` build output into a
comparable snapshot, stores baselines, and gates CI on regressions. It lives in
`scripts/perf/benchmarks/` and is dependency-free Node (`.mjs`).

## What it measures

`scripts/perf/benchmarks/bench.mjs` collects a JSON snapshot containing:

- **Static totals** — total JS/CSS/other bytes and file count under
  `.next/static`.
- **Per-route client payload** — for every page in
  `.next/app-path-routes-manifest.json`, the `*_client-reference-manifest.js`
  is parsed for referenced `/_next/static/...` chunks and their on-disk sizes
  are summed (deduplicated per route). This approximates the client JS each
  route pulls into the browser, including shared framework chunks.
- **Runtime metrics** (optional) — TTFB/FCP/LCP/TBT/CLS/INP embedded via
  `--runtime <file.json>`; flat keys like `lcpMs`/`tbtMs` or Lighthouse-style
  names (`largest-contentful-paint`) are both accepted.

The snapshot also records `BUILD_ID` so baseline↔current comparisons are
traceable to a specific build.

`scripts/perf/benchmarks/budgets.json` defines the gates:

- `regression.percent` / `regression.absoluteKbSlack` — a metric may grow by
  at most this much vs the baseline before `check` fails (default: +5% or
  +25 kB, whichever is larger).
- `bundle.routes` / `bundle.default` — absolute `maxJsKb` ceilings per route.
- `runtime` — absolute ceilings for TTFB/FCP/LCP/TBT/CLS/INP, aligned with
  `lighthouserc.json` (LCP ≤ 2500 ms, TBT ≤ 200 ms, CLS ≤ 0.1).

## Workflow

```bash
# 1. Build, then capture a baseline (run once per release branch / milestone)
npm run build
node scripts/perf/benchmarks/compare.mjs baseline            # -> baselines/main.json
node scripts/perf/benchmarks/compare.mjs baseline --name pr-123

# 2. After subsequent builds, diff against the baseline
node scripts/perf/benchmarks/compare.mjs diff --baseline main
node scripts/perf/benchmarks/compare.mjs check --baseline main   # CI gate

# 3. Capture ad-hoc snapshots for inspection
node scripts/perf/benchmarks/bench.mjs --out /tmp/snap.json --pretty
node scripts/perf/benchmarks/bench.mjs --runtime lighthouse.json
```

`check` exit codes: `0` = pass, `1` = regression or budget breach, `2` =
usage/IO error (e.g. missing baseline or missing `.next` build). Useful CI
flags: `--threshold <pct>` to tighten/loosen the regression window for one
run, `--require-runtime` to fail when no runtime metrics were supplied, and
`--current <file>` / `--runtime <file>` to compare stored snapshots instead
of a live build.

### Runtime metrics input

`--runtime` accepts a JSON file produced by Lighthouse CI, a custom
`performance.now()` probe, or anything shaped like:

```json
{ "lcpMs": 2100, "tbtMs": 120, "cls": 0.04, "fcpMs": 900, "ttfbMs": 180, "inpMs": 160 }
```

Per-route runtime budgets are not yet supported; the runtime section compares
global metrics only.

## Demo mode (offline)

Everything runs without a build:

```bash
node scripts/perf/benchmarks/bench.mjs --demo                 # synthetic snapshot
node scripts/perf/benchmarks/compare.mjs demo                 # full PASS + FAIL walkthrough
node scripts/perf/benchmarks/compare.mjs baseline --demo --name demo
node scripts/perf/benchmarks/compare.mjs check --demo --baseline demo
```

`compare.mjs demo` writes synthetic snapshots to a temp dir and prints two
scenarios: a within-thresholds PASS and an injected +20% regression on
`/docs/[slug]` that produces a FAIL report — exactly what a real `check` run
would print before exiting 1.

## Interpreting results

- `·` = within threshold, `↓`/`+` = improved/new, `✗` = regression or budget
  breach, `−` = route removed.
- Per-route numbers are **approximate**: they count every chunk referenced by
  the route's client modules (shared chunks included), uncompressed. Use them
  for relative comparisons and budgets, not as wire-size truth — gzip/brotli
  sizes differ. For module-level analysis see `npm run analyze` and
  `docs/performance/bundle-report.md`.
- Budgets in `budgets.json` were calibrated against the current Turbopack
  build; revisit `bundle.default`/`bundle.routes` after major dependency or
  routing changes. Snapshot files under `scripts/perf/benchmarks/snapshots/`
  are ad-hoc and gitignored; files under `baselines/` are meant to be
  committed.
