/**
 * Onboarding wizard definition and per-principal progress store.
 *
 * The wizard has four steps — welcome, profile, preferences, tour — and is
 * skippable at any point. Progress is persisted server-side per session
 * principal (`user:<uid>` / `mock:<email>`, same scheme as
 * `src/lib/profile.ts`) through `PUT/POST /api/onboarding`, which keeps the
 * records in the process-local map below — the same stopgap the profile
 * overrides and the in-memory `AuthBackend` use until a real backend lands.
 * State is lost on restart; `src/lib/onboarding-server.ts` and the API route
 * are the only server touchpoints.
 *
 * Client-side, the wizard falls back to `localStorage` (`spindle_onboarding`)
 * when the API is unreachable so an offline or erroring backend never traps a
 * new user in the flow. The stored helpers are SSR-safe.
 *
 * This module is intentionally free of server-only imports so the API route,
 * page guards, and client wizard can all share the types and step logic.
 */

import { parseDisplayName } from "./profile"

/** Path of the wizard; `/app` redirects first-time users here. */
export const ONBOARDING_PATH = "/app/onboarding"

export const ONBOARDING_STEP_IDS = ["welcome", "profile", "preferences", "tour"] as const
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number]

export const ONBOARDING_ROLES = ["individual", "lab", "team", "institution"] as const
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number]

/** Answers collected across the wizard; every field is optional (skippable). */
export type OnboardingAnswers = {
  displayName?: string
  role?: OnboardingRole
}

/** One landing on a wizard step, appended on every persisted navigation. */
export type OnboardingStepVisit = {
  stepId: OnboardingStepId
  /** ISO timestamp of the visit. */
  at: string
}

/** Cap on retained step visits so the trail can't grow without bound. */
export const ONBOARDING_MAX_STEP_HISTORY = 50

export type OnboardingRecord = {
  /** Index into `ONBOARDING_STEP_IDS` the user is currently on. */
  stepIndex: number
  answers: OnboardingAnswers
  /** Set when the user finishes or skips; null while the flow is in progress. */
  completedAt: string | null
  /** True when the flow was dismissed via "Skip setup" rather than finished. */
  skipped: boolean
  updatedAt: string
  /**
   * ISO timestamp of the first persisted progress save — the start of the
   * onboarding session. Null only for records created before this field
   * existed; `updatedAt` still tracks the most recent activity.
   */
  startedAt: string | null
  /**
   * Step ids the user advanced PAST (validated Next/Finish). This — not
   * `stepIndex` — drives the completion percentage and the resume target, so
   * navigating Back to review earlier steps never loses progress.
   */
  completedSteps: OnboardingStepId[]
  /**
   * Append-only trail of step landings (most recent last, capped at
   * `ONBOARDING_MAX_STEP_HISTORY`). Combined with `startedAt`/`updatedAt` it
   * gives time-in-step and last-active-step analytics without a separate
   * events table.
   */
  stepHistory: OnboardingStepVisit[]
}

// ---------------------------------------------------------------------------
// Step logic (pure)
// ---------------------------------------------------------------------------

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(value)
}

export function stepIndexFromId(id: OnboardingStepId): number {
  return ONBOARDING_STEP_IDS.indexOf(id)
}

export function stepIdAt(index: number): OnboardingStepId {
  return ONBOARDING_STEP_IDS[clampStepIndex(index)]
}

/** Clamps any index into the valid `[0, steps - 1]` range. */
export function clampStepIndex(index: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), ONBOARDING_STEP_IDS.length - 1)
}

export function isFirstStep(index: number): boolean {
  return clampStepIndex(index) === 0
}

export function isLastStep(index: number): boolean {
  return clampStepIndex(index) === ONBOARDING_STEP_IDS.length - 1
}

export function nextStepIndex(index: number): number {
  return clampStepIndex(index + 1)
}

export function previousStepIndex(index: number): number {
  return Math.max(clampStepIndex(index) - 1, 0)
}

export function isOnboardingComplete(record: OnboardingRecord | null | undefined): boolean {
  return record !== null && record !== undefined && record.completedAt !== null
}

