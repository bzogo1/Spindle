# Cost model — what drives the Spindle bill

Grounded in `docs/runbooks/hosting.md` (§1 topology, §4 spending caps),
`infra/origin/compose.yaml`, `infra/host/bootstrap.sh`, and
`scripts/db/backup/backup.ts`. All dollar figures are **estimates** — the
`PRICE_TABLE` in `scripts/finops/report.mjs` is the single place to update
them, and every report carries the "reconcile with invoices" caveat.

## Fixed costs (do not vary with traffic)

| Component       | Spec                                                                          | Est. USD/mo | Notes                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------- | ----------: | -------------------------------------------------------------------------------------------------------------------------- |
| Production host | Hetzner AX42-1: 8C/16T, 64 GB RAM, 2×512 GB NVMe RAID1, 1 Gbit/s, Falkenstein |         ~64 | No autoscaling, no hard spend cap at Hetzner — the budget _alert_ is €200/mo (hosting.md §4). Cost is structural: one box. |
| Staging host    | Smaller instance (CPX31 or AX41 class)                                        |         ~16 | Separate host, own tunnel/DB/B2 bucket.                                                                                    |
| Cloudflare Pro  | Tunnel + DNS + CDN for `*.spindle.app`                                        |          20 | Tunnel egress is free; Pro adds analytics/notifications.                                                                   |
| Sentry          | Error monitoring org                                                          |         ≤20 | Hard org spend cap $20/mo per hosting.md §4.                                                                               |
| Resend          | Transactional email                                                           |           0 | Beta quota only; no automatic upgrade.                                                                                     |

**Fixed subtotal: ~$120/mo.** The hosting.md beta estimate of $155–185/mo
adds variable storage and LLM spend on top.

## Variable costs

### Backblaze B2 — object storage

- Used for: the sync worker's working-set reconciliation (`/srv/spindle/projects`
  ↔ B2, compose `worker` volume) and the **off-box backup** target.
- Local `pg_dump` artifacts land in `backups/` (default `BACKUP_RETENTION_COUNT=14`,
  cron example uses 30) via `scripts/db/backup/backup.ts`; the runbook notes the
  script "does not upload anywhere" — syncing to B2 is a separate step.
- Price: ~$6/TB-month storage; egress free up to 3× stored bytes.
- **Hard cap exists**: Caps & Alerts at 3 TB stored, alert at 2.5 TB,
  object versioning on (hosting.md §4). This is the only vendor-enforced hard
  cap in the stack.
- At beta scale (~2 TB incl. versioning headroom) expect **~$6–12/mo**.

### LLM API

- `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` are declared in
  `src/lib/env.server.ts` and the secrets catalog, but **no in-repo code path
  calls an LLM provider** — chat/agent features go through the external
  backend HTTP adapter (`src/lib/api/adapters/http.ts`, `usage.getUsageSummary`
  → `/usage/summary`). Treat LLM spend as an external-bill line item.
- Cap: **$100/mo hard limit on the production provider key** (hosting.md §4).
- The report accepts a usage JSON export (`--usage-file`); without it the LLM
  line is "not measured" rather than $0.

### Egress / bandwidth

- All ingress is Cloudflare Tunnel (outbound-only `cloudflared` connectors,
  two replicas). There is **no inbound public port** and Hetzner's 1 Gbit/s
  port includes generous traffic allowance (20 TB+/mo class) — bandwidth is
  not a meaningful cost driver at beta scale.
- B2 download is free up to 3× stored; the worker's reconcile loop is the main
  consumer. If egress ever mattered, Cloudflare cache in front of B2-backed
  assets is the lever (see `optimization.md`).

## What the report measures vs. what it estimates

| Measured on-host                                              | Estimated/static                |
| ------------------------------------------------------------- | ------------------------------- |
| `docker stats` CPU/mem per container                          | Host monthly price              |
| `.next`, `backups/`, `$SPINDLE_ROOT/{backups,projects}` sizes | B2 $/TB rate                    |
| Docker json-file log bytes vs rotation cap                    | Cloudflare/Sentry/Resend prices |
| LLM tokens/cost **if** a usage file is supplied               | LLM blended token rates         |

Single instantaneous `docker stats` samples are directional only — run the
report on a schedule and compare dates for trends.
