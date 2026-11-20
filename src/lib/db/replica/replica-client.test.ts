import { Pool } from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"

// Capture constructor args so we can assert which connection string each
// client was built with without opening real pg connections.
const mocks = vi.hoisted(() => ({
  pgConfigs: [] as unknown[],
  prismaClientOpts: [] as unknown[],
}))

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation(function (this: { config?: unknown }, config: unknown) {
    this.config = config
    mocks.pgConfigs.push(config)
  }),
}))

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(function (
    this: { $disconnect: unknown },
    opts: unknown,
  ) {
    mocks.prismaClientOpts.push(opts)
    this.$disconnect = vi.fn(async () => {})
  }),
}))

import {
  createReadReplicaPool,
  getReadReplicaPool,
  resolvePrimaryDatabaseUrl,
  withReadReplica,
  type ReadReplicaPool,
} from "./replica-client"

interface FakeClient {
  name: string
  calls: number
  failNext?: boolean
  $disconnect: ReturnType<typeof vi.fn>
}

function makeClients(names: string[]): Map<string, FakeClient> {
  const map = new Map<string, FakeClient>()
  for (const name of names) {
    map.set(name, { name, calls: 0, $disconnect: vi.fn(async () => {}) })
  }
  return map
}

describe("createReadReplicaPool", () => {
  it("throws when neither replicas nor primary are provided", () => {
    expect(() => createReadReplicaPool({})).toThrow(/at least one/)
  })

  it("round-robins reads across replicas", async () => {
    const clients = makeClients(["r1", "r2", "primary"])
    const seen: string[] = []
    const pool = createReadReplicaPool<FakeClient>({
      primaryUrl: "postgresql://h/primary",
      replicaUrls: ["postgresql://h/r1", "postgresql://h/r2"],
      createClient: (url) => {
        const name = url.split("/").pop() as string
        const base = clients.get(name)!
        return {
          name,
          calls: 0,
          $disconnect: base.$disconnect,
        }
      },
    })

    await pool.read(async (client) => {
      seen.push(client.name)
      client.calls += 1
    })
    await pool.read(async (client) => {
      seen.push(client.name)
      client.calls += 1
    })
    await pool.read(async (client) => {
      seen.push(client.name)
      client.calls += 1
    })

    expect(seen).toEqual(["r1", "r2", "r1"])
    expect(pool.endpoints().map((e) => e.kind)).toEqual(["replica", "replica", "primary"])
  })

  it("falls back to the next replica when one fails", async () => {
    const urls = ["postgresql://h/r1", "postgresql://h/r2", "postgresql://h/primary"]
    const calls: string[] = []
    const pool = createReadReplicaPool<{ name: string }>({
      primaryUrl: urls[2],
      replicaUrls: urls.slice(0, 2),
      createClient: (url) => ({ name: url.split("/").pop() as string }),
    })

    const result = await pool.read(async (client) => {
      calls.push(client.name)
      if (client.name === "r1") throw new Error("replica down")
      return client.name
    })

    expect(result).toBe("r2")
    expect(calls).toEqual(["r1", "r2"])
  })

  it("falls back to the primary when all replicas fail", async () => {
    const urls = ["postgresql://h/r1", "postgresql://h/r2", "postgresql://h/primary"]
    const pool = createReadReplicaPool<{ name: string }>({
      primaryUrl: urls[2],
      replicaUrls: urls.slice(0, 2),
      createClient: (url) => ({ name: url.split("/").pop() as string }),
    })

    const result = await pool.read(async (client) => {
      if (client.name !== "primary") throw new Error(`${client.name} down`)
      return client.name
    })

    expect(result).toBe("primary")
  })

  it("throws the last error when every endpoint fails", async () => {
    const pool = createReadReplicaPool<{ name: string }>({
      primaryUrl: "postgresql://h/primary",
      replicaUrls: ["postgresql://h/r1"],
      createClient: (url) => ({ name: url.split("/").pop() as string }),
    })

    await expect(
      pool.read(async () => {
        throw new Error("all down")
      }),
    ).rejects.toThrow("all down")
  })

  it("uses only the primary when no replicas are configured", async () => {
    const pool = createReadReplicaPool<{ name: string }>({
      primaryUrl: "postgresql://h/primary",
      replicaUrls: [],
      createClient: () => ({ name: "primary" }),
    })

    await expect(pool.read(async (c) => c.name)).resolves.toBe("primary")
    expect(pool.endpoints()).toHaveLength(1)
  })

  it("supports replicas without a primary (failover between replicas only)", async () => {
    const pool = createReadReplicaPool<{ name: string }>({
      replicaUrls: ["postgresql://h/r1", "postgresql://h/r2"],
      createClient: (url) => ({ name: url.split("/").pop() as string }),
    })

    const result = await pool.read(async (client) => {
      if (client.name === "r1") throw new Error("r1 down")
      return client.name
    })
    expect(result).toBe("r2")
  })

  it("close() disconnects every client", async () => {
    const disconnects: string[] = []
    const pool = createReadReplicaPool<{ name: string; $disconnect: () => Promise<void> }>({
      primaryUrl: "postgresql://h/primary",
      replicaUrls: ["postgresql://h/r1"],
      createClient: (url) => {
        const name = url.split("/").pop() as string
        return {
          name,
          $disconnect: async () => {
            disconnects.push(name)
          },
        }
      },
    })

    await pool.close()
    expect(disconnects.sort()).toEqual(["primary", "r1"])
  })
})

