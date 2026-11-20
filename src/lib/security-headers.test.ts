import { describe, expect, it } from "vitest"

import { securityHeaders } from "./security-headers"

function ruleFor(rules: ReturnType<typeof securityHeaders>, source: string) {
  return rules.find((rule) => rule.source === source)
}

function headerValue(rule: ReturnType<typeof securityHeaders>[number] | undefined, key: string) {
  return rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
}

describe("securityHeaders", () => {
  it("applies the baseline headers to every route", () => {
    const rules = securityHeaders({ production: false })
    const global = ruleFor(rules, "/:path*")
    expect(global).toBeDefined()
    expect(headerValue(global, "X-Content-Type-Options")).toBe("nosniff")
    expect(headerValue(global, "Referrer-Policy")).toBe("strict-origin-when-cross-origin")
    expect(headerValue(global, "X-Frame-Options")).toBe("SAMEORIGIN")
    expect(headerValue(global, "Permissions-Policy")).toContain("camera=()")
    expect(headerValue(global, "Permissions-Policy")).toContain("microphone=()")
    expect(headerValue(global, "Permissions-Policy")).toContain("geolocation=()")
  })

  it("keeps the enforced CSP to the safe subset and ships the full policy report-only", () => {
    const global = ruleFor(securityHeaders({ production: false }), "/:path*")
    const enforced = headerValue(global, "Content-Security-Policy") ?? ""
    expect(enforced).toContain("frame-ancestors 'self'")
    expect(enforced).toContain("base-uri 'self'")
    expect(enforced).toContain("object-src 'none'")
    // No script/style directives in enforce mode — those would need nonce/hash
    // plumbing for the inline theme scripts first.
    expect(enforced).not.toContain("script-src")
    expect(enforced).not.toContain("default-src")

    const reportOnly = headerValue(global, "Content-Security-Policy-Report-Only") ?? ""
    expect(reportOnly).toContain("default-src 'self'")
    expect(reportOnly).toContain("script-src 'self' 'unsafe-inline'")
    expect(reportOnly).not.toContain("unsafe-eval")
    // Approved third-party origins.
    expect(reportOnly).toContain("https://fonts.googleapis.com")
    expect(reportOnly).toContain("https://fonts.gstatic.com")
    expect(reportOnly).toContain("*.ingest.sentry.io")
    expect(reportOnly).toContain("*.ingest.us.sentry.io")
  })

  it("enforces the full CSP only in production with the CSP_ENFORCE opt-in", () => {
    const global = ruleFor(securityHeaders({ production: true, cspEnforce: true }), "/:path*")
    const enforced = headerValue(global, "Content-Security-Policy") ?? ""
    expect(enforced).toContain("default-src 'self'")
    expect(enforced).toContain("script-src 'self' 'unsafe-inline'")
    expect(enforced).toContain("frame-ancestors 'self'")
    expect(enforced).not.toContain("unsafe-eval")
    // Once the same policy is enforced there is no report-only duplicate.
    expect(headerValue(global, "Content-Security-Policy-Report-Only")).toBeUndefined()
    // HSTS still applies on the same production path.
    expect(headerValue(global, "Strict-Transport-Security")).toContain("max-age=")
  })

  it("keeps the safe subset in production without the opt-in flag", () => {
    const global = ruleFor(securityHeaders({ production: true, cspEnforce: false }), "/:path*")
    const enforced = headerValue(global, "Content-Security-Policy") ?? ""
    expect(enforced).not.toContain("default-src")
    expect(enforced).not.toContain("script-src")
    expect(headerValue(global, "Content-Security-Policy-Report-Only")).toContain(
      "default-src 'self'",
    )
  })

  it("never enforces the full CSP outside production, even with the flag", () => {
    const global = ruleFor(securityHeaders({ production: false, cspEnforce: true }), "/:path*")
    const enforced = headerValue(global, "Content-Security-Policy") ?? ""
    expect(enforced).not.toContain("default-src")
    expect(enforced).not.toContain("script-src")
    expect(headerValue(global, "Content-Security-Policy-Report-Only")).toContain(
      "default-src 'self'",
    )
  })

  it("sends HSTS only in production and without preload", () => {
    const dev = ruleFor(securityHeaders({ production: false }), "/:path*")
    expect(headerValue(dev, "Strict-Transport-Security")).toBeUndefined()

    const prod = ruleFor(securityHeaders({ production: true, cspEnforce: false }), "/:path*")
    const hsts = headerValue(prod, "Strict-Transport-Security") ?? ""
    expect(hsts).toContain("max-age=")
    expect(hsts).toContain("includeSubDomains")
    expect(hsts).not.toContain("preload")
  })

  it("sets Referrer-Policy: no-referrer on every token route", () => {
    const rules = securityHeaders({ production: true, cspEnforce: false })
    for (const source of [
      "/reset-password/:path*",
      "/verify-email/:path*",
      "/magic-link/:path*",
      "/invite/:path*",
    ]) {
      const rule = ruleFor(rules, source)
      expect(rule, `missing header rule for ${source}`).toBeDefined()
      expect(headerValue(rule, "Referrer-Policy")).toBe("no-referrer")
      // Token routes only override Referer — they must not drop the rest.
      expect(rule?.headers).toHaveLength(1)
    }
  })

  it("orders token-route rules after the global rule so no-referrer wins", () => {
    const rules = securityHeaders({ production: true, cspEnforce: false })
    const globalIndex = rules.findIndex((r) => r.source === "/:path*")
    for (const rule of rules.slice(globalIndex + 1)) {
      expect(rule.source).not.toBe("/:path*")
    }
    expect(rules.length).toBeGreaterThan(1)
  })
})
