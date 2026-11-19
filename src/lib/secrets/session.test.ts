import { describe, expect, it } from "vitest"

import { createKeyring } from "./keyring"
import { signSession, verifySession } from "./session"

const current = "session-current-".padEnd(40, "a")
const previous = "session-previous-".padEnd(40, "b")
const now = 1_800_000_000

describe("session tokens", () => {
  it("round-trips a token signed with the current key", () => {
    const keyring = createKeyring(current, undefined, "SESSION_SECRET")
    const token = signSession({ sub: "user_1" }, { keyring, now, ttlSeconds: 60 })

    const result = verifySession(token, { keyring, now: now + 30 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.claims.sub).toBe("user_1")
      expect(result.claims.exp).toBe(now + 60)
      expect(result.key).toBe("current")
    }
  })

  it("accepts a token signed with the previous key during rotation", () => {
    const oldKeyring = createKeyring(previous, undefined, "SESSION_SECRET")
    const newKeyring = createKeyring(current, previous, "SESSION_SECRET")
    const token = signSession({ sub: "user_1" }, { keyring: oldKeyring, now })

    const result = verifySession(token, { keyring: newKeyring, now })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.key).toBe("previous")
  })

  it("rejects an expired token", () => {
    const keyring = createKeyring(current, undefined, "SESSION_SECRET")
    const token = signSession({ sub: "user_1" }, { keyring, now, ttlSeconds: 10 })

    expect(verifySession(token, { keyring, now: now + 11 })).toEqual({
      ok: false,
      reason: "expired",
    })
  })

  it("rejects a token signed with an unknown key", () => {
    const signer = createKeyring("unknown-key-".padEnd(40, "c"), undefined, "SESSION_SECRET")
    const verifier = createKeyring(current, undefined, "SESSION_SECRET")
    const token = signSession({ sub: "user_1" }, { keyring: signer, now })

    expect(verifySession(token, { keyring: verifier, now })).toEqual({
      ok: false,
      reason: "invalid-signature",
    })
  })

  it("rejects malformed tokens and tampered payloads", () => {
    const keyring = createKeyring(current, undefined, "SESSION_SECRET")
    const token = signSession({ sub: "user_1" }, { keyring, now })
    const [payload, signature] = token.split(".")

    expect(verifySession("not-a-token", { keyring, now })).toEqual({
      ok: false,
      reason: "malformed",
    })
    expect(verifySession(`${payload}.`, { keyring, now })).toEqual({
      ok: false,
      reason: "malformed",
    })
    expect(verifySession(`${payload}.${signature}.extra`, { keyring, now })).toEqual({
      ok: false,
      reason: "malformed",
    })

    const tampered = `${Buffer.from(JSON.stringify({ sub: "user_2", iat: now, exp: now + 60 })).toString("base64url")}.${signature}`
    expect(verifySession(tampered, { keyring, now })).toEqual({
      ok: false,
      reason: "invalid-signature",
    })
  })

  it("rejects claims that are missing a subject or expiry", () => {
    const keyring = createKeyring(current, undefined, "SESSION_SECRET")

    expect(() => signSession({ sub: "" }, { keyring, now })).toThrow(/subject/)
    expect(() => signSession({ sub: "user_1", exp: now }, { keyring, now })).toThrow(/expiry/)
  })
})
