// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"

import {
  checkGeoRestriction,
  DEFAULT_GEO_RESTRICTIONS,
  evaluateGeoRestriction,
  getGeoRestrictionStore,
  geoRestrictionsSchema,
  MemoryGeoRestrictionStore,
  normalizeCountryCode,
  recordLoginCountry,
  resolveRequestCountry,
  setGeoRestrictionStoreForTests,
  UNKNOWN_COUNTRY,
  type GeoRestrictionsPolicy,
} from "@/lib/auth/geo-restrictions"

function policy(partial: Partial<GeoRestrictionsPolicy>): GeoRestrictionsPolicy {
  return { ...DEFAULT_GEO_RESTRICTIONS, ...partial }
}

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

afterEach(() => {
  setGeoRestrictionStoreForTests(undefined)
})

describe("geoRestrictionsSchema", () => {
  it("normalizes country codes: uppercase, dedupe, sort", () => {
    const parsed = geoRestrictionsSchema.parse({
      mode: "allowlist",
      countryCodes: ["de", "US", "us", "ua"],
      blockUnknown: false,
    })
    expect(parsed).toEqual({
      mode: "allowlist",
      countryCodes: ["DE", "UA", "US"],
      blockUnknown: false,
    })
  })

  it("accepts mode off with an empty list", () => {
    const parsed = geoRestrictionsSchema.parse({
      mode: "off",
      countryCodes: [],
      blockUnknown: false,
    })
    expect(parsed.countryCodes).toEqual([])
  })

  it.each(["allowlist", "blocklist"] as const)(
    "rejects mode %s with an empty countryCodes list (self-locking)",
    (mode) => {
      const result = geoRestrictionsSchema.safeParse({
        mode,
        countryCodes: [],
        blockUnknown: false,
      })
      expect(result.success).toBe(false)
    },
  )

  it("rejects allowlist/blocklist when codes are only whitespace-free but absent", () => {
    const result = geoRestrictionsSchema.safeParse({
      mode: "allowlist",
      blockUnknown: true,
    })
    expect(result.success).toBe(false)
  })

  it("rejects pseudo-codes XX, T1 and ZZ as allowed countries", () => {
    for (const code of ["XX", "T1", "ZZ"]) {
      const result = geoRestrictionsSchema.safeParse({
        mode: "blocklist",
        countryCodes: [code, "US"],
        blockUnknown: false,
      })
      expect(result.success).toBe(false)
    }
  })

  it("rejects malformed codes and unknown keys", () => {
    expect(
      geoRestrictionsSchema.safeParse({
        mode: "off",
        countryCodes: ["USA"],
        blockUnknown: false,
      }).success,
    ).toBe(false)
    expect(
      geoRestrictionsSchema.safeParse({
        mode: "off",
        countryCodes: [],
        blockUnknown: false,
        extra: true,
      }).success,
    ).toBe(false)
  })
})

describe("normalizeCountryCode", () => {
  it("uppercases and validates alpha-2 codes", () => {
    expect(normalizeCountryCode("us")).toBe("US")
    expect(normalizeCountryCode("  de ")).toBe("DE")
  })

  it("maps pseudo-codes and junk to unknown", () => {
    expect(normalizeCountryCode("XX")).toBe(UNKNOWN_COUNTRY)
    expect(normalizeCountryCode("T1")).toBe(UNKNOWN_COUNTRY)
    expect(normalizeCountryCode("ZZ")).toBe(UNKNOWN_COUNTRY)
    expect(normalizeCountryCode("USA")).toBe(UNKNOWN_COUNTRY)
    expect(normalizeCountryCode("")).toBe(UNKNOWN_COUNTRY)
    expect(normalizeCountryCode(null)).toBe(UNKNOWN_COUNTRY)
    expect(normalizeCountryCode(undefined)).toBe(UNKNOWN_COUNTRY)
  })
})

describe("resolveRequestCountry", () => {
  it("prefers cf-ipcountry, then vercel, then appengine, then unknown", () => {
    expect(resolveRequestCountry(req({ "cf-ipcountry": "US", "x-vercel-ip-country": "DE" }))).toBe(
      "US",
    )
    expect(
      resolveRequestCountry(req({ "x-vercel-ip-country": "de", "x-appengine-country": "FR" })),
    ).toBe("DE")
    expect(resolveRequestCountry(req({ "x-appengine-country": "JP" }))).toBe("JP")
  })

  it("falls through on pseudo-codes and malformed values", () => {
    expect(
      resolveRequestCountry(
        req({
          "cf-ipcountry": "XX",
          "x-vercel-ip-country": "T1",
          "x-appengine-country": "not-a-code",
        }),
      ),
    ).toBe(UNKNOWN_COUNTRY)
    expect(resolveRequestCountry(req({ "cf-ipcountry": "XX", "x-vercel-ip-country": "GB" }))).toBe(
      "GB",
    )
  })

  it("returns unknown with no geo headers", () => {
    expect(resolveRequestCountry(req({}))).toBe(UNKNOWN_COUNTRY)
  })
})

