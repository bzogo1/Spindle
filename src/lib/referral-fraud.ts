/**
 * Referral fraud detection — a rule engine that scores referral records for
 * suspicious patterns and maintains an admin review queue.
 *
 * There is no referral backend yet (see `src/lib/referral.ts` — referral
 * attribution is a best-effort client-side hand-off). This module therefore
 * defines the minimal `ReferralRecord` shape the fraud rules need and keeps
 * BOTH the source records and the resulting flags in process-local `Map`s —
 * the same interim-store pattern as `beta-access.ts` / `win-back.ts`. On
 * serverless or multi-instance deploys each instance keeps its own copy and
 * everything is lost on restart; the upgrade path is `Referral` /
 * `ReferralFlag` tables behind the same exported signatures.
 *
 * Pure analysis (`analyzeReferral`) is deliberately separated from the
 * store: callers may scan an explicit record list or the dev-seam store via
 * `scanReferrals()`.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it.
 */

export const REFERRAL_FRAUD_FLAG_STATUSES = ["pending", "cleared", "confirmed_fraud"] as const
export type ReferralFraudFlagStatus = (typeof REFERRAL_FRAUD_FLAG_STATUSES)[number]

export function isReferralFraudFlagStatus(value: string): value is ReferralFraudFlagStatus {
  return (REFERRAL_FRAUD_FLAG_STATUSES as readonly string[]).includes(value)
}

/** Minimum score at which a referral is flagged for admin review. */
export const REFERRAL_FRAUD_FLAG_THRESHOLD = 40
/** Velocity rule: more than this many referrals from one referrer in 24h. */
export const REFERRAL_FRAUD_VELOCITY_LIMIT = 5
export const REFERRAL_FRAUD_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000

/** Hard caps so the in-memory stores cannot grow without bound. */
export const REFERRAL_RECORDS_STORE_MAX = 10_000
export const REFERRAL_FLAGS_STORE_MAX = 2_000

/**
 * Minimal referral record shape the rules evaluate. Field names mirror the
 * eventual backend columns (`referrerId`/`referredId` are user ids when the
 * referral backend lands); email and hashed-network fields are optional
 * because the client-side seam may only know the referral code.
 */
export interface ReferralRecord {
  id: string
  referrerId?: string
  referrerEmail?: string
  referredId?: string
  referredEmail?: string
  /** Hashed client IP of the referrer (never a raw IP). */
  referrerIpHash?: string
  /** Hashed client IP of the referred visitor. */
  referredIpHash?: string
  /** Device/session fingerprint shared across referral events, when known. */
  fingerprint?: string
  /** ISO timestamp of the referral event. */
  createdAt: string
}

export interface ReferralAnalysisContext {
  /** "Now" for the velocity window; defaults to `new Date()`. */
  now?: Date
  /**
   * Other records to correlate against (velocity, duplicate fingerprints).
   * Defaults to the process-local store when omitted.
   */
  records?: readonly ReferralRecord[]
}

export interface FraudReason {
  /** Stable rule id, e.g. "self_referral_email". */
  rule: string
  /** Human-readable explanation for the admin queue. */
  detail: string
  /** Points this rule contributed to the score. */
  points: number
}

export interface ReferralAnalysis {
  score: number
  reasons: FraudReason[]
}

export interface FlaggedReferral {
  id: string
  referralId: string
  referrerId?: string
  referrerEmail?: string
  referredId?: string
  referredEmail?: string
  score: number
  reasons: FraudReason[]
  status: ReferralFraudFlagStatus
  /** ISO timestamp of the scan that produced the current score. */
  scannedAt: string
  reviewedBy?: string
  reviewedAt?: string
}

