import { getAttribution, getReferralProgramSettings, markRewarded } from "@/lib/referral-program"

/**
 * Referral reward ledger — fulfillment records on top of the referral
 * program core (`src/lib/referral-program.ts`).
 *
 * IMPORTANT: this is a REPORTING-ONLY ledger. Issuing a reward records
 * that a referrer earned something conceptually (the program's
 * `rewardLabel` / `rewardAmountCents` are labels for analytics and admin
 * review). NO real credits, payouts, or account entitlements are applied
 * anywhere — there is no payout pipeline.
 *
 * DEVELOPMENT SEAM: all state lives in a process-local `Map`, the same
 * interim-store pattern as `referral-program.ts` / `referral-fraud.ts`.
 * On serverless or multi-instance deploys each instance keeps its own
 * copy and everything is lost on restart. The upgrade path is a
 * `ReferralReward` table behind the same exported signatures.
 *
 * Server-only in practice: imported by route handlers and API tests;
 * client components must not import it.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Fixed reward kinds. `type` is a coarse classification for reporting;
 * the human-readable description of what was earned lives on the
 * program settings' `rewardLabel` (surfaced alongside rewards in the
 * API/UI), so a settings change does not rewrite history.
 */
export const REFERRAL_REWARD_TYPES = ["credit", "badge", "trial_extension"] as const
export type ReferralRewardType = (typeof REFERRAL_REWARD_TYPES)[number]

export function isReferralRewardType(value: string): value is ReferralRewardType {
  return (REFERRAL_REWARD_TYPES as readonly string[]).includes(value)
}

/**
 * Reward lifecycle:
 *
 *   pending → issued    ({@link issueRewardForAttribution} creates the
 *                        record as `pending` then transitions it to
 *                        `issued` in the same call, stamping `issuedAt`;
 *                        `pending` is reserved for future review-queue
 *                        flows where an admin stages a reward before
 *                        issuing it)
 *   pending → revoked   (a staged reward cancelled before issue)
 *   issued  → revoked   (an issued reward clawed back, e.g. fraud
 *                        confirmed after the fact)
 *   revoked is terminal — there are no transitions out of it.
 */
export const REFERRAL_REWARD_STATUSES = ["pending", "issued", "revoked"] as const
export type ReferralRewardStatus = (typeof REFERRAL_REWARD_STATUSES)[number]

export function isReferralRewardStatus(value: string): value is ReferralRewardStatus {
  return (REFERRAL_REWARD_STATUSES as readonly string[]).includes(value)
}

export interface ReferralReward {
  id: string
  /** The qualified attribution this reward fulfils (unique — one reward per attribution). */
  attributionId: string
  /** The referrer who earned the reward (copied from the attribution). */
  referrerUserId: string
  type: ReferralRewardType
  status: ReferralRewardStatus
  /**
   * Reporting value in cents only — `null` means "no monetary value".
   * Defaults to the program settings' `rewardAmountCents` at issue time.
   * NEVER triggers a payout.
   */
  amountCents: number | null
  /** ISO timestamp when the reward reached `issued`. */
  issuedAt?: string
  /** ISO timestamp when the reward was revoked. */
  revokedAt?: string
  /** Human-readable note: why it was issued / why it was revoked. */
  reason: string
}

export interface IssueRewardOptions {
  /** Reward kind; defaults to `"credit"`. */
  type?: ReferralRewardType
  /**
   * Reporting amount in cents. `undefined` falls back to the program
   * settings' `rewardAmountCents`; `null` explicitly records "no
   * monetary value".
   */
  amountCents?: number | null
  /** Free-text issuance note (e.g. admin justification). */
  reason?: string
  /**
   * Fraud override seam: when `true`, the reward is refused even if the
   * attribution is not (yet) marked `fraudFlagged` — used when a caller
   * has fresher fraud signal than the attribution record. The
   * attribution's own `fraudFlagged` flag is always honoured.
   */
  fraudFlagged?: boolean
  /**
   * Whether to advance the attribution `qualified → rewarded` via
   * `markRewarded` (which also enforces `maxRewardsPerUser`). Defaults
   * to `true`. When the attribution is already `rewarded` the call is
   * skipped so re-issuing after a store reset stays possible; pass
   * `false` to keep the attribution untouched entirely.
   */
  syncAttribution?: boolean
}

