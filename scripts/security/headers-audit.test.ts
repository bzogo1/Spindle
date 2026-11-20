import { describe, expect, it } from "vitest"

import {
  auditHeaders,
  demoResponses,
  loadPolicy,
  normalizeHeaders,
  parseCsp,
  runAudit,
  validatePolicy,
} from "./headers-audit.mjs"

const POLICY_PATH = new URL("./policy.headers.json", import.meta.url).pathname

async function devPolicy() {
  const policy = await loadPolicy(POLICY_PATH)
  return { policy, profile: policy.profiles.development, profileName: "development" }
}

async function prodPolicy() {
  const policy = await loadPolicy(POLICY_PATH)
  return { policy, profile: policy.profiles.production, profileName: "production" }
}

const FULL_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  "connect-src 'self' https://*.ingest.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' https:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ")

const COMPLIANT_DEV_HEADERS = {
  "content-security-policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  "content-security-policy-report-only": FULL_CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
}

const COMPLIANT_PROD_HEADERS = {
  ...COMPLIANT_DEV_HEADERS,
  "strict-transport-security": "max-age=63072000; includeSubDomains",
}

describe("normalizeHeaders", () => {
  it("lowercases plain object keys", () => {
    expect(normalizeHeaders({ "X-Frame-Options": "SAMEORIGIN" })).toEqual({
      "x-frame-options": "SAMEORIGIN",
    })
  })

  it("handles a fetch Headers instance", () => {
    const h = new Headers({ "Content-Type": "text/html", "X-Test": "1" })
    const out = normalizeHeaders(h) as Record<string, string>
    expect(out["content-type"]).toBe("text/html")
    expect(out["x-test"]).toBe("1")
  })

  it("handles an array of pairs", () => {
    expect(normalizeHeaders([["A-B", "v"]])).toEqual({ "a-b": "v" })
  })

  it("returns {} for nullish input", () => {
    expect(normalizeHeaders(undefined)).toEqual({})
    expect(normalizeHeaders(null)).toEqual({})
  })
})

describe("parseCsp", () => {
  it("parses directives and sources", () => {
    expect(parseCsp("default-src 'self'; script-src 'self' https:")).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "https:"],
    })
  })

  it("lowercases directive names and ignores empty parts", () => {
    expect(parseCsp(" Frame-Ancestors 'self' ;; base-uri 'self' ")).toEqual({
      "frame-ancestors": ["'self'"],
      "base-uri": ["'self'"],
    })
  })

  it("returns {} for empty input", () => {
    expect(parseCsp(undefined)).toEqual({})
    expect(parseCsp("")).toEqual({})
  })
})

describe("validatePolicy", () => {
  it("accepts the shipped policy file", async () => {
    const policy = await loadPolicy(POLICY_PATH)
    expect(Object.keys(policy.profiles).sort()).toEqual(["development", "production"])
  })

  it("rejects a profile without requiredHeaders", () => {
    expect(() => validatePolicy({ profiles: { x: {} } })).toThrow(/requiredHeaders/)
  })

  it("rejects an unknown match type", () => {
    expect(() =>
      validatePolicy({
        profiles: {
          x: {
            requiredHeaders: [{ name: "A", severity: "error", match: { type: "nope" } }],
          },
        },
      }),
    ).toThrow(/match type/)
  })
})

describe("auditHeaders — development profile", () => {
  it("passes a compliant dev response", async () => {
    const { profile, profileName } = await devPolicy()
    const report = auditHeaders({
      url: "http://localhost:3000/",
      status: 200,
      headers: COMPLIANT_DEV_HEADERS,
      profile,
      profileName,
    })
    expect(report.ok).toBe(true)
    expect(report.summary.failed).toBe(0)
  })

  it("fails when the report-only CSP is missing", async () => {
    const { profile, profileName } = await devPolicy()
    const { "content-security-policy-report-only": _drop, ...headers } = COMPLIANT_DEV_HEADERS
    const report = auditHeaders({
      url: "http://localhost:3000/",
      status: 200,
      headers,
      profile,
      profileName,
    })
    expect(report.ok).toBe(false)
    expect(
      report.checks.some(
        (c) => c.id === "header:Content-Security-Policy-Report-Only" && c.status === "fail",
      ),
    ).toBe(true)
  })

  it("fails when the report-only CSP misses a required directive", async () => {
    const { profile, profileName } = await devPolicy()
    const headers = {
      ...COMPLIANT_DEV_HEADERS,
      "content-security-policy-report-only": "default-src 'self'; script-src 'self'",
    }
    const report = auditHeaders({
      url: "http://localhost:3000/",
      status: 200,
      headers,
      profile,
      profileName,
    })
    expect(report.ok).toBe(false)
    const directiveCheck = report.checks.find((c) => c.id.startsWith("csp:directives"))
    expect(directiveCheck?.status).toBe("fail")
    expect(directiveCheck?.message).toContain("connect-src")
  })

  it("fails on 'unsafe-eval' in any CSP header", async () => {
    const { profile, profileName } = await devPolicy()
    const headers = {
      ...COMPLIANT_DEV_HEADERS,
      "content-security-policy": "frame-ancestors 'self'; script-src 'unsafe-eval'",
    }
    const report = auditHeaders({
      url: "http://localhost:3000/",
      status: 200,
      headers,
      profile,
      profileName,
    })
    expect(report.ok).toBe(false)
    expect(report.checks.some((c) => c.id.includes("unsafe-eval") && c.status === "fail")).toBe(
      true,
    )
  })

  it("warns (not fails) when HSTS appears in dev", async () => {
    const { profile, profileName } = await devPolicy()
    const report = auditHeaders({
      url: "http://localhost:3000/",
      status: 200,
      headers: { ...COMPLIANT_DEV_HEADERS, "strict-transport-security": "max-age=63072000" },
      profile,
      profileName,
    })
    expect(report.ok).toBe(true)
    expect(report.checks.some((c) => c.id === "optional:Strict-Transport-Security")).toBe(true)
  })

  it("warns on non-2xx status but does not fail", async () => {
    const { profile, profileName } = await devPolicy()
    const report = auditHeaders({
      url: "http://localhost:3000/missing",
      status: 404,
      headers: COMPLIANT_DEV_HEADERS,
      profile,
      profileName,
    })
    expect(report.ok).toBe(true)
    expect(report.checks.some((c) => c.id === "http:status" && c.severity === "warn")).toBe(true)
  })
})