// ---------------------------------------------------------------------------
// Progress tracking (pure)
// ---------------------------------------------------------------------------

function dedupeStepIds(ids: readonly unknown[]): OnboardingStepId[] {
  const seen = new Set<OnboardingStepId>()
  const result: OnboardingStepId[] = []
  for (const id of ids) {
    if (isOnboardingStepId(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  // Canonical step order so the list is stable regardless of write order.
  return result.sort((a, b) => stepIndexFromId(a) - stepIndexFromId(b))
}

/**
 * The step ids a record counts as completed. Records written before
 * `completedSteps` existed derive it from `stepIndex` (every earlier step was
 * visited); a finished record counts every step as complete.
 */
export function getCompletedStepIds(
  record: OnboardingRecord | null | undefined,
): OnboardingStepId[] {
  if (!record) return []
  if (isOnboardingComplete(record)) return [...ONBOARDING_STEP_IDS]
  // Records written by current code always carry `completedSteps` (possibly
  // empty); pre-progress-tracking records lack it and derive completion from
  // `stepIndex` — every earlier step was necessarily visited to get there.
  if (Array.isArray(record.completedSteps)) {
    return dedupeStepIds(record.completedSteps)
  }
  return dedupeStepIds(ONBOARDING_STEP_IDS.slice(0, clampStepIndex(record.stepIndex)))
}

/**
 * Index of the first step the user has NOT completed — the resume target.
 * Returns `ONBOARDING_STEP_IDS.length` (out of range) when every step is done;
 * callers clamp. A null record resumes at step 0.
 */
export function firstIncompleteStepIndex(record: OnboardingRecord | null | undefined): number {
  if (!record || isOnboardingComplete(record)) return 0
  const completed = new Set(getCompletedStepIds(record))
  const index = ONBOARDING_STEP_IDS.findIndex((id) => !completed.has(id))
  return index === -1 ? ONBOARDING_STEP_IDS.length : index
}

/**
 * Where "resume" lands: the first incomplete step for in-progress records
 * (so going Back to review doesn't restart the flow), the stored position for
 * completed ones, and step 0 when there is no record.
 */
export function resumeStepIndex(record: OnboardingRecord | null | undefined): number {
  if (!record) return 0
  if (isOnboardingComplete(record)) return clampStepIndex(record.stepIndex)
  return clampStepIndex(firstIncompleteStepIndex(record))
}

/**
 * Overall completion percentage (0–100) for progress UIs and the API. Based on
 * `completedSteps`, not the current position: 25/50/75 as steps are finished,
 * 100 once `completedAt` is set (finish OR skip).
 */
export function onboardingProgressPercent(record: OnboardingRecord | null | undefined): number {
  if (!record) return 0
  if (isOnboardingComplete(record)) return 100
  return Math.round((getCompletedStepIds(record).length / ONBOARDING_STEP_IDS.length) * 100)
}

/**
 * Progress percentage shown INSIDE the wizard: like
 * `onboardingProgressPercent` but the step currently on screen counts as
 * in-progress (added when not already completed), so a fresh wizard reads
 * 25% on step 1 rather than 0%. The API/banner figure stays completed-only.
 */
export function wizardProgressPercent(
  completedSteps: readonly OnboardingStepId[],
  stepIndex: number,
): number {
  const counted = new Set(completedSteps)
  counted.add(stepIdAt(stepIndex))
  return Math.round((counted.size / ONBOARDING_STEP_IDS.length) * 100)
}

/** Convenience snapshot shipped alongside the record in API payloads. */
export function onboardingProgressSnapshot(record: OnboardingRecord | null | undefined) {
  if (!record) return null
  return {
    percent: onboardingProgressPercent(record),
    completedSteps: getCompletedStepIds(record),
    resumeStepIndex: resumeStepIndex(record),
    currentStepId: stepIdAt(record.stepIndex),
    isComplete: isOnboardingComplete(record),
  }
}

// ---------------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------------

/**
 * Sanitizes a raw answers payload (API body or stored JSON) into
 * `OnboardingAnswers`. Unknown fields are dropped; an invalid display name is
 * discarded rather than failing the whole record so a partial draft never
 * blocks the wizard.
 */
export function parseOnboardingAnswers(value: unknown): OnboardingAnswers {
  if (typeof value !== "object" || value === null) return {}
  const raw = value as Record<string, unknown>
  const answers: OnboardingAnswers = {}

  if (typeof raw.displayName === "string" && raw.displayName.trim()) {
    const parsed = parseDisplayName(raw.displayName)
    if (parsed.ok) answers.displayName = parsed.name
  }

  if (typeof raw.role === "string" && (ONBOARDING_ROLES as readonly string[]).includes(raw.role)) {
    answers.role = raw.role as OnboardingRole
  }

  return answers
}

/**
 * Validates a persisted record shape (localStorage fallback). The progress
 * fields (`startedAt`, `completedSteps`, `stepHistory`) are optional here so
 * records written before task 22 still pass; `normalizeOnboardingRecord`
 * fills their defaults on read.
 */
export function isOnboardingRecord(value: unknown): value is OnboardingRecord {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<OnboardingRecord>
  return (
    typeof candidate.stepIndex === "number" &&
    Number.isFinite(candidate.stepIndex) &&
    typeof candidate.answers === "object" &&
    candidate.answers !== null &&
    (candidate.completedAt === null || typeof candidate.completedAt === "string") &&
    typeof candidate.skipped === "boolean" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.startedAt === undefined ||
      candidate.startedAt === null ||
      typeof candidate.startedAt === "string") &&
    (candidate.completedSteps === undefined || Array.isArray(candidate.completedSteps)) &&
    (candidate.stepHistory === undefined || Array.isArray(candidate.stepHistory))
  )
}

function sanitizeStepHistory(value: unknown): OnboardingStepVisit[] {
  if (!Array.isArray(value)) return []
  const visits: OnboardingStepVisit[] = []
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue
    const visit = entry as Partial<OnboardingStepVisit>
    if (isOnboardingStepId(visit.stepId) && typeof visit.at === "string") {
      visits.push({ stepId: visit.stepId, at: visit.at })
    }
  }
  return visits.slice(-ONBOARDING_MAX_STEP_HISTORY)
}

/**
 * Fills defaults and sanitizes a record of the (guard-validated) shape —
 * used when reading localStorage payloads that may predate the progress
 * fields. Legacy records derive `completedSteps` from `stepIndex`.
 */
export function normalizeOnboardingRecord(record: OnboardingRecord): OnboardingRecord {
  const stepIndex = clampStepIndex(record.stepIndex)
  const completedAt = typeof record.completedAt === "string" ? record.completedAt : null
  const normalized: OnboardingRecord = {
    stepIndex,
    answers: parseOnboardingAnswers(record.answers),
    completedAt,
    skipped: record.skipped === true,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
    completedSteps: [],
    stepHistory: sanitizeStepHistory(record.stepHistory),
  }
  if (Array.isArray(record.completedSteps)) {
    normalized.completedSteps = dedupeStepIds(record.completedSteps)
  } else {
    // Legacy record: every step before the stored position was visited.
    normalized.completedSteps = completedAt
      ? [...ONBOARDING_STEP_IDS]
      : dedupeStepIds(ONBOARDING_STEP_IDS.slice(0, stepIndex))
  }
  return normalized
}

// ---------------------------------------------------------------------------
// Server/localStorage merge
// ---------------------------------------------------------------------------

function earliestIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) <= Date.parse(b) ? a : b
}

