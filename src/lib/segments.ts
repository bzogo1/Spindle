/**
 * User segments: named, rule-based groups of users that admins can define
 * and inspect from `/app/admin/segments`.
 *
 * DEVELOPMENT SEAM: segment definitions live in a process-local `Map`, same
 * interim-store pattern as `announcements.ts`/`newsletter-store.ts`. State is
 * lost on restart and is per-instance on multi-instance deploys; the upgrade
 * path is a `Segment` table. The exported function signatures are already
 * shaped for that swap.
 *
 * Evaluation is pure: `evaluateSegment` takes an explicit list of
 * {@link SegmentUser} records so it can be unit-tested without touching the
 * auth backend. `listBackendSegmentUsers` is the dev-seam bridge that
 * projects the in-memory `MemoryAuthBackend` user/session stores into
 * `SegmentUser` rows (bounded — see SEGMENT_EVALUATION_MAX_USERS). It reads
 * the backend's internal maps structurally because `AuthBackend` has no
 * list-users method yet; a future Prisma backend will replace this bridge.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it.
 */

import { isAdminEmail } from "@/lib/admin"
import { getAuthBackend } from "@/lib/auth/backend"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const SEGMENT_FIELDS = [
  "emailDomain",
  "emailVerified",
  "createdAfter",
  "createdBefore",
  "hasSession",
  "role",
] as const
export type SegmentField = (typeof SEGMENT_FIELDS)[number]

export const SEGMENT_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "isTrue",
  "isFalse",
  "is",
] as const
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number]

export const SEGMENT_COMBINATORS = ["all", "any"] as const
export type SegmentCombinator = (typeof SEGMENT_COMBINATORS)[number]

/** Roles a segment rule may match against. `admin` derives from ADMIN_EMAILS. */
export const SEGMENT_ROLES = ["admin", "member"] as const
export type SegmentRole = (typeof SEGMENT_ROLES)[number]

export interface SegmentRule {
  field: SegmentField
  operator: SegmentOperator
  /** Normalized string value; empty for isTrue/isFalse operators. */
  value: string
}

export interface Segment {
  id: string
  name: string
  description?: string
  rules: SegmentRule[]
  combinator: SegmentCombinator
  /** ISO timestamp — record creation time. */
  createdAt: string
}

export interface CreateSegmentInput {
  name: string
  description?: string
  rules: SegmentRule[]
  combinator?: SegmentCombinator
}

/**
 * The flat user shape segment rules evaluate against. `createdAt` is an ISO
 * timestamp; `role` is `"admin"` for ADMIN_EMAILS matches, `"member"`
 * otherwise; `hasSession` means at least one live (unrevoked, unexpired)
 * auth session.
 */
