import { z } from "zod"

/**
 * Per-principal geographic login restrictions.
 *
 * A geo policy decides whether a sign-in attempt is allowed based on the
 * *country* the request appears to come from:
 *
 *  - `mode: "off"`       — no geographic restriction (default).
 *  - `mode: "allowlist"` — only sign-ins from `countryCodes` are allowed.
 *  - `mode: "blocklist"` — sign-ins from `countryCodes` are denied.
 *
 * `blockUnknown` additionally denies sign-ins whose country cannot be
 * determined at all (missing/unsupported geo headers). When `blockUnknown`
 * is false, an unknown country is always allowed regardless of mode — an
 * allowlist that cannot see the country must not lock the user out of
 * every network that lacks geo headers.
 *
 * COUNTRY RESOLUTION: there is NO external geoip service. The country is
 * read from platform-injected request headers, in order:
 *
 *   1. `cf-ipcountry`        (Cloudflare)
 *   2. `x-vercel-ip-country` (Vercel)
 *   3. `x-appengine-country` (Google App Engine)
 *   4. fallback              `"unknown"`
 *
 * Pseudo-codes are normalized: Cloudflare `XX` (unknown) and `T1` (Tor
 * exit) and App Engine `ZZ` all resolve to `"unknown"`. Values are
 * upper-cased ISO 3166-1 alpha-2 codes.
 *
 * REAL GEOIP: IP→country mapping for direct (non-platform) traffic needs
 * infrastructure — either a trusted proxy that injects one of the headers
 * above, or a local MaxMind GeoLite2 database behind a server-side
 * resolver. That is deliberately out of scope here; the header contract is
 * the stable seam.
 *
 * ENFORCEMENT STATUS: `checkGeoRestriction` is a pure function ready to be
 * wired into the session-creation routes (`/api/auth/signin`,
 * `/api/auth/2fa/verify-login`, OAuth callback, passwordless verify).
 * Those routes are NOT wired yet — see {@link evaluateGeoRestriction} for
 * the intended integration point and recommended response (403
 * `geo_restricted`). Until then policies are stored and observable but do
 * not block sign-ins.
 *
 * OBSERVATIONS: only {@link evaluateGeoRestriction} records login-country
 * observations, and it is meant exclusively for real sign-in evaluation.
 * Advisory reads (e.g. `GET /api/auth/geo/check`) must use the pure
 * {@link checkGeoRestriction} + {@link resolveRequestCountry} so polling
 * cannot inflate observation counts.
 *
 * STORE SEAM: like {@link MemorySecurityPolicyStore} and the login-alert
 * store, policies and observed countries live in a bounded in-memory map
 * inside one process and are lost on restart.
 * `getGeoRestrictionStore`/`setGeoRestrictionStoreForTests` is the single
 * seam where a durable backend (Prisma) plugs in — see
 * prisma/AUTH-SCHEMA.md.
 */

export type GeoRestrictionMode = "off" | "allowlist" | "blocklist"

export interface GeoRestrictionsPolicy {
  mode: GeoRestrictionMode
  /**
   * ISO 3166-1 alpha-2 country codes the mode applies to (uppercase,
   * deduplicated, sorted). Empty when `mode` is `"off"`.
   */
  countryCodes: string[]
  /** Deny sign-ins whose country cannot be determined. */
  blockUnknown: boolean
}

export const DEFAULT_GEO_RESTRICTIONS: GeoRestrictionsPolicy = {
  mode: "off",
  countryCodes: [],
  blockUnknown: false,
}

/** Sentinel returned when no geo header yields a usable country. */
export const UNKNOWN_COUNTRY = "unknown"

const GEO_PSEUDO_CODES = new Set(["XX", "T1", "ZZ"])

const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Use ISO 3166-1 alpha-2 country codes (e.g. US, DE).")
  .refine(
    (value) => !GEO_PSEUDO_CODES.has(value.toUpperCase()),
    "XX, T1 and ZZ are platform 'unknown' markers, not real countries.",
  )
  .transform((value) => value.toUpperCase())

/**
 * zod schema for a full geo policy object (PUT body). Strict — unknown keys
 * are rejected. Country codes are normalized (uppercased, deduplicated,
 * sorted) by the transform so stored policies are canonical.
 */
export const geoRestrictionsSchema = z
  .object({
    mode: z.enum(["off", "allowlist", "blocklist"]),
    countryCodes: z.array(countryCodeSchema).max(250),
    blockUnknown: z.boolean(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    // A non-off mode with an empty list would deny (allowlist) or mean
    // nothing (blocklist) — and once enforced it would lock the principal
    // out of every country. Require at least one code up front.
    if (policy.mode !== "off" && policy.countryCodes.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["countryCodes"],
        message: "countryCodes must list at least one country when mode is allowlist or blocklist.",
      })
    }
  })
  .transform((policy) => ({
    ...policy,
    countryCodes: [...new Set(policy.countryCodes)].sort(),
  }))

