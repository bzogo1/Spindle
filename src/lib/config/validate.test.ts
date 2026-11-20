import { describe, expect, it } from "vitest"

import type { EnvSource } from "../env"
import { collectRuntimeConfigIssues, validateRuntimeConfig } from "./validate"

const PRODUCTION_BASE: EnvSource = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://spindle.app",
  NEXT_PUBLIC_API_MODE: "http",
  DATABASE_URL: "postgresql://app:pw@db.internal:5432/spindle",
  DIRECT_URL: "postgresql://app:pw@db.internal:5432/spindle",
}

function rules(report: ReturnType<typeof validateRuntimeConfig>) {
  return report.issues.map((issue) => issue.rule)
}

describe("validateRuntimeConfig", () => {
  it("accepts a minimal development environment", () => {
    const report = validateRuntimeConfig({ NODE_ENV: "development" })

    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
  })

  it("requires the site URL and database URLs in production", () => {
    const report = validateRuntimeConfig({ NODE_ENV: "production" })

    expect(report.valid).toBe(false)
    expect(rules(report)).toEqual(
      expect.arrayContaining([
        "public-url.site-url-required-in-production",
        "database.required-in-production",
      ]),
    )
    expect(report.errors.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(["NEXT_PUBLIC_SITE_URL", "DATABASE_URL", "DIRECT_URL"]),
    )
  })

  it("accepts a complete production configuration", () => {
    const report = validateRuntimeConfig(PRODUCTION_BASE)

    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
  })

  it("rejects a localhost database in production but allows it elsewhere", () => {
    const local = {
      ...PRODUCTION_BASE,
      DATABASE_URL: "postgresql://app:pw@localhost:5432/spindle",
    }
    expect(rules(validateRuntimeConfig(local))).toContain("database.local-host-in-production")

    const dev = validateRuntimeConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:pw@127.0.0.1:5432/spindle",
    })
    expect(dev.issues).toEqual([])
  })

  it("ignores database URLs that the schema already rejects", () => {
    // A non-Postgres URL is a schema error; the semantic layer must not
    // double-report or crash on it.
    const report = validateRuntimeConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://spindle.app",
      DATABASE_URL: "mysql://localhost/spindle",
      DIRECT_URL: "postgresql://app:pw@db.internal:5432/spindle",
    })

    expect(rules(report)).not.toContain("database.local-host-in-production")
  })

  it("requires https for the site URL and API URL in production", () => {
    const report = validateRuntimeConfig({
      ...PRODUCTION_BASE,
      NEXT_PUBLIC_SITE_URL: "http://spindle.app",
      NEXT_PUBLIC_API_URL: "http://api.internal",
    })

    expect(rules(report)).toEqual(
      expect.arrayContaining(["public-url.site-url-not-https", "public-url.api-url-not-https"]),
    )
  })

  it("warns when production runs the mock API mode, including the unset default", () => {
    const unset = validateRuntimeConfig({ ...PRODUCTION_BASE, NEXT_PUBLIC_API_MODE: undefined })
    expect(rules(unset)).toContain("feature-flag.mock-api-mode-in-production")
    expect(unset.warnings).toHaveLength(1)
    // A warning does not invalidate the configuration.
    expect(unset.valid).toBe(true)

    const explicit = validateRuntimeConfig({
      ...PRODUCTION_BASE,
      NEXT_PUBLIC_API_MODE: "http",
    })
    expect(rules(explicit)).not.toContain("feature-flag.mock-api-mode-in-production")
  })

  it("rejects mock auth in production but allows it in development", () => {
    const prod = validateRuntimeConfig({ ...PRODUCTION_BASE, NEXT_PUBLIC_MOCK_AUTH: "1" })
    expect(rules(prod)).toContain("feature-flag.mock-auth-in-production")
    expect(prod.valid).toBe(false)

    const dev = validateRuntimeConfig({ NODE_ENV: "development", NEXT_PUBLIC_MOCK_AUTH: "1" })
    expect(dev.issues).toEqual([])
  })

  it("warns that CSP_ENFORCE is ignored outside production", () => {
    const dev = validateRuntimeConfig({ NODE_ENV: "development", CSP_ENFORCE: "1" })
    expect(rules(dev)).toContain("feature-flag.csp-enforce-outside-production")

    const prod = validateRuntimeConfig({ ...PRODUCTION_BASE, CSP_ENFORCE: "1" })
    expect(rules(prod)).not.toContain("feature-flag.csp-enforce-outside-production")
  })

  it("requires the B2 group to be configured all-or-nothing", () => {
    const partial = validateRuntimeConfig({
      NODE_ENV: "development",
      B2_KEY_ID: "key-id",
      B2_BUCKET: "bucket",
    })

    expect(rules(partial)).toContain("service.b2-incomplete")
    expect(partial.errors.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(["B2_APPLICATION_KEY", "B2_ENDPOINT"]),
    )

    const full = validateRuntimeConfig({
      NODE_ENV: "development",
      B2_KEY_ID: "key-id",
      B2_APPLICATION_KEY: "application-key-with-enough-length",
      B2_BUCKET: "bucket",
      B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    })
    expect(rules(full)).not.toContain("service.b2-incomplete")
  })

  it("warns when only one B2 previous-rotation variable is set", () => {
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      B2_KEY_ID_PREVIOUS: "old-key-id",
    })

    expect(rules(report)).toContain("service.b2-rotation-pair-incomplete")
    // B2_KEY_ID_PREVIOUS also has no current B2_KEY_ID, which is an error.
    expect(rules(report)).toContain("rotation.previous-without-current")
  })

  it("requires the LLM trio when the API key is present", () => {
    const partial = validateRuntimeConfig({
      NODE_ENV: "development",
      LLM_API_KEY: "sk-test-key",
    })

    expect(rules(partial)).toContain("service.llm-incomplete")
    expect(partial.errors.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(["LLM_BASE_URL", "LLM_MODEL"]),
    )

    const orphan = validateRuntimeConfig({
      NODE_ENV: "development",
      LLM_MODEL: "gpt-5",
    })
    expect(rules(orphan)).toContain("service.llm-without-key")
    expect(orphan.valid).toBe(true)
  })

  it("rejects plaintext service endpoints in production", () => {
    const report = validateRuntimeConfig({
      ...PRODUCTION_BASE,
      B2_ENDPOINT: "http://b2.local",
      LLM_API_KEY: "sk-live-key",
      LLM_BASE_URL: "http://llm.internal",
      LLM_MODEL: "gpt-5",
    })

    expect(rules(report)).toEqual(
      expect.arrayContaining(["service.b2-endpoint-not-https", "service.llm-base-url-not-https"]),
    )

    const dev = validateRuntimeConfig({
      NODE_ENV: "development",
      B2_ENDPOINT: "http://localhost:9000",
      LLM_API_KEY: "sk-test-key",
      LLM_BASE_URL: "http://localhost:11434",
      LLM_MODEL: "local-model",
    })
    expect(rules(dev)).not.toContain("service.b2-endpoint-not-https")
    expect(rules(dev)).not.toContain("service.llm-base-url-not-https")
  })

  it("requires the current secret before its previous rotation value", () => {
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      SESSION_SECRET_PREVIOUS: "old-" + "x".repeat(40),
    })

    expect(rules(report)).toContain("rotation.previous-without-current")
    expect(report.valid).toBe(false)
  })

  it("warns when a previous rotation value equals the current one", () => {
    const secret = "a".repeat(40) + "bcdefgh"
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      SESSION_SECRET: secret,
      SESSION_SECRET_PREVIOUS: secret,
    })

    expect(rules(report)).toContain("rotation.previous-equals-current")
  })

  it("rejects malformed OAUTH_PROVIDERS_JSON", () => {
    const notJson = validateRuntimeConfig({
      NODE_ENV: "development",
      OAUTH_PROVIDERS_JSON: "{not json",
    })
    expect(rules(notJson)).toContain("oauth.invalid-json")
    expect(notJson.valid).toBe(false)

    const notObject = validateRuntimeConfig({
      NODE_ENV: "development",
      OAUTH_PROVIDERS_JSON: '["github"]',
    })
    expect(rules(notObject)).toContain("oauth.not-an-object")
  })

  it("flags OAuth providers that runtime would silently drop", () => {
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      OAUTH_PROVIDERS_JSON: JSON.stringify({
        github: { clientId: "id", authorizeUrl: "not a url", tokenUrl: "", scopes: [42] },
        gitlab: {
          authorizeUrl: "https://gitlab.com/oauth/authorize",
          tokenUrl: "https://gitlab.com/oauth/token",
        },
      }),
    })

    expect(rules(report)).toContain("oauth.provider-invalid")
    const messages = report.errors.map((issue) => issue.message)
    expect(messages.some((m) => m.includes('"github"'))).toBe(true)
    expect(messages.some((m) => m.includes('"gitlab"'))).toBe(true)
  })

  it("accepts a well-formed OAUTH_PROVIDERS_JSON", () => {
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      OAUTH_PROVIDERS_JSON: JSON.stringify({
        github: {
          clientId: "client-id",
          authorizeUrl: "https://github.com/login/oauth/authorize",
          tokenUrl: "https://github.com/login/oauth/access_token",
          userinfoUrl: "https://api.github.com/user",
          scopes: ["read:user"],
        },
      }),
    })

    expect(report.issues).toEqual([])
  })

  it("warns about weak secrets outside production without leaking values", () => {
    const weak = "a".repeat(32)
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      SESSION_SECRET: weak,
      RESEND_API_KEY: "change-me",
    })

    expect(rules(report)).toEqual(
      expect.arrayContaining([
        "secret.below-recommended-length",
        "secret.low-entropy",
        "secret.placeholder-value",
      ]),
    )
    // Values must never appear in messages.
    for (const issue of report.issues) {
      expect(issue.message).not.toContain(weak)
      expect(issue.message).not.toContain("change-me")
    }
  })

  it("skips secret-strength heuristics in production", () => {
    const report = validateRuntimeConfig({
      ...PRODUCTION_BASE,
      SESSION_SECRET: "a".repeat(32),
      RESEND_API_KEY: "change-me",
    })

    expect(rules(report).filter((rule) => rule.startsWith("secret."))).toEqual([])
  })

  it("warns when a Sentry sample rate is set without a browser DSN", () => {
    const report = validateRuntimeConfig({
      NODE_ENV: "development",
      NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.1",
    })

    expect(rules(report)).toContain("sentry.sample-rate-without-dsn")

    const withDsn = validateRuntimeConfig({
      NODE_ENV: "development",
      NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.1",
      NEXT_PUBLIC_SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
    })
    expect(rules(withDsn)).not.toContain("sentry.sample-rate-without-dsn")
  })

  it("treats blank values as unset", () => {
    const report = validateRuntimeConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "   ",
      DATABASE_URL: "",
      DIRECT_URL: "  ",
    })

    expect(rules(report)).toContain("public-url.site-url-required-in-production")
    expect(rules(report)).toContain("database.required-in-production")
  })
})

describe("collectRuntimeConfigIssues", () => {
  it("projects only error-severity issues onto EnvIssue", () => {
    const issues = collectRuntimeConfigIssues({
      NODE_ENV: "production",
      NEXT_PUBLIC_MOCK_AUTH: "1",
      CSP_ENFORCE: "1", // warning-only outside production; NODE_ENV is production so ignored anyway
    })

    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue).toEqual({ key: expect.any(String), message: expect.any(String) })
    }
    // Warnings (mock API mode) must not leak into the error list.
    expect(issues.some((issue) => issue.message.includes("NEXT_PUBLIC_API_MODE=http"))).toBe(false)
  })
})
