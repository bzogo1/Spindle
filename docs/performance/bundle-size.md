# Bundle size monitoring

Continuous tracking of client JS/CSS bundle sizes: per-build snapshots,
budget enforcement, and growth warnings. Complements the one-shot module
analysis in `bundle-report.md` and the hard build gate in
`check-client-bundle.mjs`.

## What it measures

`scripts/bundle-size/monitor.mjs` reads the `.next` build output after
`next build`:

- **Per-route first-load JS/CSS (gzip)** — from, in priority order:
  1. `.next/app-build-manifest.json` `pages[route].files` (webpack builds;
     includes `.js` and `.css`)
  2. `.next/diagnostics/route-bundle-stats.json` `firstLoadChunkPaths`
     (Turbopack builds; **JS only** — Turbopack does not attribute per-route
     CSS, so per-route CSS budgets only apply on webpack builds)
- **Total `.next/static` JS+CSS (gzip)** — every `.js`/`.css` file under
  `.next/static`, including lazy chunks. Same set `check-client-bundle.mjs`
  enforces.

All sizes are real `gzipSync` measurements of the emitted files, not
estimates.

## Usage

```bash
# After `npm run build` (or `npm run analyze` for a webpack build):
node scripts/bundle-size/monitor.mjs

# Fully offline demo on synthetic data (no .next required):
node scripts/bundle-size/monitor.mjs --demo

# Options
node scripts/bundle-size/monitor.mjs --no-record        # don't append to history
node scripts/bundle-size/monitor.mjs --top 30           # more routes in report
node scripts/bundle-size/monitor.mjs --budgets <path>   # alternate budgets
node scripts/bundle-size/monitor.mjs --history <path>   # alternate history file
```

Every non-demo run appends one JSONL snapshot to
`scripts/bundle-size/history.jsonl` (disable with `--no-record`). Each line:

```json
{
  "ts": "2026-11-20T12:00:00.000Z",
  "source": "turbopack",
  "total": { "jsKb": 700.1, "cssKb": 214.9, "jsCssKb": 927.3, "fileCount": 412 },
  "routes": { "/": { "jsKb": 388.2, "cssKb": 31.4, "jsCssKb": 419.6, "fileCount": 24 } }
}
```

The previous snapshot is used for regression warnings (see below).

## Budgets

`scripts/bundle-size/budgets.json` holds the limits:

| Key                         | Meaning                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `total.maxJsCssKb`          | Ceiling for all `.js`/`.css` under `.next/static` (initial + lazy) |
| `routes.<route>.maxJsCssKb` | Per-route first-load JS+CSS ceiling                                |
| `routes.<route>.maxCssKb`   | Per-route CSS ceiling (webpack builds only)                        |
| `defaultRoute`              | Fallback for routes not listed in `routes`                         |
| `regression.percent`        | Growth-warning threshold vs. previous snapshot                     |

Route lookup order: exact match → `/prefix/*` wildcard keys → `defaultRoute`.

Current values are `ceil(baseline × 1.25)` against the 2026-11-20 calibration
used by `check-client-bundle.mjs`: global JS+CSS 914.2 KiB gzip → 1143 KiB
budget; worst-route initial JS+CSS 449.3 KiB gzip → 562 KiB; worst-route CSS
34.3 KiB gzip → 43 KiB. Auth routes (`/sign-in`, `/sign-up`) get tighter
420 KiB ceilings; `/app/*` gets 700 KiB. Revisit after major dependency or
routing changes.

Two non-fatal warning classes:

- **Near budget** — a route within 10% of its `maxJsCssKb` ceiling.
- **Regression** — a route or the total grew by more than
  `regression.percent` (default 5%) versus the previous history snapshot.

## Exit codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | All budgets satisfied (warnings allowed) |
| 1    | At least one budget exceeded             |
| 2    | Usage error, or no build manifests found |

## CI integration sketch

Run after the build step, before deploy:

```yaml
- name: Build
  run: npm run build # postbuild already runs check-client-bundle
- name: Bundle size monitor
  run: node scripts/bundle-size/monitor.mjs
- name: Upload size history
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: bundle-size-history
    path: scripts/bundle-size/history.jsonl
```

Suggested pipeline policy:

- **PR / pre-merge**: run with `--no-record` (or record and discard the
  artifact) so PR builds don't pollute the trend history; exit 1 blocks merge
  on hard budget breaches.
- **Main / nightly**: record normally and archive `history.jsonl` as a build
  artifact (or commit it periodically) to keep the regression baseline.
- Optionally diff two history files offline:
  `node -e 'const l=require("fs").readFileSync("scripts/bundle-size/history.jsonl","utf8").trim().split("\n");console.log(JSON.parse(l.at(-1)))'`

To tighten budgets deliberately, edit `budgets.json` — the `_comment` field
records the calibration baseline and rationale.

## Relationship to other checks

- `npm run check:client-bundle` (`scripts/check-client-bundle.mjs`) is a
  **postbuild hard gate**: Shiki-leak scan + the same class of gzip budgets.
  It fails the build; `monitor.mjs` is the **trend + reporting** layer.
- `npm run analyze` + `scripts/bundle-report.mjs` answers _which modules_ are
  heavy; `monitor.mjs` answers _how big each route's shipped JS/CSS is over
  time_.
- `scripts/perf/benchmarks/budgets.json` budgets **runtime** metrics
  (TTFB/FCP/LCP) and approximate JS payloads; this file budgets **gzip bytes
  of emitted chunks**.
