import { Pool, type PoolConfig } from "pg"

import { logger } from "@/lib/logger"

// `DATABASE_POOL_*`/`DATABASE_SSL` are optional tuning knobs, intentionally
// kept out of the validated server schema in `src/lib/env.server.ts` (the
// schema's key list must stay in parity with `.env.example`). Reading them
// here via `process.env` defaults is the documented exception; see
// `docs/database/connection-pooling.md`.

/**
 * Postgres connection pool configuration for the Prisma `pg` adapter.
 *
 * `DATABASE_URL` supplies the connection string (see `src/lib/database-url.ts`
 * for the pooled/direct split). Pool sizing and TLS behaviour are tuned through
 * the optional `DATABASE_POOL_*` / `DATABASE_SSL` variables documented in
 * `docs/database/connection-pooling.md`. They are read straight from
 * `process.env` rather than the validated server schema so this module stays
 * usable from scripts and tests without registering new required env keys.
 */

export const DEFAULT_POOL_MAX = 10
export const DEFAULT_POOL_MIN = 0
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000
export const DEFAULT_KEEPALIVE_DELAY_MS = 10_000
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000

const LOCAL_HOSTNAMES = new Set(["localhost", "::1", "[::1]"])
const LOCAL_HOSTNAME_SUFFIX = ".localhost"
const LOCAL_IPV4_PREFIX = "127."

/** Minimal env shape the pool config reads; `process.env` satisfies it. */
export type PoolEnv = Record<string, string | undefined>

export interface PoolHealth {
  ok: boolean
  latencyMs: number
  error?: string
}

function isLocalHostname(hostname: string): boolean {
  return (
    LOCAL_HOSTNAMES.has(hostname) ||
    hostname.endsWith(LOCAL_HOSTNAME_SUFFIX) ||
    hostname.startsWith(LOCAL_IPV4_PREFIX)
  )
}

/**
 * Parses a positive integer env var. Blank, non-numeric, fractional, and
 * non-positive values all fall back so a typo never takes the pool down.
 */
export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return fallback
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Returns the pool limits implied by `env`. `DATABASE_POOL_MIN` is honoured
 * only when it does not exceed `DATABASE_POOL_MAX`.
 */
export function resolvePoolLimits(
  // eslint-disable-next-line no-restricted-properties -- see file header
  env: PoolEnv = process.env,
): {
  max: number
  min: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
  keepAliveInitialDelayMillis: number
} {
  const max = parsePositiveInt(env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX)
  const requestedMin = parsePositiveInt(env.DATABASE_POOL_MIN, DEFAULT_POOL_MIN)
  return {
    max,
    min: Math.min(requestedMin, max),
    idleTimeoutMillis: parsePositiveInt(env.DATABASE_POOL_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: parsePositiveInt(
      env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    keepAliveInitialDelayMillis: parsePositiveInt(
      env.DATABASE_POOL_KEEPALIVE_DELAY_MS,
      DEFAULT_KEEPALIVE_DELAY_MS,
    ),
  }
}

/**
 * `true` when the connection string already carries TLS settings that `pg`
 * understands (`sslmode`, `ssl`, or the `sslcert`/`sslkey`/`sslrootcert`/
 * `sslcrl` family). In that case we must not set `config.ssl`, which would
 * override the parsed value.
 */
function connectionStringConfiguresSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString)
    return ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "sslcrl"].some((param) =>
      url.searchParams.has(param),
    )
  } catch {
    // Unparseable strings fail later inside `pg`; treat as "no TLS params".
    return false
  }
}

function isLocalConnectionString(connectionString: string): boolean {
  try {
    return isLocalHostname(new URL(connectionString).hostname)
  } catch {
    return false
  }
}

/**
 * Resolves the `ssl` option for the pool.
 *
 * - `DATABASE_SSL=disable` (or `false`/`0`) forces plaintext — useful for
 *   local Compose Postgres or a TLS-terminating sidecar.
 * - `DATABASE_SSL=require` allows self-signed certs (`rejectUnauthorized:
 *   false`); `verify`/`verify-full` requires a valid certificate chain.
 * - Otherwise: production gets verified TLS unless the host is local;
 *   development/test get plaintext.
 * - A connection string that already sets `sslmode`/`ssl*` params wins: this
 *   function returns `undefined` so `pg` parses them itself.
 */
export function resolveSslConfig(
  connectionString: string,
  // eslint-disable-next-line no-restricted-properties -- see file header
  env: PoolEnv = process.env,
): PoolConfig["ssl"] | undefined {
  if (connectionStringConfiguresSsl(connectionString)) return undefined

  const override = env.DATABASE_SSL?.trim().toLowerCase()
  if (override === "disable" || override === "false" || override === "0") {
    return false
  }
  if (override === "require") return { rejectUnauthorized: false }
  if (override === "verify" || override === "verify-full") {
    return { rejectUnauthorized: true }
  }

  if (env.NODE_ENV === "production" && !isLocalConnectionString(connectionString)) {
    return { rejectUnauthorized: true }
  }
  return false
}

/**
 * Builds a `pg.PoolConfig` from a connection string plus `DATABASE_POOL_*`
 * tuning variables. Kept pure (no `pg` side effects) so it is unit-testable.
 */
export function buildPoolConfig(
  connectionString: string,
  // eslint-disable-next-line no-restricted-properties -- see file header
  env: PoolEnv = process.env,
): PoolConfig {
  const limits = resolvePoolLimits(env)
  const config: PoolConfig = {
    connectionString,
    max: limits.max,
    min: limits.min,
    idleTimeoutMillis: limits.idleTimeoutMillis,
    connectionTimeoutMillis: limits.connectionTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: limits.keepAliveInitialDelayMillis,
  }

  const ssl = resolveSslConfig(connectionString, env)
  if (ssl !== undefined) config.ssl = ssl

  return config
}

/**
 * Creates a `pg.Pool` and wires the idle-client `error` handler. `pg` emits
 * `error` on the pool when an *idle* client dies (e.g. the server restarted);
 * without a listener Node treats it as an unhandled error and crashes.
 */
export function createDatabasePool(config: PoolConfig): Pool {
  const pool = new Pool(config)
  pool.on("error", (error) => {
    logger.error({ err: error }, "Postgres pool error on idle client")
  })
  return pool
}

/**
 * Runs `SELECT 1` against the pool with a hard timeout. Never throws; callers
 * (health endpoints, readiness probes) inspect `ok`/`error` instead.
 */
export async function checkPoolHealth(
  pool: Pick<Pool, "query">,
  timeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
): Promise<PoolHealth> {
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined

  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Health check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
        timer.unref?.()
      }),
    ])
    return { ok: true, latencyMs: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Drains the pool on `SIGINT`/`SIGTERM`. The listeners are `once`, so after the
 * first signal finishes `pool.end()` the default signal behaviour is restored
 * and a second signal terminates immediately.
 */
export function registerPoolShutdown(pool: Pool): void {
  let closing = false

  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return
    closing = true
    void (async () => {
      try {
        await pool.end()
      } catch (error) {
        logger.error({ err: error }, "Failed to drain Postgres pool during shutdown")
      } finally {
        // Listeners were registered with `once`, so re-raising the same signal
        // hits the default handler and the process exits.
        process.kill(process.pid, signal)
      }
    })()
  }

  process.once("SIGINT", () => shutdown("SIGINT"))
  process.once("SIGTERM", () => shutdown("SIGTERM"))
}
