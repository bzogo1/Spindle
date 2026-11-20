# Deployment Metrics Dashboard

A local, self-contained dashboard for deployment metrics. It collects data from
local sources only — no external service is required — and renders a single
HTML file with inline CSS and SVG charts (no CDN dependencies).

## Running

```bash
# Demo mode — renders synthetic sample data, no real deploy needed
node scripts/deploy/metrics/collect.mjs --demo --out deploy-metrics/

# Collect from this repo
node scripts/deploy/metrics/collect.mjs --out deploy-metrics/

# With a health endpoint timing sample
node scripts/deploy/metrics/collect.mjs --health-url https://example.com/healthz

# Point at a different checkout / artifact dir / history depth
node scripts/deploy/metrics/collect.mjs --repo /path/to/repo \
  --artifacts .deploy-artifacts --last 30 --out reports/deploy
```

Outputs (written to `--out`, default `deploy-metrics/`):

- `index.html` — self-contained dashboard (open in any browser)
- `metrics.json` — the raw collected dataset

## Options

| Flag                | Default             | Description                                        |
| ------------------- | ------------------- | -------------------------------------------------- |
| `--demo`            | off                 | Use embedded sample data instead of real sources   |
| `--out <dir>`       | `deploy-metrics/`   | Output directory for `index.html` + `metrics.json` |
| `--artifacts <dir>` | `.deploy-artifacts` | Directory scanned recursively for artifact JSON    |
| `--health-url <u>`  | none                | Health endpoint to time (3 samples per run)        |
| `--repo <path>`     | cwd                 | Git repository to read tags/log from               |
| `--last <n>`        | `20`                | Max number of releases (tags) to include           |

## Data sources

### Git

`git for-each-ref` provides the tag list; releases are ordered newest-first by
their position in `git rev-list --topo-order HEAD` (robust to creatordate
ties). For each tag the script records the version, commit SHA, and timestamp,
and counts rollbacks by searching `git log <prev-tag>..<tag>` — where `<prev-tag>`
is the nearest ancestor tag found via `git describe --tags --abbrev=0 <tag>^` —
for `revert`/`rollback` messages (case-insensitive). If the repo has no tags, a
single entry for `HEAD` (`git describe --tags --always --dirty`) is emitted
instead.

### CI artifact files

Any `*.json` file under `--artifacts` is read and matched to a release by
`release`, `version`, or `commit`. Recognized fields:

```json
{
  "release": "v1.2.3",
  "version": "1.2.3",
  "commit": "abc1234",
  "buildSeconds": 123.4,
  "deploySeconds": 45.6,
  "status": "success",
  "rollback": false,
  "rollbackCount": 0,
  "timestamp": "2025-01-01T00:00:00Z"
}
```

Unmatched or malformed files are skipped. `status` accepts any string; the
dashboard styles `success`, `failure`, and `rolled-back` specially.

### Health endpoint

With `--health-url`, the script performs 3 timed `fetch` calls (10s timeout
each) and records latency, HTTP status, and success/failure per sample. These
feed the latency line chart and the health KPI.

## Dashboard contents

- KPI strip: release count, rollbacks, failures, current version, average
  build/deploy seconds, health latency
- Bar chart: build time per release
- Bar chart: deploy duration per release (rollback releases highlighted)
- Line chart: health-check latency over samples
- Table: per-release version, commit, timestamp, build/deploy durations,
  rollback count, status

In `--demo` mode a banner marks the page as synthetic data.

## Notes

- The script is dependency-free Node.js (ESM, `node:` builtins only).
- All sources degrade gracefully: missing tags, missing artifact files, or an
  unreachable health URL produce empty sections rather than errors.
- The generated `index.html` is a static artifact — safe to archive, attach to
  CI runs, or serve from any static host.
