import { describe, expect, it } from "vitest"

import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  hashBackupCode,
  normalizeBackupCode,
  verifyTotpCode,
} from "./totp"

// RFC 4648 base32 test vector for "foo".
const BASE32_VECTOR = "MZXW6==="

describe("base32", () => {
  it("encodes and decodes round-trip", () => {
    const bytes = new Uint8Array([0x66, 0x6f, 0x6f, 0xde, 0xad, 0xbe, 0xef])
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
  })

  it("decodes the RFC 4648 vector", () => {
    expect([...base32Decode(BASE32_VECTOR)]).toEqual([0x66, 0x6f, 0x6f])
    // "f" alone encodes as MY======.
    expect([...base32Decode("MY======")]).toEqual([0x66])
    // Encoder emits unpadded base32 (secrets are stored/shown without "=").
    expect(base32Encode(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe("MZXW6")
  })
})

describe("totp (RFC 6238)", () => {
  // ASCII secret "12345678901234567890" -> base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

  it("matches RFC 6238 test vectors (SHA-1, 8 digits -> truncated to 6)", async () => {
    // T = 59s -> counter 1 -> 94287082 (8-digit); 6-digit form is 287082.
    await expect(generateTotpCode(SECRET, { now: 59_000, digits: 8 })).resolves.toBe("94287082")
    await expect(generateTotpCode(SECRET, { now: 59_000 })).resolves.toBe("287082")
    // T = 1111111109 -> 07081804 -> 081804
    await expect(generateTotpCode(SECRET, { now: 1_111_111_109_000, digits: 8 })).resolves.toBe(
      "07081804",
    )
    // T = 1234567890 -> 89005924 -> 005924
    await expect(generateTotpCode(SECRET, { now: 1_234_567_890_000 })).resolves.toBe("005924")
  })

  it("verifies a current code and rejects wrong ones", async () => {
    const now = Date.now()
    const code = await generateTotpCode(SECRET, { now })
    await expect(verifyTotpCode(SECRET, code, { now })).resolves.toBe(true)
    await expect(verifyTotpCode(SECRET, "000000", { now })).resolves.toBe(false)
  })

  it("accepts codes within the drift window", async () => {
    const now = 1_700_000_000_000
    const pastCode = await generateTotpCode(SECRET, { now: now - 30_000 })
    await expect(verifyTotpCode(SECRET, pastCode, { now })).resolves.toBe(true)
    const farCode = await generateTotpCode(SECRET, { now: now - 90_000 })
    await expect(verifyTotpCode(SECRET, farCode, { now })).resolves.toBe(false)
  })

  it("rejects malformed codes", async () => {
    await expect(verifyTotpCode(SECRET, "abcdef", { now: Date.now() })).resolves.toBe(false)
    await expect(verifyTotpCode(SECRET, "", { now: Date.now() })).resolves.toBe(false)
  })

  it("generates 32-char base32 secrets", () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(() => base32Decode(secret)).not.toThrow()
  })

  it("builds an otpauth provisioning URI", () => {
    const uri = buildOtpAuthUri({ secret: SECRET, accountName: "user@lab.edu" })
    expect(uri).toContain("otpauth://totp/")
    expect(uri).toContain("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
    expect(uri).toContain("Spindle")
    expect(uri).toContain("digits=6")
    expect(uri).toContain("period=30")
  })
})

describe("backup codes", () => {
  it("generates the requested count of unique formatted codes", () => {
    const codes = generateBackupCodes(8)
    expect(codes).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  it("normalizes user input for comparison", () => {
    expect(normalizeBackupCode(" abcd-1234 ")).toBe("ABCD1234")
    expect(normalizeBackupCode("wxyz 9876")).toBe("WXYZ9876")
  })

  it("hashes codes deterministically", async () => {
    const hash = await hashBackupCode("ABCD-1234")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    await expect(hashBackupCode("abcd1234")).resolves.toBe(hash)
    await expect(hashBackupCode("ABCD-5678")).resolves.not.toBe(hash)
  })
})
