/**
 * Churn-risk scoring for admin tooling.
 *
 * HEURISTIC, NOT MACHINE LEARNING. `computeChurnRisk` is a transparent
 * weighted checklist over whatever signals the current (mostly in-memory,
 * dev-seam) stores can provide. There is no training data, no model, and no
 * prediction of actual churn — the score is a prioritization aid that says
 * "this account shows risk-shaped signals", nothing more. Treat the output
 * as a reason to look, not a verdict.
 *
 * SIGNAL SOURCES (all best-effort; missing data scores as neutral-ish, never
 * as confirmed-bad):
 *  - `AuthBackend` users: `emailVerified`, `createdAt`, and active sessions
 *    via `listSessions` (a session's `createdAt` is the freshest observable
 *    "last seen" — refresh rotation mints a new session on activity).
 *  - Onboarding store (`src/lib/onboarding.ts`): completion state keyed by
 *    session principal (`user:<id>` / `mock:<email>`).
 *  - Feedback store (`src/lib/feedback.ts`): submissions matched by email;
 *    "bug" category counts as a dissatisfaction proxy.
 *
 * KNOWN GAPS (documented, not silently dropped):
 *  - NPS responses (`src/lib/nps.ts`) are anonymous by design — no user id
 *    or email is collected, so they CANNOT be attributed per user.
 *  - `AuthBackend` has no user-enumeration method. `scoreAllUsers` reads the
 *    in-memory `MemoryAuthBackend.users` map structurally (guarded, dev-seam
 *    only) and unions it with the Prisma `User` directory; a future
 *    Prisma-backed backend plugs in via the same seam or the directory
 *    source moves behind an interface.
 *  - The Prisma `User` table has no `emailVerified`/`lastLoginAt` columns
 *    (see prisma/AUTH-SCHEMA.md), so those signals only resolve for users
 *    that also exist in the auth backend.
 */

import { feedbackStore } from "@/lib/feedback"
import { getOnboardingRecord, isOnboardingComplete } from "@/lib/onboarding"
import { getAuthBackend, type AuthBackend, type AuthUser } from "@/lib/auth/backend"

export const DAY_MS = 24 * 60 * 60 * 1000

export const CHURN_RISKS = ["low", "medium", "high"] as const
export type ChurnRisk = (typeof CHURN_RISKS)[number]

const RISK_RANK: Record<ChurnRisk, number> = { low: 0, medium: 1, high: 2 }

/** One scored signal: what was measured, how many points it added, why. */
export type ChurnFactor = {
  /** Stable machine-ish signal key, e.g. "recency". */
  signal: string
  /** Points added to the 0–100 score (>= 0). */
  impact: number
  /** Human-readable explanation shown to admins. */
  detail: string
}

export type ChurnScore = {
  userId: string
  email: string
  name: string | null
  risk: ChurnRisk
  /** 0–100, higher = more risk-shaped signals. */
  score: number
  /** All evaluated signals, highest impact first. */
  factors: ChurnFactor[]
  computedAt: string
}

/** Directory row shape `computeChurnRisk` needs — decoupled from stores. */
export type ChurnUserInput = {
  id: string
  email: string
  name?: string | null
  /** ISO timestamp of account creation. */
  createdAt: string
}

/**
 * Everything `computeChurnRisk` may look at. Every field is nullable:
 * `null`/`undefined` means "the store could not tell us", which the scorer
 * treats as neutral-ish rather than as a negative signal.
 */
export type ChurnSignals = {
  /** Days since the freshest observed activity (session, onboarding, signup). */
  daysSinceLastActivity: number | null
  /** Count of currently-active sessions; null = session data unavailable. */
  sessionCount: number | null
  emailVerified: boolean | null
  onboardingComplete: boolean | null
  /** Feedback submissions matched to this user's email. */
  feedbackCount: number | null
  /** Subset of `feedbackCount` in the "bug" category (dissatisfaction proxy). */
  negativeFeedbackCount: number | null
}

// ---------------------------------------------------------------------------
// Scoring (pure)
// ---------------------------------------------------------------------------