export type GeoCheckResult = {
  allowed: boolean
  /** Human-readable explanation when denied; null when allowed. */
  reason: string | null
}

/**
 * Normalizes a raw header value into an ISO alpha-2 code or `UNKNOWN_COUNTRY`.
 * `XX`/`T1` (Cloudflare) and `ZZ` (App Engine) are platform "unknown"
 * pseudo-codes and map to the sentinel.
 */
export function normalizeCountryCode(raw: string | null | undefined): string {
  if (!raw) return UNKNOWN_COUNTRY
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return UNKNOWN_COUNTRY
  if (code === "XX" || code === "T1" || code === "ZZ") return UNKNOWN_COUNTRY
  return code
}

const GEO_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-appengine-country"] as const

/**
 * Resolves the request's country from platform geo headers. Order:
 * `cf-ipcountry` → `x-vercel-ip-country` → `x-appengine-country` →
 * `"unknown"`. The first header that yields a valid alpha-2 code wins;
 * pseudo-codes and malformed values fall through to the next header.
 *
 * Accepts anything with a `headers` map (Request, NextRequest).
 */
export function resolveRequestCountry(request: { headers: Pick<Headers, "get"> }): string {
  for (const name of GEO_HEADERS) {
    const country = normalizeCountryCode(request.headers.get(name))
    if (country !== UNKNOWN_COUNTRY) return country
  }
  return UNKNOWN_COUNTRY
}

/**
 * Pure enforcement check: evaluates `country` (an ISO alpha-2 code or
 * `"unknown"` from {@link resolveRequestCountry}) against `policy`.
 * Returns `{ allowed, reason }` — `reason` is null when allowed.
 *
 * Ready to be called by the sign-in routes once enforcement is wired; see
 * module docs for the integration points.
 */
export function checkGeoRestriction(
  policy: GeoRestrictionsPolicy,
  country: string,
): GeoCheckResult {
  if (policy.mode === "off") return { allowed: true, reason: null }

  const normalized = country.trim().toUpperCase()
  const isUnknown = normalized === UNKNOWN_COUNTRY.toUpperCase() || normalized === ""

  if (isUnknown) {
    if (policy.blockUnknown) {
      return {
        allowed: false,
        reason:
          "Sign-in is blocked because your location could not be determined and unknown locations are restricted.",
      }
    }
    return { allowed: true, reason: null }
  }

  const listed = policy.countryCodes.includes(normalized)
  if (policy.mode === "allowlist" && !listed) {
    return {
      allowed: false,
      reason:
        "Sign-in is restricted to specific countries and your location is not on the allowed list.",
    }
  }
  if (policy.mode === "blocklist" && listed) {
    return {
      allowed: false,
      reason: "Sign-in from your country is blocked by your geographic restrictions.",
    }
  }
  return { allowed: true, reason: null }
}

/** A country observed on a successful sign-in for a user. */
export interface ObservedCountry {
  /** ISO alpha-2 code, or `"unknown"`. */
  country: string
  /** ISO timestamp of the most recent observation. */
  lastSeenAt: string
  /** Number of observed sign-ins from this country. */
  count: number
}

/**
 * Per-principal store for geo policies plus observed login countries.
 * Mirrors {@link SecurityPolicyStore}: a per-user entry overrides the
 * global layer, which overrides the defaults.
 */
export interface GeoRestrictionStore {
  getPolicy(principalId: string): GeoRestrictionsPolicy
  getStoredPolicy(principalId: string): GeoRestrictionsPolicy | null
  setPolicy(principalId: string, policy: GeoRestrictionsPolicy): GeoRestrictionsPolicy
  resetPolicy(principalId: string): void
  getGlobalPolicy(): GeoRestrictionsPolicy
  setGlobalPolicy(policy: GeoRestrictionsPolicy): GeoRestrictionsPolicy
  /**
   * Records a country observed for the user (typically at sign-in). Always
   * records — including `"unknown"` — so the UI can honestly show "we
   * couldn't determine your country" rather than implying coverage.
   */
  recordLoginCountry(principalId: string, country: string, now?: number): void
  /** Observed countries for a user, most recently seen first. */
  getObservedCountries(principalId: string): ObservedCountry[]
}

const MAX_OBSERVED_COUNTRIES_PER_USER = 64

function clonePolicy(policy: GeoRestrictionsPolicy): GeoRestrictionsPolicy {
  return { ...policy, countryCodes: [...policy.countryCodes] }
}

