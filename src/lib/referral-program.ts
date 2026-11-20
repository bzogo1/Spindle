import { isAnyReferralCode, normalizeReferralVanityCode } from "@/lib/referral"

/**
 * Referral program core: program settings, per-user referral codes, and
 * attribution records.
 *
 * DEVELOPMENT SEAM: all state lives in process-local `Map`s, the same
 * interim-store pattern as `affiliate.ts` / `win-back.ts` / `referral-fraud.ts`.
 * On serverless or multi-instance deploys each instance keeps its own copy
 * and everything is lost on restart. The upgrade path is `ReferralCode` /
 * `ReferralAttribution` / settings tables behind the same exported
 * signatures.
 *
 * There are NO real payouts: `rewardAmountCents` is a reporting label only —
 * `markRewarded` records that a reward was granted conceptually, it never
 * moves money.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it.
 */

/* ------------------------------------------------------------------ */
/* Program settings                                                    */
/* ------------------------------------------------------------------ */

export interface ReferralProgramSettings {
  /** Master switch — when false the public API reports the program off. */
  enabled: boolean
  /** Human-readable reward description shown to users, e.g. "One month free". */
  rewardLabel: string
  /**
   * Optional reward value in cents for reporting/analytics only. `null`
   * means "no monetary value" — there is no payout pipeline.
   */
  rewardAmountCents: number | null
  /** Max rewarded attributions a single referrer may accumulate. */
  maxRewardsPerUser: number
  /**
   * Attribution window in days: how long after a click a signup may still
   * qualify the referral. Reporting metadata for Phase-10 surfaces.
   */
  windowDays: number
}

export const REFERRAL_PROGRAM_DEFAULTS: ReferralProgramSettings = {
  enabled: true,
  rewardLabel: "A free month of Spindle Pro",
  rewardAmountCents: null,
  maxRewardsPerUser: 12,
  windowDays: 30,
}

export const REFERRAL_REWARD_LABEL_MAX = 200
export const REFERRAL_MAX_REWARDS_PER_USER_MAX = 1000
export const REFERRAL_WINDOW_DAYS_MAX = 3650

function validateSettings(patch: Partial<ReferralProgramSettings>): ReferralProgramSettings {
  const next = { ...getReferralProgramSettings(), ...patch }

  if (typeof next.enabled !== "boolean") {
    throw new ReferralProgramError("invalid", "enabled must be a boolean.")
  }
  const rewardLabel = next.rewardLabel.trim()
  if (!rewardLabel || rewardLabel.length > REFERRAL_REWARD_LABEL_MAX) {
    throw new ReferralProgramError(
      "invalid",
      `rewardLabel must be 1-${REFERRAL_REWARD_LABEL_MAX} characters.`,
    )
  }
  if (
    next.rewardAmountCents !== null &&
    (!Number.isInteger(next.rewardAmountCents) || next.rewardAmountCents < 0)
  ) {
    throw new ReferralProgramError(
      "invalid",
      "rewardAmountCents must be a non-negative integer or null.",
    )
  }
  if (
    !Number.isInteger(next.maxRewardsPerUser) ||
    next.maxRewardsPerUser < 1 ||
    next.maxRewardsPerUser > REFERRAL_MAX_REWARDS_PER_USER_MAX
  ) {
    throw new ReferralProgramError(
      "invalid",
      `maxRewardsPerUser must be an integer between 1 and ${REFERRAL_MAX_REWARDS_PER_USER_MAX}.`,
    )
  }
  if (
    !Number.isInteger(next.windowDays) ||
    next.windowDays < 1 ||
    next.windowDays > REFERRAL_WINDOW_DAYS_MAX
  ) {
    throw new ReferralProgramError(
      "invalid",
      `windowDays must be an integer between 1 and ${REFERRAL_WINDOW_DAYS_MAX}.`,
    )
  }

  return {
    enabled: next.enabled,
    rewardLabel,
    rewardAmountCents: next.rewardAmountCents,
    maxRewardsPerUser: next.maxRewardsPerUser,
    windowDays: next.windowDays,
  }
}