/**
 * Merges the server record with the localStorage fallback record after the
 * wizard's initial load. Picking `serverRecord ?? stored` discards newer
 * offline work whenever the server returns ANY record — even a stale
 * in-progress one — so instead the newer `updatedAt` wins as the base
 * (stepIndex, answers, completion flag) while `completedSteps` is unioned,
 * `stepHistory` is merged without duplicates, and `startedAt` keeps the
 * earliest value. Completion is sticky: if either side is complete the
 * merged record stays complete (the `/app` guard only trusts the server, so
 * callers still re-sync before redirecting).
 */
export function mergeOnboardingRecords(
  serverRecord: OnboardingRecord | null | undefined,
  storedRecord: OnboardingRecord | null | undefined,
): OnboardingRecord | null {
  if (!serverRecord && !storedRecord) return null
  if (!serverRecord) return normalizeOnboardingRecord(storedRecord as OnboardingRecord)
  if (!storedRecord) return normalizeOnboardingRecord(serverRecord)

  const server = normalizeOnboardingRecord(serverRecord)
  const stored = normalizeOnboardingRecord(storedRecord)
  const serverComplete = isOnboardingComplete(server)
  const storedComplete = isOnboardingComplete(stored)

  // A completed record always wins over an incomplete one (completion is
  // authoritative); between equals the newer updatedAt wins.
  const base =
    serverComplete !== storedComplete
      ? serverComplete
        ? server
        : stored
      : Date.parse(stored.updatedAt) > Date.parse(server.updatedAt)
        ? stored
        : server
  const other = base === server ? stored : server

  const completedSteps = dedupeStepIds([...server.completedSteps, ...stored.completedSteps])

  const seenVisits = new Set<string>()
  const mergedHistory: OnboardingStepVisit[] = []
  for (const visit of [...server.stepHistory, ...stored.stepHistory]) {
    const key = `${visit.stepId}${visit.at}`
    if (seenVisits.has(key)) continue
    seenVisits.add(key)
    mergedHistory.push(visit)
  }
  mergedHistory.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))

  return {
    stepIndex: base.stepIndex,
    answers: { ...base.answers },
    completedAt: base.completedAt ?? other.completedAt,
    skipped: base.completedAt !== null ? base.skipped : other.skipped,
    // The merged record is at least as fresh as either input.
    updatedAt:
      Date.parse(stored.updatedAt) > Date.parse(server.updatedAt)
        ? stored.updatedAt
        : server.updatedAt,
    startedAt: earliestIso(server.startedAt, stored.startedAt),
    completedSteps,
    stepHistory: mergedHistory.slice(-ONBOARDING_MAX_STEP_HISTORY),
  }
}