/** Recency is the heavy signal: up to 45 of the 100 points. */
function recencyImpact(
  days: number | null,
  accountAgeDays: number | null,
): { impact: number; detail: string } {
  if (days === null || !Number.isFinite(days) || days < 0) {
    // Unknown activity on a brand-new account is weaker evidence of risk
    // than on an established one.
    if (accountAgeDays !== null && accountAgeDays <= 14) {
      return { impact: 4, detail: "New account — limited activity history to judge." }
    }
    return { impact: 8, detail: "No activity signal available for this user." }
  }
  if (days <= 7)
    return { impact: 0, detail: `Active within the last week (${Math.floor(days)}d ago).` }
  if (days <= 14) return { impact: 6, detail: `Last activity ${Math.floor(days)} days ago.` }
  if (days <= 30) return { impact: 14, detail: `Last activity ${Math.floor(days)} days ago.` }
  if (days <= 45) return { impact: 22, detail: `Last activity ${Math.floor(days)} days ago.` }
  if (days <= 60)
    return {
      impact: 30,
      detail: `Last activity ${Math.floor(days)} days ago — approaching the 60-day mark.`,
    }
  if (days <= 90) return { impact: 38, detail: `Last activity ${Math.floor(days)} days ago.` }
  return { impact: 45, detail: `No observed activity for ${Math.floor(days)} days.` }
}

function sessionImpact(count: number | null): { impact: number; detail: string } {
  if (count === null || !Number.isFinite(count) || count < 0) {
    return { impact: 5, detail: "Session data unavailable." }
  }
  if (count === 0) return { impact: 15, detail: "No active sessions." }
  if (count === 1) return { impact: 8, detail: "Only one active session." }
  return { impact: 0, detail: `${count} active sessions.` }
}

function booleanSignalImpact(
  value: boolean | null,
  yesDetail: string,
  noDetail: string,
  unknownDetail: string,
): { impact: number; detail: string } {
  if (value === null || value === undefined) return { impact: 4, detail: unknownDetail }
  if (value === false) return { impact: 10, detail: noDetail }
  return { impact: 0, detail: yesDetail }
}

function negativeFeedbackImpact(count: number | null): { impact: number; detail: string } {
  if (count === null || !Number.isFinite(count) || count <= 0) {
    return { impact: 0, detail: "No negative feedback on record." }
  }
  const impact = count >= 2 ? 10 : 6
  return {
    impact,
    detail: `${count} bug-report${count === 1 ? "" : "s"} filed — possible dissatisfaction.`,
  }
}

function riskForScore(score: number): ChurnRisk {
  if (score >= 60) return "high"
  if (score >= 30) return "medium"
  return "low"
}

/**
 * Scores one user from the signals available. Pure: `now` is injectable for
 * tests. Returns a `ChurnScore` with every evaluated factor listed
 * (highest impact first) so admins can audit WHY a user scored as they did.
 */