export class ReferralFraudError extends Error {
  readonly code: "not_found" | "invalid_status"
  constructor(code: "not_found" | "invalid_status", message: string) {
    super(message)
    this.name = "ReferralFraudError"
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Rule data                                                           */
/* ------------------------------------------------------------------ */

/**
 * Well-known disposable / throwaway email providers. Kept deliberately
 * small — this is a dev-seam heuristic list, not a maintained blocklist;
 * the real implementation should read a blocklist service or table.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
]

const RULE_POINTS = {
  selfReferralEmail: 50,
  selfReferralIp: 40,
  emailAlias: 35,
  disposableEmail: 35,
  velocity: 30,
  duplicateFingerprint: 25,
  sameEmailDomain: 15,
} as const

/* ------------------------------------------------------------------ */
/* Email helpers                                                       */
/* ------------------------------------------------------------------ */

function normalizeEmail(email: string | undefined): string | null {
  const trimmed = email?.trim().toLowerCase()
  if (!trimmed || !trimmed.includes("@")) return null
  return trimmed
}

function emailDomain(email: string | undefined): string | null {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const at = normalized.lastIndexOf("@")
  const domain = normalized.slice(at + 1)
  return domain.length > 0 ? domain : null
}

/** Strips a `+tag` sub-address: `ada+x@x.com` → `ada@x.com`. */
function stripPlusTag(email: string): string {
  const at = email.indexOf("@")
  if (at === -1) return email
  const local = email.slice(0, at).split("+")[0]
  return `${local}${email.slice(at)}`
}

/* ------------------------------------------------------------------ */
/* Pure analysis                                                       */
/* ------------------------------------------------------------------ */

/**
 * Scores a single referral record against the fraud rules. `context.records`
 * supplies the surrounding population for correlation rules (velocity,
 * duplicate fingerprints); it defaults to the process-local store.
 *
 * Pure with respect to its arguments: it never mutates the store. Points
 * accumulate per matched rule and the score is capped at 100.
 */
export function analyzeReferral(
  record: ReferralRecord,
  context: ReferralAnalysisContext = {},
): ReferralAnalysis {
  const reasons: FraudReason[] = []
  const add = (rule: string, detail: string, points: number) => {
    reasons.push({ rule, detail, points })
  }

  const referrerEmail = normalizeEmail(record.referrerEmail)
  const referredEmail = normalizeEmail(record.referredEmail)
  const referrerIp = record.referrerIpHash?.trim() || null
  const referredIp = record.referredIpHash?.trim() || null

  // Self-referral: identical normalized email addresses.
  if (referrerEmail && referredEmail && referrerEmail === referredEmail) {
    add(
      "self_referral_email",
      "Referrer and referred email addresses are identical.",
      RULE_POINTS.selfReferralEmail,
    )
  }

  // Self-referral via plus-addressing: `ada+ref@x.com` → `ada@x.com`.
  if (
    referrerEmail &&
    referredEmail &&
    referrerEmail !== referredEmail &&
    stripPlusTag(referrerEmail) === stripPlusTag(referredEmail)
  ) {
    add(
      "email_alias",
      "Emails differ only by a +tag sub-address — likely the same mailbox.",
      RULE_POINTS.emailAlias,
    )
  }

  // Self-referral: identical hashed client IP.
  if (referrerIp && referredIp && referrerIp === referredIp) {
    add(
      "self_referral_ip",
      "Referrer and referred share the same hashed IP address.",
      RULE_POINTS.selfReferralIp,
    )
  }

  // Disposable email: the referred address (or referrer) uses a throwaway
  // provider — classic multi-account referral farming.
  const domains = [emailDomain(record.referrerEmail), emailDomain(record.referredEmail)]
  const disposable = domains.find(
    (domain): domain is string => domain !== null && DISPOSABLE_EMAIL_DOMAINS.includes(domain),
  )
  if (disposable) {
    add(
      "disposable_email",
      `Email domain "${disposable}" is a known disposable provider.`,
      RULE_POINTS.disposableEmail,
    )
  }

  // Same-domain signal: referrer and referred share an email domain. Weak
  // on its own (coworkers refer each other legitimately) but stacks with
  // the others.
  const referrerDomain = emailDomain(record.referrerEmail)
  const referredDomain = emailDomain(record.referredEmail)
  // Skip when the pair is already scored as self/alias — the strong self
  // rules carry the signal; stacking same-domain on top would double-count.
  const sameMailbox =
    referrerEmail !== null &&
    referredEmail !== null &&
    stripPlusTag(referrerEmail) === stripPlusTag(referredEmail)
  if (
    referrerDomain &&
    referredDomain &&
    referrerDomain === referredDomain &&
    !sameMailbox &&
    !DISPOSABLE_EMAIL_DOMAINS.includes(referrerDomain)
  ) {
    add(
      "same_email_domain",
      `Referrer and referred share the email domain "${referrerDomain}".`,
      RULE_POINTS.sameEmailDomain,
    )
  }

  // Correlation rules need the surrounding record set.
  const population = context.records ?? listReferralRecords()
  const now = context.now ?? new Date()
  const referrerKey = record.referrerId ?? record.referrerEmail ?? null

  // Velocity: more than N referrals attributed to the same referrer inside
  // the trailing 24h window.
  if (referrerKey) {
    const windowStart = now.getTime() - REFERRAL_FRAUD_VELOCITY_WINDOW_MS
    const recent = population.filter((other) => {
      if (other.id === record.id) return false
      const otherKey = other.referrerId ?? other.referrerEmail ?? null
      if (otherKey !== referrerKey) return false
      const at = Date.parse(other.createdAt)
      return Number.isFinite(at) && at >= windowStart && at <= now.getTime()
    })
    if (recent.length + 1 > REFERRAL_FRAUD_VELOCITY_LIMIT) {
      add(
        "velocity",
        `Referrer created ${recent.length + 1} referrals in the last 24h (limit ${REFERRAL_FRAUD_VELOCITY_LIMIT}).`,
        RULE_POINTS.velocity,
      )
    }
  }

  // Duplicate fingerprint: the same device/session fingerprint appears on a
  // different referral record.
  const fingerprint = record.fingerprint?.trim()
  if (fingerprint) {
    const dupe = population.some(
      (other) => other.id !== record.id && other.fingerprint?.trim() === fingerprint,
    )
    if (dupe) {
      add(
        "duplicate_fingerprint",
        "This referral shares a device fingerprint with another referral.",
        RULE_POINTS.duplicateFingerprint,
      )
    }
  }

  const score = Math.min(
    100,
    reasons.reduce((total, reason) => total + reason.points, 0),
  )
  return { score, reasons }
}

/* ------------------------------------------------------------------ */
/* In-memory dev seam stores                                           */
/* ------------------------------------------------------------------ */

const referralRecords = new Map<string, ReferralRecord>()
const flags = new Map<string, FlaggedReferral>()

function flagId(): string {
  return `rff_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Stores a referral record in the dev-seam population that `scanReferrals`
 * analyzes. Bounded: oldest record is evicted past
 * `REFERRAL_RECORDS_STORE_MAX`. Returns the stored record.
 */
export function addReferralRecord(record: ReferralRecord): ReferralRecord {
  if (referralRecords.size >= REFERRAL_RECORDS_STORE_MAX) {
    const oldest = referralRecords.keys().next().value
    if (oldest !== undefined) referralRecords.delete(oldest)
  }
  referralRecords.set(record.id, record)
  return record
}

/** All stored referral records, insertion-ordered. Do not mutate. */
export function listReferralRecords(): ReferralRecord[] {
  return [...referralRecords.values()]
}

/**
 * Runs the fraud rules over every stored referral record (or an explicit
 * `records` list) and upserts one flag per referral scoring at or above
 * `REFERRAL_FRAUD_FLAG_THRESHOLD`. Existing flags keep their review status —
 * a rescan refreshes score/reasons but never re-opens a reviewed flag.
 * Returns the flagged referrals, highest score first.
 */
export function scanReferrals(
  records: readonly ReferralRecord[] = listReferralRecords(),
  now: Date = new Date(),
): FlaggedReferral[] {
  const scannedAt = now.toISOString()
  for (const record of records) {
    const { score, reasons } = analyzeReferral(record, { now, records })
    if (score < REFERRAL_FRAUD_FLAG_THRESHOLD) continue

    const existing = [...flags.values()].find((flag) => flag.referralId === record.id)
    if (existing) {
      existing.score = score
      existing.reasons = reasons
      existing.scannedAt = scannedAt
      existing.referrerId = record.referrerId
      existing.referrerEmail = record.referrerEmail
      existing.referredId = record.referredId
      existing.referredEmail = record.referredEmail
      continue
    }

    if (flags.size >= REFERRAL_FLAGS_STORE_MAX) {
      // Evict the oldest pending flag; reviewed flags are kept.
      const evictable = [...flags.values()].find((flag) => flag.status === "pending")
      if (evictable) flags.delete(evictable.id)
      else {
        const oldest = flags.keys().next().value
        if (oldest !== undefined) flags.delete(oldest)
      }
    }

    const id = flagId()
    flags.set(id, {
      id,
      referralId: record.id,
      referrerId: record.referrerId,
      referrerEmail: record.referrerEmail,
      referredId: record.referredId,
      referredEmail: record.referredEmail,
      score,
      reasons,
      status: "pending",
      scannedAt,
    })
  }
  return listFlags({}).items
}

/**
 * Sets a flag's review status. `reviewer` is the verified admin email from
 * `requireAdmin`. Throws `ReferralFraudError("not_found")` for unknown ids
 * and `("invalid_status")` for bad statuses.
 */
export function reviewFlag(
  id: string,
  status: ReferralFraudFlagStatus,
  reviewer: string,
): FlaggedReferral {
  const flag = flags.get(id)
  if (!flag) {
    throw new ReferralFraudError("not_found", "Flag not found.")
  }
  if (!isReferralFraudFlagStatus(status)) {
    throw new ReferralFraudError("invalid_status", "Invalid flag status.")
  }
  flag.status = status
  flag.reviewedBy = reviewer
  flag.reviewedAt = nowIso()
  return flag
}

/** One flag by id, or `undefined`. */
export function getFlag(id: string): FlaggedReferral | undefined {
  return flags.get(id)
}

/**
 * Flags sorted by score descending then scan time descending. `status`
 * filters to one queue state; `limit`/`offset` paginate (limit clamped to
 * 500). Returns the live records; callers must not mutate them.
 */
export function listFlags(
  filter: {
    status?: ReferralFraudFlagStatus
    limit?: number
    offset?: number
  } = {},
): { items: FlaggedReferral[]; total: number } {
  const all = [...flags.values()].sort(
    (a, b) =>
      b.score - a.score || b.scannedAt.localeCompare(a.scannedAt) || b.id.localeCompare(a.id),
  )
  const filtered = filter.status ? all.filter((flag) => flag.status === filter.status) : all
  const offset = Math.max(filter.offset ?? 0, 0)
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
  return { items: filtered.slice(offset, offset + limit), total: filtered.length }
}

/** JSON-safe flag view for API responses. */
export function flagJson(flag: FlaggedReferral) {
  return {
    id: flag.id,
    referralId: flag.referralId,
    referrerId: flag.referrerId ?? null,
    referrerEmail: flag.referrerEmail ?? null,
    referredId: flag.referredId ?? null,
    referredEmail: flag.referredEmail ?? null,
    score: flag.score,
    reasons: flag.reasons,
    status: flag.status,
    scannedAt: flag.scannedAt,
    reviewedBy: flag.reviewedBy ?? null,
    reviewedAt: flag.reviewedAt ?? null,
  }
}

/** Test hook: clears referral records, flags, and review state. */
export function clearReferralFraudStoreForTests(): void {
  referralRecords.clear()
  flags.clear()
}