export interface SegmentUser {
  id: string
  email: string
  emailVerified: boolean
  createdAt: string
  hasSession: boolean
  role: string
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const SEGMENTS_STORE_MAX = 200
export const SEGMENT_MAX_RULES = 20
export const SEGMENT_NAME_MAX = 120
export const SEGMENT_DESCRIPTION_MAX = 500
export const SEGMENT_VALUE_MAX = 253
/** Upper bound on users scanned per segment evaluation (dev seam). */
export const SEGMENT_EVALUATION_MAX_USERS = 5000
/** Number of matched emails returned as a sample in API responses. */
export const SEGMENT_SAMPLE_SIZE = 10

// ---------------------------------------------------------------------------
// Rule validation
// ---------------------------------------------------------------------------

const FIELD_OPERATORS: Record<SegmentField, readonly SegmentOperator[]> = {
  emailDomain: ["equals", "notEquals", "contains"],
  emailVerified: ["isTrue", "isFalse"],
  createdAfter: ["is"],
  createdBefore: ["is"],
  hasSession: ["isTrue", "isFalse"],
  role: ["equals", "notEquals"],
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

function normalizeDomain(value: string): string {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "")
  if (domain.length === 0 || domain.length > SEGMENT_VALUE_MAX || !DOMAIN_PATTERN.test(domain)) {
    throw new Error("emailDomain value must be a bare domain like example.com.")
  }
  return domain
}

function normalizeRole(value: string): SegmentRole {
  const role = value.trim().toLowerCase()
  if (role !== "admin" && role !== "member") {
    throw new Error("role value must be 'admin' or 'member'.")
  }
  return role
}

function normalizeDate(value: string, field: SegmentField): string {
  const time = Date.parse(value.trim())
  if (Number.isNaN(time)) {
    throw new Error(`${field} value must be a valid date/time.`)
  }
  return new Date(time).toISOString()
}

/**
 * Validates and normalizes one rule. Throws `Error` with a human-readable
 * message on anything invalid — callers (the admin route) map this to a 400.
 * Returns a new normalized rule; the input is not mutated.
 */
export function normalizeSegmentRule(rule: SegmentRule): SegmentRule {
  if (!SEGMENT_FIELDS.includes(rule.field)) {
    throw new Error(`Unknown segment field "${String(rule.field)}".`)
  }
  const allowed = FIELD_OPERATORS[rule.field]
  if (!allowed.includes(rule.operator)) {
    throw new Error(`Operator "${rule.operator}" is not allowed for field "${rule.field}".`)
  }
  if (typeof rule.value !== "string" || rule.value.length > SEGMENT_VALUE_MAX * 2) {
    throw new Error("Rule value must be a string.")
  }

  switch (rule.field) {
    case "emailDomain":
      return { ...rule, value: normalizeDomain(rule.value) }
    case "role":
      return { ...rule, value: normalizeRole(rule.value) }
    case "createdAfter":
    case "createdBefore":
      return { ...rule, value: normalizeDate(rule.value, rule.field) }
    case "emailVerified":
    case "hasSession":
      // Boolean predicates carry no value.
      if (rule.value.trim() !== "") {
        throw new Error(`${rule.field} rules do not take a value.`)
      }
      return { ...rule, value: "" }
  }
}

// ---------------------------------------------------------------------------
// Rule evaluation (pure)
// ---------------------------------------------------------------------------

function emailDomainOf(email: string): string {
  const at = email.lastIndexOf("@")
  return at === -1 ? "" : email.slice(at + 1).toLowerCase()
}

function isValidRule(rule: SegmentRule): boolean {
  try {
    normalizeSegmentRule(rule)
    return true
  } catch {
    return false
  }
}

function ruleMatches(rule: SegmentRule, user: SegmentUser): boolean {
  // Stored rules are normalized on write, but evaluate defensively: an
  // invalid rule simply never matches rather than throwing mid-scan.
  if (!isValidRule(rule)) return false
  const value = rule.value

  switch (rule.field) {
    case "emailDomain": {
      const domain = emailDomainOf(user.email)
      if (rule.operator === "equals") return domain === value
      if (rule.operator === "notEquals") return domain !== value
      return domain.includes(value) // "contains"
    }
    case "emailVerified":
      return rule.operator === "isTrue" ? user.emailVerified : !user.emailVerified
    case "hasSession":
      return rule.operator === "isTrue" ? user.hasSession : !user.hasSession
    case "createdAfter": {
      const created = Date.parse(user.createdAt)
      const bound = Date.parse(value)
      return !Number.isNaN(created) && !Number.isNaN(bound) && created > bound
    }
    case "createdBefore": {
      const created = Date.parse(user.createdAt)
      const bound = Date.parse(value)
      return !Number.isNaN(created) && !Number.isNaN(bound) && created < bound
    }
    case "role":
      return rule.operator === "equals" ? user.role === value : user.role !== value
  }
}

/**
 * Returns the subset of `users` matching the segment. `combinator: "all"`
 * requires every rule to match, `"any"` requires at least one. A segment with
 * no rules — or with a combinator other than "all"/"any" on a hand-built or
 * legacy record — matches nobody: unknown combinators must not silently widen
 * the match the way "any" would.
 */
export function evaluateSegment(segment: Segment, users: SegmentUser[]): SegmentUser[] {
  if (segment.rules.length === 0) return []
  if (segment.combinator === "all") {
    return users.filter((user) => segment.rules.every((rule) => ruleMatches(rule, user)))
  }
  if (segment.combinator === "any") {
    return users.filter((user) => segment.rules.some((rule) => ruleMatches(rule, user)))
  }
  return []
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const segments = new Map<string, Segment>() // id → record

function segmentId(): string {
  return `seg_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Creates and stores a segment. Throws `Error` on invalid input (name,
 * description, combinator, or any rule) — the admin route maps this to 400.
 * Bounded capacity: evicts the oldest record beyond SEGMENTS_STORE_MAX.
 */
export function createSegment(input: CreateSegmentInput): Segment {
  const name = input.name.trim()
  if (name.length === 0 || name.length > SEGMENT_NAME_MAX) {
    throw new Error(`name must be 1-${SEGMENT_NAME_MAX} characters.`)
  }
  const description = input.description?.trim()
  if (description !== undefined && description.length > SEGMENT_DESCRIPTION_MAX) {
    throw new Error(`description must be at most ${SEGMENT_DESCRIPTION_MAX} characters.`)
  }
  const combinator = input.combinator ?? "all"
  if (!SEGMENT_COMBINATORS.includes(combinator)) {
    throw new Error("combinator must be 'all' or 'any'.")
  }
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error("At least one rule is required.")
  }
  if (input.rules.length > SEGMENT_MAX_RULES) {
    throw new Error(`At most ${SEGMENT_MAX_RULES} rules are allowed.`)
  }
  const rules = input.rules.map(normalizeSegmentRule)

  const segment: Segment = {
    id: segmentId(),
    name,
    ...(description ? { description } : {}),
    rules,
    combinator,
    createdAt: nowIso(),
  }

  if (segments.size >= SEGMENTS_STORE_MAX) {
    const oldest = segments.keys().next().value
    if (oldest !== undefined) segments.delete(oldest)
  }
  segments.set(segment.id, segment)
  return segment
}

/** Every stored segment, newest `createdAt` first. */
export function listSegments(): Segment[] {
  return [...segments.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )
}

export function getSegment(id: string): Segment | null {
  return segments.get(id) ?? null
}

/** Removes a segment; returns false when the id does not exist. */
export function deleteSegment(id: string): boolean {
  return segments.delete(id)
}

// ---------------------------------------------------------------------------
// Backend user projection (dev seam)
// ---------------------------------------------------------------------------

/**
 * Structural view of the in-memory backend's private stores. `AuthBackend`
 * exposes no list-users method, so the dev seam reads the
 * `MemoryAuthBackend` maps directly; any other backend yields an empty list.
 */
type BackendUserRecord = {
  id?: unknown
  email?: unknown
  emailVerified?: unknown
  createdAt?: unknown
}

type BackendSessionRecord = {
  userId?: unknown
  revokedAt?: unknown
  expiresAt?: unknown
}

function asUsersMap(backend: unknown): Map<string, BackendUserRecord> | null {
  const users = (backend as { users?: unknown } | null)?.users
  return users instanceof Map ? (users as Map<string, BackendUserRecord>) : null
}

function asSessionsMap(backend: unknown): Map<string, BackendSessionRecord> | null {
  const sessions = (backend as { sessions?: unknown } | null)?.sessions
  return sessions instanceof Map ? (sessions as Map<string, BackendSessionRecord>) : null
}

/**
 * Projects up to `limit` users from the auth backend into {@link SegmentUser}
 * rows for segment evaluation. Returns an empty array when the backend does
 * not expose the in-memory user store (e.g. a mocked or future Prisma
 * backend) — callers report `evaluatedUsers: 0` rather than failing.
 */
export function listBackendSegmentUsers(
  limit: number = SEGMENT_EVALUATION_MAX_USERS,
): SegmentUser[] {
  const backend = getAuthBackend()
  const users = asUsersMap(backend)
  if (!users) return []
  const sessions = asSessionsMap(backend)

  const now = Date.now()
  const activeUserIds = new Set<string>()
  if (sessions) {
    for (const session of sessions.values()) {
      const revokedAt = session.revokedAt
      const expiresAt = session.expiresAt
      if (
        typeof session.userId === "string" &&
        (revokedAt === null || revokedAt === undefined) &&
        typeof expiresAt === "number" &&
        expiresAt > now
      ) {
        activeUserIds.add(session.userId)
      }
    }
  }

  const out: SegmentUser[] = []
  for (const record of users.values()) {
    if (out.length >= limit) break
    if (typeof record.id !== "string" || typeof record.email !== "string") continue
    if (typeof record.createdAt !== "string") continue
    out.push({
      id: record.id,
      email: record.email,
      emailVerified: record.emailVerified === true,
      createdAt: record.createdAt,
      hasSession: activeUserIds.has(record.id),
      role: isAdminEmail(record.email) ? "admin" : "member",
    })
  }
  return out
}

/** Test hook: clears all stored segments. */
export function clearSegmentsForTests(): void {
  segments.clear()
}
