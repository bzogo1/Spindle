/**
 * Minimal COSE_Key parsing for the credential types this implementation
 * supports.
 *
 * SUPPORTED: EC2 keys (kty=2) on the P-256 curve (crv=1) used with the
 * ES256 algorithm (alg=-7). This is what every FIDO2 security key produces
 * for WebAuthn. RSA (kty=3), OKP/Ed25519 (kty=1), and non-P-256 curves
 * (P-384, secp256k1) return null — registration rejects them with a clear
 * error rather than silently storing an unverifiable key.
 *
 * COSE map labels used here (RFC 8152 / WebAuthn §6.5.1.7):
 *   1 = kty, 3 = alg, -1 = crv, -2 = x, -3 = y
 */

import { decodeCborItem, type CborValue } from "./cbor"
import { base64urlEncode } from "./types"

import type { JsonWebKey as NodeJsonWebKey } from "node:crypto"

export const COSE_KTY_EC2 = 2
export const COSE_CRV_P256 = 1
export const COSE_ALG_ES256 = -7

export type Ec2PublicKey = {
  kty: typeof COSE_KTY_EC2
  alg: number
  crv: typeof COSE_CRV_P256
  /** 32-byte X coordinate. */
  x: Uint8Array
  /** 32-byte Y coordinate. */
  y: Uint8Array
}

function bytes(value: CborValue | undefined): Uint8Array | null {
  return value instanceof Uint8Array ? value : null
}

/**
 * Parses a COSE_Key byte string. Returns the EC2/P-256 key plus the offset
 * just past the item so callers embedding the key in `authData` can find
 * trailing extensions.
 */
export function parseCoseEc2Key(
  data: Uint8Array,
  offset = 0,
): { key: Ec2PublicKey; next: number } | null {
  let item: { value: CborValue; next: number }
  try {
    item = decodeCborItem(data, offset)
  } catch {
    return null
  }
  const { value, next } = item
  if (!(value instanceof Map)) return null

  const kty = value.get(1)
  const alg = value.get(3)
  const crv = value.get(-1)
  const x = bytes(value.get(-2))
  const y = bytes(value.get(-3))

  if (kty !== COSE_KTY_EC2 || crv !== COSE_CRV_P256) return null
  if (typeof alg !== "number" || alg !== COSE_ALG_ES256) return null
  if (!x || !y || x.length !== 32 || y.length !== 32) return null

  return { key: { kty, alg, crv, x, y }, next }
}

/**
 * Converts the parsed key into the JWK shape `node:crypto`'s `verify`
 * accepts for ECDSA P-256. WebAuthn signatures are ASN.1 DER, which is
 * `node:crypto`'s default `dsaEncoding` — callers must NOT pass
 * `ieee-p1363` (raw r||s) here.
 */
export function coseKeyToJwk(key: Ec2PublicKey): NodeJsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: base64urlEncode(key.x),
    y: base64urlEncode(key.y),
    ext: true,
  }
}
