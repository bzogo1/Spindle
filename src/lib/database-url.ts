import { getServerEnv } from "./env.server"

/**
 * Postgres connection strings.
 *
 * Runtime code uses the pooled `DATABASE_URL`; Prisma CLI commands (migrate,
 * studio, seed) use the direct `DIRECT_URL`. Locally, the database from
 * `compose.yaml` fills both so a fresh checkout needs no external account.
 */
export const localDatabaseUrl = "postgresql://spindle:spindle@localhost:5432/spindle?schema=public"

export function resolveDatabaseUrl(): string | undefined {
  const env = getServerEnv()
  return env.DATABASE_URL ?? (env.NODE_ENV === "production" ? undefined : localDatabaseUrl)
}

export function resolveDirectDatabaseUrl(): string | undefined {
  const env = getServerEnv()
  return env.DIRECT_URL ?? (env.NODE_ENV === "production" ? undefined : localDatabaseUrl)
}