describe("auditHeaders — production profile", () => {
  it("passes a compliant prod response (report-only present)", async () => {
    const { profile, profileName } = await prodPolicy()
    const report = auditHeaders({
      url: "https://spindle.example.com/",
      status: 200,
      headers: COMPLIANT_PROD_HEADERS,
      profile,
      profileName,
    })
    expect(report.ok).toBe(true)
  })

  it("passes CSP_ENFORCE=1 mode (full CSP enforced, no report-only)", async () => {
    const { profile, profileName } = await prodPolicy()
    const { "content-security-policy-report-only": _drop, ...rest } = COMPLIANT_PROD_HEADERS
    const headers = { ...rest, "content-security-policy": FULL_CSP }
    const report = auditHeaders({
      url: "https://spindle.example.com/",
      status: 200,
      headers,
      profile,
      profileName,
    })
    expect(report.ok).toBe(true)
    expect(report.summary.warnings).toBeGreaterThanOrEqual(0)
  })

  it("fails production without HSTS", async () => {
    const { profile, profileName } = await prodPolicy()
    const report = auditHeaders({
      url: "https://spindle.example.com/",
      status: 200,
      headers: COMPLIANT_DEV_HEADERS,
      profile,
      profileName,
    })
    expect(report.ok).toBe(false)
    expect(
      report.checks.some((c) => c.id === "header:Strict-Transport-Security" && c.status === "fail"),
    ).toBe(true)
  })

  it("fails when enforced CSP is the safe subset AND report-only is gone", async () => {
    const { profile, profileName } = await prodPolicy()
    const { "content-security-policy-report-only": _drop, ...rest } = COMPLIANT_PROD_HEADERS
    const report = auditHeaders({
      url: "https://spindle.example.com/",
      status: 200,
      headers: rest, // enforced CSP is only the safe subset
      profile,
      profileName,
    })
    expect(report.ok).toBe(false)
    const directiveCheck = report.checks.find((c) => c.id.startsWith("csp:directives"))
    expect(directiveCheck?.status).toBe("fail")
  })
})

describe("demo fixtures", () => {
  it("compliant fixture passes, non-compliant fails (dev profile)", async () => {
    const [good, bad] = demoResponses()
    const { profile, profileName } = await devPolicy()
    const goodReport = auditHeaders({
      url: "demo://good",
      status: good.status,
      headers: good.headers,
      profile,
      profileName,
    })
    const badReport = auditHeaders({
      url: "demo://bad",
      status: bad.status,
      headers: bad.headers,
      profile,
      profileName,
    })
    expect(goodReport.ok).toBe(true)
    expect(badReport.ok).toBe(false)
    expect(badReport.summary.failed).toBeGreaterThan(0)
  })

  it("runAudit --demo returns both reports without a server", async () => {
    const result = await runAudit(
      { url: "http://localhost:3000/", profile: "development", demo: true },
      {
        fetchImpl: async () => {
          throw new Error("fetch must not be called in demo mode")
        },
      },
    )
    expect(result.demo).toBe(true)
    expect(result.reports).toHaveLength(2)
    expect(result.reports[0].ok).toBe(true)
    expect(result.reports[1].ok).toBe(false)
  })

  it("runAudit uses the injected fetch for live audits", async () => {
    const fetchImpl = async () => ({
      status: 200,
      headers: new Headers(COMPLIANT_DEV_HEADERS),
      finalUrl: "http://localhost:3000/",
    })
    const result = await runAudit(
      { url: "http://localhost:3000/", profile: "development", demo: false },
      { fetchImpl },
    )
    expect(result.reports).toHaveLength(1)
    expect(result.reports[0].ok).toBe(true)
    expect(result.reports[0].url).toBe("http://localhost:3000/")
  })

  it("runAudit auto-selects production profile for https URLs", async () => {
    const fetchImpl = async () => ({
      status: 200,
      headers: new Headers(COMPLIANT_PROD_HEADERS),
      finalUrl: "https://spindle.example.com/",
    })
    const result = await runAudit(
      { url: "https://spindle.example.com/", demo: false },
      { fetchImpl },
    )
    expect(result.profileName).toBe("production")
    expect(result.reports[0].ok).toBe(true)
  })
})