/**
 * Bounded in-memory geo store. Per-principal policies live in a Map keyed
 * by user id; {@link GLOBAL_POLICY_KEY}-equivalent global layer mirrors
 * security-policies. Observed countries are capped per user — when the cap
 * is exceeded the least-recently-seen entries are evicted.
 */
export class MemoryGeoRestrictionStore implements GeoRestrictionStore {
  private policies = new Map<string, GeoRestrictionsPolicy>()
  private global: GeoRestrictionsPolicy = clonePolicy(DEFAULT_GEO_RESTRICTIONS)
  private observed = new Map<string, Map<string, { lastSeenAt: string; count: number }>>()

  getPolicy(principalId: string): GeoRestrictionsPolicy {
    const stored = this.policies.get(principalId) ?? this.global
    return clonePolicy(stored)
  }

  getStoredPolicy(principalId: string): GeoRestrictionsPolicy | null {
    const stored = this.policies.get(principalId)
    return stored ? clonePolicy(stored) : null
  }

  setPolicy(principalId: string, policy: GeoRestrictionsPolicy): GeoRestrictionsPolicy {
    const stored = clonePolicy(policy)
    this.policies.set(principalId, stored)
    return clonePolicy(stored)
  }

  resetPolicy(principalId: string): void {
    this.policies.delete(principalId)
  }

  getGlobalPolicy(): GeoRestrictionsPolicy {
    return clonePolicy(this.global)
  }

  setGlobalPolicy(policy: GeoRestrictionsPolicy): GeoRestrictionsPolicy {
    this.global = clonePolicy(policy)
    return clonePolicy(this.global)
  }

  recordLoginCountry(principalId: string, country: string, now = Date.now()): void {
    const normalized = normalizeCountryCode(country)
    let entries = this.observed.get(principalId)
    if (!entries) {
      entries = new Map()
      this.observed.set(principalId, entries)
    }
    const existing = entries.get(normalized)
    if (existing) {
      entries.delete(normalized)
    }
    entries.set(normalized, {
      lastSeenAt: new Date(now).toISOString(),
      count: (existing?.count ?? 0) + 1,
    })
    while (entries.size > MAX_OBSERVED_COUNTRIES_PER_USER) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
  }

  getObservedCountries(principalId: string): ObservedCountry[] {
    const entries = this.observed.get(principalId)
    if (!entries) return []
    return [...entries.entries()]
      .map(([country, entry]) => ({
        country,
        lastSeenAt: entry.lastSeenAt,
        count: entry.count,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
  }
}

let geoStore: GeoRestrictionStore = new MemoryGeoRestrictionStore()

/** Single seam for the geo store (swap for a durable backend in prod). */
export function getGeoRestrictionStore(): GeoRestrictionStore {
  return geoStore
}

/** Test hook: replaces the geo store. */
export function setGeoRestrictionStoreForTests(next: GeoRestrictionStore | undefined): void {
  geoStore = next ?? new MemoryGeoRestrictionStore()
}

/**
 * Records an observed login country for a user through the store seam.
 * Convenience wrapper for the sign-in wiring described in the module docs.
 */
export function recordLoginCountry(
  principalId: string,
  country: string,
  now?: number,
  store: GeoRestrictionStore = getGeoRestrictionStore(),
): void {
  store.recordLoginCountry(principalId, country, now)
}

export type GeoEnforcementResult = GeoCheckResult & {
  /** Country resolved from the request headers (`"unknown"` when undetermined). */
  country: string
}

/**
 * SIGN-IN INTEGRATION POINT (not yet wired).
 *
 * Call this from every session-creation route (`/api/auth/signin`,
 * `/api/auth/2fa/verify-login`, OAuth callback, passwordless verify) AFTER
 * the principal is authenticated but BEFORE issuing tokens:
 *
 *   const geo = evaluateGeoRestriction(request, user.id)
 *   if (!geo.allowed) return fail(403, "geo_restricted", geo.reason)
 *
 * It resolves the request country from platform headers, records it as an
 * observed login country (feeding the "you've logged in from X" UI), and
 * returns the {@link checkGeoRestriction} verdict for the user's effective
 * policy. Recommended denial: HTTP 403 with code `geo_restricted` so the
 * UI can explain the restriction. Never throws on store failures — the
 * record step is best-effort.
 */
export function evaluateGeoRestriction(
  request: { headers: Pick<Headers, "get"> },
  principalId: string,
  store: GeoRestrictionStore = getGeoRestrictionStore(),
  now?: number,
): GeoEnforcementResult {
  const country = resolveRequestCountry(request)
  try {
    store.recordLoginCountry(principalId, country, now ?? Date.now())
  } catch {
    // Observation is best-effort; enforcement must still run.
  }
  return { country, ...checkGeoRestriction(store.getPolicy(principalId), country) }
}
