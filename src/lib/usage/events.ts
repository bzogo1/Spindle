/**
 * Feature usage events.
 *
 * A `FeatureUsageEvent` records that a subject (signed-in user or anonymous
 * visitor) used a trackable product feature. This is the canonical shape for
 * the usage-analytics pipeline documented in
 * `docs/analytics/feature-usage.md`; it complements — and does not replace —
 * the existing product analytics in `src/lib/analytics.ts` and the feature
 * flag exposure telemetry in `src/lib/feature-flags/analytics/`.
 *
 * Events are plain JSON objects, one per line in JSONL streams, so they can
 * be produced client-side (`trackFeatureUse` in `src/lib/analytics.ts`),
 * server-side, or replayed from exports into `scripts/analytics/usage/report.mjs`.
 *
 * Privacy: `subject` must be an opaque identifier — `user:<uid>` for signed-in
 * users, `anon:<id>` for anonymous visitors (the per-tab id from
 * `src/lib/analytics.ts`, or a hashed id), or `mock:<email>` for mock-auth
 * sessions (see `src/lib/notifications/principal.ts`; mock auth is a
 * dev/demo mode, not production). Never put emails, names, or other
 * personal data in `subject` or `properties`.
 */

/** Upper bound on feature keys; matches the analytics event-name limit. */
export const MAX_FEATURE_KEY_LENGTH = 128
/** Upper bound on the opaque subject id after the `user:`/`anon:`/`mock:` prefix. */
export const MAX_SUBJECT_LENGTH = 128
/** Serialized `properties` must stay small enough for a JSONL line. */
export const MAX_PROPERTIES_BYTES = 4_096

export const FEATURE_USAGE_EVENT_KIND = "feature_use" as const

/**
 * One feature-usage event. `timestamp` is epoch milliseconds (UTC).
 * `properties` is optional, JSON-serialisable, and must stay aggregate-safe
 * (counts, enum labels, durations) — never personal data.
 */
export interface FeatureUsageEvent {
  /** Discriminator; always `"feature_use"` for this stream. */
  kind: typeof FEATURE_USAGE_EVENT_KIND
  /** Stable feature key, e.g. `"new-dashboard"` or `"docs-search"`. */
  feature: string
  /** Opaque subject: `user:<uid>`, `anon:<id>`, or `mock:<email>` (mock auth). */
  subject: string
  /** Epoch milliseconds when the usage happened. */
  timestamp: number
  /** Optional aggregate-safe context (e.g. `{ source: "sidebar" }`). */
  properties?: Record<string, unknown>
}

export interface CreateFeatureUsageEventInput {
  feature: string
  subject: string
  timestamp?: number
  properties?: Record<string, unknown>
  kind?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidSubject(subject: unknown): subject is string {
  if (typeof subject !== "string") return false
  if (subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) return false
  // Convention: "user:<id>", "anon:<id>", or "mock:<email>" (mock-auth
  // sessions, matching notificationPrincipalFromRequest); the bare id may be
  // anything opaque (a uid, session id, or hash) but not whitespace-only.
  return subject.startsWith("user:") || subject.startsWith("anon:") || subject.startsWith("mock:")
}

function isValidFeature(feature: unknown): feature is string {
  return (
    typeof feature === "string" &&
    feature.length > 0 &&
    feature.length <= MAX_FEATURE_KEY_LENGTH &&
    !/\s/.test(feature)
  )
}

function sanitizeProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (properties === undefined) return undefined
  try {
    if (JSON.stringify(properties).length > MAX_PROPERTIES_BYTES) return undefined
    // JSON round-trip drops functions/undefined values that would corrupt JSONL.
    return JSON.parse(JSON.stringify(properties)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Builds a validated `FeatureUsageEvent`. Returns `null` for invalid input so
 * call sites can stay fire-and-forget (`track && append(record(...))`).
 * `timestamp` defaults to `Date.now()`.
 */
export function createFeatureUsageEvent(
  input: CreateFeatureUsageEventInput,
): FeatureUsageEvent | null {
  if (input.kind !== undefined && input.kind !== FEATURE_USAGE_EVENT_KIND) return null
  if (!isValidFeature(input.feature) || !isValidSubject(input.subject)) return null

  const timestamp = input.timestamp ?? Date.now()
  if (!Number.isFinite(timestamp)) return null

  const event: FeatureUsageEvent = {
    kind: FEATURE_USAGE_EVENT_KIND,
    feature: input.feature,
    subject: input.subject,
    timestamp,
  }
  const properties = sanitizeProperties(input.properties)
  if (properties !== undefined) event.properties = properties
  return event
}

/**
 * Validates an unknown value (e.g. a parsed JSONL line) as a
 * `FeatureUsageEvent`. Accepts both the canonical `kind: "feature_use"` shape
 * and the flattened ingest shape used by `/api/analytics`
 * (`type: "feature_use"`, `feature` lifted, `props` instead of `properties`),
 * normalising either into the canonical event. Returns `null` on any
 * mismatch — never throws.
 */
export function parseFeatureUsageEvent(raw: unknown): FeatureUsageEvent | null {
  if (!isPlainObject(raw)) return null

  const kind = raw.kind ?? raw.type
  if (kind !== FEATURE_USAGE_EVENT_KIND) return null

  const feature = raw.feature
  const rawSubject = raw.subject ?? raw.anonymousId ?? raw.userId
  const timestamp = raw.timestamp ?? raw.receivedAt

  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null

  // Normalise bare ids (e.g. the `anonymousId` UUID from `/api/analytics`)
  // into the documented `anon:`/`user:`/`mock:` convention.
  let subject = rawSubject
  if (typeof subject === "string" && subject.length > 0 && !subject.includes(":")) {
    subject = `anon:${subject}`
  }

  const properties =
    raw.properties !== undefined && raw.properties !== null
      ? raw.properties
      : raw.props !== undefined && raw.props !== null
        ? raw.props
        : undefined
  if (properties !== undefined && !isPlainObject(properties)) return null

  return createFeatureUsageEvent({
    kind: FEATURE_USAGE_EVENT_KIND,
    feature: feature as string,
    subject: subject as string,
    timestamp,
    properties: properties as Record<string, unknown> | undefined,
  })
}

/**
 * Parses one JSONL line into a `FeatureUsageEvent`. Blank lines and
 * malformed lines return `null`; the stream reader skips them, so partial
 * writes or unrelated log lines don't break reports.
 */
export function parseFeatureUsageEventLine(line: string): FeatureUsageEvent | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    return parseFeatureUsageEvent(JSON.parse(trimmed))
  } catch {
    return null
  }
}