describe("default Prisma client factory", () => {
  it("builds a PrismaClient with a shared-config pg.Pool adapter per URL", async () => {
    mocks.pgConfigs.length = 0
    mocks.prismaClientOpts.length = 0

    const pool: ReadReplicaPool<unknown> = createReadReplicaPool({
      primaryUrl: "postgresql://h/primary",
      replicaUrls: ["postgresql://h/r1", "postgresql://h/r2"],
    })

    expect(pool.endpoints()).toHaveLength(3)
    // Each endpoint gets a real pg.Pool built via buildPoolConfig/createDatabasePool,
    // same as src/lib/db.ts — not a bare { connectionString } adapter config.
    expect(mocks.pgConfigs).toHaveLength(3)
    for (const [index, url] of [
      "postgresql://h/r1",
      "postgresql://h/r2",
      "postgresql://h/primary",
    ].entries()) {
      const adapterArg = mocks.pgConfigs[index] as Pool
      expect(adapterArg).toBeInstanceOf(Pool)
      expect(adapterArg.options.connectionString).toBe(url)
    }
    expect(mocks.prismaClientOpts).toHaveLength(3)

    await pool.close()
  })

  it("close() ends the pg.Pool backing each default-factory endpoint", async () => {
    mocks.pgConfigs.length = 0
    const pool = createReadReplicaPool({
      primaryUrl: "postgresql://h/primary",
      replicaUrls: ["postgresql://h/r1"],
    })

    const pgPools = mocks.pgConfigs as Pool[]
    const endSpies = pgPools.map((p) => vi.spyOn(p, "end"))

    await pool.close()

    expect(endSpies).toHaveLength(2)
    for (const spy of endSpies) expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe("resolvePrimaryDatabaseUrl", () => {
  it("prefers DATABASE_URL", () => {
    expect(
      resolvePrimaryDatabaseUrl({
        DATABASE_URL: "postgresql://env/db",
        NODE_ENV: "production",
      }),
    ).toBe("postgresql://env/db")
  })

  it("falls back to the local compose URL outside production", () => {
    expect(resolvePrimaryDatabaseUrl({ NODE_ENV: "development" })).toContain("localhost:5432")
  })

  it("returns undefined in production without DATABASE_URL", () => {
    expect(resolvePrimaryDatabaseUrl({ NODE_ENV: "production" })).toBeUndefined()
  })
})

describe("getReadReplicaPool / withReadReplica", () => {
  afterEach(() => {
    delete (globalThis as { readReplicaPool?: unknown }).readReplicaPool
  })

  it("returns undefined when no replica is configured", () => {
    expect(getReadReplicaPool({})).toBeUndefined()
  })

  it("routes reads to a replica and falls back to primary on failure", async () => {
    const env = {
      REPLICA_DATABASE_URL: "postgresql://h/replica",
      DATABASE_URL: "postgresql://h/primary",
      NODE_ENV: "test",
    }

    mocks.pgConfigs.length = 0
    const pool = getReadReplicaPool(env)
    expect(pool).toBeDefined()
    expect(pool!.endpoints().map((e) => e.kind)).toEqual(["replica", "primary"])

    const seen: string[] = []
    const result = await withReadReplica(async (client) => {
      const endpoint = pool!.endpoints().find((e) => e.client === client)
      seen.push(endpoint?.url ?? "unknown")
      if (endpoint?.kind === "replica") throw new Error("replica down")
      return "ok"
    }, env)

    expect(result).toBe("ok")
    expect(seen).toEqual(["postgresql://h/replica", "postgresql://h/primary"])

    await pool!.close()
  })
})
