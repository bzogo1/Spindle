import { describe, expect, it } from "vitest"

import {
  checkRotationOverlap,
  edgeKeyring,
  llmCredentials,
  resendApiKey,
  sessionKeyring,
  SecretsConfigurationError,
  verifyWorkerToken,
  workerKeyring,
} from "./index"

const source = {
  SESSION_SECRET: "a".repeat(40),
  SESSION_SECRET_PREVIOUS: "b".repeat(40),
  EDGE_HMAC_SECRET: "c".repeat(40),
  EDGE_HMAC_SECRET_PREVIOUS: "d".repeat(40),
  WORKER_SECRET: "e".repeat(40),
  WORKER_SECRET_PREVIOUS: "f".repeat(40),
  RESEND_API_KEY: "resend-key",
  LLM_API_KEY: "llm-key",
  LLM_BASE_URL: "https://llm.example.com",
  LLM_MODEL: "model-name",
}

describe("secret accessors", () => {
  it("builds keyrings with the current and previous keys", () => {
    expect(sessionKeyring(source)).toEqual({
      current: source.SESSION_SECRET,
      previous: source.SESSION_SECRET_PREVIOUS,
    })
    expect(edgeKeyring(source)).toEqual({
      current: source.EDGE_HMAC_SECRET,
      previous: source.EDGE_HMAC_SECRET_PREVIOUS,
    })
    expect(workerKeyring(source)).toEqual({
      current: source.WORKER_SECRET,
      previous: source.WORKER_SECRET_PREVIOUS,
    })
  })

  it("requires the current value for every keyring", () => {
    expect(() => sessionKeyring({})).toThrow(SecretsConfigurationError)
    expect(() => edgeKeyring({})).toThrow(SecretsConfigurationError)
    expect(() => workerKeyring({})).toThrow(SecretsConfigurationError)
  })

  it("reads provider credentials", () => {
    expect(resendApiKey(source)).toBe("resend-key")
    expect(llmCredentials(source)).toEqual({
      apiKey: "llm-key",
      baseUrl: "https://llm.example.com",
      model: "model-name",
    })
  })

  it("reports a missing provider credential by name", () => {
    expect(() => resendApiKey({})).toThrow(/RESEND_API_KEY/)
    expect(() => llmCredentials({ LLM_API_KEY: "key" })).toThrow(/LLM_BASE_URL/)
  })

  it("accepts the current and previous worker token during rotation", () => {
    expect(verifyWorkerToken(source.WORKER_SECRET, source)).toBe(true)
    expect(verifyWorkerToken(source.WORKER_SECRET_PREVIOUS, source)).toBe(true)
    expect(verifyWorkerToken("wrong", source)).toBe(false)
    expect(verifyWorkerToken(undefined, source)).toBe(false)
  })

  it("proves both keys verify for every dual-key secret", () => {
    expect(checkRotationOverlap(source)).toEqual([
      {
        service: "session",
        key: "SESSION_SECRET",
        hasPrevious: true,
        currentAccepted: true,
        previousAccepted: true,
      },
      {
        service: "edge",
        key: "EDGE_HMAC_SECRET",
        hasPrevious: true,
        currentAccepted: true,
        previousAccepted: true,
      },
      {
        service: "worker",
        key: "WORKER_SECRET",
        hasPrevious: true,
        currentAccepted: true,
        previousAccepted: true,
      },
    ])
  })

  it("marks a missing current key as not accepted", () => {
    const checks = checkRotationOverlap({ SESSION_SECRET_PREVIOUS: source.SESSION_SECRET_PREVIOUS })

    expect(checks[0]).toEqual({
      service: "session",
      key: "SESSION_SECRET",
      hasPrevious: true,
      currentAccepted: false,
      previousAccepted: false,
    })
  })
})
