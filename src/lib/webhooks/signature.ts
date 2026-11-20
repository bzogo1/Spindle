import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Inbound webhook signature verification.
 *
 * Pure, transport-agnostic helpers for the signature schemes real webhook
 * providers use. Every verifier takes the RAW request body bytes (utf8
 * string) plus the signature header value(s) and one or more candidate
 * secrets; verification is HMAC-based and all comparisons are
 * constant-time.
 *
 * Schemes supported ({@link WebhookSignatureScheme}):
 *
 *  - `"stripe"`  — `Webhook-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]` over
 *    `${t}.${rawBody}`. Multiple `v1` values exist so senders can sign with
 *    current AND previous secrets during rotation. Mirrors
 *    `scripts/webhooks/contract/signing.ts`, which remains the outbound
 *    contract implementation.
 *  - `"github"`  — `X-Hub-Signature-256: sha256=<hex>` over `rawBody`.
 *    No timestamp; replay protection must come from TLS + idempotency keys.
 *  - `"slack"`   — `X-Slack-Signature: v0=<hex>` over
 *    `v0:<X-Slack-Request-Timestamp>:<rawBody>`, with a timestamp tolerance.
 *  - `"generic"` — HMAC-SHA256 over `rawBody` in a caller-chosen encoding
 *    (hex default), optionally with a provider-style `sha256=` prefix on
 *    the wire value.
 *
 * Secrets are passed as a list (`[current, previous]` during rotation);
 * ANY match verifies, and new signatures should only ever be produced with
 * the first (current) secret.
 */

/** Default replay-protection window, matching the contract suite. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

export type WebhookSignatureScheme = "stripe" | "github" | "slack" | "generic"

export type SignatureEncoding = "hex" | "base64" | "base64url"

export type SignatureVerification =
  | { ok: true; timestamp?: number; matchedSecretIndex: number }
  | {
      ok: false
      reason:
        | "missing_signature"
        | "missing_timestamp"
        | "malformed_header"
        | "timestamp_out_of_tolerance"
        | "no_matching_signature"
    }

/* ------------------------------------------------------------------ */
/* Low-level primitives                                                 */
/* ------------------------------------------------------------------ */

/** Raw HMAC-SHA256 of `data` under `secret`, as a Buffer. */
export function hmacSha256Bytes(secret: string, data: string | Buffer): Buffer {
  return createHmac("sha256", secret).update(data).digest()
}

/** HMAC-SHA256 of `data` under `secret` in the requested encoding. */
export function hmacSha256(
  secret: string,
  data: string | Buffer,
  encoding: SignatureEncoding = "hex",
): string {
  return hmacSha256Bytes(secret, data).toString(encoding)
}

/**
 * Constant-time string comparison. Returns false immediately on length
 * mismatch (length is not secret for fixed-size digests); otherwise uses
 * `crypto.timingSafeEqual`.
 */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Constant-time comparison of a presented signature against the expected
 * digest. Accepts the digest in any supported encoding — the candidate is
 * decoded back to bytes so `sha256=` prefixes, case differences, and
 * encoding mismatches don't leak through timing.
 */
export function signatureMatches(
  expectedBytes: Buffer,
  presented: string,
  encoding: SignatureEncoding = "hex",
): boolean {
  const trimmed = presented.trim()
  // Hex digests are case-insensitive on the wire; base64/base64url are not.
  const normalized = encoding === "hex" ? trimmed.toLowerCase() : trimmed
  let candidate: Buffer
  try {
    candidate = Buffer.from(normalized, encoding)
  } catch {
    return false
  }
  // Buffer.from with an encoding never throws for invalid chars in node —
  // it silently truncates. Guard by re-encoding: a canonical digest must
  // round-trip to itself.
  if (candidate.length !== expectedBytes.length) return false
  if (candidate.toString(encoding) !== normalized) return false
  return timingSafeEqual(candidate, expectedBytes)
}

/* ------------------------------------------------------------------ */
/* Stripe-style: t=<unix>,v1=<hex>                                      */
/* ------------------------------------------------------------------ */

export type ParsedStripeSignatureHeader = {
  /** Unix seconds timestamp from the `t=` field. */
  timestamp: number
  /** All `v1=` signatures in wire order; >1 means sender-side rotation. */
  signatures: string[]
}

/**
 * Parses `t=…,v1=…,v1=…`. Returns null on malformed input. Unknown keys are
 * ignored for forward compatibility, matching the contract implementation.
 */
export function parseStripeSignatureHeader(header: string): ParsedStripeSignatureHeader | null {
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
      if (!Number.isSafeInteger(timestamp)) return null
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null
      signatures.push(value.toLowerCase())
    }
  }

  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

/** HMAC-SHA256 hex of `${timestampSeconds}.${rawBody}` — the Stripe signed payload. */
export function signStripePayload(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  return hmacSha256(secret, `${timestampSeconds}.${rawBody}`, "hex")
}

