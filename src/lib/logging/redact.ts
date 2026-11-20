import { createHash } from "node:crypto"

import { REDACTED } from "../logger"

/**
 * Field-level PII redaction layered on top of src/lib/logger.ts.
 *
 * The core logger already strips secrets (tokens, cookies, signed URLs) at
 * serialisation time. This module covers the complementary case: values that
 * are not credentials but still identify a person — email addresses, phone
 * numbers, postal addresses — which are sometimes needed for debugging yet
 * must not reach log aggregation in the clear.
 *
 * Apply `redactPii` to objects before handing them to a logger when you want
 * to keep *some* shape (e.g. a masked email for correlation). The core
 * redaction still runs afterwards, so secrets stay hidden either way.
 */

/** Normalised key names (lowercase, alphanumerics only) that hold PII. */
const piiKeys = new Set([
  "email",
  "emailaddress",
  "secondaryemail",
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "firstname",
  "lastname",
  "fullname",
  "displayname",
  "address",
  "addressline1",
  "addressline2",
  "postalcode",
  "zipcode",
  "ipaddress",
  "ip",
])

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function isPiiKey(key: string) {
  return piiKeys.has(normalizeKey(key))
}

/** `jane.doe@example.com` -> `j***@example.com` */
export function maskEmail(value: string) {
  const trimmed = value.trim()
  const at = trimmed.indexOf("@")
  if (at <= 0) return REDACTED

  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  return `${local[0]}***@${domain}`
}

/**
 * Stable pseudonymous id for correlating log lines without exposing the raw
 * identifier. Uses SHA-256 truncated to 16 hex chars — enough to group events
 * for the same subject, not reversible.
 */
export function hashIdentifier(value: string, salt = "spindle") {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16)
}

function redactPiiValue(key: string | undefined, value: unknown): unknown {
  if (key === undefined || typeof value !== "string") return value

  if (!isPiiKey(key)) return value
  if (emailPattern.test(value.trim())) return maskEmail(value)
  return REDACTED
}

function walk(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  const replaced = redactPiiValue(key, value)
  if (replaced !== value) return replaced

  if (value === null || typeof value !== "object") return value
  if (depth >= 8) return "[Truncated]"
  if (seen.has(value)) return "[Circular]"
  if (value instanceof Date || value instanceof Error) return value

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, undefined, depth + 1, seen))
    }

    const result: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = walk(entryValue, entryKey, depth + 1, seen)
    }
    return result
  } finally {
    seen.delete(value)
  }
}

/**
 * Returns a copy of `value` where PII fields are masked (emails) or removed
 * (other PII keys). The input is not mutated; circular references are marked.
 * Secret redaction is unaffected — the core logger applies it on write.
 */
export function redactPii<T>(value: T): T {
  return walk(value, undefined, 0, new WeakSet()) as T
}
