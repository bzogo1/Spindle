// @vitest-environment node
import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it } from "vitest"

import { issueCaptchaChallenge, resetCaptchaStoreForTests } from "@/lib/captcha"
import { POST } from "./route"

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/captcha/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.8.8.${ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function leadingZeroBits(digest: Buffer): number {
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    for (let mask = 0x80; mask !== 0; mask >>= 1) {
      if (byte & mask) return bits
      bits += 1
    }
    return bits
  }
  return bits
}

function solve(prefix: string, bits: number): string {
  for (let nonce = 0; ; nonce += 1) {
    const digest = createHash("sha256").update(`${prefix}${nonce}`, "utf8").digest()
    if (leadingZeroBits(digest) >= bits) return String(nonce)
  }
}

beforeEach(() => {
  resetCaptchaStoreForTests()
})

describe("POST /api/auth/captcha/verify", () => {
  it("mints a captcha token for a solved challenge", async () => {
    const challenge = issueCaptchaChallenge({ difficulty: 8 })
    const nonce = solve(challenge.prefix, 8)

    const response = await post({ challengeId: challenge.challengeId, nonce })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(typeof body.token).toBe("string")
    expect(body.token.split(".")).toHaveLength(3)
  })

  it("rejects unsolved challenges with captcha_failed", async () => {
    const challenge = issueCaptchaChallenge({ difficulty: 12 })
    const response = await post({ challengeId: challenge.challengeId, nonce: "0" })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "captcha_failed" })
  })

  it("rejects replayed solutions (single-use)", async () => {
    const challenge = issueCaptchaChallenge({ difficulty: 6 })
    const nonce = solve(challenge.prefix, 6)

    expect((await post({ challengeId: challenge.challengeId, nonce })).status).toBe(200)
    expect((await post({ challengeId: challenge.challengeId, nonce })).status).toBe(403)
  })

  it("rejects malformed bodies and cross-origin requests", async () => {
    expect((await post({})).status).toBe(403)
    expect((await post({ challengeId: "x", nonce: "1" })).status).toBe(403)

    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/captcha/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.8.8.99",
        },
        body: JSON.stringify({ challengeId: "x", nonce: "1" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
  })
})
