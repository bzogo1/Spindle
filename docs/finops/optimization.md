# Optimization recommendations

Ordered by expected savings-to-effort. Each item notes how to verify it with
`scripts/finops/report.mjs`.

## 1. Right-size the production host (biggest lever)

The AX42-1 (64 GB, ~$64/mo) hosts app + worker + Postgres + Valkey + two
cloudflared connectors + lab session containers capped at 12 concurrent.
Postgres `shared_buffers`/Valkey `maxmemory 512mb` are modest; the app
containers have no memory limits in compose.

- **Signal**: run `report.mjs` daily for a week; if `hostMemUtilizationPct`
  stays < 25% _including_ lab session containers, the host is oversized for
  steady state.
- **Action**: do **not** resize mid-beta — the 12-session lab ceiling is a
  product constraint, and Hetzner has no autoscaling. Instead:
  - Keep the AX42 but resist adding always-on services (no extra replicas,
    no staging-on-prod — staging already has its own host).
  - Revisit at renewal or when sustained utilization > 70% for a month.
- **Staging**: confirm it is CPX31/AX41-class (~$16/mo), not a second AX42.
  It runs the same compose stack and does not need lab capacity.

## 2. Backup retention ↔ storage cost

`BACKUP_RETENTION_COUNT` (default 14, cron example 30) × artifact size is the
driver of both local disk and B2 storage.

- Artifact size ≈ `pg_dump` custom-format size of the DB — measure it: the
  report's `avgBackupArtifactBytes` = measured backup-dir bytes ÷ retention.
- **Tuning rule**: retention should cover your restore-test cadence
  (`docs/runbooks/database-restore-test.md`) plus migration rollback window
  (`docs/runbooks/migration-rollback.md`). 14 daily artifacts ≈ 2 weeks;
  30 ≈ 1 month. Each extra week of daily backups costs
  `artifact_size × 7 × $6/TB-mo` on B2 — trivial (<$1/mo) until the DB is
  hundreds of GB.
- **Real risk is disk, not dollars**: backups + `/srv/spindle/projects`
  (the B2-synced working set) share the 480 GB usable RAID1 volume. The
  report warns when measured footprint leaves < 50 GB headroom. If
  `projects/` grows toward the cap, move the B2 sync root or the backup dir
  to a separate mount before touching retention.
- Keep object versioning on in B2 (hosting.md §4) — it is the cheapest
  protection against sync-worker corruption, and the 3 TB hard cap bounds it.

## 3. Docker logs and local disk

Compose already caps json-file logs at 20 MB × 5 files per service
(`x-logging` in `infra/origin/compose.yaml`) — bounded by design. The report
shows bytes used vs. that cap; >80% just means rotation is working. No action
needed unless a service is added **without** inheriting `x-logging` — check
new services in compose diffs.

`.next` on the host is a build artifact directory; on the origin the image is
built in CI and only `app-cache` is a volume, so `.next` growth is a
**local/dev-machine** concern (the report measures the checkout it runs in).
`next build` caches and `node_modules/.cache` can be pruned freely.

## 4. Egress / CDN notes

- Cloudflare Tunnel carries all ingress; there are no public ports, so
  Hetzner bandwidth billing is effectively nil at beta traffic. Do not add a
  CDN in front of the tunnel — Cloudflare _is_ the edge.
- If static assets or the docs site ever need cheaper delivery, Cloudflare
  Cache Rules in front of `app.spindle.app` are free on Pro; B2 downloads are
  already free up to 3× stored.
- The lab WebSocket path (`lab.spindle.app` → `lab-proxy:7000`) is long-lived;
  Cloudflare's ~100 s idle timeout is handled by client pings (verified in
  hosting.md §5). Persistent connections cost nothing extra but do count
  against concurrent-connection limits — not a cost issue at 12 sessions.

## 5. LLM spend guardrail

- The $100/mo provider-key cap (hosting.md §4) is the control; the report
  only _measures_. Wire `FINOPS_USAGE_FILE` to a monthly export from the
  backend that owns `LLM_*` calls so the report can trend against the cap.
- If usage approaches the cap: reduce `max_tokens`/context in the backend,
  cache repeated prompts, or move summarization-class calls to a cheaper
  model — all backend-side changes outside this repo.

## 6. Quarterly review checklist

1. `node scripts/finops/report.mjs` on the origin; archive the JSON.
2. Reconcile `PRICE_TABLE` in `report.mjs` against Hetzner/B2/Cloudflare/
   Sentry invoices; update `cost-model.md`.
3. Check B2 bucket size vs. the 3 TB hard cap and 2.5 TB alert.
4. Confirm staging instance class hasn't drifted up.
5. Re-run this checklist when: lab concurrency ceiling changes, retention
   changes, or a new always-on service is added to compose.
