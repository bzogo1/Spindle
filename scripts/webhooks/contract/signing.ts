import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Webhook signature contract (Stripe-style).
 *
 * The `Webhook-Signature` header carries a unix timestamp and one or more
 * hex-encoded HMAC-SHA256 signatures:
 *
 *   Webhook-Signature: t=1700000000,v1=<hex>[,v1=<hex>…]
 *
 * The signed content is `${t}.${rawBody}` — the raw request body bytes as a
 * UTF-8 string, NEVER the re-serialized JSON. Receivers must verify against
 * the exact bytes received.
 *
 * Multiple `v1` signatures exist so a sender can sign with both the current
 * and previous secret during a key rotation; a receiver configured with a
 * keyring accepts either. Timestamps older (or newer) than
 * {@link SIGNATURE_TOLERANCE_SECONDS} are rejected to bound replay windows.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300

export type SignatureVerification =
  | { ok: true; timestamp: number }
  | {
      ok: false
      reason:
        | "malformed_header"
        | "missing_signature"
        | "timestamp_out_of_tolerance"
        | "no_matching_signature"
    }

/** HMAC-SHA256 hex digest of `${timestamp}.${rawBody}`. */
export function signPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`, "utf8").digest("hex")
}

/** Builds a full `Webhook-Signature` header value for `rawBody`. */
export function buildSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestampSeconds},v1=${signPayload(secret, timestampSeconds, rawBody)}`
}

export type ParsedSignatureHeader = {
  timestamp: number
  /** All `v1=` signatures in order; more than one means key rotation. */
  signatures: string[]
}

/** Parses `t=…,v1=…,v1=…` into its parts; returns null when malformed. */
export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | null = null
  const signatures: string[] = []

  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq === -1) return null
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === "t") {
      if (!/^\d+$/.test(value)) return null
      timestamp = Number.parseInt(value, 10)
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null
      signatures.push(value.toLowerCase())
    }
    // Unknown keys are ignored for forward compatibility.
  }

  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

function safeHexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

export type VerifySignatureOptions = {
  /** Raw request body exactly as received (utf8). */
  rawBody: string
  /** Value of the `Webhook-Signature` header. */
  signatureHeader: string | undefined
  /**
   * Secrets to accept, checked in order — pass `[current, previous]` during
   * a rotation. Any match verifies.
   */
  secrets: readonly string[]
  /** Reference "now" in unix seconds; defaults to the wall clock. */
  nowSeconds?: number
  /** Max |now - t| in seconds. Defaults to {@link SIGNATURE_TOLERANCE_SECONDS}. */
  toleranceSeconds?: number
}

/**
 * Verifies a webhook signature end-to-end: header shape, timestamp
 * freshness, and HMAC match against any of `secrets`.
 */
export function verifySignatureHeader(options: VerifySignatureOptions): SignatureVerification {
  const {
    rawBody,
    signatureHeader,
    secrets,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
  } = options

  if (!signatureHeader) {
    return { ok: false, reason: "missing_signature" }
  }

  const parsed = parseSignatureHeader(signatureHeader)
  if (!parsed) {
    return { ok: false, reason: "malformed_header" }
  }

  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" }
  }

  for (const secret of secrets) {
    const expected = signPayload(secret, parsed.timestamp, rawBody)
    if (parsed.signatures.some((candidate) => safeHexEqual(candidate, expected))) {
      return { ok: true, timestamp: parsed.timestamp }
    }
  }

  return { ok: false, reason: "no_matching_signature" }
}
