import { PrismaPg } from "@prisma/adapter-pg"
import type { Pool } from "pg"

import { PrismaClient } from "@/generated/prisma/client"
import { localDatabaseUrl } from "@/lib/database-url"
import { buildPoolConfig, createDatabasePool } from "@/lib/db/pool"

import { rawServerEnv, resolveReplicaDatabaseUrls, type ReplicaEnvSource } from "./config"

/**
 * Read-replica client routing.
 *
 * Thin, opt-in wrapper around Prisma clients: when `REPLICA_DATABASE_URL` /
 * `REPLICA_DATABASE_URLS` are configured, read workloads can be dispatched to
 * replica pools via `pool.read(fn)`; every failure falls through the remaining
 * replicas and finally to the primary `DATABASE_URL` client. Nothing in the
 * app is rewired by this module — adopt it per call site.
 *
 * Server-only: the pg adapter requires the Node.js runtime.
 */

export interface ReplicaEndpoint<TClient> {
  /** Index into the pool: `0..n-1` are replicas, `n` is the primary. */
  readonly kind: "replica" | "primary"
  readonly url: string
  readonly client: TClient
}

export interface ReadReplicaPoolOptions<TClient> {
  /** Primary connection string. Required unless `replicaUrls` cover reads. */
  readonly primaryUrl?: string
  /** Ordered replica connection strings (see `resolveReplicaDatabaseUrls`). */
  readonly replicaUrls?: readonly string[]
  /**
   * Client factory — injectable so tests can substitute fakes. Defaults to a
   * Prisma client backed by `@prisma/adapter-pg`.
   */
  readonly createClient?: (url: string) => TClient
}

export interface ReadReplicaPool<TClient> {
  /**
   * Run `fn` against a replica chosen by round-robin. On error, tries the
   * remaining replicas and finally the primary; throws the last error only
   * when every endpoint fails.
   */
  read<T>(fn: (client: TClient) => Promise<T>): Promise<T>
  /** All endpoints in failover order (replicas first, primary last). */
  endpoints(): readonly ReplicaEndpoint<TClient>[]
  /** Disconnect every client in the pool. */
  close(): Promise<void>
}

/**
 * Default endpoint factory: one `pg.Pool` per URL built through the shared
 * `src/lib/db/pool.ts` path (`DATABASE_POOL_*` sizing, `DATABASE_SSL`,
 * idle-client error handling, keepAlive), wrapped in a Prisma client via
 * `@prisma/adapter-pg` — the same construction `src/lib/db.ts` uses for the
 * primary client.
 *
 * `PrismaPg(pool)` does not end an externally-owned pool when the Prisma
 * client is disposed, so the pools are tracked by `createReadReplicaPool`
 * and drained explicitly by `close()`.
 */
function defaultCreateClientWithPool(url: string): {
  client: PrismaClient
  pool: Pool
} {
  const pool = createDatabasePool(buildPoolConfig(url))
  return { client: new PrismaClient({ adapter: new PrismaPg(pool) }), pool }
}

/**
 * Build a read pool. The primary is always the last resort so a total replica
 * outage degrades to primary reads rather than failing the request.
 */
export function createReadReplicaPool<TClient>(
  options: ReadReplicaPoolOptions<TClient>,
): ReadReplicaPool<TClient> {
  // Pools created by the default factory; empty when `createClient` is
  // injected (tests own their client lifecycle).
  const pools: Pool[] = []
  const createClient =
    options.createClient ??
    ((url: string): TClient => {
      const { client, pool } = defaultCreateClientWithPool(url)
      pools.push(pool)
      return client as unknown as TClient
    })
  const replicaUrls = options.replicaUrls ?? []

  const endpoints: ReplicaEndpoint<TClient>[] = []
  for (const url of replicaUrls) {
    endpoints.push({ kind: "replica", url, client: createClient(url) })
  }
  if (options.primaryUrl) {
    endpoints.push({
      kind: "primary",
      url: options.primaryUrl,
      client: createClient(options.primaryUrl),
    })
  }

  if (endpoints.length === 0) {
    throw new Error("createReadReplicaPool requires at least one replica or primary URL.")
  }

  const replicaCount = replicaUrls.length
  let cursor = 0

  return {
    async read<T>(fn: (client: TClient) => Promise<T>): Promise<T> {
      if (replicaCount === 0) {
        // No replicas configured: behave exactly like the primary client.
        const primary = endpoints[endpoints.length - 1]
        return fn(primary.client)
      }

      // Candidates: replicas in round-robin order, then the primary last.
      const order: ReplicaEndpoint<TClient>[] = []
      for (let i = 0; i < replicaCount; i += 1) {
        const index = (cursor + i) % replicaCount
        order.push(endpoints[index])
      }
      cursor = (cursor + 1) % replicaCount
      if (endpoints[replicaCount]) order.push(endpoints[replicaCount])

      let lastError: unknown
      for (const endpoint of order) {
        try {
          return await fn(endpoint.client)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    },

    // Return a copy: callers must not be able to mutate pool internals.
    endpoints: () => [...endpoints],

    async close() {
      try {
        await Promise.all(
          endpoints.map(async (endpoint) => {
            const maybeClient = endpoint.client as { $disconnect?: () => Promise<void> }
            await maybeClient.$disconnect?.()
          }),
        )
      } finally {
        // `PrismaPg(pool)` leaves externally-owned pools running after
        // `$disconnect`, so drain them here even if a disconnect throws.
        await Promise.all(pools.map((pool) => pool.end()))
      }
    },
  }
}

/**
 * Primary connection string, mirroring `resolveDatabaseUrl` but read from
 * the raw env source so this module stays importable in any runtime (and in
 * tests, where `getServerEnv` throws under jsdom).
 */
export function resolvePrimaryDatabaseUrl(
  env: ReplicaEnvSource = rawServerEnv(),
): string | undefined {
  return env.DATABASE_URL ?? (env.NODE_ENV === "production" ? undefined : localDatabaseUrl)
}

const globalForReadPool = globalThis as unknown as {
  readReplicaPool?: ReadReplicaPool<PrismaClient>
}

/**
 * Lazily-created process-wide pool for Prisma read replicas.
 *
 * Returns `undefined` when no `REPLICA_DATABASE_URL(S)` is configured —
 * callers should then use the regular `prisma` client from `@/lib/db`.
 * Reused across hot reloads in development, same as `src/lib/db.ts`.
 */
export function getReadReplicaPool(
  env: ReplicaEnvSource = rawServerEnv(),
): ReadReplicaPool<PrismaClient> | undefined {
  const replicaUrls = resolveReplicaDatabaseUrls(env)
  if (replicaUrls.length === 0) return undefined

  globalForReadPool.readReplicaPool ??= createReadReplicaPool<PrismaClient>({
    primaryUrl: resolvePrimaryDatabaseUrl(env),
    replicaUrls,
  })
  return globalForReadPool.readReplicaPool
}

/**
 * Adoption helper for read call sites.
 *
 * Runs `fn` against a replica when replicas are configured (with automatic
 * failover to the primary), otherwise against the regular `prisma` client.
 * The `@/lib/db` import is lazy so importing this module never instantiates
 * the primary client.
 */
export async function withReadReplica<T>(
  fn: (client: PrismaClient) => Promise<T>,
  env: ReplicaEnvSource = rawServerEnv(),
): Promise<T> {
  const pool = getReadReplicaPool(env)
  if (pool) return pool.read(fn)

  const { prisma } = await import("@/lib/db")
  return fn(prisma)
}
