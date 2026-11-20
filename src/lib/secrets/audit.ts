import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { redactUrl, sanitizeForLog } from "../logger"
import { secretCatalog, type SecretService } from "./catalog"

/**
 * Secret access audit log.
 *
 * Server-side only. Every read, verify, or other use of a secret-store value
 * can be recorded as one JSON object per line (JSONL) so access is
 * attributable after the fact — who touched which named secret, when, from
 * where, and whether the attempt was allowed.
 *
 * The log NEVER contains a secret value. Events carry the variable name
 * (`secretName`), the actor, the action, and free-text context only; context
 * strings still pass through the shared log sanitiser so embedded bearer
 * tokens, JWTs, and signed URLs are redacted before they reach disk. Callers
 * must not put values into `reason`, `source`, or `requestId` — there is no
 * field for them and none may be added.
 *
 * Default location is `<cwd>/.spindle/secret-access-audit.jsonl`; pass
 * `options.path` (or `--log` on the report script) to redirect it. See
 * docs/security/secret-access-audit.md for retention and alerting.
 */

export class SecretAuditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretAuditError"
  }
}

export type SecretAccessActorKind = "user" | "service" | "system" | "deploy-identity" | "unknown"

export type SecretAccessAction = "read" | "verify" | "list" | "check" | "rotate" | "inject"

export type SecretAccessActor = {
  /** Stable identifier: user id, service name, or machine identity. */
  id?: string
  kind: SecretAccessActorKind
  /** Human-readable label, e.g. "release-manager" or "app-runtime". */
  name?: string
}

export type SecretAccessEvent = {
  id: string
  /** ISO-8601 timestamp of the access. */
  timestamp: string
  actor: SecretAccessActor
  /** Environment-variable / secret-store name — never the value. */
  secretName: string
  action: SecretAccessAction
  /** Catalog service the secret belongs to, when known. */
  service?: SecretService
  /** Where the access happened: script name, host, or consumer. */
  source?: string
  /** Deployment environment, e.g. "prod" or "staging". */
  environment?: string
  /** `false` records a denied or failed attempt; absent means allowed. */
  allowed?: boolean
  /** Why an attempt was denied or failed. Never a secret value. */
  reason?: string
  /** Correlation id for tracing one request across logs. */
  requestId?: string
}

export type SecretAccessEventInput = Omit<SecretAccessEvent, "id" | "timestamp" | "service">

export type RecordSecretAccessOptions = {
  /** JSONL file to append to. Defaults to `defaultSecretAccessLogPath()`. */
  path?: string
  /** Build and return the event without writing it — for dry runs and tests. */
  dryRun?: boolean
  /** Clock override for tests. */
  now?: Date
}

const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/

const ACTIONS: readonly SecretAccessAction[] = [
  "read",
  "verify",
  "list",
  "check",
  "rotate",
  "inject",
]

const ACTOR_KINDS: readonly SecretAccessActorKind[] = [
  "user",
  "service",
  "system",
  "deploy-identity",
  "unknown",
]

