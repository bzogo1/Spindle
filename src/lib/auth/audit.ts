import { clientIp } from "@/lib/site-forms"

/**
 * Auth audit log: a typed record of security-relevant authentication events
 * (sign-ins, failures, sign-outs, token refreshes).
 *
 * Like {@link MemoryAuthBackend} this is a DEVELOPMENT store: events live in a
 * bounded in-memory ring buffer inside one process and are lost on restart.
 * It exists so the audit trail is exercisable in dev and tests; production
 * MUST persist events to a durable store (see prisma/AUTH-SCHEMA.md) behind
 * the same `recordAuthEvent`/`listAuthEvents` seam.
 *
 * NEVER put passwords, tokens, session ids, or request bodies into an event —
 * `metadata` is for non-sensitive context only (failure reasons, purposes).
 */

export type AuthAuditEventType =
  | "signin.success"
  | "signin.failure"
  | "signin.totp_challenge"
  | "logout"
  | "token.refresh"
  | "session.revoked"
  | "password.reset"
  | "email.verify"
  | "totp.enroll"
  | "totp.disable"

export type AuthAuditEvent = {
  /** ISO-8601 timestamp of when the event was recorded. */
  timestamp: string
  type: AuthAuditEventType
  /** Null for anonymous events (e.g. a failed sign-in for an unknown email). */
  userId: string | null
  email: string | null
  ip: string | null
  userAgent: string | null
  /** Non-sensitive context: `{ reason }`, `{ purpose }`, etc. */
  metadata: Record<string, unknown>
}

export type AuthAuditEventInput = {
  type: AuthAuditEventType
  userId?: string | null
  email?: string | null
  ip?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

export type AuthAuditFilter = {
  userId?: string
  email?: string
  type?: AuthAuditEventType
  /** Max events to return (newest first). */
  limit?: number
}

export const DEFAULT_AUDIT_CAPACITY = 1000
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

/**
 * Bounded in-memory audit store. Events are appended chronologically; reads
 * return newest-first. When the buffer exceeds `capacity` the oldest events
 * are dropped.
 */
export class MemoryAuthAuditLog {
  private events: AuthAuditEvent[] = []

  constructor(private readonly capacity = DEFAULT_AUDIT_CAPACITY) {}

  record(input: AuthAuditEventInput): AuthAuditEvent {
    const event: AuthAuditEvent = {
      timestamp: new Date().toISOString(),
      type: input.type,
      userId: input.userId ?? null,
      email: input.email ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { ...(input.metadata ?? {}) },
    }
    this.events.push(event)
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity)
    }
    return event
  }

  /** Newest-first; optionally narrowed by user, email, and/or event type. */
  list(filter: AuthAuditFilter = {}): AuthAuditEvent[] {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
    const matched: AuthAuditEvent[] = []
    // Walk backwards so the newest events win the limit.
    for (let i = this.events.length - 1; i >= 0 && matched.length < limit; i -= 1) {
      const event = this.events[i]
      if (filter.userId && event.userId !== filter.userId) continue
      if (filter.email && event.email !== filter.email) continue
      if (filter.type && event.type !== filter.type) continue
      matched.push(event)
    }
    return matched
  }

  /** Test/reset hook: empties the buffer without replacing the instance. */
  clear(): void {
    this.events = []
  }

  get size(): number {
    return this.events.length
  }
}

export interface AuthAuditLog {
  record(input: AuthAuditEventInput): AuthAuditEvent
  list(filter?: AuthAuditFilter): AuthAuditEvent[]
}

let auditLog: AuthAuditLog = new MemoryAuthAuditLog()

/** Single seam for the audit store (swap for a durable backend in prod). */
export function getAuthAuditLog(): AuthAuditLog {
  return auditLog
}

/** Test hook: replaces the audit store. */
export function setAuthAuditLogForTests(next: AuthAuditLog | undefined): void {
  auditLog = next ?? new MemoryAuthAuditLog()
}

/** Extracts ip/userAgent from a route-handler request for audit context. */
export function auditContextFromRequest(request: Request): {
  ip: string | null
  userAgent: string | null
} {
  return {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  }
}

export function recordAuthEvent(input: AuthAuditEventInput): AuthAuditEvent {
  return getAuthAuditLog().record(input)
}

export function listAuthEvents(filter?: AuthAuditFilter): AuthAuditEvent[] {
  return getAuthAuditLog().list(filter)
}
