import { z } from "zod"

/**
 * General user preferences — app-level behavior settings stored server-side
 * per principal (`user:<id>` for real sessions, `mock:<email>` for mock
 * auth), the same keying scheme as `src/lib/profile.ts` and
 * `src/lib/communication-preferences.ts`.
 *
 * This domain is deliberately separate from:
 * - `src/lib/communication-preferences.ts` (task 64) — outbound email/product
 *   opt-ins;
 * - `src/lib/onboarding.ts` — first-run wizard answers;
 * - `src/components/app/notifications-provider.tsx` — localStorage-backed
 *   in-app notification toggles;
 * - the `spindle-app-theme` localStorage key — the theme control stays
 *   device-local until a theme preference is wired through this store.
 *
 * Like the other per-principal stores, persistence is a process-local `Map` —
 * state is lost on restart and is the single seam to replace once a real
 * preferences table/API lands.
 *
 * This module is intentionally free of server-only imports so both the API
 * route and client components can share the types and validation.
 */

export const USER_PREFERENCE_DENSITIES = ["comfortable", "compact"] as const
export type UserPreferenceDensity = (typeof USER_PREFERENCE_DENSITIES)[number]

export const USER_PREFERENCE_WEEK_STARTS = ["monday", "sunday"] as const
export type UserPreferenceWeekStart = (typeof USER_PREFERENCE_WEEK_STARTS)[number]

/** Max length accepted for a stored default project id. */
export const DEFAULT_PROJECT_ID_MAX_LENGTH = 128

/**
 * The full preference shape returned by `GET /api/preferences` and rendered
 * by the settings panel.
 */
export interface UserPreferences {
  /** UI density hint for list and form surfaces. */
  density: UserPreferenceDensity
  /** First day of the week in calendar-style views. */
  weekStartsOn: UserPreferenceWeekStart
  /**
   * Project preselected when starting new work, or null to always ask.
   * Stored as the project id; consumers resolve it against the projects API.
   */
  defaultProjectId: string | null
  /** When true, destructive actions (archive, delete) ask for confirmation. */
  confirmDestructiveActions: boolean
  /** When true, the app honors an always-on reduced-motion preference. */
  reduceMotion: boolean
}

/**
 * The partial shape `PUT /api/preferences` accepts. Every field is optional
 * (partial update); `defaultProjectId` accepts a project id string or null
 * to clear the selection.
 */
export const userPreferencesUpdateSchema = z.strictObject({
  density: z.enum(USER_PREFERENCE_DENSITIES).optional(),
  weekStartsOn: z.enum(USER_PREFERENCE_WEEK_STARTS).optional(),
  defaultProjectId: z
    .string()
    .trim()
    .min(1)
    .max(DEFAULT_PROJECT_ID_MAX_LENGTH)
    .nullable()
    .optional(),
  confirmDestructiveActions: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
})
export type UserPreferencesUpdate = z.infer<typeof userPreferencesUpdateSchema>

export function defaultUserPreferences(): UserPreferences {
  return {
    density: "comfortable",
    weekStartsOn: "monday",
    defaultProjectId: null,
    confirmDestructiveActions: true,
    reduceMotion: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDensity(value: unknown): value is UserPreferenceDensity {
  return (
    typeof value === "string" && (USER_PREFERENCE_DENSITIES as readonly string[]).includes(value)
  )
}

function isWeekStart(value: unknown): value is UserPreferenceWeekStart {
  return (
    typeof value === "string" && (USER_PREFERENCE_WEEK_STARTS as readonly string[]).includes(value)
  )
}

function parseStoredProjectId(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > DEFAULT_PROJECT_ID_MAX_LENGTH) return null
  return trimmed
}

/**
 * Merges an untrusted stored value over the defaults so a corrupt or partial
 * record can never produce an invalid preferences object. A missing or
 * malformed `defaultProjectId` falls back to "no default" rather than
 * inventing an id.
 */
export function mergeUserPreferences(stored: unknown): UserPreferences {
  const defaults = defaultUserPreferences()
  if (!isRecord(stored)) return defaults

  const hasProjectId =
    stored.defaultProjectId === null ||
    (typeof stored.defaultProjectId === "string" && stored.defaultProjectId.trim().length > 0)
  const projectId = parseStoredProjectId(stored.defaultProjectId)

  return {
    density: isDensity(stored.density) ? stored.density : defaults.density,
    weekStartsOn: isWeekStart(stored.weekStartsOn) ? stored.weekStartsOn : defaults.weekStartsOn,
    defaultProjectId: hasProjectId ? projectId : defaults.defaultProjectId,
    confirmDestructiveActions:
      typeof stored.confirmDestructiveActions === "boolean"
        ? stored.confirmDestructiveActions
        : defaults.confirmDestructiveActions,
    reduceMotion:
      typeof stored.reduceMotion === "boolean" ? stored.reduceMotion : defaults.reduceMotion,
  }
}

const overrides = new Map<string, UserPreferencesUpdate>()

/** Returns the effective preferences for a principal (defaults merged with stored overrides). */
export function getUserPreferences(principal: string): UserPreferences {
  return mergeUserPreferences(overrides.get(principal))
}

/** Applies a validated partial update and returns the merged result. */
export function updateUserPreferences(
  principal: string,
  update: UserPreferencesUpdate,
): UserPreferences {
  overrides.set(principal, { ...overrides.get(principal), ...update })
  return getUserPreferences(principal)
}

/** Test hook: clears every stored override. */
export function resetUserPreferencesForTests(): void {
  overrides.clear()
}
