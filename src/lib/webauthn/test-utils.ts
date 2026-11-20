/**
 * TEST-ONLY helpers: a minimal CBOR encoder and WebAuthn ceremony fixtures.
 *
 * `cbor.ts` intentionally ships decode-only (production never encodes CBOR).
 * Tests need to *construct* attestationObjects, authData, and COSE keys, so
 * the encoder lives here. Nothing in `src/` outside `*.test.ts` files should
 * import this module.
 */

import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto"

import { base64urlEncode } from "./types"

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (definite lengths only — everything WebAuthn emits).
// ---------------------------------------------------------------------------

export type Encoded =
  number | bigint | string | Uint8Array | boolean | null | Encoded[] | Map<Encoded, Encoded>

function head(major: number, arg: number): number[] {
  if (arg < 24) return [(major << 5) | arg]
  if (arg < 256) return [(major << 5) | 24, arg]
  if (arg < 65536) return [(major << 5) | 25, arg >> 8, arg & 0xff]
  return [
    (major << 5) | 26,
    (arg >>> 24) & 0xff,
    (arg >>> 16) & 0xff,
    (arg >>> 8) & 0xff,
    arg & 0xff,
  ]
}

export function encodeCbor(value: Encoded): Uint8Array {
  if (value === null) return new Uint8Array([0xf6])
  if (value === true) return new Uint8Array([0xf5])
  if (value === false) return new Uint8Array([0xf4])
  if (typeof value === "number" || typeof value === "bigint") {
    const n = typeof value === "bigint" ? value : BigInt(value)
    if (n >= 0n) return new Uint8Array(head(0, Number(n)))
    // Negative int: value = -1 - n
    return new Uint8Array(head(1, Number(-1n - n)))
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value)
    return concatBytes(new Uint8Array(head(3, bytes.length)), bytes)
  }
  if (value instanceof Uint8Array) {
    return concatBytes(new Uint8Array(head(2, value.length)), value)
  }
  if (Array.isArray(value)) {
    const parts: Uint8Array[] = [new Uint8Array(head(4, value.length))]
    for (const item of value) parts.push(encodeCbor(item))
    return concatBytes(...parts)
  }
  if (value instanceof Map) {
    const parts: Uint8Array[] = [new Uint8Array(head(5, value.size))]
    for (const [k, v] of value) {
      parts.push(encodeCbor(k), encodeCbor(v))
    }
    return concatBytes(...parts)
  }
  throw new Error("Unsupported CBOR value")
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// ---------------------------------------------------------------------------
// WebAuthn fixtures
// ---------------------------------------------------------------------------

export const TEST_RP_ID = "localhost"
export const TEST_ORIGIN = "http://localhost"
export const TEST_CHALLENGE_B64 = base64urlEncode("test-challenge-32-bytes-aaaaaaaaaaaa")

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToB64(bytes: Uint8Array): string {
  return base64urlEncode(bytes)
}

export function clientDataJSON(
  type: string,
  challengeB64 = TEST_CHALLENGE_B64,
  origin = TEST_ORIGIN,
) {
  return new TextEncoder().encode(
    JSON.stringify({ type, challenge: challengeB64, origin, crossOrigin: false }),
  )
}

export type TestEcKey = {
  privateKey: KeyObject
  /** Raw COSE_Key bytes (EC2/P-256, alg ES256). */
  coseBytes: Uint8Array
  coseB64: string
}

/** Generates a real P-256 keypair and encodes its public half as COSE_Key. */
export function makeEcKey(): TestEcKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string }
  const cose = encodeCbor(
    new Map<Encoded, Encoded>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, b64ToBytes(jwk.x)],
      [-3, b64ToBytes(jwk.y)],
    ]),
  )
  return { privateKey, coseBytes: cose, coseB64: bytesToB64(cose) }
}

const FLAG_UP = 0x01
const FLAG_AT = 0x40

export type AuthDataOptions = {
  rpId?: string
  flags?: number
  signCount?: number
  credentialId?: Uint8Array
  coseBytes?: Uint8Array
  aaguid?: Uint8Array
}

/** Builds authenticatorData bytes for tests. */
export function makeAuthData(options: AuthDataOptions = {}): Uint8Array {
  const rpId = options.rpId ?? TEST_RP_ID
  const flags = options.flags ?? FLAG_UP | FLAG_AT
  const signCount = options.signCount ?? 0
  const rpIdHash = new Uint8Array(createHash("sha256").update(rpId, "utf8").digest())

  const head = new Uint8Array(37)
  head.set(rpIdHash, 0)
  head[32] = flags
  new DataView(head.buffer).setUint32(33, signCount)

  if ((flags & FLAG_AT) === 0) return head

  const credentialId = options.credentialId ?? new Uint8Array(16).fill(7)
  const cose = options.coseBytes ?? makeEcKey().coseBytes
  const aaguid = options.aaguid ?? new Uint8Array(16)

  const credLen = new Uint8Array(2)
  new DataView(credLen.buffer).setUint16(0, credentialId.length)

  return concatBytes(head, aaguid, credLen, credentialId, cose)
}

