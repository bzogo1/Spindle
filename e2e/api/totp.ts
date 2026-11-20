import { createHmac } from "node:crypto"

/**
 * RFC 6238 TOTP helpers shared by the 2FA contract specs
 * (`auth-2fa.spec.ts`, `auth-2fa-recovery.spec.ts`). Mirrors the server-side
 * parameters in `src/lib/auth/totp.ts`: HMAC-SHA1, 30s step, 6 digits,
 * ±1 verification window.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "")
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) throw new Error(`Invalid base32 character: ${char}`)
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

/** Current (or `at`-offset) 6-digit TOTP code for a base32 secret. */
export function totpCode(base32Secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac("sha1", Buffer.from(base32Decode(base32Secret)))
    .update(message)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, "0")
}
