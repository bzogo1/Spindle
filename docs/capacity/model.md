# Capacity model

How `scripts/capacity/calc.mjs` turns repo facts into a max sustainable RPS
number and a Postgres connection budget. Re-run triggers and the review
checklist live in [`review.md`](./review.md).

## Topology being modelled

The production origin is **one self-managed Hetzner box** running Docker
Compose (`infra/origin/compose.yaml`, ADR 0001):

| Service                                  | Role                                                      | Notes for capacity                                    |
| ---------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `app`                                    | Next.js server, loopback `:8080`, behind 2× `cloudflared` | `read_only`, no CPU/mem `deploy.resources` limits set |
| `worker`                                 | Sync worker (B2 reconcile, DEV-103)                       | Separate image, also holds a DB pool                  |
| `postgres`                               | `postgres:17-alpine`, named volume                        | `max_connections` defaults to **100**                 |
| `valkey`                                 | cache/queue, `--maxmemory 512mb`                          | Eviction `allkeys-lru`; not in the RPS ceiling model  |
| `docker-socket-proxy`, `cloudflared-1/2` | ingress + session orchestration                           | Small constant footprint                              |

Because everything shares one host's CPU/RAM/disk, **vertical scale-up is
the first lever**; horizontal app replicas on the same box only help when a
single Node process (event-loop saturation) is the bottleneck, and they add
DB connections (see below).

## Inputs and where they come from

### RPS ceiling (the numerator)

Measured with `scripts/perf/load.mjs` per
[`docs/performance/load-testing.md`](../performance/load-testing.md). Ship a
`--out report.json`, then feed it to the calculator:

```bash
node scripts/perf/load.mjs --config scripts/perf/scenarios/mixed-traffic.json \
  --concurrency 50 --duration 120s --out reports/load-$(date +%F).json
node scripts/capacity/calc.mjs --load-report reports/load-2026-01-15.json \
  --target-rps 500
```

The ceiling is the **highest achieved `summary.overall.rps`** among reports
that pass the quality gate: `errorRate <= 5%` **and** `p95Ms <= --p95-budget`
(default 500 ms). If no report passes, the calculator warns and uses the best
observed run — treat that number as provisional.

Caveats inherited from the load-testing doc: achieved RPS is truth (pacing is
approximate), concurrency ≠ browser users, localhost/demo numbers are not
comparable to staging/prod, and one source IP trips per-IP rate limiters.
**Only compare ceilings measured against the same target shape** (same
scenario mix, same network path).

### Headroom discount

`maxSustainableRps = ceiling × (1 − headroomPct/100)`, default 30%. The
reserved share covers the worker, backups, deploys/restarts, Valkey
failover, and traffic spikes above the measured peak. Raise `headroomPct`
after incidents or when running closer to a known bad day (launch, crawl).

### Traffic projection

`targetRps` is either explicit (`--target-rps`) or projected:
`currentRps × (1 + growthPct/100)^periods` over 12 months
(`growthPeriodMonths`, default 3 → 4 periods). `monthsToCap` reports when
the _un-discounted projection_ crosses the sustainable ceiling.

## Database connection budget

Runtime queries share one `pg.Pool` per process
([`src/lib/db.ts`](../../src/lib/db.ts),
[`src/lib/db/pool.ts`](../../src/lib/db/pool.ts)) with
`DATABASE_POOL_MAX` default **10 per process** — not per deployment
([`docs/database/connection-pooling.md`](../database/connection-pooling.md)).

The calculator's formula:

```
connections = poolMax × [ appProcesses × (1 + replicaPools) + workerProcesses ]
           + reservedConnections

appProcesses      = appReplicas × appProcessesPerReplica   (default 1×1)
replicaPools      = readReplicas>0 ? readReplicas + (fallback?1:0) : 0
workerProcesses   = worker containers holding a pool       (default 1)
reservedConnections = superuser + migrations + admin       (default 10)
```

Why `replicaPools` counts `readReplicas + 1`: when `REPLICA_DATABASE_URLS`
is set, `getReadReplicaPool()` builds **one `pg.Pool` per endpoint —
replicas first, primary last**
([`docs/database/read-replicas.md`](../database/read-replicas.md)). So each
app process holds its normal primary pool **plus** a pool per replica URL
**plus** a fallback pool to the primary. Verify the real process count
(`appProcessesPerReplica`) against the deployed image before trusting the
number — Next.js standalone runs one Node process, but check for
cluster/worker modes.

Budget rule: total must stay ≤ **80% of `max_connections`** (default 100 →
80 usable). The remaining 20% covers superuser-reserved connections,
migration runs (`DIRECT_URL` bypasses the pool), `prisma studio`, and
unexpected spikes. A Postgres crash-loop from connection exhaustion is the
failure this guards against.

Sanity check on defaults: 1 app + 1 worker = `10 × (1 + 1) + 10 = 30`
connections — comfortable. Adding a second app replica with one read
replica: `10 × (2 × (1 + 2) + 1) + 10 = 80` — at the cap already.

## Scaling recommendation logic

The script emits `[blocker|warn|action|info|ok]` recommendations:

1. **Connection budget blown** → blocker: cut `DATABASE_POOL_MAX`, reduce
   replicas/processes, or raise `max_connections` (requires Postgres config
   change + restart — plan it).
2. **Target > sustainable** →
   - DB budget >70% used: **vertical first** (bigger host raises CPU/RAM and
     lets you raise `max_connections`), then replicas.
   - Otherwise: **vertical scale-up** of the Hetzner box. App replicas on the
     same host share CPU/RAM and multiply DB connections; they only help for
     single-process event-loop saturation.
   - If `readPct` of replica-safe reads is large and no read replicas exist:
     **read replicas** — provision streaming replicas and route safe reads via
     `REPLICA_DATABASE_URLS`/`withReadReplica`. Never route read-after-write,
     auth-adjacent, or destructive-precondition reads (lag is invisible to
     the pool's health check).
3. **Ceiling reachable within ~12 months at current growth** → schedule a
   review per `review.md`.

## What this model does NOT cover

- Worker throughput / B2 sync backlog (separate capacity domain).
- Valkey memory pressure (512mb cap, `allkeys-lru` eviction).
- Disk I/O on the single volume (Postgres data + `SPINDLE_ROOT` projects).
- Cloudflare Tunnel edge limits and per-IP rate limiters.
- Session/lab containers on `spindle-lab` (orchestrated, ephemeral).
- Multi-AZ or multi-host failover — out of scope for a single box.
