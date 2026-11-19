import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * A keyring holds the key that signs new values and, during a rotation
 * window, the previous key that still verifies values issued by older
 * instances. Both keys are read from the secret store at runtime.
 */
export type Keyring = {
  /** Key used for new signatures. */
  current: string
  /** Key accepted only for verification until the rotation window closes. */
  previous?: string
}

export class SecretsConfigurationError extends Error {
  readonly key: string

  constructor(key: string, message: string) {
    super(`${key}: ${message}`)
    this.name = "SecretsConfigurationError"
    this.key = key
  }
}

/**
 * Builds a keyring from two environment values. A previous key is ignored when
 * it is blank or identical to the current key, so a half-finished rotation
 * cannot make verification ambiguous.
 */
export function createKeyring(
  current: string | undefined,
  previous: string | undefined,
  key: string,
): Keyring {
  const normalizedCurrent = current?.trim()

  if (!normalizedCurrent) {
    throw new SecretsConfigurationError(
      key,
      "is required but was not provided by the secret store.",
    )
  }

  const normalizedPrevious = previous?.trim()

  return {
    current: normalizedCurrent,
    previous:
      normalizedPrevious && normalizedPrevious !== normalizedCurrent
        ? normalizedPrevious
        : undefined,
  }
}

/** Returns a base64url HMAC-SHA256 signature. */
export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url")
}

/** Compares two strings without leaking their length or content through timing. */
export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8")
  const rightBuffer = Buffer.from(right, "utf8")

  if (leftBuffer.length !== rightBuffer.length) return false

  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyHmac(secret: string, payload: string, signature: string): boolean {
  return safeEqual(hmacSha256(secret, payload), signature)
}

/** Signs with the current key. The previous key is never used for new values. */
export function signWithKeyring(keyring: Keyring, payload: string): string {
  return hmacSha256(keyring.current, payload)
}

/**
 * Returns which key verified the signature, or null when neither key matches.
 * Callers can log the returned key name during a rotation without logging the
 * signature itself.
 */
export function verifyWithKeyring(
  keyring: Keyring,
  payload: string,
  signature: string,
): "current" | "previous" | null {
  if (verifyHmac(keyring.current, payload, signature)) return "current"
  if (keyring.previous && verifyHmac(keyring.previous, payload, signature)) return "previous"
  return null
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

export function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8")
  } catch {
    return null
  }
}