export function computeChurnRisk(
  user: ChurnUserInput,
  signals: ChurnSignals,
  now: Date = new Date(),
): ChurnScore {
  const createdAtMs = Date.parse(user.createdAt)
  const accountAgeDays = Number.isFinite(createdAtMs)
    ? Math.max(0, (now.getTime() - createdAtMs) / DAY_MS)
    : null

  const factors: ChurnFactor[] = []
  const add = (signal: string, result: { impact: number; detail: string }) => {
    factors.push({ signal, impact: result.impact, detail: result.detail })
  }

  add("recency", recencyImpact(signals.daysSinceLastActivity, accountAgeDays))
  add("sessions", sessionImpact(signals.sessionCount))
  add(
    "email_verified",
    booleanSignalImpact(
      signals.emailVerified,
      "Email address is verified.",
      "Email address is not verified.",
      "Email verification status unknown.",
    ),
  )
  add(
    "onboarding",
    booleanSignalImpact(
      signals.onboardingComplete,
      "Onboarding is complete.",
      "Onboarding is not complete.",
      "Onboarding status unknown.",
    ),
  )
  add("negative_feedback", negativeFeedbackImpact(signals.negativeFeedbackCount))

  const score = Math.min(
    100,
    Math.max(
      0,
      factors.reduce((sum, f) => sum + f.impact, 0),
    ),
  )
  factors.sort((a, b) => b.impact - a.impact || a.signal.localeCompare(b.signal))

  return {
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    risk: riskForScore(score),
    score,
    factors,
    computedAt: now.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Signal gathering (best-effort, read-only against existing stores)
// ---------------------------------------------------------------------------

/** Upper bound on users scored per call — keeps the dev seam cheap. */
const MAX_SCORED_USERS = 500

type BackendUserRow = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  createdAt: string
}

/**
 * Best-effort user enumeration for the in-memory dev backend.
 *
 * `AuthBackend` deliberately has no `listUsers` (the interface predates a
 * real user directory). `MemoryAuthBackend` keeps its rows in a private
 * `users` Map; we read it structurally — guarded by a shape check and
 * try/catch — purely so this dev seam can score the accounts that actually
 * exist in dev. A Prisma-backed implementation simply returns [] here and
 * the Prisma directory below becomes the user source instead.
 */
function enumerateBackendUsers(backend: AuthBackend): BackendUserRow[] {
  try {
    const candidate = backend as unknown as { users?: unknown }
    if (!(candidate.users instanceof Map)) return []
    const rows: BackendUserRow[] = []
    for (const value of candidate.users.values()) {
      const row = value as Partial<BackendUserRow>
      if (
        typeof row.id === "string" &&
        typeof row.email === "string" &&
        typeof row.createdAt === "string"
      ) {
        rows.push({
          id: row.id,
          email: row.email,
          name: typeof row.name === "string" ? row.name : null,
          emailVerified: row.emailVerified === true,
          createdAt: row.createdAt,
        })
      }
    }
    return rows
  } catch {
    return []
  }
}

type DirectoryUser = ChurnUserInput & { emailVerified: boolean | null }

/**
 * Merges the auth-backend user set with the Prisma `User` directory, deduped
 * by lowercased email. Backend rows win on conflicts because they carry
 * `emailVerified`; Prisma-only rows keep `emailVerified: null` (the column
 * does not exist there yet).
 */
async function collectDirectoryUsers(): Promise<DirectoryUser[]> {
  const backend = getAuthBackend()
  const byEmail = new Map<string, DirectoryUser>()

  for (const row of enumerateBackendUsers(backend)) {
    byEmail.set(row.email.trim().toLowerCase(), {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
      emailVerified: row.emailVerified,
    })
  }

  // Prisma directory — same source as GET /api/admin/users. The `@/lib/db`
  // import builds a pg pool eagerly and throws without DATABASE_URL, so it
  // is lazy and fully guarded: churn scoring must work without a database.
  try {
    const { prisma } = await import("@/lib/db")
    const rows = await prisma.user.findMany({
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_SCORED_USERS,
    })
    for (const row of rows) {
      const key = row.email.trim().toLowerCase()
      const existing = byEmail.get(key)
      if (existing) {
        // Fill in fields the backend row may lack; never clobber verified.
        if (existing.name === null && row.name) existing.name = row.name
        continue
      }
      byEmail.set(key, {
        id: row.id,
        email: row.email,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        emailVerified: null,
      })
    }
  } catch {
    // No database (or query failure) — backend users still get scored.
  }

  return [...byEmail.values()].slice(0, MAX_SCORED_USERS)
}

async function resolveBackendUser(
  backend: AuthBackend,
  directory: DirectoryUser,
  backendByEmail: Map<string, AuthUser>,
): Promise<AuthUser | null> {
  const key = directory.email.trim().toLowerCase()
  const known = backendByEmail.get(key)
  if (known) return known
  try {
    return await backend.getUserByEmail(directory.email)
  } catch {
    return null
  }
}

function latestIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null
  let bestMs = -Infinity
  for (const value of values) {
    if (!value) continue
    const ms = Date.parse(value)
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms
      best = value
    }
  }
  return best
}

