import { hashToBucket } from "./feature-flags/evaluate"

/**
 * Admin-managed feature flags with per-user targeting rules.
 *
 * This module is the *runtime/user-targeted* complement to the
 * env/registry-based flags in `./feature-flags/` (which resolve
 * `FEATURE_FLAG_*` overrides and per-environment defaults for statically
 * declared flags). Flags created here are stored in a process-local `Map` —
 * the same in-memory development seam used by `src/lib/announcements.ts` and
 * `src/lib/email-ab.ts`. On serverless or multi-instance deploys each
 * instance keeps its own copy and everything is lost on restart; the
 * upgrade path is a `FeatureFlag` table. The exported function signatures
 * are already shaped for that swap.
 *
 * Server-only in practice: imported by route handlers and API tests. Client
 * components must NOT import this module — they should call
 * `GET /api/feature-flags`, which evaluates every flag for the caller and
 * returns the enabled keys. Server code that has a user id/email should call
 * `isFeatureEnabled`/`listEnabledFlagKeys` here instead of duplicating the
 * evaluation rules.
 *
 * Evaluation semantics (`isFeatureEnabled`), first match wins:
 *   1. Flag missing or `enabled === false`            → false
 *   2. `userId` ∈ `targetUserIds`                     → true
 *   3. `email` ∈ `targetEmails` (case-insensitive)    → true
 *   4. `rolloutPercent` set                           →
 *        `hashToBucket(userId || email) < percent` (stable per subject;
 *        percent <= 0 enables nobody, >= 100 everybody)
 *   5. otherwise                                      → false
 *
 * `targetUserIds`/`targetEmails` are explicit allowlists: when either is
 * non-empty a matching identity short-circuits to `true` even at low (or
 * zero) rollout percentages. Non-matching identities still fall through to
 * the rollout percentage — targets are additive, not exclusive.
 */

export interface FeatureFlag {
  id: string
  /** Stable identifier used by `isFeatureEnabled`/`GET /api/feature-flags`. */
  key: string
  /** Human-readable label shown in the admin UI. */
  name: string
  description: string
  enabled: boolean
  /** 0–100 deterministic rollout share; absent means no percentage rollout. */
  rolloutPercent?: number
  /** Auth-backend user ids that always get the flag. */
  targetUserIds?: string[]
  /** Emails (stored lowercased) that always get the flag. */
  targetEmails?: string[]
  /** ISO timestamps. */
  createdAt: string
  updatedAt: string
}

export interface CreateFeatureFlagInput {
  key: string
  name: string
  description?: string
  enabled?: boolean
  rolloutPercent?: number
  targetUserIds?: string[]
  targetEmails?: string[]
}

/**
 * Patch accepted by `updateFlag`. `null` clears an optional field
 * (`rolloutPercent`, `targetUserIds`, `targetEmails`); omitting a field
 * leaves it unchanged. `key` is immutable — create a new flag instead.
 */
export interface UpdateFeatureFlagInput {
  name?: string
  description?: string
  enabled?: boolean
  rolloutPercent?: number | null
  targetUserIds?: string[] | null
  targetEmails?: string[] | null
}

/** Identity a flag is evaluated for. At least one should be provided. */
export interface FlagSubject {
  userId?: string
  email?: string
}

/** Hard cap so the in-memory store cannot grow without bound. */
export const FEATURE_FLAGS_STORE_MAX = 500

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const flags = new Map<string, FeatureFlag>() // id → record
const byKey = new Map<string, string>() // key → id

