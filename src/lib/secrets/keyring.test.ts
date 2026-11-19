import { describe, expect, it } from "vitest"

import {
  createKeyring,
  decodeBase64Url,
  encodeBase64Url,
  hmacSha256,
  safeEqual,
  SecretsConfigurationError,
  signWithKeyring,
  verifyHmac,
  verifyWithKeyring,
} from "./keyring"

const current = "current-key-".padEnd(40, "a")
const previous = "previous-key-".padEnd(40, "b")

describe("keyring", () => {
  it("requires a current key", () => {
    expect(() => createKeyring(undefined, previous, "SESSION_SECRET")).toThrow(
      SecretsConfigurationError,
    )
    expect(() => createKeyring("   ", previous, "SESSION_SECRET")).toThrow(/SESSION_SECRET/)
  })

  it("drops a previous key that is blank or identical to the current key", () => {
    expect(createKeyring(current, "   ", "SESSION_SECRET")).toEqual({ current })
    expect(createKeyring(current, current, "SESSION_SECRET")).toEqual({ current })
    expect(createKeyring(current, previous, "SESSION_SECRET")).toEqual({ current, previous })
  })

  it("signs with the current key and verifies both keys during overlap", () => {
    const keyring = createKeyring(current, previous, "SESSION_SECRET")
    const payload = "payload"

    const currentSignature = signWithKeyring(keyring, payload)
    const previousSignature = hmacSha256(previous, payload)

    expect(verifyWithKeyring(keyring, payload, currentSignature)).toBe("current")
    expect(verifyWithKeyring(keyring, payload, previousSignature)).toBe("previous")
  })

  it("rejects a tampered payload and a missing previous key", () => {
    const keyring = createKeyring(current, previous, "SESSION_SECRET")
    const signature = signWithKeyring(keyring, "payload")

    expect(verifyWithKeyring(keyring, "other", signature)).toBeNull()

    const withoutPrevious = createKeyring(current, undefined, "SESSION_SECRET")
    expect(
      verifyWithKeyring(withoutPrevious, "payload", hmacSha256(previous, "payload")),
    ).toBeNull()
  })

  it("compares strings safely, including different lengths", () => {
    expect(safeEqual("same", "same")).toBe(true)
    expect(safeEqual("same", "different")).toBe(false)
    expect(safeEqual("short", "a longer value")).toBe(false)
  })

  it("verifies HMACs and round-trips base64url", () => {
    const payload = "hello"
    const signature = hmacSha256(current, payload)

    expect(verifyHmac(current, payload, signature)).toBe(true)
    expect(verifyHmac(current, "goodbye", signature)).toBe(false)
    expect(decodeBase64Url(encodeBase64Url("spindle"))).toBe("spindle")
  })
})