/** Builds a CBOR attestationObject with fmt "none". */
export function makeAttestationObject(
  authData: Uint8Array,
  fmt = "none",
  attStmt: Map<Encoded, Encoded> = new Map(),
): Uint8Array {
  return encodeCbor(
    new Map<Encoded, Encoded>([
      ["fmt", fmt],
      ["attStmt", attStmt],
      ["authData", authData],
    ]),
  )
}

export type RegistrationFixture = {
  credentialJSON: Record<string, unknown>
  key: TestEcKey
  credentialIdBytes: Uint8Array
  challengeB64: string
}

/**
 * Builds a complete registration credential JSON (the shape
 * `PublicKeyCredential.toJSON()` produces) for a "none" attestation.
 */
export function makeRegistrationFixture(
  overrides: {
    rpId?: string
    origin?: string
    challengeB64?: string
    credentialId?: Uint8Array
    signCount?: number
    fmt?: string
    flags?: number
  } = {},
): RegistrationFixture {
  const challengeB64 = overrides.challengeB64 ?? TEST_CHALLENGE_B64
  const key = makeEcKey()
  const credentialIdBytes = overrides.credentialId ?? new Uint8Array(16).fill(3)
  const authData = makeAuthData({
    rpId: overrides.rpId,
    flags: overrides.flags,
    signCount: overrides.signCount,
    credentialId: credentialIdBytes,
    coseBytes: key.coseBytes,
  })
  const attestationObject = makeAttestationObject(authData, overrides.fmt)
  const clientData = clientDataJSON("webauthn.create", challengeB64, overrides.origin)
  const credentialIdB64 = bytesToB64(credentialIdBytes)

  return {
    key,
    credentialIdBytes,
    challengeB64,
    credentialJSON: {
      id: credentialIdB64,
      rawId: credentialIdB64,
      type: "public-key",
      response: {
        clientDataJSON: bytesToB64(clientData),
        attestationObject: bytesToB64(attestationObject),
        transports: ["usb", "nfc"],
      },
      authenticatorAttachment: "cross-platform",
      clientExtensionResults: {},
    },
  }
}

export type AssertionFixture = {
  credentialJSON: Record<string, unknown>
  key: TestEcKey
  credentialIdBytes: Uint8Array
  challengeB64: string
  signCount: number
}

/**
 * Builds a complete authentication credential JSON with a REAL ECDSA
 * signature over `authData || SHA-256(clientDataJSON)` — verification in
 * `assertion.ts` exercises actual `node:crypto` signature checking.
 */
export function makeAssertionFixture(
  key: TestEcKey,
  options: {
    rpId?: string
    origin?: string
    challengeB64?: string
    credentialId?: Uint8Array
    signCount?: number
    storedCounter?: number
    tamper?: boolean
    /** UTF-8 user id echoed as the assertion's userHandle (passkey flow). */
    userHandle?: string
  } = {},
): AssertionFixture {
  const challengeB64 = options.challengeB64 ?? TEST_CHALLENGE_B64
  const credentialIdBytes = options.credentialId ?? new Uint8Array(16).fill(3)
  const signCount = options.signCount ?? (options.storedCounter ?? 0) + 1
  // Assertions carry no attested credential data (AT flag clear).
  const assertionAuthData = makeAuthData({
    rpId: options.rpId,
    flags: FLAG_UP,
    signCount,
  })

  const clientData = clientDataJSON("webauthn.get", challengeB64, options.origin)
  const signed = Buffer.concat([
    Buffer.from(assertionAuthData),
    createHash("sha256").update(clientData).digest(),
  ])
  let signature = cryptoSign("sha256", signed, key.privateKey)
  if (options.tamper) signature = Buffer.concat([signature, Buffer.from([0])])

  const credentialIdB64 = bytesToB64(credentialIdBytes)
  return {
    key,
    credentialIdBytes,
    challengeB64,
    signCount,
    credentialJSON: {
      id: credentialIdB64,
      rawId: credentialIdB64,
      type: "public-key",
      response: {
        clientDataJSON: bytesToB64(clientData),
        authenticatorData: bytesToB64(assertionAuthData),
        signature: bytesToB64(new Uint8Array(signature)),
        userHandle:
          options.userHandle === undefined
            ? null
            : bytesToB64(new TextEncoder().encode(options.userHandle)),
      },
    },
  }
}
