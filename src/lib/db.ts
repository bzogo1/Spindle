import { PrismaPg } from "@prisma/adapter-pg"
import type { Pool } from "pg"

import { PrismaClient } from "@/generated/prisma/client"
import { resolveDatabaseUrl } from "@/lib/database-url"
import {
  buildPoolConfig,
  checkPoolHealth,
  createDatabasePool,
  registerPoolShutdown,
  type PoolHealth,
} from "@/lib/db/pool"
import { getServerEnv } from "@/lib/env.server"

// Reuse the pool and client across hot reloads in development instead of
// opening a new connection pool for every module evaluation.
const globalForDb = globalThis as unknown as {
  prisma: PrismaClient | undefined
  databasePool: Pool | undefined
}

function createDatabasePoolSingleton(): Pool {
  const connectionString = resolveDatabaseUrl()

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure the pooled Postgres connection string before using the database.",
    )
  }

  const pool = createDatabasePool(buildPoolConfig(connectionString))
  registerPoolShutdown(pool)
  return pool
}

function createPrismaClient(pool: Pool): PrismaClient {
  // The pool is owned by this module (and `globalThis` in dev), so the adapter
  // must not end it when the Prisma client is disposed.
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

export const databasePool = globalForDb.databasePool ?? createDatabasePoolSingleton()
export const prisma = globalForDb.prisma ?? createPrismaClient(databasePool)

if (getServerEnv().NODE_ENV !== "production") {
  globalForDb.databasePool = databasePool
  globalForDb.prisma = prisma
}

/**
 * Readiness probe: `SELECT 1` through the shared pool with a timeout. Returns
 * a result object instead of throwing so it can back a `/api/health` route.
 */
export async function checkDatabaseHealth(timeoutMs?: number): Promise<PoolHealth> {
  return checkPoolHealth(databasePool, timeoutMs)
}