const EMBEDDED_URL = /https?:\/\/[^\s"'<>]+/g

/**
 * `sanitizeForLog` only redacts a URL when it is the whole string; audit
 * reasons often embed one mid-sentence, so signed-URL credentials are
 * stripped per match before the shared sanitiser runs.
 */
function redactEmbeddedUrls(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.replace(EMBEDDED_URL, (match) => redactUrl(match))
}

/** Where the audit log lives when no explicit path is given. */
export function defaultSecretAccessLogPath(): string {
  return resolve(process.cwd(), ".spindle", "secret-access-audit.jsonl")
}

/**
 * Validates a secret-store variable name. Only uppercase env-var-shaped names
 * are accepted, which makes it structurally impossible to log a value under
 * this field.
 */
export function normalizeSecretName(name: string): string {
  const normalized = name.trim()

  if (!SECRET_NAME_PATTERN.test(normalized)) {
    throw new SecretAuditError(
      `Invalid secret name "${name}". Audit events may only name secret-store variables (e.g. SESSION_SECRET).`,
    )
  }

  return normalized
}

/** Resolves the catalog service a variable belongs to, if it is catalogued. */
export function resolveSecretService(secretName: string): SecretService | undefined {
  for (const entry of secretCatalog) {
    if (entry.variables.includes(secretName) || entry.previousVariables?.includes(secretName)) {
      return entry.service
    }
  }

  return undefined
}

/** Builds a sanitised event. Throws on invalid names, actions, or actor kinds. */
export function createSecretAccessEvent(
  input: SecretAccessEventInput,
  options: { now?: Date } = {},
): SecretAccessEvent {
  const secretName = normalizeSecretName(input.secretName)

  if (!ACTIONS.includes(input.action)) {
    throw new SecretAuditError(`Unknown secret access action "${input.action}".`)
  }

  if (!ACTOR_KINDS.includes(input.actor?.kind)) {
    throw new SecretAuditError(`Unknown secret access actor kind "${input.actor?.kind}".`)
  }

  const event: SecretAccessEvent = {
    id: `saa_${(options.now ?? new Date()).getTime().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`,
    timestamp: (options.now ?? new Date()).toISOString(),
    actor: {
      id: redactEmbeddedUrls(input.actor.id),
      kind: input.actor.kind,
      name: redactEmbeddedUrls(input.actor.name),
    },
    secretName,
    action: input.action,
    service: resolveSecretService(secretName),
    source: redactEmbeddedUrls(input.source),
    environment: input.environment,
    allowed: input.allowed,
    reason: redactEmbeddedUrls(input.reason),
    requestId: redactEmbeddedUrls(input.requestId),
  }

  // Free-text fields pass through the shared log sanitiser so bearer tokens,
  // JWTs, and signed URLs in a reason or source string never reach disk.
  // Undefined optional fields are dropped by the sanitiser.
  return sanitizeForLog(event) as SecretAccessEvent
}

/**
 * Appends one access event to the JSONL audit log and returns it.
 *
 * Integration point for `scripts/secrets/*` entrypoints and server code that
 * reads secret-store values:
 *
 * ```ts
 * recordSecretAccess({
 *   actor: { kind: "system", name: "secrets-check" },
 *   secretName: "SESSION_SECRET",
 *   action: "check",
 *   source: "scripts/secrets/check.ts",
 *   environment: "prod",
 * })
 * ```
 *
 * With `dryRun: true` the event is built and returned but nothing is written.
 * Write failures throw `SecretAuditError` — an audit write that silently fails
 * is worse than a loud one; callers that must not crash can catch it.
 */
export function recordSecretAccess(
  input: SecretAccessEventInput,
  options: RecordSecretAccessOptions = {},
): SecretAccessEvent {
  const event = createSecretAccessEvent(input, { now: options.now })

  if (options.dryRun) return event

  const path = options.path ?? defaultSecretAccessLogPath()

  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8")
  } catch (error) {
    throw new SecretAuditError(
      `Could not append to the secret access audit log at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return event
}

/**
 * Runs `fn` and records the access it performed: `allowed: true` on success,
 * `allowed: false` with the error message as `reason` on failure. The error is
 * rethrown unchanged. Use this to wrap secret reads in entrypoints:
 *
 * ```ts
 * const key = await withSecretAccessAudit("RESEND_API_KEY", () => fetchResendKey(), {
 *   actor: { kind: "service", name: "app-runtime" },
 *   source: "src/lib/email.ts",
 * })
 * ```
 */
export async function withSecretAccessAudit<T>(
  secretName: string,
  fn: () => T | Promise<T>,
  context: Partial<Omit<SecretAccessEventInput, "secretName" | "allowed" | "reason">> = {},
  options: RecordSecretAccessOptions = {},
): Promise<T> {
  const action = context.action ?? "read"
  const actor = context.actor ?? { kind: "unknown" as const }

  try {
    const result = await fn()
    recordSecretAccess({ ...context, actor, secretName, action, allowed: true }, options)
    return result
  } catch (error) {
    recordSecretAccess(
      {
        ...context,
        actor,
        secretName,
        action,
        allowed: false,
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
      options,
    )
    throw error
  }
}

function isSecretAccessEvent(value: unknown): value is SecretAccessEvent {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<SecretAccessEvent>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.secretName === "string" &&
    typeof candidate.action === "string" &&
    typeof candidate.actor === "object" &&
    candidate.actor !== null &&
    typeof candidate.actor.kind === "string"
  )
}

/** Parses JSONL audit-log text into events, skipping blank and malformed lines. */
export function parseSecretAccessLog(text: string): SecretAccessEvent[] {
  const events: SecretAccessEvent[] = []

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isSecretAccessEvent(parsed)) events.push(parsed)
    } catch {
      // A truncated or corrupt line must not hide the rest of the log.
    }
  }

  return events
}

/** Reads and parses an audit log file. Throws if the file cannot be read. */
export function readSecretAccessLog(path: string): SecretAccessEvent[] {
  return parseSecretAccessLog(readFileSync(path, "utf8"))
}

export type SecretAccessSecretSummary = {
  secretName: string
  service?: SecretService
  count: number
  distinctActors: number
  denied: number
  lastTimestamp: string
}

export type SecretAccessActorSummary = {
  actor: string
  count: number
  distinctSecrets: number
  denied: number
}

export type SecretAccessAnomaly = {
  type: "denied-access" | "unknown-secret" | "high-volume"
  secretName?: string
  detail: string
  count: number
}

export type SecretAccessSummary = {
  totalEvents: number
  firstTimestamp?: string
  lastTimestamp?: string
  bySecret: SecretAccessSecretSummary[]
  byActor: SecretAccessActorSummary[]
  byAction: { action: SecretAccessAction; count: number }[]
  /** Events per UTC day, oldest first. */
  byDay: { day: string; count: number }[]
  anomalies: SecretAccessAnomaly[]
}

export type SummarizeSecretAccessOptions = {
  /** Flag a secret accessed more than this many times in one UTC day. */
  highVolumePerDay?: number
}

function actorLabel(event: SecretAccessEvent): string {
  return event.actor.name ?? event.actor.id ?? event.actor.kind
}

/**
 * Aggregates parsed events into the report consumed by
 * `scripts/secrets/audit-access.ts`: per-secret and per-actor totals plus
 * anomalies worth alerting on — denied attempts, names outside the secret
 * catalog, and per-day volume spikes.
 */
export function summarizeSecretAccess(
  events: SecretAccessEvent[],
  options: SummarizeSecretAccessOptions = {},
): SecretAccessSummary {
  const highVolumePerDay = options.highVolumePerDay ?? 50

  const bySecret = new Map<string, SecretAccessSecretSummary & { actors: Set<string> }>()
  const byActor = new Map<string, SecretAccessActorSummary & { secrets: Set<string> }>()
  const byAction = new Map<SecretAccessAction, number>()
  const byDay = new Map<string, number>()
  const perSecretPerDay = new Map<string, number>()

  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined

  for (const event of events) {
    if (!firstTimestamp || event.timestamp < firstTimestamp) firstTimestamp = event.timestamp
    if (!lastTimestamp || event.timestamp > lastTimestamp) lastTimestamp = event.timestamp

    const secret = bySecret.get(event.secretName) ?? {
      secretName: event.secretName,
      service: resolveSecretService(event.secretName),
      count: 0,
      distinctActors: 0,
      denied: 0,
      lastTimestamp: event.timestamp,
      actors: new Set<string>(),
    }
    secret.count += 1
    secret.actors.add(actorLabel(event))
    secret.denied += event.allowed === false ? 1 : 0
    if (event.timestamp > secret.lastTimestamp) secret.lastTimestamp = event.timestamp
    bySecret.set(event.secretName, secret)

    const actor = actorLabel(event)
    const actorEntry = byActor.get(actor) ?? {
      actor,
      count: 0,
      distinctSecrets: 0,
      denied: 0,
      secrets: new Set<string>(),
    }
    actorEntry.count += 1
    actorEntry.secrets.add(event.secretName)
    actorEntry.denied += event.allowed === false ? 1 : 0
    byActor.set(actor, actorEntry)

    byAction.set(event.action, (byAction.get(event.action) ?? 0) + 1)

    const day = event.timestamp.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
    const volumeKey = `${event.secretName}|${day}`
    perSecretPerDay.set(volumeKey, (perSecretPerDay.get(volumeKey) ?? 0) + 1)
  }

  const secrets = [...bySecret.values()]
    .map(({ actors, ...rest }) => ({ ...rest, distinctActors: actors.size }))
    .sort((a, b) => b.count - a.count || a.secretName.localeCompare(b.secretName))

  const actors = [...byActor.values()]
    .map(({ secrets: secretNames, ...rest }) => ({
      ...rest,
      distinctSecrets: secretNames.size,
    }))
    .sort((a, b) => b.count - a.count || a.actor.localeCompare(b.actor))

  const actions = [...byAction.entries()]
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)

  const days = [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const anomalies: SecretAccessAnomaly[] = []

  for (const secret of secrets) {
    if (secret.denied > 0) {
      anomalies.push({
        type: "denied-access",
        secretName: secret.secretName,
        detail: `${secret.denied} denied or failed access attempt(s)`,
        count: secret.denied,
      })
    }

    if (!secret.service) {
      anomalies.push({
        type: "unknown-secret",
        secretName: secret.secretName,
        detail: "Not a variable in the secret catalog; confirm it is intentional",
        count: secret.count,
      })
    }
  }

  for (const [key, count] of perSecretPerDay) {
    if (count <= highVolumePerDay) continue
    const [secretName, day] = key.split("|")
    anomalies.push({
      type: "high-volume",
      secretName,
      detail: `${count} accesses on ${day} (threshold ${highVolumePerDay}/day)`,
      count,
    })
  }

  anomalies.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))

  return {
    totalEvents: events.length,
    firstTimestamp,
    lastTimestamp,
    bySecret: secrets,
    byActor: actors,
    byAction: actions,
    byDay: days,
    anomalies,
  }
}
