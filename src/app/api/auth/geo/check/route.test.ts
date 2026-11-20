// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import {
  MemoryGeoRestrictionStore,
  setGeoRestrictionStoreForTests,
  type GeoRestrictionsPolicy,
} from "@/lib/auth/geo-restrictions"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET } from "./route"

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

let store: MemoryGeoRestrictionStore
let ipCounter = 0

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function get(cookie?: string, headers: Record<string, string> = {}, ip?: string) {
  ipCounter += 1
  const h = new Headers({
    "x-forwarded-for": ip ?? `10.2.0.${ipCounter}`,
    ...headers,
  })
  if (cookie) h.set("cookie", `${ACCESS_COOKIE}=${cookie}`)
  return GET(new Request("http://localhost/api/auth/geo/check", { headers: h }))
}

function setPolicy(partial: Partial<GeoRestrictionsPolicy>) {
  store.setPolicy("u1", {
    mode: "off",
    countryCodes: [],
    blockUnknown: false,
    ...partial,
  })
}

beforeEach(() => {
  getUserById
    .mockReset()
    .mockImplementation(async (id: string) => (id === "u1" || id === "u2" ? { ...user, id } : null))
  store = new MemoryGeoRestrictionStore()
  setGeoRestrictionStoreForTests(store)
})

describe("GET /api/auth/geo/check", () => {
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

  it("returns the resolved country and allowed verdict for mode off", async () => {
    const response = await get(accessCookie(), { "cf-ipcountry": "US" })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ ok: true, country: "US", allowed: true, reason: null })
  })

  it("returns unknown country when no geo headers are present", async () => {
    const response = await get(accessCookie())
    const data = await response.json()
    expect(data.country).toBe("unknown")
    expect(data.allowed).toBe(true)
  })

  it("denies per the caller's policy without blocking the response", async () => {
    setPolicy({ mode: "blocklist", countryCodes: ["RU"] })
    const response = await get(accessCookie(), { "x-vercel-ip-country": "RU" })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.country).toBe("RU")
    expect(data.allowed).toBe(false)
    expect(data.reason).toBeTruthy()
  })

  it("does NOT record login-country observations (pure check)", async () => {
    setPolicy({ mode: "allowlist", countryCodes: ["US"], blockUnknown: true })
    for (let i = 0; i < 5; i += 1) {
      await get(accessCookie(), { "cf-ipcountry": "US" })
    }
    expect(store.getObservedCountries("u1")).toEqual([])
  })

  it("scopes the verdict to the caller's own policy", async () => {
    store.setPolicy("u1", {
      mode: "blocklist",
      countryCodes: ["US"],
      blockUnknown: false,
    })
    const response = await get(accessCookie("u2"), { "cf-ipcountry": "US" })
    const data = await response.json()
    expect(data.allowed).toBe(true)
  })

  it("rate limits repeated requests per IP", async () => {
    const cookie = accessCookie()
    let lastStatus = 0
    // AUTH_LIMITS.publicRead allows 60 requests per window.
    for (let i = 0; i < 61; i += 1) {
      lastStatus = (await get(cookie, {}, "203.0.113.8")).status
    }
    expect(lastStatus).toBe(429)
    expect(await (await get(cookie, {}, "203.0.113.8")).json()).toMatchObject({
      ok: false,
      code: "rate_limited",
    })
  })
})
