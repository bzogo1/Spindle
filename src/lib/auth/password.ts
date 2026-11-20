import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

/**
 * Password hashing with scrypt (Node built-in, memory-hard). Format:
 * `scrypt$N$r$p$<salt-b64url>$<hash-b64url>` so parameters can evolve.
 * Server-only — never import from client components.
 */

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
// scrypt's default maxmem (32MB) is too small for N=16384,r=8,p=1 (~16MB ok,
// but headroom avoids platform surprises).
const MAX_MEM = 64 * 1024 * 1024

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [, n, r, p, saltB64, hashB64] = parts
  const salt = Buffer.from(saltB64, "base64url")
  const expected = Buffer.from(hashB64, "base64url")

  let derived: Buffer
  try {
    derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    })
  } catch {
    return false
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