function flagId(): string {
  return `ff_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeKey(key: string): string {
  const trimmed = key.trim()
  if (!KEY_PATTERN.test(trimmed)) {
    throw new Error(
      "key must start with a letter or digit and contain only letters, digits, '.', '_' or '-' (max 128 chars).",
    )
  }
  return trimmed
}

function normalizeName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error("name is required.")
  if (trimmed.length > 200) throw new Error("name is too long.")
  return trimmed
}

function normalizeDescription(description: string | undefined): string {
  const trimmed = (description ?? "").trim()
  if (trimmed.length > 2000) throw new Error("description is too long.")
  return trimmed
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) throw new Error("rolloutPercent must be a number between 0 and 100.")
  if (value < 0 || value > 100) throw new Error("rolloutPercent must be between 0 and 100.")
  return value
}

function normalizeUserIds(ids: string[] | undefined): string[] | undefined {
  if (ids === undefined) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (id.length === 0) continue
    if (id.length > 200) throw new Error("targetUserIds entries must be at most 200 chars.")
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out.length > 0 ? out : undefined
}

function normalizeEmails(emails: string[] | undefined): string[] | undefined {
  if (emails === undefined) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of emails) {
    const email = raw.trim().toLowerCase()
    if (email.length === 0) continue
    if (email.length > 320 || !email.includes("@")) {
      throw new Error(`"${raw.trim()}" is not a valid email address.`)
    }
    if (!seen.has(email)) {
      seen.add(email)
      out.push(email)
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * Creates a flag. `enabled` defaults to `false` (safe: a flag nobody turned
 * on evaluates false for everyone). Throws on invalid input or a duplicate
 * key — callers (the admin route) map this to a 400.
 */
export function createFlag(input: CreateFeatureFlagInput): FeatureFlag {
  const key = normalizeKey(input.key)
  if (byKey.has(key)) throw new Error(`A flag with key "${key}" already exists.`)

  const now = nowIso()
  const flag: FeatureFlag = {
    id: flagId(),
    key,
    name: normalizeName(input.name),
    description: normalizeDescription(input.description),
    enabled: input.enabled ?? false,
    ...(input.rolloutPercent !== undefined
      ? { rolloutPercent: clampPercent(input.rolloutPercent) }
      : {}),
    ...(normalizeUserIds(input.targetUserIds) !== undefined
      ? { targetUserIds: normalizeUserIds(input.targetUserIds) }
      : {}),
    ...(normalizeEmails(input.targetEmails) !== undefined
      ? { targetEmails: normalizeEmails(input.targetEmails) }
      : {}),
    createdAt: now,
    updatedAt: now,
  }

  if (flags.size >= FEATURE_FLAGS_STORE_MAX) {
    const oldest = flags.keys().next().value
    if (oldest !== undefined) {
      const evicted = flags.get(oldest)
      flags.delete(oldest)
      if (evicted) byKey.delete(evicted.key)
    }
  }
  flags.set(flag.id, flag)
  byKey.set(flag.key, flag.id)
  return flag
}

/** All flags, newest first. */
export function listFlags(): FeatureFlag[] {
  return [...flags.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getFlagById(id: string): FeatureFlag | undefined {
  return flags.get(id)
}

export function getFlagByKey(key: string): FeatureFlag | undefined {
  const id = byKey.get(key.trim())
  return id === undefined ? undefined : flags.get(id)
}

/**
 * Applies a partial update. Returns the updated flag, or `undefined` when
 * the id does not exist. Throws on invalid field values. `updatedAt` always
 * advances; `createdAt` never changes.
 */
export function updateFlag(id: string, patch: UpdateFeatureFlagInput): FeatureFlag | undefined {
  const existing = flags.get(id)
  if (!existing) return undefined

  const next: FeatureFlag = { ...existing, updatedAt: nowIso() }

  if (patch.name !== undefined) next.name = normalizeName(patch.name)
  if (patch.description !== undefined) next.description = normalizeDescription(patch.description)
  if (patch.enabled !== undefined) next.enabled = patch.enabled

  if (patch.rolloutPercent !== undefined) {
    if (patch.rolloutPercent === null) {
      delete next.rolloutPercent
    } else {
      next.rolloutPercent = clampPercent(patch.rolloutPercent)
    }
  }
  if (patch.targetUserIds !== undefined) {
    const ids = normalizeUserIds(patch.targetUserIds ?? undefined)
    if (ids === undefined) delete next.targetUserIds
    else next.targetUserIds = ids
  }
  if (patch.targetEmails !== undefined) {
    const emails = normalizeEmails(patch.targetEmails ?? undefined)
    if (emails === undefined) delete next.targetEmails
    else next.targetEmails = emails
  }

  flags.set(id, next)
  return next
}

/** Deletes a flag by id. Returns true when a record was removed. */
export function deleteFlag(id: string): boolean {
  const existing = flags.get(id)
  if (!existing) return false
  flags.delete(id)
  byKey.delete(existing.key)
  return true
}

/**
 * Evaluates one flag for a subject. See the module docstring for the full
 * semantics — disabled/missing flags are false; explicit user/email targets
 * short-circuit to true; otherwise `rolloutPercent` buckets the subject by
 * the stable `hashToBucket` FNV-1a hash (same algorithm as the env-based
 * evaluator in `./feature-flags/evaluate.ts`).
 */
export function isFeatureEnabled(key: string, subject: FlagSubject = {}): boolean {
  const flag = getFlagByKey(key)
  if (!flag || !flag.enabled) return false

  const userId = subject.userId?.trim()
  const email = subject.email?.trim().toLowerCase()

  if (userId && flag.targetUserIds?.includes(userId)) return true
  if (email && flag.targetEmails?.includes(email)) return true

  if (flag.rolloutPercent === undefined) return false

  const percent = Math.min(100, Math.max(0, flag.rolloutPercent))
  if (percent <= 0) return false
  if (percent >= 100) return true

  // Same bucketing contract as `evaluateFlag`: userId wins over email so a
  // caller's bucket is stable across identifier availability.
  return hashToBucket(userId || email || "") < percent
}

/** Keys of every flag enabled for the subject, sorted for stable output. */
export function listEnabledFlagKeys(subject: FlagSubject = {}): string[] {
  return listFlags()
    .filter((flag) => flag.enabled && isFeatureEnabled(flag.key, subject))
    .map((flag) => flag.key)
    .sort()
}

/** Test hook: empties the store. */
export function clearFeatureFlagsForTests(): void {
  flags.clear()
  byKey.clear()
}
