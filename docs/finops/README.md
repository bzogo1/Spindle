# FinOps — cost monitoring for the Spindle origin

Cost visibility for the self-hosted deployment described in
`docs/runbooks/hosting.md` (ADR `docs/decisions/0001-container-host-topology.md`)
and the spending caps in hosting.md §4.

## Contents

| File                           | Purpose                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `cost-model.md`                | What drives the bill: hosts, B2, Cloudflare, Sentry, Resend, LLM — with the price table used by the report |
| `optimization.md`              | Right-sizing, retention tuning, egress/CDN notes, and the checklist for reviewing spend                    |
| `../scripts/finops/report.mjs` | The collector/report generator (dependency-free, offline-tolerant)                                         |

## Generating a report

```bash
# On the origin host (or anywhere with docker + the repo checked out):
node scripts/finops/report.mjs

# Offline verification / CI — fabricates all inputs, touches nothing:
node scripts/finops/report.mjs --demo

# Extra flags:
node scripts/finops/report.mjs --out /tmp/finops --json --host prod-origin-1
node scripts/finops/report.mjs --backup-dir /mnt/backups --usage-file ./usage.json
```

Outputs land in `scripts/finops/.output/` (gitignored) as
`finops-report-<date>.json` and `finops-report-<date>.md` (`-demo` suffix in
demo mode). `--json` also prints the report to stdout.

### What it collects

| Section     | Source                                                                                                                               | Offline behaviour                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Compute     | `docker stats --no-stream --format '{{json .}}'`                                                                                     | marked `unavailable` if docker is absent                                                    |
| Disk        | recursive size of `.next`, `backups/`, `$SPINDLE_ROOT/backups`, `$SPINDLE_ROOT/projects`, `/srv/spindle*` paths, plus `--backup-dir` | missing paths skipped; all-missing → `unavailable`                                          |
| Docker logs | `docker inspect` LogPath sizes; rotation cap assumed from compose `x-logging` (20m × 5)                                              | `unavailable` if docker absent                                                              |
| LLM usage   | JSON file (`--usage-file`, env `FINOPS_USAGE_FILE`, default `scripts/finops/usage.json`)                                             | `unavailable` with instructions — LLM calls are made by the external backend, not this repo |

Every collector is failure-tolerant: a section that cannot be measured is
reported as `unavailable`/`not measured` rather than aborting the report. Cost
figures come from a static `PRICE_TABLE` at the top of `report.mjs` — **all
prices are estimates**; reconcile them against real invoices quarterly (see
`cost-model.md`).

### LLM usage file format

```json
{
  "periodStart": "2026-11-01",
  "periodEnd": "2026-11-30",
  "requests": 18420,
  "inputTokens": 9840000,
  "outputTokens": 2310000,
  "costUsd": 64.17
}
```

`costUsd` may be omitted — the report then prices tokens with
`PRICE_TABLE.llm` blended rates ($3/$15 per 1M in/out). A `{ "daily": [...] }`
array of the same per-day shape is also accepted and aggregated. Today nothing
in `src/` calls an LLM provider directly (`LLM_API_KEY`/`LLM_BASE_URL`/
`LLM_MODEL` are declared in `src/lib/env.server.ts` and consumed by the
external backend behind the HTTP API adapter), so this input must be exported
from that backend or the provider dashboard.

### Scheduling

Run daily on the origin via cron alongside the backup job, or weekly is enough
for trend purposes:

```cron
15 4 * * * cd /srv/spindle && node scripts/finops/report.mjs >> /var/log/spindle-finops.log 2>&1
```

Keep the JSON outputs; diff month-over-month to spot storage or LLM drift
before it hits a provider cap.

## Relationship to existing monitoring

- `docs/oncall/` — paging/escalation for _incidents_; this directory is for
  _spend_ trends. A finops report is not an alert; wire thresholds (e.g. LLM
  > $100/mo, disk headroom < 50 GB) into the alert channel if desired.
- `scripts/db/monitoring/check.mjs` — DB freshness/health rules
  (`backup-staleness` watches the same `backups/` dir this report sizes).
- `docs/runbooks/hosting.md` §4 — the authoritative list of provider caps;
  this tooling measures against them, it does not replace them.
