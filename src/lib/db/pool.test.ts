import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildPoolConfig,
  checkPoolHealth,
  createDatabasePool,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_POOL_MAX,
  parsePositiveInt,
  registerPoolShutdown,
  resolvePoolLimits,
  resolveSslConfig,
} from "./pool"
import type { Pool } from "pg"

interface MockPoolInstance {
  config: unknown
  handlers: Record<string, Array<(...args: unknown[]) => void>>
  end: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
}

const { poolInstances } = vi.hoisted(() => ({
  poolInstances: [] as MockPoolInstance[],
}))

vi.mock("pg", () => {
  class MockPool {
    config: unknown
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    end = vi.fn().mockResolvedValue(undefined)
    query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] })
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      ;(this.handlers[event] ??= []).push(handler)
      return this
    })
    constructor(config: unknown) {
      this.config = config
      poolInstances.push(this as unknown as MockPoolInstance)
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers[event] ?? []) handler(...args)
    }
  }
  return { Pool: MockPool }
})

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

const LOCAL_URL = "postgresql://spindle:spindle@localhost:5432/spindle?schema=public"
const PROD_URL = "postgresql://user:pass@db.example.com:5432/spindle?schema=public"

beforeEach(() => {
  poolInstances.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parsePositiveInt", () => {
  it("returns the fallback for missing or invalid values", () => {
    expect(parsePositiveInt(undefined, 7)).toBe(7)
    expect(parsePositiveInt("", 7)).toBe(7)
    expect(parsePositiveInt("  ", 7)).toBe(7)
    expect(parsePositiveInt("abc", 7)).toBe(7)
    expect(parsePositiveInt("-3", 7)).toBe(7)
    expect(parsePositiveInt("0", 7)).toBe(7)
    expect(parsePositiveInt("2.5", 7)).toBe(7)
  })

  it("parses positive integers and trims whitespace", () => {
    expect(parsePositiveInt("42", 7)).toBe(42)
    expect(parsePositiveInt("  42  ", 7)).toBe(42)
  })
})

describe("resolvePoolLimits", () => {
  it("uses documented defaults", () => {
    expect(resolvePoolLimits({})).toEqual({
      max: DEFAULT_POOL_MAX,
      min: 0,
      idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
      keepAliveInitialDelayMillis: 10_000,
    })
  })

  it("reads DATABASE_POOL_* overrides", () => {
    expect(
      resolvePoolLimits({
        DATABASE_POOL_MAX: "25",
        DATABASE_POOL_MIN: "4",
        DATABASE_POOL_IDLE_TIMEOUT_MS: "60000",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: "5000",
        DATABASE_POOL_KEEPALIVE_DELAY_MS: "20000",
      }),
    ).toEqual({
      max: 25,
      min: 4,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 5000,
      keepAliveInitialDelayMillis: 20000,
    })
  })

  it("clamps min to max and falls back on invalid values", () => {
    expect(resolvePoolLimits({ DATABASE_POOL_MAX: "3", DATABASE_POOL_MIN: "9" })).toMatchObject({
      max: 3,
      min: 3,
    })
    expect(resolvePoolLimits({ DATABASE_POOL_MAX: "nope" })).toMatchObject({
      max: DEFAULT_POOL_MAX,
    })
  })
})

describe("resolveSslConfig", () => {
  it("disables TLS for local development URLs", () => {
    expect(resolveSslConfig(LOCAL_URL, { NODE_ENV: "development" })).toBe(false)
    expect(resolveSslConfig(LOCAL_URL, {})).toBe(false)
  })

  it("enables verified TLS for remote production URLs", () => {
    expect(resolveSslConfig(PROD_URL, { NODE_ENV: "production" })).toEqual({
      rejectUnauthorized: true,
    })
  })

  it("keeps plaintext for local hosts even in production", () => {
    expect(resolveSslConfig(LOCAL_URL, { NODE_ENV: "production" })).toBe(false)
    expect(
      resolveSslConfig("postgresql://u:p@127.0.0.1:5432/db", {
        NODE_ENV: "production",
      }),
    ).toBe(false)
    expect(
      resolveSslConfig("postgresql://u:p@db.localhost:5432/db", {
        NODE_ENV: "production",
      }),
    ).toBe(false)
  })

  it("honours DATABASE_SSL overrides", () => {
    expect(
      resolveSslConfig(PROD_URL, {
        NODE_ENV: "production",
        DATABASE_SSL: "disable",
      }),
    ).toBe(false)
    expect(resolveSslConfig(LOCAL_URL, { DATABASE_SSL: "require" })).toEqual({
      rejectUnauthorized: false,
    })
    expect(resolveSslConfig(PROD_URL, { NODE_ENV: "production", DATABASE_SSL: "verify" })).toEqual({
      rejectUnauthorized: true,
    })
  })

  it("defers to ssl params already present in the connection string", () => {
    const withSslMode = `${PROD_URL}&sslmode=require`
    expect(resolveSslConfig(withSslMode, { NODE_ENV: "production" })).toBeUndefined()
    const withSsl = `${PROD_URL}&ssl=true`
    expect(resolveSslConfig(withSsl, { NODE_ENV: "production" })).toBeUndefined()
    const withRootCert = `${PROD_URL}&sslrootcert=/certs/ca.pem`
    expect(resolveSslConfig(withRootCert, { NODE_ENV: "production" })).toBeUndefined()
  })
})

