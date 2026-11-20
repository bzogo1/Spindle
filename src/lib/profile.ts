/**
 * Profile display-name overrides, keyed by the session principal
 * (`user:<id>` for real sessions, `mock:<email>` for mock auth).
 *
 * There is no user-profile table or update endpoint in the auth backend yet,
 * so `PUT /api/profile` persists the chosen display name in a process-local
 * map — the same stopgap approach the in-memory `AuthBackend` uses for the
 * rest of the auth flow (see `src/lib/auth/backend.ts`). State is lost on
 * restart and does not propagate back into the session cookie or the auth
 * backend; once a real profile API lands this module is the single seam to
 * replace.
 *
 * This module is intentionally free of server-only imports so both the API
 * route and client screens can share the types and validation.
 */

export const DISPLAY_NAME_MAX_LENGTH = 80

/** The profile shape returned by `GET/PUT /api/profile` and rendered by the screen. */
export type ProfileData = {
  /** Effective display name (override ?? session name ?? email-derived). */
  name: string
  email: string
  /**
   * The user's @handle (normalized lowercase), when one is set. Stored in the
   * in-memory registry in `src/lib/username.ts` until a real profile API
   * exists.
   */
  handle: string | null
  /** ISO timestamp the account was created, when the session source knows it. */
  memberSince: string | null
}

export type ProfileOverride = {
  name: string
  updatedAt: string
}

const overrides = new Map<string, ProfileOverride>()

/**
 * Validates a raw display-name value. Returns the normalized name (trimmed,
 * internal whitespace collapsed) or a user-facing error message.
 */
export function parseDisplayName(
  value: unknown,
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Display name must be text." }
  }
  const name = value.trim().replace(/\s+/g, " ")
  if (!name) {
    return { ok: false, error: "Display name is required." }
  }
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`,
    }
  }
  return { ok: true, name }
}

/** Derives a display name from an email when the session carries none. */
export function fallbackDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email
  return local.charAt(0).toUpperCase() + local.slice(1)
}

export function getProfileOverride(principal: string): ProfileOverride | null {
  return overrides.get(principal) ?? null
}

export function setProfileOverride(principal: string, name: string): ProfileOverride {
  const record: ProfileOverride = { name, updatedAt: new Date().toISOString() }
  overrides.set(principal, record)
  return record
}

/** Test hook: clears every stored override. */
export function resetProfileOverridesForTests(): void {
  overrides.clear()
}
