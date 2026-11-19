import { config } from "dotenv"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/generated/prisma/client"
import { resolveDirectDatabaseUrl } from "../src/lib/database-url"

config({ path: [".env.local", ".env"], quiet: true })

async function main() {
  const connectionString = resolveDirectDatabaseUrl()

  if (!connectionString) {
    throw new Error("Set DIRECT_URL to the direct Postgres connection string before seeding.")
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })

  try {
    const user = await prisma.user.upsert({
      where: { email: "dev@spindle.local" },
      update: { name: "Dev User" },
      create: { email: "dev@spindle.local", name: "Dev User" },
    })

    console.log(`Seeded development user ${user.email} (${user.id}).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