/* ------------------------------------------------------------------ */
/* Referral codes                                                      */
/* ------------------------------------------------------------------ */

export interface ReferralCode {
  id: string
  /** Canonical `SPN-XXXX-XXXX` or vanity `SPN-<slug>` code. */
  code: string
  /** Stable per-user key (auth uid or `mock:<email>`), same as affiliate. */
  userId: string
  /** True when `code` was user-chosen via {@link setVanityReferralCode}. */
  vanity: boolean
  /** ISO timestamp — record creation time. */
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* Attributions                                                        */
/* ------------------------------------------------------------------ */

export const REFERRAL_ATTRIBUTION_STATUSES = [
  "pending",
  "qualified",
  "rewarded",
  "rejected",
] as const
export type ReferralAttributionStatus = (typeof REFERRAL_ATTRIBUTION_STATUSES)[number]

export function isReferralAttributionStatus(value: string): value is ReferralAttributionStatus {
  return (REFERRAL_ATTRIBUTION_STATUSES as readonly string[]).includes(value)
}

/**
 * How the attribution was recorded:
 *  - `"click"` — an anonymous `/r/<code>` or `?ref=` landing hit; no
 *    referred user is known yet.
 *  - `"signup"` — bound to a `referredUserId` at auth completion.
 *  - `"manual"` — recorded directly through the API/library (tests, admin
 *    tooling, future backfills).
 */
export const REFERRAL_ATTRIBUTION_SOURCES = ["click", "signup", "manual"] as const
export type ReferralAttributionSource = (typeof REFERRAL_ATTRIBUTION_SOURCES)[number]

export interface ReferralAttribution {
  id: string
  /** The referral code as recorded (may differ from the owner's current code after a vanity upgrade). */
  code: string
  /** Owner of `code` at record time. */
  referrerUserId: string
  /** Referred user once known; null for anonymous clicks. */
  referredUserId: string | null
  status: ReferralAttributionStatus
  source: ReferralAttributionSource
  /** ISO timestamp. */
  createdAt: string
  qualifiedAt?: string
  rewardedAt?: string
  /** Set when status becomes "rejected". */
  rejectedReason?: string
  /**
   * Fraud seam: set when the optional fraud check (or a later
   * `flagAttributionFraud` call, e.g. from `referral-fraud.ts` scans)
   * marks this record suspicious. Flagged records can still transition but
   * should be reviewed before `markRewarded`.
   */
  fraudFlagged?: boolean
}

/** State machine — see {@link qualifyAttribution} / {@link markRewarded} / {@link rejectAttribution}. */
const ATTRIBUTION_TRANSITIONS: Record<
  "qualify" | "reward" | "reject",
  { to: ReferralAttributionStatus; from: readonly ReferralAttributionStatus[] }
> = {
  // A click/signup starts pending; qualification confirms the referred
  // user met the program criteria inside the attribution window.
  qualify: { to: "qualified", from: ["pending"] },
  // Rewards are granted from qualified only — a pending click must be
  // qualified first so unverified signups cannot be paid out.
  reward: { to: "rewarded", from: ["qualified"] },
  // Rejection is allowed from pending or qualified (e.g. fraud confirmed,
  // window expired, policy violation). Rewarded and rejected are terminal.
  reject: { to: "rejected", from: ["pending", "qualified"] },
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** Hard caps so the in-memory stores cannot grow without bound. */
export const REFERRAL_CODES_STORE_MAX = 10_000
export const REFERRAL_ATTRIBUTIONS_STORE_MAX = 10_000

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

let settings: ReferralProgramSettings = { ...REFERRAL_PROGRAM_DEFAULTS }

const codesByUser = new Map<string, string>() // userId → code record id
const codesByCode = new Map<string, string>() // canonical code → code record id
const codeRecords = new Map<string, ReferralCode>() // id → record (insertion order)
const attributions = new Map<string, ReferralAttribution>() // id → record (insertion order)

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1, matches referral.ts patterns

export class ReferralProgramError extends Error {
  readonly code: "invalid" | "not_found" | "conflict" | "invalid_transition" | "limit"
  constructor(
    code: "invalid" | "not_found" | "conflict" | "invalid_transition" | "limit",
    message: string,
  ) {
    super(message)
    this.name = "ReferralProgramError"
    this.code = code
  }
}

function codeRecordId(): string {
  return `rfc_${crypto.randomUUID()}`
}

function attributionId(): string {
  return `rfa_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Current program settings (a copy — mutate via {@link updateReferralProgramSettings}). */
export function getReferralProgramSettings(): ReferralProgramSettings {
  return { ...settings }
}

/**
 * Applies a partial settings update with validation. Unknown/extra fields
 * are ignored by callers' schemas; every provided field is validated and
 * the whole patch is rejected atomically on the first invalid value.
 */
export function updateReferralProgramSettings(
  patch: Partial<ReferralProgramSettings>,
): ReferralProgramSettings {
  settings = validateSettings(patch)
  return getReferralProgramSettings()
}

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

/** The user's referral code record, or null when none exists yet. */
export function getReferralCodeForUser(userId: string): ReferralCode | null {
  const id = codesByUser.get(userId.trim())
  return id ? (codeRecords.get(id) ?? null) : null
}

/** Looks up a code record by its canonical `SPN-…` string (any status). */
export function getReferralCodeByCode(code: string): ReferralCode | null {
  const normalized = code.trim().toUpperCase()
  if (!isAnyReferralCode(normalized)) return null
  const id = codesByCode.get(normalized)
  return id ? (codeRecords.get(id) ?? null) : null
}

/** Generates a unique `SPN-XXXX-XXXX` code not already in use. */
function generateReferralCode(): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const segment = () =>
      Array.from(
        { length: 4 },
        () => CODE_ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0] % CODE_ALPHABET.length],
      ).join("")
    const code = `SPN-${segment()}-${segment()}`
    if (!codesByCode.has(code)) return code
  }
  throw new ReferralProgramError("limit", "Could not allocate a unique referral code.")
}

/**
 * Returns the user's referral code, generating a `SPN-XXXX-XXXX` code on
 * first call. One active code per user — repeat calls return the existing
 * record. Bounded: when the code store is full the oldest record is evicted
 * (its user simply gets a fresh code on next call).
 */
export function getOrCreateReferralCode(userId: string): ReferralCode {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) {
    throw new ReferralProgramError("invalid", "A user id is required.")
  }

  const existing = getReferralCodeForUser(normalizedUserId)
  if (existing) return existing

  if (codeRecords.size >= REFERRAL_CODES_STORE_MAX) {
    const oldest = codeRecords.keys().next().value
    if (oldest !== undefined) {
      const evicted = codeRecords.get(oldest)
      codeRecords.delete(oldest)
      if (evicted) {
        codesByUser.delete(evicted.userId)
        codesByCode.delete(evicted.code)
      }
    }
  }

  const record: ReferralCode = {
    id: codeRecordId(),
    code: generateReferralCode(),
    userId: normalizedUserId,
    vanity: false,
    createdAt: nowIso(),
  }
  codeRecords.set(record.id, record)
  codesByUser.set(record.userId, record.id)
  codesByCode.set(record.code, record.id)
  return record
}

/**
 * Upgrades (or sets) the user's code to a vanity `SPN-<slug>` code.
 *
 * The input is normalized via `normalizeReferralVanityCode` from
 * `src/lib/referral.ts` (accepts the slug with or without the `SPN-`
 * prefix, any case). The candidate must be pattern-valid, must not collide
 * with the generated `SPN-XXXX-XXXX` namespace, and must be unique across
 * all users. Setting a vanity code frees the user's previous code — it can
 * be issued to someone else and old share links for it stop resolving.
 *
 * The user's first call implicitly creates the record (same as
 * {@link getOrCreateReferralCode}); the generated code is discarded.
 */
export function setVanityReferralCode(userId: string, input: string): ReferralCode {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) {
    throw new ReferralProgramError("invalid", "A user id is required.")
  }

  const candidate = normalizeReferralVanityCode(input)
  if (!candidate) {
    throw new ReferralProgramError(
      "invalid",
      "Vanity code must be SPN- followed by a 4-20 character slug (letters, digits, dashes).",
    )
  }

  const owner = getReferralCodeByCode(candidate)
  if (owner && owner.userId !== normalizedUserId) {
    throw new ReferralProgramError("conflict", "That referral code is already taken.")
  }

  // getOrCreate guarantees a record (and handles store-full eviction).
  const record = getOrCreateReferralCode(normalizedUserId)
  if (record.code === candidate) {
    record.vanity = true
    return record
  }

  codesByCode.delete(record.code)
  record.code = candidate
  record.vanity = true
  codesByCode.set(candidate, record.id)
  return record
}

/* ------------------------------------------------------------------ */
/* Attributions                                                        */
/* ------------------------------------------------------------------ */

export interface RecordAttributionInput {
  /** The `SPN-…` code from the link; normalized to upper case. */
  code: string
  /**
   * Click/signup/manual — see {@link REFERRAL_ATTRIBUTION_SOURCES}.
   *
   * TRUSTED-CALLER ONLY: `"signup"` and `"manual"` must never be reachable
   * from the public `/api/referral/attribution` endpoint — that route
   * hardcodes `"click"`. Server code that has already authenticated the
   * referred user (e.g. a future signup-completion hook or admin tooling)
   * calls this function directly with the appropriate source.
   */
  source: ReferralAttributionSource
  /**
   * Referred user id when the click/signup is authenticated. `null`/absent
   * records an anonymous click.
   */
  referredUserId?: string | null
  /**
   * Optional fraud seam: a synchronous check run at record time. Return
   * `true` to mark the record `fraudFlagged` (it is still stored — flagging
   * never silently drops data). Async batch analysis belongs to
   * `referral-fraud.ts` scans, which can call
   * {@link flagAttributionFraud} afterwards.
   */
  fraudCheck?: (record: ReferralAttribution) => boolean
}

export type RecordAttributionResult =
  | { recorded: true; attribution: ReferralAttribution }
  | {
      recorded: false
      reason: "unknown_code" | "self_referral" | "duplicate" | "disabled"
    }

/**
 * Records a click or signup attribution for `code`.
 *
 * Rules:
 *  - The code must match a referral-code pattern AND resolve to an
 *    existing code record (`unknown_code` otherwise — the API layer maps
 *    every failure to the same public response so codes cannot be
 *    enumerated).
 *  - When the program is disabled, nothing is recorded (`disabled`).
 *  - Self-referral is rejected: a `referredUserId` equal to the code
 *    owner's user id records nothing (`self_referral`).
 *  - At most one attribution per referred user: a second record for the
 *    same `referredUserId` is rejected (`duplicate`). Anonymous clicks
 *    (`referredUserId` null) are never deduplicated.
 *
 * Bounded: when the attribution store is full the oldest record is evicted.
 */
export function recordAttribution(input: RecordAttributionInput): RecordAttributionResult {
  const settingsNow = getReferralProgramSettings()
  if (!settingsNow.enabled) return { recorded: false, reason: "disabled" }

  const codeRecord = getReferralCodeByCode(input.code)
  if (!codeRecord) return { recorded: false, reason: "unknown_code" }

  const referredUserId = input.referredUserId?.trim() || null
  if (referredUserId === codeRecord.userId) {
    return { recorded: false, reason: "self_referral" }
  }
  if (referredUserId) {
    for (const existing of attributions.values()) {
      if (existing.referredUserId === referredUserId) {
        return { recorded: false, reason: "duplicate" }
      }
    }
  }

  const attribution: ReferralAttribution = {
    id: attributionId(),
    code: codeRecord.code,
    referrerUserId: codeRecord.userId,
    referredUserId,
    status: "pending",
    source: input.source,
    createdAt: nowIso(),
  }
  if (input.fraudCheck?.(attribution)) {
    attribution.fraudFlagged = true
  }

  if (attributions.size >= REFERRAL_ATTRIBUTIONS_STORE_MAX) {
    const oldest = attributions.keys().next().value
    if (oldest !== undefined) attributions.delete(oldest)
  }
  attributions.set(attribution.id, attribution)
  return { recorded: true, attribution }
}

/** One attribution by id, or `undefined`. */
export function getAttribution(id: string): ReferralAttribution | undefined {
  return attributions.get(id)
}

export interface AttributionListFilter {
  status?: ReferralAttributionStatus
  /** Page size, clamped to 1–500; defaults to 200. */
  limit?: number
  offset?: number
}

/**
 * Admin listing, newest first. `status` filters to a single state;
 * `limit`/`offset` paginate (limit clamped to 500). Returns the live
 * records — callers must not mutate them.
 */
export function listAttributionsForAdmin(filter: AttributionListFilter = {}): {
  items: ReferralAttribution[]
  total: number
} {
  const all = [...attributions.values()]
    .filter((attribution) => !filter.status || attribution.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const offset = Math.max(filter.offset ?? 0, 0)
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
  return { items: all.slice(offset, offset + limit), total: all.length }
}

function assertTransition(
  attribution: ReferralAttribution,
  action: keyof typeof ATTRIBUTION_TRANSITIONS,
): void {
  const rule = ATTRIBUTION_TRANSITIONS[action]
  if (!rule.from.includes(attribution.status)) {
    throw new ReferralProgramError(
      "invalid_transition",
      `Cannot ${action} an attribution in status "${attribution.status}".`,
    )
  }
}

function transition(
  id: string,
  action: keyof typeof ATTRIBUTION_TRANSITIONS,
  extra: Partial<ReferralAttribution> = {},
): ReferralAttribution {
  const attribution = attributions.get(id)
  if (!attribution) {
    throw new ReferralProgramError("not_found", "Attribution not found.")
  }
  assertTransition(attribution, action)
  attribution.status = ATTRIBUTION_TRANSITIONS[action].to
  Object.assign(attribution, extra)
  return attribution
}

/**
 * `pending → qualified`. Marks that the referred user satisfied the
 * program's qualification criteria (e.g. completed signup / first
 * qualifying action inside `windowDays`). Throws
 * `ReferralProgramError("invalid_transition")` from any other status.
 */
export function qualifyAttribution(id: string): ReferralAttribution {
  return transition(id, "qualify", { qualifiedAt: nowIso() })
}

/**
 * `qualified → rewarded`. Validates the state transition BEFORE the cap:
 * calling this on a record that cannot transition (pending, rejected,
 * already rewarded) throws `ReferralProgramError("invalid_transition")`
 * even when the referrer is at the limit. Once the transition is legal,
 * `maxRewardsPerUser` is enforced: when the referrer already has that many
 * `rewarded` attributions the call throws
 * `ReferralProgramError("limit")` and the record is left `qualified`.
 * `rewardAmountCents` is reporting metadata only — no payout occurs.
 */
export function markRewarded(id: string): ReferralAttribution {
  const attribution = attributions.get(id)
  if (!attribution) {
    throw new ReferralProgramError("not_found", "Attribution not found.")
  }
  assertTransition(attribution, "reward")
  const rewardedCount = countByReferrerStatus(attribution.referrerUserId, "rewarded")
  if (rewardedCount >= getReferralProgramSettings().maxRewardsPerUser) {
    throw new ReferralProgramError(
      "limit",
      `Referrer already reached the maximum of ${getReferralProgramSettings().maxRewardsPerUser} rewards.`,
    )
  }
  return transition(id, "reward", { rewardedAt: nowIso() })
}

/**
 * `pending|qualified → rejected`. `reason` is stored on the record for
 * admin review (fraud confirmed, attribution window expired, etc.).
 */
export function rejectAttribution(id: string, reason?: string): ReferralAttribution {
  return transition(id, "reject", {
    ...(reason?.trim() ? { rejectedReason: reason.trim().slice(0, 500) } : {}),
  })
}

/**
 * Fraud seam for batch scanners (`referral-fraud.ts`): marks an existing
 * attribution `fraudFlagged` without changing its status. Idempotent.
 * Returns the record, or `undefined` for unknown ids.
 */
export function flagAttributionFraud(id: string): ReferralAttribution | undefined {
  const attribution = attributions.get(id)
  if (!attribution) return undefined
  attribution.fraudFlagged = true
  return attribution
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export interface ReferralUserStats {
  /** All recorded attributions/clicks attributed to this referrer. */
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  /** Records the fraud seam has marked suspicious. */
  fraudFlagged: number
}

function emptyStats(): ReferralUserStats {
  return { clicks: 0, pending: 0, qualified: 0, rewarded: 0, rejected: 0, fraudFlagged: 0 }
}

function countByReferrerStatus(referrerUserId: string, status: ReferralAttributionStatus): number {
  let count = 0
  for (const attribution of attributions.values()) {
    if (attribution.referrerUserId === referrerUserId && attribution.status === status) {
      count += 1
    }
  }
  return count
}

/**
 * Per-user referral stats: counts of the caller's attributions by status.
 * `clicks` is the total record count (every record began as a click or
 * signup event); the status counters overlap it, not add to it.
 */
export function getReferralStatsForUser(userId: string): ReferralUserStats {
  const normalized = userId.trim()
  const stats = emptyStats()
  if (!normalized) return stats
  for (const attribution of attributions.values()) {
    if (attribution.referrerUserId !== normalized) continue
    stats.clicks += 1
    stats[attribution.status] += 1
    if (attribution.fraudFlagged) stats.fraudFlagged += 1
  }
  return stats
}

export interface ReferralProgramStats extends ReferralUserStats {
  /** Live referral-code records in the store. */
  codes: number
  /** Program-wide totals across every referrer. */
  totals: ReferralUserStats & { codes: number }
}

/**
 * Program-wide stats for admin/analytics surfaces: the caller-scope counts
 * (same shape as {@link getReferralStatsForUser} for `userId`, or zeros)
 * plus store totals. Bounded by the fixed store caps, so this is a linear
 * scan over at most {@link REFERRAL_ATTRIBUTIONS_STORE_MAX} records.
 */
export function getReferralProgramStats(userId?: string): ReferralProgramStats {
  const perUser = userId ? getReferralStatsForUser(userId) : emptyStats()
  const totals: ReferralUserStats & { codes: number } = { ...emptyStats(), codes: codeRecords.size }
  for (const attribution of attributions.values()) {
    totals.clicks += 1
    totals[attribution.status] += 1
    if (attribution.fraudFlagged) totals.fraudFlagged += 1
  }
  return { ...perUser, codes: codeRecords.size, totals }
}

/* ------------------------------------------------------------------ */
/* Test hooks                                                          */
/* ------------------------------------------------------------------ */

/**
 * Test hook: clears codes, attributions, and restores default settings.
 * Does not touch `referral-fraud.ts` stores — flag records there by id may
 * dangle after a reset, same as other dev seams.
 */
export function resetReferralProgramStoreForTests(): void {
  settings = { ...REFERRAL_PROGRAM_DEFAULTS }
  codesByUser.clear()
  codesByCode.clear()
  codeRecords.clear()
  attributions.clear()
}

/**
 * Test/diagnostic hook: store sizes for bounds assertions.
 * `codes`/`attributions` are the live record counts (each capped at its
 * `*_STORE_MAX`).
 */
export function getReferralProgramStoreForTests(): {
  codes: number
  attributions: number
} {
  return { codes: codeRecords.size, attributions: attributions.size }
}
