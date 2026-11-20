import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { clientEnv, formatEnvError, parseClientEnv } from "./env"
import {
  configuredEnvKeys,
  EnvValidationError,
  getServerEnv,
  parseBuildEnv,
  parseServerEnv,
  validateEnv,
} from "./env.server"

describe("environment schema", () => {
  it("applies safe development defaults", () => {
    expect(parseClientEnv({ NODE_ENV: "development" })).toEqual({
      NODE_ENV: "development",
      NEXT_PUBLIC_SITE_URL: undefined,
      NEXT_PUBLIC_SENTRY_DSN: undefined,
      NEXT_PUBLIC_SENTRY_RELEASE: undefined,
      NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: undefined,
      NEXT_PUBLIC_API_MODE: "mock",
      NEXT_PUBLIC_API_URL: undefined,
      NEXT_PUBLIC_MOCK_AUTH: undefined,
    })
  })

  it("treats blank values as unset", () => {
    expect(parseServerEnv({ NODE_ENV: "test", SENTRY_DSN: "", SENTRY_RELEASE: "   " })).toEqual({
      NODE_ENV: "test",
      NEXT_RUNTIME: undefined,
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
      SENTRY_DSN: undefined,
      SENTRY_RELEASE: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
      GITHUB_SHA: undefined,
      B2_KEY_ID: undefined,
      B2_APPLICATION_KEY: undefined,
      B2_KEY_ID_PREVIOUS: undefined,
      B2_APPLICATION_KEY_PREVIOUS: undefined,
      B2_BUCKET: undefined,
      B2_ENDPOINT: undefined,
      RESEND_API_KEY: undefined,
      LLM_API_KEY: undefined,
      LLM_BASE_URL: undefined,
      LLM_MODEL: undefined,
      SESSION_SECRET: undefined,
      SESSION_SECRET_PREVIOUS: undefined,
      EDGE_HMAC_SECRET: undefined,
      EDGE_HMAC_SECRET_PREVIOUS: undefined,
      WORKER_SECRET: undefined,
      WORKER_SECRET_PREVIOUS: undefined,
      OAUTH_PROVIDERS_JSON: undefined,
      CSP_ENFORCE: undefined,
    })
  })

  it("accepts CSP_ENFORCE only as the literal opt-in flag", () => {
    expect(parseServerEnv({ NODE_ENV: "test", CSP_ENFORCE: "1" }).CSP_ENFORCE).toBe("1")
    expect(parseServerEnv({ NODE_ENV: "test", CSP_ENFORCE: "" }).CSP_ENFORCE).toBeUndefined()
    expect(parseServerEnv({ NODE_ENV: "test" }).CSP_ENFORCE).toBeUndefined()
    expect(() => parseServerEnv({ NODE_ENV: "test", CSP_ENFORCE: "true" })).toThrow(/CSP_ENFORCE/)
  })

  it("rejects a non-Postgres database URL", () => {
    expect(() =>
      parseServerEnv({ NODE_ENV: "test", DATABASE_URL: "mysql://localhost/spindle" }),
    ).toThrow(/postgres:\/\/ or postgresql:\/\//)
  })

  it("rejects a malformed URL without printing the value", () => {
    expect.assertions(3)

    try {
      validateEnv({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "not a url" })
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const message = (error as Error).message
      expect(message).toContain("NEXT_PUBLIC_SITE_URL")
      expect(message).not.toContain("not a url")
    }
  })

  it("lists every invalid variable in one failure", () => {
    expect.assertions(3)

    try {
      validateEnv({
        NODE_ENV: "production",
        SENTRY_DSN: "still not a url",
      })
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain("NEXT_PUBLIC_SITE_URL")
      expect(message).toContain("Required in production")
      expect(message).toContain("SENTRY_DSN")
    }
  })

  it("accepts a production configuration with the site origin set", () => {
    const result = validateEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://spindle.app",
    })

    expect(result.client.NEXT_PUBLIC_SITE_URL).toBe("https://spindle.app")
    expect(result.server.NODE_ENV).toBe("production")
  })

  it("keeps server-only values out of the client export", () => {
    const parsed = parseClientEnv({
      NODE_ENV: "development",
      SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
      SENTRY_AUTH_TOKEN: "secret",
    })

    expect(parsed).not.toHaveProperty("SENTRY_DSN")
    expect(parsed).not.toHaveProperty("SENTRY_AUTH_TOKEN")
    expect(clientEnv).not.toHaveProperty("SENTRY_DSN")
  })

  it("passes the ANALYZE flag through the build env unchanged", () => {
    expect(parseBuildEnv({ ANALYZE: "true" }).ANALYZE).toBe("true")
    // Whitespace is preserved so `ANALYZE === "true"` semantics are unchanged.
    expect(parseBuildEnv({ ANALYZE: " true " }).ANALYZE).toBe(" true ")
    expect(parseBuildEnv({ ANALYZE: "" }).ANALYZE).toBeUndefined()
    expect(parseBuildEnv({}).ANALYZE).toBeUndefined()
  })

  it("refuses to read server configuration in the browser", () => {
    expect(() => getServerEnv()).toThrow(/cannot be read in the browser/)
  })

  it("documents exactly the configured keys in .env.example", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8")
    const documented = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1])

    expect(documented).toHaveLength(configuredEnvKeys.length)
    expect(new Set(documented)).toEqual(new Set(configuredEnvKeys))
  })

  it("formats issues as one aligned list", () => {
    const message = formatEnvError("application", [
      { key: "SHORT", message: "Missing." },
      { key: "A_LONGER_KEY", message: "Invalid." },
    ])

    expect(message).toContain("Invalid application environment configuration:")
    expect(message).toContain("SHORT")
    expect(message).toContain("A_LONGER_KEY")
  })
})
