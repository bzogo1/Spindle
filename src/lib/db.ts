import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/generated/prisma/client"
import { resolveDatabaseUrl } from "@/lib/database-url"
import { getServerEnv } from "@/lib/env.server"

// Reuse the client across hot reloads in development instead of opening a new
// connection pool for every module evaluation.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = resolveDatabaseUrl()

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure the pooled Postgres connection string before using the database.",
    )
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (getServerEnv().NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