// ---------------------------------------------------------------------------
// Server-side store (process-local, keyed by session principal)
// ---------------------------------------------------------------------------

const records = new Map<string, OnboardingRecord>()

function nowIso(): string {
  return new Date().toISOString()
}

export function getOnboardingRecord(principal: string): OnboardingRecord | null {
  const record = records.get(principal)
  return record ? normalizeOnboardingRecord(record) : null
}

/** Input accepted by `applyOnboardingProgress` / `saveOnboardingProgress`. */
export type OnboardingProgressInput = {
  stepIndex: number
  answers?: OnboardingAnswers
  /**
   * When true, `answers` REPLACES the stored answers wholesale — keys absent
   * from `answers` are deleted. This is how cleared fields (emptied display
   * name, unset role) propagate; the default merge keeps backward
   * compatibility for partial updates.
   */
  replaceAnswers?: boolean
  /**
   * Step the user is advancing PAST (typically the step they just left).
   * Added to `completedSteps` idempotently — this is what feeds the
   * completion percentage and the resume target.
   */
  completedStep?: OnboardingStepId
  /** Injectable clock for tests; defaults to now. */
  at?: string
}

/**
 * Pure state transition shared by the server store and the wizard's
 * localStorage fallback so offline and online records evolve identically:
 * merges answers, records the step visit in `stepHistory`, stamps
 * `startedAt`/`updatedAt`, and folds `completedStep` into `completedSteps`.
 */