describe("buildPoolConfig", () => {
  it("combines connection string, limits, keepAlive and TLS", () => {
    const config = buildPoolConfig(PROD_URL, {
      NODE_ENV: "production",
      DATABASE_POOL_MAX: "20",
      DATABASE_POOL_IDLE_TIMEOUT_MS: "45000",
    })
    expect(config).toMatchObject({
      connectionString: PROD_URL,
      max: 20,
      min: 0,
      idleTimeoutMillis: 45000,
      connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      ssl: { rejectUnauthorized: true },
    })
  })

  it("omits the ssl key when the URL configures TLS itself", () => {
    const config = buildPoolConfig(`${PROD_URL}&sslmode=verify-full`, {
      NODE_ENV: "production",
    })
    expect(config.ssl).toBeUndefined()
  })
})

describe("createDatabasePool", () => {
  it("constructs a Pool with the given config and an error handler", () => {
    const config = buildPoolConfig(LOCAL_URL, { NODE_ENV: "development" })
    const pool = createDatabasePool(config)

    expect(poolInstances).toHaveLength(1)
    expect(poolInstances[0].config).toEqual(config)
    expect(poolInstances[0].on).toHaveBeenCalledWith("error", expect.any(Function))
    expect(pool).toBe(poolInstances[0])
  })

  it("logs idle-client errors instead of crashing", async () => {
    const { logger } = await import("@/lib/logger")
    createDatabasePool(buildPoolConfig(LOCAL_URL, {}))
    const failure = new Error("connection terminated")

    poolInstances[0].emit("error", failure)

    expect(logger.error).toHaveBeenCalledWith(
      { err: failure },
      "Postgres pool error on idle client",
    )
  })
})

describe("checkPoolHealth", () => {
  it("returns ok with latency on a successful SELECT 1", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const result = await checkPoolHealth(pool as unknown as Pool, 1000)

    expect(pool.query).toHaveBeenCalledWith("SELECT 1")
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  it("returns ok:false with the error message when the query fails", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    }
    const result = await checkPoolHealth(pool as unknown as Pool, 1000)

    expect(result).toMatchObject({ ok: false, error: "connect ECONNREFUSED" })
  })

  it("times out when the query hangs", async () => {
    const pool = { query: vi.fn().mockReturnValue(new Promise(() => {})) }
    const result = await checkPoolHealth(pool as unknown as Pool, 20)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("timed out")
  })
})

describe("registerPoolShutdown", () => {
  it("drains the pool on SIGTERM then re-raises the signal", async () => {
    const pool = createDatabasePool(buildPoolConfig(LOCAL_URL, {}))
    const onceSpy = vi.spyOn(process, "once").mockImplementation(() => process)
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)

    registerPoolShutdown(pool)

    const sigterm = onceSpy.mock.calls.find(([signal]) => signal === "SIGTERM")
    const sigint = onceSpy.mock.calls.find(([signal]) => signal === "SIGINT")
    expect(sigterm).toBeDefined()
    expect(sigint).toBeDefined()

    ;(sigterm?.[1] as () => void)()

    await vi.waitFor(() => {
      expect(poolInstances[0].end).toHaveBeenCalledTimes(1)
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM")
    })
  })

  it("still re-raises the signal when pool.end() rejects", async () => {
    const pool = createDatabasePool(buildPoolConfig(LOCAL_URL, {}))
    poolInstances[0].end.mockRejectedValue(new Error("boom"))
    const onceSpy = vi.spyOn(process, "once").mockImplementation(() => process)
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)

    registerPoolShutdown(pool)

    const sigint = onceSpy.mock.calls.find(([signal]) => signal === "SIGINT")
    ;(sigint?.[1] as () => void)()

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT")
    })
  })
})
