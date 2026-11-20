/**
 * Beta programs: admin-created enrollment groups that let users opt in to
 * early features. Admins enroll users by principal id (or email, resolved
 * by the API layer); enrolled users see the program — with a "beta" badge —
 * on `/app/beta` and can self-enroll/unenroll while the program is `open`.
 *
 * Enrollment keys are the same principal strings used by `/api/preferences`
 * and `/api/announcements`: `user:<uid>` for real sessions, `mock:<email>`
 * for mock-auth sessions.
 *
 * DEVELOPMENT SEAM: state lives in a process-local `Map`, same interim-store
 * pattern as `announcements.ts` / `newsletter-store.ts`. On serverless or
 * multi-instance deploys each instance keeps its own copy and everything is
 * lost on restart. The upgrade path is a `BetaProgram` table plus a
 * per-user enrollment table; the exported function signatures are already
 * shaped for that swap.
 *
 * This module covers program *enrollment* only. Feature-flag gating (whether
 * an enrolled user actually sees a gated feature) is a separate concern owned
 * by `src/lib/feature-flags.ts` — do not couple the two.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it.
 */

export type BetaProgramStatus = "open" | "closed"

export const BETA_PROGRAM_STATUSES: readonly BetaProgramStatus[] = ["open", "closed"]

export interface BetaProgram {
  id: string
  name: string
  description: string
  status: BetaProgramStatus
  /** Enrollment principals (`user:<uid>` / `mock:<email>`), insertion-ordered. */
  enrolledUserIds: Set<string>
  /** ISO timestamp — record creation time. */
  createdAt: string
}

export interface CreateBetaProgramInput {
  name: string
  description: string
}

/** Hard caps so the in-memory store cannot grow without bound. */
export const BETA_PROGRAMS_STORE_MAX = 200
export const BETA_ENROLLMENTS_PER_PROGRAM_MAX = 10_000

const programs = new Map<string, BetaProgram>() // id → record, insertion-ordered

function programId(): string {
  return `beta_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error("Program name is required.")
  }
  return trimmed
}

/**
 * Creates a beta program in `open` status. New programs accept self-service
 * enrollment immediately; admins close a program via `updateProgramStatus`.
 * Throws when the name is blank.
 */
export function createProgram(input: CreateBetaProgramInput): BetaProgram {
  const program: BetaProgram = {
    id: programId(),
    name: requireName(input.name),
    description: input.description.trim(),
    status: "open",
    enrolledUserIds: new Set(),
    createdAt: nowIso(),
  }

  // Bounded capacity: evict the oldest record (Map preserves insertion
  // order) so a flood of programs cannot grow memory without limit.
  if (programs.size >= BETA_PROGRAMS_STORE_MAX) {
    const oldest = programs.keys().next().value
    if (oldest !== undefined) programs.delete(oldest)
  }
  programs.set(program.id, program)
  return program
}

/**
 * All stored programs, newest `createdAt` first — open and closed alike.
 * Returns the live records; callers must not mutate them.
 */
export function listPrograms(): BetaProgram[] {
  return [...programs.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )
}

/** One program by id, or `undefined` when it does not exist. */
export function getProgram(id: string): BetaProgram | undefined {
  return programs.get(id)
}

/**
 * Sets a program's `open`/`closed` status. Enrollment state is preserved —
 * closing a program only blocks *new* self-service enrollments; existing
 * enrollees stay enrolled (admins can still unenroll them).
 * Throws when the program does not exist or the status is invalid.
 */
export function updateProgramStatus(id: string, status: BetaProgramStatus): BetaProgram {
  const program = programs.get(id)
  if (!program) {
    throw new Error("Beta program not found.")
  }
  if (status !== "open" && status !== "closed") {
    throw new Error("status must be 'open' or 'closed'.")
  }
  program.status = status
  return program
}

/**
 * Enrolls the principal `userId` (`user:<uid>` / `mock:<email>`) in the
 * program. Idempotent — enrolling an already
 * enrolled user is a no-op. Throws when the program does not exist.
 * Works regardless of program status: admins may enroll users into closed
 * programs; the `open` gate only applies to the self-service endpoint.
 */
export function enrollUser(programIdValue: string, userId: string): void {
  const program = programs.get(programIdValue)
  if (!program) {
    throw new Error("Beta program not found.")
  }
  if (program.enrolledUserIds.has(userId)) return

  // Per-program bound: drop the oldest enrollment (Set preserves insertion
  // order) so enrollment cannot grow memory without limit.
  if (program.enrolledUserIds.size >= BETA_ENROLLMENTS_PER_PROGRAM_MAX) {
    const oldest = program.enrolledUserIds.values().next().value
    if (oldest !== undefined) program.enrolledUserIds.delete(oldest)
  }
  program.enrolledUserIds.add(userId)
}

/**
 * Removes the principal `userId` from the program. Idempotent — unenrolling
 * a principal that is
 * not enrolled (or when the program does not exist) is a no-op.
 */
export function unenrollUser(programIdValue: string, userId: string): void {
  programs.get(programIdValue)?.enrolledUserIds.delete(userId)
}

/** Whether `userId` is currently enrolled in the program. */
export function isEnrolled(programIdValue: string, userId: string): boolean {
  return programs.get(programIdValue)?.enrolledUserIds.has(userId) ?? false
}

/** Every program the principal `userId` is enrolled in, newest `createdAt` first.
 * Programs are bounded (BETA_PROGRAMS_STORE_MAX), so the scan is cheap.
 */
export function listUserEnrollments(userId: string): BetaProgram[] {
  return listPrograms().filter((program) => program.enrolledUserIds.has(userId))
}

/**
 * Enrolled principal ids (`user:<uid>` / `mock:<email>`) for a program, in
 * enrollment order. Returns an empty
 * array when the program does not exist — callers that need a 404 should
 * check `getProgram` first.
 */
export function listProgramEnrollments(programIdValue: string): string[] {
  const program = programs.get(programIdValue)
  return program ? [...program.enrolledUserIds] : []
}

/**
 * JSON-safe program view for API responses. `enrolledUserIds` is a `Set`
 * internally; the API surface exposes a count (admin list) or the id list
 * via `listProgramEnrollments` (admin detail).
 */
export function betaProgramJson(program: BetaProgram) {
  return {
    id: program.id,
    name: program.name,
    description: program.description,
    status: program.status,
    enrolledCount: program.enrolledUserIds.size,
    createdAt: program.createdAt,
  }
}

/** Test hook: clears all programs and enrollment records. */
export function clearBetaAccessForTests(): void {
  programs.clear()
}