describe("checkGeoRestriction", () => {
  it("allows everything when mode is off", () => {
    for (const country of ["US", "DE", UNKNOWN_COUNTRY]) {
      expect(checkGeoRestriction(policy({ mode: "off" }), country)).toEqual({
        allowed: true,
        reason: null,
      })
    }
  })

  it("allowlist permits listed countries and denies unlisted ones", () => {
    const p = policy({ mode: "allowlist", countryCodes: ["US", "DE"] })
    expect(checkGeoRestriction(p, "us")).toEqual({ allowed: true, reason: null })
    const denied = checkGeoRestriction(p, "FR")
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toBeTruthy()
  })

  it("blocklist denies listed countries and permits others", () => {
    const p = policy({ mode: "blocklist", countryCodes: ["RU", "IR"] })
    expect(checkGeoRestriction(p, "RU").allowed).toBe(false)
    expect(checkGeoRestriction(p, "US")).toEqual({ allowed: true, reason: null })
  })

  it("unknown country is allowed when blockUnknown is false", () => {
    for (const mode of ["allowlist", "blocklist"] as const) {
      const p = policy({
        mode,
        countryCodes: ["US"],
        blockUnknown: false,
      })
      expect(checkGeoRestriction(p, UNKNOWN_COUNTRY)).toEqual({
        allowed: true,
        reason: null,
      })
      expect(checkGeoRestriction(p, "")).toEqual({ allowed: true, reason: null })
    }
  })

  it("unknown country is denied when blockUnknown is true", () => {
    for (const mode of ["allowlist", "blocklist"] as const) {
      const p = policy({ mode, countryCodes: ["US"], blockUnknown: true })
      const result = checkGeoRestriction(p, UNKNOWN_COUNTRY)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("location could not be determined")
    }
  })

  it("treats case-insensitively and ignores whitespace", () => {
    const p = policy({ mode: "allowlist", countryCodes: ["US"] })
    expect(checkGeoRestriction(p, " us ").allowed).toBe(true)
  })
})

describe("MemoryGeoRestrictionStore", () => {
  it("scopes policies per principal with global fallback", () => {
    const store = new MemoryGeoRestrictionStore()
    expect(store.getPolicy("u1")).toEqual(DEFAULT_GEO_RESTRICTIONS)
    store.setPolicy("u1", policy({ mode: "blocklist", countryCodes: ["RU"] }))
    expect(store.getPolicy("u1").mode).toBe("blocklist")
    expect(store.getPolicy("u2").mode).toBe("off")
    store.resetPolicy("u1")
    expect(store.getPolicy("u1").mode).toBe("off")

    store.setGlobalPolicy(policy({ mode: "allowlist", countryCodes: ["DE"] }))
    expect(store.getPolicy("u2").countryCodes).toEqual(["DE"])
  })

  it("records observed countries, normalizes codes, and increments counts", () => {
    const store = new MemoryGeoRestrictionStore()
    store.recordLoginCountry("u1", "us", 1000)
    store.recordLoginCountry("u1", "US", 2000)
    store.recordLoginCountry("u1", "XX")
    const observed = store.getObservedCountries("u1")
    expect(observed).toHaveLength(2)
    const us = observed.find((entry) => entry.country === "US")
    expect(us?.count).toBe(2)
    expect(us?.lastSeenAt).toBe(new Date(2000).toISOString())
    expect(observed.find((entry) => entry.country === "unknown")?.count).toBe(1)
  })

  it("evicts least-recently-seen entries beyond the per-user cap", () => {
    const store = new MemoryGeoRestrictionStore()
    // 70 distinct alpha-2 codes (first char cycles, second advances slowly).
    for (let i = 0; i < 70; i += 1) {
      const code = String.fromCharCode(65 + (i % 26), 65 + Math.floor(i / 26))
      store.recordLoginCountry("u1", code, i)
    }
    const observed = store.getObservedCountries("u1")
    expect(observed).toHaveLength(64)
    // Most recent observation must survive eviction.
    expect(observed[0].lastSeenAt).toBe(new Date(69).toISOString())
  })

  it("store seam: setGeoRestrictionStoreForTests swaps the active store", () => {
    const custom = new MemoryGeoRestrictionStore()
    setGeoRestrictionStoreForTests(custom)
    expect(getGeoRestrictionStore()).toBe(custom)
    recordLoginCountry("u1", "FR", 1)
    expect(custom.getObservedCountries("u1")).toHaveLength(1)
    setGeoRestrictionStoreForTests(undefined)
    expect(getGeoRestrictionStore()).not.toBe(custom)
  })
})

describe("evaluateGeoRestriction", () => {
  it("resolves country, records observation, and returns the verdict", () => {
    const store = new MemoryGeoRestrictionStore()
    store.setPolicy("u1", policy({ mode: "blocklist", countryCodes: ["RU"] }))
    const result = evaluateGeoRestriction(req({ "cf-ipcountry": "RU" }), "u1", store, 5000)
    expect(result).toMatchObject({ country: "RU", allowed: false })
    expect(store.getObservedCountries("u1")).toEqual([
      {
        country: "RU",
        lastSeenAt: new Date(5000).toISOString(),
        count: 1,
      },
    ])
  })

  it("still enforces when observation recording throws", () => {
    const store = new MemoryGeoRestrictionStore()
    store.setPolicy("u1", policy({ mode: "allowlist", countryCodes: ["US"] }))
    store.recordLoginCountry = () => {
      throw new Error("boom")
    }
    const result = evaluateGeoRestriction(req({ "cf-ipcountry": "FR" }), "u1", store)
    expect(result.allowed).toBe(false)
  })
})