/**
 * Scores every user discoverable from the available stores, highest risk
 * first. Best-effort throughout: each per-user signal lookup is guarded, so
 * one failing store degrades that signal to "unknown" instead of failing
 * the whole report.
 */
export async function scoreAllUsers(options: { now?: Date } = {}): Promise<ChurnScore[]> {
  const now = options.now ?? new Date()
  const directory = await collectDirectoryUsers()
  if (directory.length === 0) return []

  const backend = getAuthBackend()
  const backendByEmail = new Map(
    enumerateBackendUsers(backend).map((row) => [row.email.trim().toLowerCase(), row as AuthUser]),
  )

  // Feedback is matched by email; computed once for the whole directory.
  const feedbackByEmail = new Map<string, { total: number; bugs: number }>()
  try {
    for (const entry of feedbackStore.list()) {
      const email = entry.email?.trim().toLowerCase()
      if (!email) continue
      const bucket = feedbackByEmail.get(email) ?? { total: 0, bugs: 0 }
      bucket.total += 1
      if (entry.category === "bug") bucket.bugs += 1
      feedbackByEmail.set(email, bucket)
    }
  } catch {
    // Feedback store unavailable — signal stays neutral.
  }

  const scores: ChurnScore[] = []
  for (const user of directory) {
    const key = user.email.trim().toLowerCase()
    const backendUser = await resolveBackendUser(backend, user, backendByEmail)

    let sessionCount: number | null = null
    let lastSessionAt: string | null = null
    if (backendUser) {
      try {
        const sessions = await backend.listSessions(backendUser.id)
        sessionCount = sessions.length
        lastSessionAt = latestIso(...sessions.map((s) => s.createdAt))
      } catch {
        sessionCount = null
      }
    }

    // Onboarding records are keyed by session principal. A missing record
    // for a known auth-backend user means the flow never persisted — treat
    // as incomplete (a real risk signal); for directory-only users it stays
    // unknown.
    let onboardingRecordUpdatedAt: string | null = null
    let onboardingComplete: boolean | null = null
    const principals = backendUser ? [`user:${backendUser.id}`, `mock:${key}`] : [`mock:${key}`]
    for (const principal of principals) {
      try {
        const record = getOnboardingRecord(principal)
        if (record) {
          onboardingRecordUpdatedAt = record.updatedAt
          onboardingComplete = isOnboardingComplete(record)
          break
        }
      } catch {
        // try next principal
      }
    }
    if (onboardingComplete === null && principals.length > 0) {
      onboardingComplete = backendUser ? false : null
    }

    const feedback = feedbackByEmail.get(key) ?? null

    // "Last activity" = freshest of: last session mint, onboarding progress
    // save, account creation (signup is itself an activity). Falls back to
    // null only if even createdAt is unparseable.
    const lastActivityAt = latestIso(lastSessionAt, onboardingRecordUpdatedAt, user.createdAt)
    const lastActivityMs = lastActivityAt ? Date.parse(lastActivityAt) : NaN
    const daysSinceLastActivity = Number.isFinite(lastActivityMs)
      ? Math.max(0, (now.getTime() - lastActivityMs) / DAY_MS)
      : null

    scores.push(
      computeChurnRisk(
        user,
        {
          daysSinceLastActivity,
          sessionCount,
          emailVerified: backendUser?.emailVerified ?? user.emailVerified,
          onboardingComplete,
          // The feedback store is always readable in-process, so "no match"
          // is a real zero, not missing data.
          feedbackCount: feedback?.total ?? 0,
          negativeFeedbackCount: feedback?.bugs ?? 0,
        },
        now,
      ),
    )
  }

  return scores.sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
}

/** Risk ranks for `?minRisk=` filtering, exported for the API route. */
export function churnRiskAtLeast(risk: ChurnRisk, minRisk: ChurnRisk): boolean {
  return RISK_RANK[risk] >= RISK_RANK[minRisk]
}