export function applyOnboardingProgress(
  existing: OnboardingRecord | null | undefined,
  progress: OnboardingProgressInput,
): OnboardingRecord {
  const at = progress.at ?? nowIso()
  const stepIndex = clampStepIndex(progress.stepIndex)
  const base = existing ? normalizeOnboardingRecord(existing) : null

  const completedSteps = new Set(base?.completedSteps ?? [])
  if (progress.completedStep && isOnboardingStepId(progress.completedStep)) {
    completedSteps.add(progress.completedStep)
  }

  const stepHistory = [...(base?.stepHistory ?? []), { stepId: stepIdAt(stepIndex), at }]

  return {
    stepIndex,
    answers: progress.replaceAnswers
      ? { ...(progress.answers ?? {}) }
      : { ...(base?.answers ?? {}), ...(progress.answers ?? {}) },
    completedAt: base?.completedAt ?? null,
    skipped: base?.skipped ?? false,
    updatedAt: at,
    startedAt: base?.startedAt ?? at,
    completedSteps: dedupeStepIds([...completedSteps]),
    stepHistory: stepHistory.slice(-ONBOARDING_MAX_STEP_HISTORY),
  }
}

export function saveOnboardingProgress(
  principal: string,
  progress: OnboardingProgressInput,
): OnboardingRecord {
  const record = applyOnboardingProgress(records.get(principal), progress)
  records.set(principal, record)
  return normalizeOnboardingRecord(record)
}

/**
 * Marks the flow finished (`skipped: false`) or dismissed (`skipped: true`).
 *
 * Completion is terminal and first-write-wins: once a record has a
 * `completedAt`, later calls return it unchanged. This pins the
 * completed-then-skipped precedence — a stray second POST (double-click,
 * retried request, offline re-sync) can never flip a finished record to
 * `skipped` or move its `completedAt`. Skipped records count as complete
 * everywhere (`isOnboardingComplete`), so a skipped user cannot re-enter
 * the wizard: `/app/onboarding` and `/app` both redirect completed records
 * to the dashboard. "Resume later" is therefore NOT a completion path —
 * it leaves the record in-progress so the dashboard banner can offer
 * resume.
 */
export function completeOnboarding(
  principal: string,
  options: { skipped?: boolean; at?: string } = {},
): OnboardingRecord {
  const at = options.at ?? nowIso()
  const existing = records.get(principal)
  const base = existing ? normalizeOnboardingRecord(existing) : null
  if (base && isOnboardingComplete(base)) {
    return base
  }
  const record: OnboardingRecord = {
    stepIndex: base?.stepIndex ?? ONBOARDING_STEP_IDS.length - 1,
    answers: { ...(base?.answers ?? {}) },
    completedAt: at,
    skipped: options.skipped === true,
    updatedAt: at,
    startedAt: base?.startedAt ?? at,
    completedSteps: base?.completedSteps ?? [],
    stepHistory: [
      ...(base?.stepHistory ?? []),
      { stepId: stepIdAt(base?.stepIndex ?? ONBOARDING_STEP_IDS.length - 1), at },
    ].slice(-ONBOARDING_MAX_STEP_HISTORY),
  }
  records.set(principal, record)
  return normalizeOnboardingRecord(record)
}

/** Test hook: clears every stored onboarding record. */
export function resetOnboardingStoreForTests(): void {
  records.clear()
}

// ---------------------------------------------------------------------------
// localStorage fallback (client-only, SSR-safe)
// ---------------------------------------------------------------------------

export const ONBOARDING_STORAGE_KEY = "spindle_onboarding"

/**
 * Builds the storage key for a principal-ish identity (usually the session
 * email). Falls back to a shared key when no identity is known.
 */
export function onboardingStorageKey(identity?: string | null): string {
  const normalized = identity?.trim().toLowerCase()
  return normalized ? `${ONBOARDING_STORAGE_KEY}:${normalized}` : ONBOARDING_STORAGE_KEY
}

export function readStoredOnboarding(storageKey: string): OnboardingRecord | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isOnboardingRecord(parsed)) return null
    return normalizeOnboardingRecord(parsed)
  } catch {
    return null
  }
}

export function writeStoredOnboarding(storageKey: string, record: OnboardingRecord): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(record))
  } catch {
    // Storage can be unavailable (private mode); the in-memory record still
    // covers the current session.
  }
}

export function clearStoredOnboarding(storageKey: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Ignore — see writeStoredOnboarding.
  }
}
