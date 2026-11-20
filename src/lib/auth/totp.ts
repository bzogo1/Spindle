/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits) plus backup-code helpers.
 *
 * Isomorphic WebCrypto implementation — no heavy dependency. The same module
 * runs in the browser (enrollment preview, optional client checks) and on the
 * server (authoritative verification in route handlers). Server code should
 * still treat client-side results as advisory only.
 *
 * Secret encoding is base32 (RFC 4648, no padding) so secrets can be shown to
 * users and typed into authenticator apps.
 */

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
export const TOTP_WINDOW = 1 // accept codes one step either side of now

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(input: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ""
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "")
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error("Invalid base32 character in TOTP secret.")
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(output)
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** 160-bit random secret, base32-encoded (32 chars). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function hotp(secretBytes: Uint8Array, counter: number, digits: number): Promise<string> {
  // 8-byte big-endian counter.
  const message = new Uint8Array(8)
  let remaining = counter
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }

  return crypto.subtle
    .importKey("raw", secretBytes as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
    .then((key) => crypto.subtle.sign("HMAC", key, message as BufferSource))
    .then((signature) => {
      const view = new DataView(signature)
      const offset = view.getUint8(signature.byteLength - 1) & 0x0f
      const binary =
        ((view.getUint8(offset) & 0x7f) << 24) |
        (view.getUint8(offset + 1) << 16) |
        (view.getUint8(offset + 2) << 8) |
        view.getUint8(offset + 3)
      return String(binary % 10 ** digits).padStart(digits, "0")
    })
}

export type TotpOptions = {
  stepSeconds?: number
  digits?: number
  /** Injectable clock for tests; milliseconds since epoch. */
  now?: number
}

/** Current TOTP code for a base32 secret. */
export async function generateTotpCode(secret: string, options: TotpOptions = {}): Promise<string> {
  const step = options.stepSeconds ?? TOTP_STEP_SECONDS
  const digits = options.digits ?? TOTP_DIGITS
  const now = options.now ?? Date.now()
  const counter = Math.floor(now / 1000 / step)
  return hotp(base32Decode(secret), counter, digits)
}

/**
 * Verifies a user-supplied code, accepting `window` steps of clock drift on
 * either side (default ±1 step = ±30s).
 */
export async function verifyTotpCode(
  secret: string,
  code: string,
  options: TotpOptions & { window?: number } = {},
): Promise<boolean> {
  const normalized = code.replace(/\s/g, "")
  if (!/^\d+$/.test(normalized)) return false
  const step = options.stepSeconds ?? TOTP_STEP_SECONDS
  const digits = options.digits ?? TOTP_DIGITS
  const window = options.window ?? TOTP_WINDOW
  const now = options.now ?? Date.now()
  const counter = Math.floor(now / 1000 / step)
  const secretBytes = base32Decode(secret)

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await hotp(secretBytes, counter + offset, digits)
    // Constant-time-ish compare: length is fixed, still compare every char.
    if (candidate.length === normalized.length) {
      let diff = 0
      for (let i = 0; i < candidate.length; i += 1) {
        diff |= candidate.charCodeAt(i) ^ normalized.charCodeAt(i)
      }
      if (diff === 0) return true
    }
  }
  return false
}

/** `otpauth://` provisioning URI for authenticator apps. */
export function buildOtpAuthUri(params: {
  secret: string
  accountName: string
  issuer?: string
}): string {
  const issuer = params.issuer ?? "Spindle"
  const label = encodeURIComponent(`${issuer}:${params.accountName}`)
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${query.toString()}`
}

export const BACKUP_CODE_COUNT = 8

function backupCodeAlphabet(): string {
  // Unambiguous alphabet: no 0/O, 1/I/L.
  return "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
}

/** Human-friendly `xxxx-xxxx` backup codes, cryptographically random. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const alphabet = backupCodeAlphabet()
  const codes = new Set<string>()
  while (codes.size < count) {
    const bytes = randomBytes(8)
    let raw = ""
    for (const byte of bytes) raw += alphabet[byte % alphabet.length]
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`)
  }
  return [...codes]
}

/** Normalizes user input: uppercase, strip spaces/dashes. */
export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "")
}

/** SHA-256 hex digest used to store backup codes hashed at rest. */
export async function hashBackupCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeBackupCode(code)),
  )
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