/** Builds a `Webhook-Signature` header value (`t=…,v1=…`). */
export function buildStripeSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestampSeconds},v1=${signStripePayload(secret, timestampSeconds, rawBody)}`
}

export type VerifyStripeOptions = {
  /** Raw request body exactly as received (utf8). */
  rawBody: string
  /** Value of the `Webhook-Signature` header. */
  signatureHeader: string | undefined
  /** Candidate secrets; ANY match verifies (rotation). */
  secrets: readonly string[]
  /** Reference "now" in unix seconds; defaults to wall clock. */
  nowSeconds?: number
  /** Max |now - t| in seconds. Default {@link SIGNATURE_TOLERANCE_SECONDS}. */
  toleranceSeconds?: number
}

export function verifyStripeSignature(options: VerifyStripeOptions): SignatureVerification {
  const {
    rawBody,
    signatureHeader,
    secrets,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
  } = options

  if (!signatureHeader) return { ok: false, reason: "missing_signature" }

  const parsed = parseStripeSignatureHeader(signatureHeader)
  if (!parsed) return { ok: false, reason: "malformed_header" }

  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" }
  }

  for (let i = 0; i < secrets.length; i += 1) {
    const expected = hmacSha256Bytes(secrets[i], `${parsed.timestamp}.${rawBody}`)
    if (parsed.signatures.some((candidate) => signatureMatches(expected, candidate, "hex"))) {
      return { ok: true, timestamp: parsed.timestamp, matchedSecretIndex: i }
    }
  }

  return { ok: false, reason: "no_matching_signature" }
}

/* ------------------------------------------------------------------ */
/* GitHub-style: sha256=<hex-hmac(rawBody)>                            */
/* ------------------------------------------------------------------ */

/** Builds an `X-Hub-Signature-256` header value. */
export function buildGitHubSignatureHeader(secret: string, rawBody: string): string {
  return `sha256=${hmacSha256(secret, rawBody, "hex")}`
}

export type VerifyGitHubOptions = {
  rawBody: string
  /** Value of the `X-Hub-Signature-256` header. */
  signatureHeader: string | undefined
  secrets: readonly string[]
}

export function verifyGitHubSignature(options: VerifyGitHubOptions): SignatureVerification {
  const { rawBody, signatureHeader, secrets } = options
  if (!signatureHeader) return { ok: false, reason: "missing_signature" }

  const trimmed = signatureHeader.trim()
  const eq = trimmed.indexOf("=")
  // Accept both `sha256=<hex>` and a bare hex digest for robustness.
  const presented =
    eq !== -1 && trimmed.slice(0, eq).toLowerCase() === "sha256"
      ? trimmed.slice(eq + 1).trim()
      : trimmed
  if (!/^[0-9a-f]{64}$/i.test(presented)) {
    return { ok: false, reason: "malformed_header" }
  }

  const bodyBytes = Buffer.from(rawBody, "utf8")
  for (let i = 0; i < secrets.length; i += 1) {
    const expected = hmacSha256Bytes(secrets[i], bodyBytes)
    if (signatureMatches(expected, presented, "hex")) {
      return { ok: true, matchedSecretIndex: i }
    }
  }

  return { ok: false, reason: "no_matching_signature" }
}

/* ------------------------------------------------------------------ */
/* Slack-style: v0=<hex-hmac(v0:ts:body)> + X-Slack-Request-Timestamp   */
/* ------------------------------------------------------------------ */

/** Slack signing basestring: `v0:<timestamp>:<rawBody>`. */
export function slackSigningPayload(timestamp: string | number, rawBody: string): string {
  return `v0:${timestamp}:${rawBody}`
}

/** Builds an `X-Slack-Signature` header value. */
export function buildSlackSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const ts = String(timestampSeconds)
  return `v0=${hmacSha256(secret, slackSigningPayload(ts, rawBody), "hex")}`
}

export type VerifySlackOptions = {
  rawBody: string
  /** Value of the `X-Slack-Signature` header (`v0=<hex>`). */
  signatureHeader: string | undefined
  /** Value of the `X-Slack-Request-Timestamp` header (unix seconds). */
  timestampHeader: string | undefined
  secrets: readonly string[]
  nowSeconds?: number
  toleranceSeconds?: number
}

export function verifySlackSignature(options: VerifySlackOptions): SignatureVerification {
  const {
    rawBody,
    signatureHeader,
    timestampHeader,
    secrets,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
  } = options

  if (!signatureHeader) return { ok: false, reason: "missing_signature" }
  if (!timestampHeader || !/^\d+$/.test(timestampHeader.trim())) {
    return { ok: false, reason: "missing_timestamp" }
  }

  const timestamp = Number.parseInt(timestampHeader.trim(), 10)
  if (!Number.isSafeInteger(timestamp)) {
    return { ok: false, reason: "missing_timestamp" }
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" }
  }

  const eq = signatureHeader.indexOf("=")
  const presented =
    eq !== -1 && signatureHeader.slice(0, eq).trim().toLowerCase() === "v0"
      ? signatureHeader.slice(eq + 1).trim()
      : signatureHeader.trim()
  if (!/^[0-9a-f]{64}$/i.test(presented)) {
    return { ok: false, reason: "malformed_header" }
  }

  const payload = slackSigningPayload(timestampHeader.trim(), rawBody)
  for (let i = 0; i < secrets.length; i += 1) {
    const expected = hmacSha256Bytes(secrets[i], payload)
    if (signatureMatches(expected, presented, "hex")) {
      return { ok: true, timestamp, matchedSecretIndex: i }
    }
  }

  return { ok: false, reason: "no_matching_signature" }
}

/* ------------------------------------------------------------------ */
/* Generic raw-body HMAC                                               */
/* ------------------------------------------------------------------ */

export type GenericSignatureOptions = {
  /** Encoding of the wire signature. Default "hex". */
  encoding?: SignatureEncoding
  /**
   * Optional literal prefix on the wire value, e.g. "sha256=". When set,
   * the presented signature MUST start with it; it is stripped before
   * comparison.
   */
  prefix?: string
}

/** Signs `rawBody` with HMAC-SHA256 in the given encoding. */
export function signGeneric(
  secret: string,
  rawBody: string | Buffer,
  options: GenericSignatureOptions = {},
): string {
  const digest = hmacSha256(secret, rawBody, options.encoding ?? "hex")
  return options.prefix ? `${options.prefix}${digest}` : digest
}

export type VerifyGenericOptions = {
  rawBody: string | Buffer
  /** The signature value as received (prefix included when configured). */
  signature: string | undefined
  secrets: readonly string[]
  encoding?: SignatureEncoding
  prefix?: string
}

export function verifyGenericSignature(options: VerifyGenericOptions): SignatureVerification {
  const { rawBody, signature, secrets, encoding = "hex", prefix } = options

  if (!signature) return { ok: false, reason: "missing_signature" }

  let presented = signature.trim()
  if (prefix) {
    if (!presented.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { ok: false, reason: "malformed_header" }
    }
    presented = presented.slice(prefix.length).trim()
  }
  if (presented.length === 0) return { ok: false, reason: "malformed_header" }

  const bodyBytes = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody
  for (let i = 0; i < secrets.length; i += 1) {
    const expected = hmacSha256Bytes(secrets[i], bodyBytes)
    if (signatureMatches(expected, presented, encoding)) {
      return { ok: true, matchedSecretIndex: i }
    }
  }

  return { ok: false, reason: "no_matching_signature" }
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

export type VerifyWebhookSignatureOptions = {
  scheme: WebhookSignatureScheme
  rawBody: string | Buffer
  /** Primary signature header value (`Webhook-Signature`, `X-Hub-Signature-256`, `X-Slack-Signature`, or a bare digest). */
  signatureHeader?: string
  /** `X-Slack-Request-Timestamp` — required for scheme "slack". */
  timestampHeader?: string
  secrets: readonly string[]
  nowSeconds?: number
  toleranceSeconds?: number
  /** Generic-scheme options (encoding/prefix). Ignored by named schemes. */
  generic?: GenericSignatureOptions
}

/**
 * Verifies an inbound webhook signature for the given scheme. Returns a
 * discriminated result; callers should treat any `ok: false` as a 401 and
 * log `reason` (never log the signature or body).
 */
export function verifyWebhookSignature(
  options: VerifyWebhookSignatureOptions,
): SignatureVerification {
  const { scheme, rawBody } = options
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")

  switch (scheme) {
    case "stripe":
      return verifyStripeSignature({
        rawBody: body,
        signatureHeader: options.signatureHeader,
        secrets: options.secrets,
        nowSeconds: options.nowSeconds,
        toleranceSeconds: options.toleranceSeconds,
      })
    case "github":
      return verifyGitHubSignature({
        rawBody: body,
        signatureHeader: options.signatureHeader,
        secrets: options.secrets,
      })
    case "slack":
      return verifySlackSignature({
        rawBody: body,
        signatureHeader: options.signatureHeader,
        timestampHeader: options.timestampHeader,
        secrets: options.secrets,
        nowSeconds: options.nowSeconds,
        toleranceSeconds: options.toleranceSeconds,
      })
    case "generic":
      return verifyGenericSignature({
        rawBody,
        signature: options.signatureHeader,
        secrets: options.secrets,
        encoding: options.generic?.encoding,
        prefix: options.generic?.prefix,
      })
  }
}

/** Signs `rawBody` for outbound delivery/testing in the given scheme. */
export function signWebhookSignature(
  scheme: WebhookSignatureScheme,
  secret: string,
  rawBody: string | Buffer,
  options: {
    timestampSeconds?: number
    generic?: GenericSignatureOptions
  } = {},
): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
  switch (scheme) {
    case "stripe":
      return buildStripeSignatureHeader(secret, body, options.timestampSeconds)
    case "github":
      return buildGitHubSignatureHeader(secret, body)
    case "slack":
      return buildSlackSignatureHeader(secret, body, options.timestampSeconds)
    case "generic":
      return signGeneric(secret, rawBody, options.generic)
  }
}
