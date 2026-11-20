# Read replicas

Scope: optional Postgres read replicas for the application runtime. This is a
**configuration + client-routing** feature only — no live infrastructure is
provisioned by this repository. Setting the environment variables below is a
no-op until a replica actually exists and code opts in via
`withReadReplica` / `getReadReplicaPool` (see
[`src/lib/db/replica/`](../../src/lib/db/replica/)).

## Environment contract

All variables are optional and server-only. They are intentionally **not**
part of the validated `ServerEnv` schema or `.env.example`; the replica
module reads them directly from `process.env` so adopting them never touches
the shared env contract.

| Variable                | Format                             | Meaning                                               |
| ----------------------- | ---------------------------------- | ----------------------------------------------------- |
| `REPLICA_DATABASE_URL`  | single Postgres connection string  | Convenience form for one replica.                     |
| `REPLICA_DATABASE_URLS` | comma-separated connection strings | Ordered list of replicas; entries are tried in order. |

Rules:

- Both variables may be set; `REPLICA_DATABASE_URLS` entries come first, then
  `REPLICA_DATABASE_URL`. The combined list is trimmed, emptied entries are
  dropped, and duplicates are removed preserving first-seen order.
- Replica URLs should point at **read replicas** of the primary database —
  streaming replicas, not the primary itself. Writes must keep going to
  `DATABASE_URL`.
- When neither variable is set, `getReadReplicaPool()` returns `undefined`
  and every read stays on the primary. There is no error.
- Outside production, an unset `DATABASE_URL` still falls back to the local
  compose database for the primary side of the pool.

Example:

```bash
DATABASE_URL=postgresql://app:***@primary.example.com:6432/spindle
REPLICA_DATABASE_URLS=postgresql://app:***@replica-1.example.com:6432/spindle,postgresql://app:***@replica-2.example.com:6432/spindle
```

## How routing works

`createReadReplicaPool` builds one Prisma client per URL (replicas first,
primary last). Each endpoint gets its own `pg.Pool` constructed through the
shared `src/lib/db/pool.ts` path (`buildPoolConfig`/`createDatabasePool`) —
the same `DATABASE_POOL_*` sizing, `DATABASE_SSL`, keepAlive, and idle-client
error handling that `src/lib/db.ts` applies to the primary — wrapped in a
`PrismaClient` via `@prisma/adapter-pg`. Pool tuning variables therefore apply
per endpoint; keep the replica count small so total connections stay bounded.

`pool.read(fn)`:

1. Picks the next replica in round-robin order and runs `fn(client)`.
2. On error, tries the remaining replicas, then the **primary** — a total
   replica outage degrades to primary reads instead of failing the request.
3. Throws the last error only when every endpoint fails.

`withReadReplica(fn)` is the adoption helper for read call sites: it uses the
replica pool when configured and otherwise falls back to the regular `prisma`
client from `src/lib/db.ts`. The app is **not** rewired — migrate read-heavy
queries (dashboards, listings, reporting) incrementally.

```ts
import { withReadReplica } from "@/lib/db/replica/replica-client"

const projects = await withReadReplica((client) =>
  client.project.findMany({ where: { archivedAt: null } }),
)
```

Caveats:

- **Server-only.** The pg adapter requires the Node.js runtime; do not call
  this from edge handlers or client components.
- **No transaction spanning failover.** `read()` retries `fn` on a different
  client after a failure, so `fn` must be idempotent or safe to re-run. Do
  not wrap multi-statement transactions in `read()` unless you accept that a
  mid-transaction replica failure replays the whole callback on another
  endpoint.
- **Pool lifecycle.** Each endpoint gets its own `pg.Pool` (see above for the
  shared sizing/SSL knobs). `pool.close()` disconnects every Prisma client
  and then ends every pool — `PrismaPg(pool)` does not end an externally
  owned pool on `$disconnect`, so both steps are required. Keep the replica
  count small (1–3); `getReadReplicaPool()` caches the pool on
  `globalThis` across hot reloads, matching `src/lib/db.ts`.
- **Writes never route here.** Mutations, `$transaction` blocks that write,
  and anything needing read-after-write consistency must keep using `prisma`
  from `src/lib/db.ts`.

## Prisma-level vs app-level replica strategies

### App-level routing (what this module implements)

Separate `PrismaClient` instances per connection string, dispatched in
application code. This is what `src/lib/db/replica/` provides.

- Works with stock Prisma 7 + `@prisma/adapter-pg`; no preview features.
- Per-call-site control: only opted-in reads hit replicas.
- Failover is explicit and observable (round-robin + ordered fallback).
- Cost: you must audit call sites and keep the "is this read replica-safe?"
  decision in code review.

### Prisma-level / driver-level routing

Alternatives that hide routing inside the driver or Prisma itself:

- **pgbouncer / PgBouncer `pool_mode=transaction` in front of primary +
  replicas** with read/write splitting rules, or a proxy like
  [pgcat](https://github.com/postgresml/pgcat) / HAProxy that routes by SQL
  verb. Prisma sees a single `DATABASE_URL`.
- **Prisma Accelerate / Prisma Postgres** managed read replicas (vendor
  feature; requires the Accelerate data proxy).
- **Prisma Client extensions** (`$extends`) that swap the adapter per
  operation — possible but fragile: extensions cannot easily distinguish
  reads from writes at the query level without parsing operations, and
  `$transaction`/`$queryRaw` edge cases multiply.

Trade-offs vs app-level:

- Proxy-based splitting catches **every** read automatically, including ones
  added later — but it cannot know application semantics (e.g. "this
  `findUnique` must see a just-written row"), so it needs conservative rules
  and lag-aware caching anyway.
- Vendor/managed options reduce ops burden but add cost and lock-in.
- App-level routing keeps correctness decisions explicit next to the query,
  at the price of incremental adoption.

Recommendation: start with app-level routing for known-safe, high-volume
reads; revisit proxy-based splitting if replica coverage needs to be
automatic across the whole codebase.

## Replication lag considerations

Physical/logical streaming replicas apply WAL asynchronously, so replica
reads can return **stale data**:

- A user who just wrote data may not see it on a replica for milliseconds to
  seconds (or longer under load or during catch-up).
- **Never route these to replicas:** read-after-write flows (edit → refetch,
  optimistic UI confirmation, permission/role checks immediately after a
  change, webhook/idempotency lookups, auth-adjacent reads, anything feeding
  a destructive action).
- Safe candidates: dashboards, analytics, listings with tolerable staleness,
  public content, search indexes rebuilt periodically.
- The pool's failover does **not** help with lag — a lagging replica is
  "healthy" and will happily serve stale rows. If a workload needs fresher
  data, keep it on the primary; do not add retry logic expecting replicas to
  catch up.
- Replica lag is also why `read()` retries are safe: re-running a stale-tolerant
  query on the primary returns _fresher_ data, never less correct for the
  workloads this is meant for — but the same argument does **not** make
  `read()` safe for read-after-write queries, which should not use it at all.

## Operational notes

- Migrations always run against `DIRECT_URL`/primary via
  `scripts/db/migrate.mjs`; replicas are never migration targets.
- `npm run secrets:check` / the Infisical secret store should carry the
  `REPLICA_DATABASE_URL*` values in production once replicas exist; until
  then leaving them unset is fully supported.
- Monitoring: replica connection failures surface as fallbacks to the
  primary (higher primary read load). Alert on primary read QPS/CPU drift
  and on replica lag (`pg_stat_replication` / provider metrics) separately.