export class ReferralRewardError extends Error {
  readonly code:
    "invalid" | "not_found" | "conflict" | "invalid_transition" | "limit" | "fraud_flagged"
  constructor(
    code: "invalid" | "not_found" | "conflict" | "invalid_transition" | "limit" | "fraud_flagged",
    message: string,
  ) {
    super(message)
    this.name = "ReferralRewardError"
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** Hard cap so the in-memory ledger cannot grow without bound. */
export const REFERRAL_REWARDS_STORE_MAX = 5_000

const REASON_MAX = 500

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const rewards = new Map<string, ReferralReward>() // id → record (insertion order)
const rewardsByAttribution = new Map<string, string>() // attributionId → reward id

/**
 * Bounded tombstone set of attribution ids whose reward was revoked.
 *
 * Eviction may delete the reward record and its `rewardsByAttribution`
 * index entry (dead weight), but a revoked reward must never be
 * re-issued for the same attribution — clawback is final. The tombstone
 * keeps that guarantee alive even after the record itself is evicted.
 * Capped at {@link REFERRAL_REWARDS_STORE_MAX}; oldest entries are
 * dropped first (FIFO via `Set` insertion order).
 */
const revokedAttributionIds = new Set<string>()

function tombstoneAttribution(attributionId: string): void {
  if (revokedAttributionIds.has(attributionId)) return
  if (revokedAttributionIds.size >= REFERRAL_REWARDS_STORE_MAX) {
    const oldest = revokedAttributionIds.values().next().value
    if (oldest !== undefined) revokedAttributionIds.delete(oldest)
  }
  revokedAttributionIds.add(attributionId)
}

function rewardId(): string {
  return `rfr_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function assertAmountCents(value: number | null): void {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new ReferralRewardError("invalid", "amountCents must be a non-negative integer or null.")
  }
}

function cleanReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? ""
  return trimmed ? trimmed.slice(0, REASON_MAX) : ""
}

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

/**
 * Issues a reward for a qualified, non-fraud-flagged attribution.
 *
 * Rules:
 *  - The attribution must exist and be in status `"qualified"` (a
 *    `pending` click must be qualified first; `rewarded`/`rejected`
 *    are terminal for reward issuance — see `syncAttribution` for the
 *    already-rewarded edge case).
 *  - The attribution must not be fraud-flagged — neither via its own
 *    `fraudFlagged` field nor via `options.fraudFlagged`.
 *  - At most one reward record per attribution (`conflict` on repeats —
 *    this is the double-issue guard), and an attribution whose reward was
 *    revoked can never be re-issued (clawback is final — see
 *    `revokeReward`).
 *  - Store capacity is resolved BEFORE the attribution is advanced: when
 *    the store is full of `issued` rewards `evictForCapacity` throws
 *    `ReferralRewardError("limit")`, and that failure must not consume
 *    the attribution's `maxRewardsPerUser` slot or leave it `rewarded`
 *    with no reward record.
 *  - By default the attribution is advanced `qualified → rewarded` via
 *    `markRewarded`, which enforces `maxRewardsPerUser`; a `limit`
 *    failure there aborts issuance and leaves no reward record. (The
 *    capacity eviction above may already have dropped a dead
 *    revoked/pending record — harmless, eviction only reclaims space.)
 *
 * The record is created `pending` and transitioned to `issued` in the
 * same call (see the status docs for the state machine). Returns the
 * issued reward.
 */
export function issueRewardForAttribution(
  attributionId: string,
  options: IssueRewardOptions = {},
): ReferralReward {
  const id = attributionId.trim()
  if (!id) {
    throw new ReferralRewardError("invalid", "An attribution id is required.")
  }

  const attribution = getAttribution(id)
  if (!attribution) {
    throw new ReferralRewardError("not_found", "Attribution not found.")
  }
  if (attribution.fraudFlagged || options.fraudFlagged === true) {
    throw new ReferralRewardError(
      "fraud_flagged",
      "Cannot issue a reward for a fraud-flagged attribution.",
    )
  }
  if (attribution.status !== "qualified" && attribution.status !== "rewarded") {
    throw new ReferralRewardError(
      "invalid_transition",
      `Cannot issue a reward for an attribution in status "${attribution.status}".`,
    )
  }
  if (rewardsByAttribution.has(id) || revokedAttributionIds.has(id)) {
    throw new ReferralRewardError(
      "conflict",
      revokedAttributionIds.has(id)
        ? "A reward for this attribution was revoked and cannot be re-issued."
        : "A reward already exists for this attribution.",
    )
  }

  const type = options.type ?? "credit"
  if (!isReferralRewardType(type)) {
    throw new ReferralRewardError("invalid", "Unknown reward type.")
  }
  const amountCents =
    options.amountCents === undefined
      ? getReferralProgramSettings().rewardAmountCents
      : options.amountCents
  assertAmountCents(amountCents)
  const reason = cleanReason(options.reason)

  // Resolve store capacity BEFORE advancing the attribution: a "limit"
  // failure here (store full of issued rewards) must not leave the
  // attribution `rewarded` — which would consume a `maxRewardsPerUser`
  // slot — with no reward record behind it.
  if (rewards.size >= REFERRAL_REWARDS_STORE_MAX) {
    evictForCapacity()
  }

  // Advance the attribution second: a `limit`/`invalid_transition` failure
  // here must not leave an orphan reward record behind.
  const syncAttribution = options.syncAttribution !== false
  if (syncAttribution && attribution.status === "qualified") {
    markRewarded(id) // enforces maxRewardsPerUser; may throw ReferralProgramError
  }

  const reward: ReferralReward = {
    id: rewardId(),
    attributionId: id,
    referrerUserId: attribution.referrerUserId,
    type,
    status: "pending",
    amountCents,
    reason,
  }
  rewards.set(reward.id, reward)
  rewardsByAttribution.set(id, reward.id)

  return issuePendingReward(reward.id)
}

/**
 * Capacity policy for the bounded ledger: evict the oldest `revoked`
 * record first (dead weight), then the oldest `pending` record; if the
 * store is full of `issued` rewards the call throws
 * `ReferralRewardError("limit")` — issued rewards are never silently
 * dropped.
 */
function evictForCapacity(): void {
  for (const status of ["revoked", "pending"] as const) {
    for (const reward of rewards.values()) {
      if (reward.status === status) {
        rewards.delete(reward.id)
        rewardsByAttribution.delete(reward.attributionId)
        return
      }
    }
  }
  throw new ReferralRewardError(
    "limit",
    `Reward store is full (${REFERRAL_REWARDS_STORE_MAX} records).`,
  )
}

/* ------------------------------------------------------------------ */
/* Transitions                                                          */
/* ------------------------------------------------------------------ */

const REWARD_TRANSITIONS: Record<
  "issue" | "revoke",
  { to: ReferralRewardStatus; from: readonly ReferralRewardStatus[] }
> = {
  // pending → issued; issuing an already-issued reward is a no-op-safe
  // conflict handled by the duplicate-attribution guard upstream.
  issue: { to: "issued", from: ["pending"] },
  // pending|issued → revoked; revoked is terminal.
  revoke: { to: "revoked", from: ["pending", "issued"] },
}

function transitionReward(
  id: string,
  action: keyof typeof REWARD_TRANSITIONS,
  extra: Partial<ReferralReward> = {},
): ReferralReward {
  const reward = rewards.get(id)
  if (!reward) {
    throw new ReferralRewardError("not_found", "Reward not found.")
  }
  const rule = REWARD_TRANSITIONS[action]
  if (!rule.from.includes(reward.status)) {
    throw new ReferralRewardError(
      "invalid_transition",
      `Cannot ${action} a reward in status "${reward.status}".`,
    )
  }
  reward.status = rule.to
  Object.assign(reward, extra)
  return reward
}

/** One reward by id, or `undefined`. */
export function getReward(id: string): ReferralReward | undefined {
  return rewards.get(id)
}

/** The reward record for an attribution, or `undefined`. */
export function getRewardForAttribution(attributionId: string): ReferralReward | undefined {
  const id = rewardsByAttribution.get(attributionId.trim())
  return id ? rewards.get(id) : undefined
}

/**
 * `pending → issued` for a staged reward. Normally unreachable through
 * the public API (issue happens inside
 * {@link issueRewardForAttribution}) but kept as the explicit transition
 * so future review-queue flows can stage then issue.
 */
export function issuePendingReward(id: string): ReferralReward {
  return transitionReward(id, "issue", { issuedAt: nowIso() })
}

/**
 * `pending|issued → revoked`. `reason` is stored on the record for
 * audit (fraud confirmed, policy violation, manual correction). Throws
 * `invalid_transition` from `revoked` (terminal) and `not_found` for
 * unknown ids.
 *
 * Clawback semantics — INTENTIONAL: revocation is a ledger-only
 * clawback. The attribution is NOT un-rewarded: `referral-program.ts`
 * has no `rewarded → qualified` transition (`rewarded` is terminal), so
 * the attribution stays `"rewarded"` and its `maxRewardsPerUser` slot
 * remains consumed. Likewise the attribution id is tombstoned
 * (`revokedAttributionIds`) so the reward can never be re-issued for it,
 * even after the revoked record itself is evicted under store pressure.
 */
export function revokeReward(id: string, reason?: string): ReferralReward {
  const reward = rewards.get(id)
  if (!reward) {
    throw new ReferralRewardError("not_found", "Reward not found.")
  }
  const trimmed = reason?.trim()
  const revoked = transitionReward(id, "revoke", {
    revokedAt: nowIso(),
    ...(trimmed ? { reason: trimmed.slice(0, REASON_MAX) } : {}),
  })
  tombstoneAttribution(revoked.attributionId)
  return revoked
}

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

export interface RewardListFilter {
  status?: ReferralRewardStatus
  type?: ReferralRewardType
  /** Restrict to rewards earned by one referrer. */
  referrerUserId?: string
  /** Restrict to the reward for one attribution. */
  attributionId?: string
  /** Page size, clamped to 1–500; defaults to 200. */
  limit?: number
  offset?: number
}

function matchesFilter(reward: ReferralReward, filter: RewardListFilter): boolean {
  if (filter.status && reward.status !== filter.status) return false
  if (filter.type && reward.type !== filter.type) return false
  if (filter.referrerUserId && reward.referrerUserId !== filter.referrerUserId) return false
  if (filter.attributionId && reward.attributionId !== filter.attributionId) return false
  return true
}

function sortNewestFirst(a: ReferralReward, b: ReferralReward): number {
  // Issued/revoked timestamps when present, else insertion order via id.
  const aAt = a.issuedAt ?? a.revokedAt ?? ""
  const bAt = b.issuedAt ?? b.revokedAt ?? ""
  return bAt.localeCompare(aAt) || b.id.localeCompare(a.id)
}

function paginate(
  all: ReferralReward[],
  filter: RewardListFilter,
): { items: ReferralReward[]; total: number } {
  const filtered = all.filter((reward) => matchesFilter(reward, filter))
  filtered.sort(sortNewestFirst)
  const offset = Math.max(filter.offset ?? 0, 0)
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
  return { items: filtered.slice(offset, offset + limit), total: filtered.length }
}

/**
 * The caller's own rewards, newest first. `status` filters to a single
 * state; `limit`/`offset` paginate (limit clamped to 500). Returns the
 * live records — callers must not mutate them.
 */
export function listRewardsForUser(
  userId: string,
  filter: Omit<RewardListFilter, "referrerUserId"> = {},
): { items: ReferralReward[]; total: number } {
  const normalized = userId.trim()
  if (!normalized) return { items: [], total: 0 }
  return paginate(
    [...rewards.values()].filter((reward) => reward.referrerUserId === normalized),
    filter,
  )
}

/**
 * Admin listing across every referrer, newest first. Supports `status`,
 * `type`, `referrerUserId`, and `attributionId` filters plus `limit` /
 * `offset` pagination (limit clamped to 500).
 */
export function listRewardsForAdmin(filter: RewardListFilter = {}): {
  items: ReferralReward[]
  total: number
} {
  return paginate([...rewards.values()], filter)
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export interface ReferralRewardStats {
  total: number
  pending: number
  issued: number
  revoked: number
  /** Count per reward type (every type key always present). */
  byType: Record<ReferralRewardType, number>
}

function emptyRewardStats(): ReferralRewardStats {
  return {
    total: 0,
    pending: 0,
    issued: 0,
    revoked: 0,
    byType: { credit: 0, badge: 0, trial_extension: 0 },
  }
}

/**
 * Reward ledger stats. With `referrerUserId` counts only that user's
 * rewards; without it counts the whole store. `status`/`type` narrow the
 * counted set (stats then describe the filtered subset).
 */
export function rewardStats(filter: RewardListFilter = {}): ReferralRewardStats {
  const stats = emptyRewardStats()
  for (const reward of rewards.values()) {
    if (!matchesFilter(reward, filter)) continue
    stats.total += 1
    stats[reward.status] += 1
    stats.byType[reward.type] += 1
  }
  return stats
}

/* ------------------------------------------------------------------ */
/* JSON view                                                           */
/* ------------------------------------------------------------------ */

/** JSON-safe reward view for API responses. */
export function rewardJson(reward: ReferralReward) {
  return {
    id: reward.id,
    attributionId: reward.attributionId,
    referrerUserId: reward.referrerUserId,
    type: reward.type,
    status: reward.status,
    amountCents: reward.amountCents,
    issuedAt: reward.issuedAt ?? null,
    revokedAt: reward.revokedAt ?? null,
    reason: reward.reason,
  }
}

/** Convenience: the program's reward label for display alongside rewards. */
export function rewardLabel(): string {
  return getReferralProgramSettings().rewardLabel
}

/* ------------------------------------------------------------------ */
/* Test hooks                                                          */
/* ------------------------------------------------------------------ */

/** Test hook: clears the reward ledger. Does not touch program stores. */
export function resetReferralRewardsStoreForTests(): void {
  rewards.clear()
  rewardsByAttribution.clear()
  revokedAttributionIds.clear()
}

/**
 * Test/diagnostic hook: store size for bounds assertions.
 * `rewards` is the live record count (capped at
 * `REFERRAL_REWARDS_STORE_MAX`).
 */
export function getReferralRewardsStoreForTests(): { rewards: number } {
  return { rewards: rewards.size }
}
