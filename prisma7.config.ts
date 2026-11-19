import { config } from "dotenv"
import { defineConfig } from "prisma/config"
import { resolveDirectDatabaseUrl } from "./src/lib/database-url"

// Next.js reads .env.local first; mirror that for Prisma CLI commands.
config({ path: [".env.local", ".env"], quiet: true })

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations and introspection need the direct (non-pooled) connection.
    url: resolveDirectDatabaseUrl(),
  },
})
