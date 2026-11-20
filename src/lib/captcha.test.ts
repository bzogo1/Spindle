// @vitest-environment node
import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it } from "vitest"

import {
  CAPTCHA_CHALLENGE_TTL_MS,
  CAPTCHA_MAX_ATTEMPTS,
  CAPTCHA_TOKEN_TTL_MS,
  createCaptchaToken,
  isCaptchaTokenValid,
  issueCaptchaChallenge,
  resetCaptchaStoreForTests,
  verifyCaptchaSolution,
  verifyCaptchaToken,
} from "./captcha"

/** Finds a nonce whose sha256(prefix+nonce) has `bits` leading zero bits. */
function solve(prefix: string, bits: number): string {
  for (let nonce = 0; ; nonce += 1) {
    const digest = createHash("sha256").update(`${prefix}${nonce}`, "utf8").digest()
    let remaining = bits
    let ok = true
    for (const byte of digest) {
      if (remaining <= 0) break
      if (byte === 0) {
        remaining -= 8
        continue
      }
      for (let mask = 0x80; mask !== 0 && remaining > 0; mask >>= 1) {
        if (byte & mask) {
          ok = false
          break
        }
        remaining -= 1
      }
      if (!ok) break
    }
    if (ok && remaining <= 0) return String(nonce)
  }
}

beforeEach(() => {
  resetCaptchaStoreForTests()
})

describe("captcha challenges", () => {
  it("issues a challenge with prefix, difficulty, and expiry", () => {
    const challenge = issueCaptchaChallenge({ difficulty: 8 })
    expect(challenge.challengeId).toMatch(/^[0-9a-f]{16}$/)
    expect(challenge.prefix).toContain(challenge.challengeId)
    expect(challenge.difficulty).toBe(8)
    expect(Date.parse(challenge.expiresAt)).toBeGreaterThan(Date.now())
  })

  it("verifies a correctly solved nonce and consumes the challenge", () => {
    const challenge = issueCaptchaChallenge({ difficulty: 10 })
    const nonce = solve(challenge.prefix, 10)

    expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce })).toBe(true)
    // Single-use: replaying the same solution fails.
    expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce })).toBe(false)
  })

  it("rejects wrong nonces, malformed input, and unknown challenges", () => {
    const challenge = issueCaptchaChallenge({ difficulty: 10 })
    const nonce = solve(challenge.prefix, 10)
    const wrong = String(Number(nonce) + 1)

    expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce: wrong })).toBe(false)
    expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce: "abc" })).toBe(false)
    expect(verifyCaptchaSolution({ challengeId: "nope", nonce })).toBe(false)
    expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce: 42 })).toBe(false)
  })

  it("expires challenges after the TTL", () => {
    const start = 1_000_000
    const challenge = issueCaptchaChallenge({ now: start, difficulty: 4 })
    const nonce = solve(challenge.prefix, 4)

    expect(
      verifyCaptchaSolution({
        challengeId: challenge.challengeId,
        nonce,
        now: start + CAPTCHA_CHALLENGE_TTL_MS + 1,
      }),
    ).toBe(false)
  })

  it("burns a challenge after too many failed attempts", () => {
    const challenge = issueCaptchaChallenge({ difficulty: 20 })
    // 20 bits is infeasible to solve in a test; every guess fails.
    for (let i = 0; i < CAPTCHA_MAX_ATTEMPTS; i += 1) {
      expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce: String(i) })).toBe(
        false,
      )
    }
    // Even a (hypothetically) correct nonce is rejected once the challenge is gone.
    expect(verifyCaptchaSolution({ challengeId: challenge.challengeId, nonce: "0" })).toBe(false)
  })
})

describe("captcha tokens", () => {
  it("round-trips a signed token and rejects tampering", () => {
    const { token, expiresAt } = createCaptchaToken("abcdef0123456789")
    expect(isCaptchaTokenValid(token)).toBe(true)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    // `isCaptchaTokenValid` consumes the token like `verifyCaptchaToken`.
    const second = createCaptchaToken("abcdef0123456789")
    expect(verifyCaptchaToken(second.token)).toBe("abcdef0123456789")

    const tampered = `${token.slice(0, -2)}xx`
    expect(verifyCaptchaToken(tampered)).toBeNull()
    expect(verifyCaptchaToken("not-a-token")).toBeNull()
    expect(verifyCaptchaToken(null)).toBeNull()
    expect(verifyCaptchaToken(123)).toBeNull()
  })

  it("burns a token on first successful verification (single-use)", () => {
    const { token } = createCaptchaToken("abcdef0123456789")
    expect(verifyCaptchaToken(token)).toBe("abcdef0123456789")
    // Replay within the TTL is rejected.
    expect(verifyCaptchaToken(token)).toBeNull()
    expect(isCaptchaTokenValid(token)).toBe(false)
    // A freshly minted token still verifies.
    const second = createCaptchaToken("abcdef0123456789")
    expect(verifyCaptchaToken(second.token)).toBe("abcdef0123456789")
  })

  it("rejects expired tokens", () => {
    const now = Date.now()
    const expired = createCaptchaToken("abcdef0123456789", now)
    expect(verifyCaptchaToken(expired.token, now + CAPTCHA_TOKEN_TTL_MS + 1_000)).toBeNull()

    const fresh = createCaptchaToken("abcdef0123456789", now)
    expect(verifyCaptchaToken(fresh.token, now + 1_000)).toBe("abcdef0123456789")
  })
})
