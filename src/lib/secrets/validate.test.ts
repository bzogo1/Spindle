import { describe, expect, it } from "vitest"

import { validateSecretEnvironment } from "./validate"

const validSource = {
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "application-key",
  B2_BUCKET: "spindle-projects",
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  RESEND_API_KEY: "resend-key",
  LLM_API_KEY: "llm-key",
  LLM_BASE_URL: "https://llm.example.com",
  LLM_MODEL: "model-name",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/spindle",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/spindle",
  SESSION_SECRET: "a".repeat(40),
  EDGE_HMAC_SECRET: "b".repeat(40),
  WORKER_SECRET: "c".repeat(40),
}

describe("secret environment validation", () => {
  it("accepts a complete production contract", () => {
    const result = validateSecretEnvironment(validSource, { requireAll: true })

    expect(result.issues).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.present).toHaveLength(13)
  })

  it("collects missing names without failing in development", () => {
    const result = validateSecretEnvironment({}, { requireAll: false })

    expect(result.issues).toEqual([])
    expect(result.missing).toHaveLength(13)
  })

  it("reports every missing name in production without printing a value", () => {
    const result = validateSecretEnvironment(
      { ...validSource, RESEND_API_KEY: "" },
      { requireAll: true },
    )

    expect(result.issues).toEqual([
      {
        key: "RESEND_API_KEY",
        message: "Resend is not configured. Add RESEND_API_KEY to the production secret store.",
      },
    ])
    expect(JSON.stringify(result)).not.toContain("resend-key")
  })

  it("rejects placeholders and short symmetric keys", () => {
    const result = validateSecretEnvironment(
      { ...validSource, RESEND_API_KEY: "changeme", SESSION_SECRET: "short" },
      { requireAll: true },
    )

    expect(result.issues).toEqual([
      { key: "RESEND_API_KEY", message: "Looks like a placeholder, not a real secret." },
      { key: "SESSION_SECRET", message: "Symmetric keys must be at least 32 characters." },
    ])
  })

  it("requires the current value before a previous value", () => {
    const { SESSION_SECRET: _session, ...withoutSession } = validSource
    const result = validateSecretEnvironment(
      { ...withoutSession, SESSION_SECRET_PREVIOUS: "d".repeat(40) },
      { requireAll: false },
    )

    expect(result.issues).toEqual([
      {
        key: "SESSION_SECRET_PREVIOUS",
        message: "Set SESSION_SECRET before SESSION_SECRET_PREVIOUS.",
      },
    ])
  })

  it("rejects a previous value that equals the current value", () => {
    const result = validateSecretEnvironment(
      { ...validSource, SESSION_SECRET_PREVIOUS: validSource.SESSION_SECRET },
      { requireAll: false },
    )

    expect(result.issues).toEqual([
      {
        key: "SESSION_SECRET_PREVIOUS",
        message: "Must differ from SESSION_SECRET; otherwise the rotation does not change the key.",
      },
    ])
  })
})
