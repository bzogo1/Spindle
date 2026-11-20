// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import {
  DEFAULT_GEO_RESTRICTIONS,
  MemoryGeoRestrictionStore,
  setGeoRestrictionStoreForTests,
  type GeoRestrictionsPolicy,
} from "@/lib/auth/geo-restrictions"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET, PUT } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const validBody: GeoRestrictionsPolicy = {
  mode: "allowlist",
  countryCodes: ["us", "DE"],
  blockUnknown: false,
}

let store: MemoryGeoRestrictionStore
let ipCounter = 0

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function request(
  method: string,
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  ipCounter += 1
  const h = new Headers({ "x-forwarded-for": `10.1.0.${ipCounter}`, ...headers })
  if (cookie) h.set("cookie", `${ACCESS_COOKIE}=${cookie}`)
  if (body !== undefined) h.set("content-type", "application/json")
  return new Request("http://localhost/api/auth/geo", {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })
}

function get(cookie?: string, headers?: Record<string, string>) {
  return GET(request("GET", undefined, cookie, headers))
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(request("PUT", body, cookie, headers))
}

beforeEach(() => {
  getUserById
    .mockReset()
    .mockImplementation(async (id: string) => (id === "u1" || id === "u2" ? { ...user, id } : null))
  store = new MemoryGeoRestrictionStore()
  setGeoRestrictionStoreForTests(store)
})

describe("GET /api/auth/geo", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects tokens whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get(accessCookie())
    expect(response.status).toBe(401)
  })

  it("returns default policy and empty observations for a fresh principal", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.policy).toEqual(DEFAULT_GEO_RESTRICTIONS)
    expect(data.observedCountries).toEqual([])
  })

  it("returns stored policy and observed countries", async () => {
    store.setPolicy("u1", { ...validBody, countryCodes: ["DE", "US"] })
    store.recordLoginCountry("u1", "US", 1000)
    const response = await get(accessCookie())
    const data = await response.json()
    expect(data.policy.countryCodes).toEqual(["DE", "US"])
    expect(data.observedCountries).toEqual([
      { country: "US", lastSeenAt: new Date(1000).toISOString(), count: 1 },
    ])
  })
})

describe("PUT /api/auth/geo", () => {
  it("rejects cross-origin requests", async () => {
    const response = await put(validBody, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    const response = await put(validBody)
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON and invalid bodies", async () => {
    expect((await put("not json", accessCookie())).status).toBe(400)
    expect((await put({ mode: "off" }, accessCookie())).status).toBe(400)
    expect(
      (await put({ mode: "off", countryCodes: [], blockUnknown: false, extra: 1 }, accessCookie()))
        .status,
    ).toBe(400)
  })

  it("rejects self-locking policies (non-off mode with no codes)", async () => {
    for (const mode of ["allowlist", "blocklist"]) {
      const response = await put({ mode, countryCodes: [], blockUnknown: false }, accessCookie())
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(store.getStoredPolicy("u1")).toBeNull()
  })

  it("rejects pseudo-codes in countryCodes", async () => {
    const response = await put(
      { mode: "blocklist", countryCodes: ["XX"], blockUnknown: false },
      accessCookie(),
    )
    expect(response.status).toBe(400)
  })

  it("stores the normalized policy and echoes it back", async () => {
    const response = await put(validBody, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.policy).toEqual({
      mode: "allowlist",
      countryCodes: ["DE", "US"],
      blockUnknown: false,
    })
    expect(store.getStoredPolicy("u1")?.countryCodes).toEqual(["DE", "US"])

    const getResponse = await get(accessCookie())
    expect((await getResponse.json()).policy.countryCodes).toEqual(["DE", "US"])
  })

  it("scopes policies per principal", async () => {
    await put(validBody, accessCookie("u1"))
    const other = await get(accessCookie("u2"))
    expect((await other.json()).policy).toEqual(DEFAULT_GEO_RESTRICTIONS)
  })

  it("rate limits repeated requests per IP", async () => {
    const cookie = accessCookie()
    let lastStatus = 0
    // AUTH_LIMITS.publicRead allows 60 requests per window; GET and PUT share
    // the same module-level limiter, so hammer one endpoint.
    for (let i = 0; i < 61; i += 1) {
      lastStatus = (await get(cookie, { "x-forwarded-for": "203.0.113.7" })).status
    }
    expect(lastStatus).toBe(429)
  })
})
