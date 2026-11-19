import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino"

/**
 * Structured JSON logging.
 *
 * Every value passed to a log method is sanitised before Pino serialises it.
 * Redaction is recursive rather than a fixed list of Pino paths, so a secret
 * stays hidden wherever it sits in the object: request headers, nested error
 * payloads, arrays, or a handler's own context object.
 */

export const REDACTED = "[Redacted]"

/** Keys whose whole value never belongs in a log line. */
const sensitiveKeys = new Set([
  "auth",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "setcookie",
  "session",
  "sessionid",
  "content",
  "contents",
  "filecontent",
  "filecontents",
  "filedata",
  "signedurl",
  "presignedurl",
  "downloadurl",
])

/** Key suffixes that always carry credentials. */
const sensitiveSuffixes = [
  "token",
  "secret",
  "password",
  "apikey",
  "credential",
  "cookie",
  "signature",
]

/** Query parameters that make a URL a signed (and therefore bearer) URL. */
const signedQueryKeys =
  /^(x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential|sig|signature|token|access_token|expires)$/i

const bearerCredentials = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi
const jsonWebTokens = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

const maxDepth = 8

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function isSensitiveKey(key: string) {
  const normalized = normalizeKey(key)
  return (
    sensitiveKeys.has(normalized) || sensitiveSuffixes.some((suffix) => normalized.endsWith(suffix))
  )
}

/**
 * Removes credentials from a URL while keeping enough shape to recognise it.
 *
 * Signed URLs carry their authorisation in the query string, so sensitive
 * parameter values become `[Redacted]`; userinfo and fragments are dropped.
 * Relative URLs keep their path and are returned without an origin.
 */
export function redactUrl(value: string) {
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  if (!absolute && !value.startsWith("/")) return value

  try {
    const url = new URL(value, "http://spindle.invalid")
    url.username = ""
    url.password = ""

    for (const key of [...url.searchParams.keys()]) {
      if (signedQueryKeys.test(key)) url.searchParams.set(key, REDACTED)
    }

    const path = `${url.pathname}${url.search}`
    return absolute ? `${url.origin}${path}` : path
  } catch {
    return REDACTED
  }
}

/** Redacts credentials embedded in free text, such as an error message. */
function redactText(value: string) {
  return redactUrl(value)
    .replace(bearerCredentials, `$1 ${REDACTED}`)
    .replace(jsonWebTokens, REDACTED)
}

function sanitizeError(error: Error) {
  return {
    type: error.name,
    message: redactText(error.message),
    ...(error.stack ? { stack: redactText(error.stack) } : {}),
  }
}

function sanitize(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && isSensitiveKey(key)) return REDACTED

  if (value === null || value === undefined) return value
  if (typeof value === "string") return redactText(value)
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value
  }
  if (typeof value !== "object") return undefined

  if (depth >= maxDepth) return "[Truncated]"
  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return redactText(value.toString())
  if (value instanceof Error) return sanitizeError(value)
  if (seen.has(value)) return "[Circular]"

  seen.add(value)

  if (Array.isArray(value)) {
    const items = value.map((item) => sanitize(item, undefined, depth + 1, seen))
    seen.delete(value)
    return items
  }

  const result: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitize(entryValue, entryKey, depth + 1, seen)
    if (sanitized !== undefined) result[entryKey] = sanitized
  }

  seen.delete(value)
  return result
}

/** Returns a copy of a log argument that is safe to serialise. */
export function sanitizeForLog(value: unknown): unknown {
  return sanitize(value, undefined, 0, new WeakSet())
}

const hooks: LoggerOptions["hooks"] = {
  logMethod(args, method) {
    const sanitized = args.map((arg) => sanitizeForLog(arg))
    method.apply(this, sanitized as Parameters<typeof method>)
  },
}

export type CreateLoggerOptions = {
  level?: string
  destination?: DestinationStream
  base?: Record<string, unknown>
}

export function createLogger({
  level = "info",
  destination,
  base = { service: "spindle" },
}: CreateLoggerOptions = {}): Logger {
  return pino(
    {
      level,
      base,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      hooks,
    },
    destination,
  )
}

export const logger = createLogger()
