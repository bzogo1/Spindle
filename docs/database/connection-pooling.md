# Database connection pooling

Runtime queries go through a single shared `pg.Pool` owned by
[`src/lib/db.ts`](../../src/lib/db.ts) and configured by
[`src/lib/db/pool.ts`](../../src/lib/db/pool.ts). The pool is handed to Prisma
via `@prisma/adapter-pg` (`new PrismaPg(pool)`), so every `prisma.*` call
checks out a pooled connection instead of opening a new TCP+TLS session.

Migrations, `prisma studio`, and seeding do **not** use this pool — they use
the direct `DIRECT_URL` connection (see `prisma7.config.ts` and
[`src/lib/database-url.ts`](../../src/lib/database-url.ts)). Keep
`DATABASE_URL` pointed at your provider's _pooler_ endpoint (e.g. PgBouncer,
RDS Proxy, Supavisor) and `DIRECT_URL` at the direct endpoint.

## Configuration

All variables are optional; invalid or blank values fall back to the defaults
shown. They are read directly from `process.env` in `src/lib/db/pool.ts`
because they are tuning knobs, not part of the validated server schema (the
schema's key list must stay in parity with `.env.example`).

| Variable                              | Default | Meaning                                                                              |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `DATABASE_POOL_MAX`                   | `10`    | Maximum pooled connections per process.                                              |
| `DATABASE_POOL_MIN`                   | `0`     | Minimum idle connections kept open (clamped to `max`).                               |
| `DATABASE_POOL_IDLE_TIMEOUT_MS`       | `30000` | Close idle clients after this many ms.                                               |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000` | Fail a checkout that cannot establish a connection within this many ms.              |
| `DATABASE_POOL_KEEPALIVE_DELAY_MS`    | `10000` | TCP keepalive initial delay for pooled sockets.                                      |
| `DATABASE_SSL`                        | auto    | TLS override: `disable`, `require` (skip cert verification), `verify`/`verify-full`. |

### TLS behaviour

`resolveSslConfig` decides the pool's `ssl` option in this order:

1. If `DATABASE_URL` already contains TLS parameters (`sslmode`, `ssl`,
   `sslcert`, `sslkey`, `sslrootcert`, `sslcrl`), `pg` parses them itself and
   no `ssl` key is set — e.g. `?sslmode=verify-full&sslrootcert=...`.
2. `DATABASE_SSL=disable|false|0` forces plaintext.
3. `DATABASE_SSL=require` allows self-signed certificates
   (`rejectUnauthorized: false`); `verify`/`verify-full` requires a valid
   chain.
4. Otherwise, production gets verified TLS (`rejectUnauthorized: true`)
   unless the host is local (`localhost`, `*.localhost`, `127.*`, `::1`);
   development/test get plaintext.

## Pool sizing guidance

`max` is **per application process**, not per deployment. Total connections
to Postgres ≈ `replicaCount × DATABASE_POOL_MAX × processesPerReplica`
(plus replicas, migrations, and direct admin connections). Size `max` so the
sum stays comfortably under the database's `max_connections` — a common rule
is to leave headroom for superuser/reserved connections and unexpected spikes.

- **Small container / single replica:** default `10` is fine; most request
  paths hold a connection for single-digit milliseconds.
- **Horizontal scaling:** prefer lowering `DATABASE_POOL_MAX` and adding
  replicas over raising `max` — more, smaller pools spread load and reduce
  blast radius when one instance restarts.
- **Serverless / many short-lived instances:** keep `max` low (2–5) and rely
  on a provider-side pooler (`DATABASE_URL` already points at it). Beware cold
  starts paying `connectionTimeoutMillis` per new instance.
- **`idleTimeoutMillis`:** 30s is a good default; raise it if your traffic is
  bursty and reconnect cost matters, lower it if the database is connection-
  limited.
- **`min`:** keep at `0` unless you have steady traffic and want to avoid
  connect latency on the first query after an idle period.

Watch `pg_stat_activity` and pool wait metrics; sustained checkout queues mean
`max` is too small or queries are too slow.

## Lifecycle

- **Dev hot reload:** the pool and `PrismaClient` are stored on `globalThis`
  outside production, so `next dev` re-evaluations reuse the same pool.
- **Shutdown:** `registerPoolShutdown` drains the pool on `SIGINT`/`SIGTERM`
  (once-only listeners; the signal is re-raised afterwards so default
  termination still applies). Idle-client `error` events are logged via the
  app logger instead of crashing the process.
- **Health check:** `checkDatabaseHealth()` (exported from `src/lib/db.ts`)
  runs `SELECT 1` with a 5s timeout and returns `{ ok, latencyMs, error? }` —
  suitable for a readiness endpoint.

## Unit tests

`src/lib/db/pool.test.ts` mocks `pg` and covers env parsing, SSL resolution,
pool construction, the idle-client error handler, health checks, and the
shutdown hook.
