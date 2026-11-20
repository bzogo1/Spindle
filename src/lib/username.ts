/**
 * Username / @handle support: validation, normalization, and an in-memory
 * handle registry.
 *
 * Like `src/lib/profile.ts`, there is no user-profile table or handle column
 * in the auth backend (`AuthUser` in `src/lib/auth/backend.ts` carries only
 * id/email/name/emailVerified/createdAt), so handles live in a process-local
 * registry keyed by the same session principal the profile overrides use
 * (`user:<id>` for real sessions, `mock:<email>` for mock auth). State is
 * lost on restart; when a real profile API lands this module is the single
 * seam to replace.
 *
 * Uniqueness is enforced store-wide and case-insensitively: handles are
 * normalized to lowercase before storage, so `@Ada` and `@ada` are the same
 * handle.
 *
 * This module is intentionally free of server-only imports so both the API
 * routes and client components can share validation and types.
 */

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

/** Handles allow lowercase letters, digits, and underscores only. */
export const USERNAME_PATTERN = /^[a-z0-9_]+$/

/**
 * Names that cannot be claimed — platform/system surfaces and common
 * impersonation targets. Compared against the normalized (lowercase) handle.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "abuse",
  "account",
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "billing",
  "blog",
  "dashboard",
  "help",
  "home",
  "info",
  "login",
  "mail",
  "me",
  "moderator",
  "noreply",
  "notifications",
  "official",
  "postmaster",
  "root",
  "search",
  "security",
  "settings",
  "signup",
  "signin",
  "spindle",
  "staff",
  "support",
  "system",
  "team",
  "webmaster",
  "www",
])

/** Lowercases and trims a raw handle value; does not validate. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidUsernameFormat(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  )
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username)
}

export type UsernameParseResult = { ok: true; username: string } | { ok: false; error: string }

/**
 * Validates a raw handle value. Returns the normalized (lowercase) handle or
 * a user-facing error message. Format and reserved-name checks only —
 * availability is a store concern (`isUsernameAvailable`).
 */
export function parseUsername(value: unknown): UsernameParseResult {
  if (typeof value !== "string") {
    return { ok: false, error: "Username must be text." }
  }
  const username = normalizeUsername(value)
  if (!username) {
    return { ok: false, error: "Username is required." }
  }
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`,
    }
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error: "Usernames can only use lowercase letters, numbers, and underscores.",
    }
  }
  if (isReservedUsername(username)) {
    return { ok: false, error: "That username is reserved. Try another." }
  }
  return { ok: true, username }
}

// ---------------------------------------------------------------------------
// In-memory handle registry (dev seam — see module docstring)
// ---------------------------------------------------------------------------

const handleByPrincipal = new Map<string, string>()
const principalByHandle = new Map<string, string>()

/** The normalized handle currently held by a principal, if any. */
export function getHandleForPrincipal(principal: string): string | null {
  return handleByPrincipal.get(principal) ?? null
}

export function getPrincipalForHandle(username: string): string | null {
  return principalByHandle.get(normalizeUsername(username)) ?? null
}

/**
 * True when `username` is valid, unreserved, and not held by another
 * principal. `excludePrincipal` lets the current holder re-check their own
 * handle without reporting it as taken.
 */
export function isUsernameAvailable(username: string, excludePrincipal?: string): boolean {
  const parsed = parseUsername(username)
  if (!parsed.ok) return false
  const holder = principalByHandle.get(parsed.username)
  return holder === undefined || holder === excludePrincipal
}

export type SetUsernameResult = { ok: true; username: string } | { ok: false; error: string }

/**
 * Claims `username` for `principal`, releasing any handle the principal
 * already holds. Fails when the handle fails validation or is held by a
 * different principal. Re-claiming the principal's own handle is a no-op
 * success.
 */
export function setUsernameForPrincipal(principal: string, value: unknown): SetUsernameResult {
  const parsed = parseUsername(value)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const current = handleByPrincipal.get(principal)
  if (current === parsed.username) {
    return { ok: true, username: parsed.username }
  }

  const holder = principalByHandle.get(parsed.username)
  if (holder !== undefined && holder !== principal) {
    return { ok: false, error: "That username is already taken." }
  }

  if (current) principalByHandle.delete(current)
  handleByPrincipal.set(principal, parsed.username)
  principalByHandle.set(parsed.username, principal)
  return { ok: true, username: parsed.username }
}

/** Releases the principal's handle, if any. */
export function clearUsernameForPrincipal(principal: string): void {
  const current = handleByPrincipal.get(principal)
  if (!current) return
  handleByPrincipal.delete(principal)
  principalByHandle.delete(current)
}

/** Test hook: clears every stored handle. */
export function resetUsernameStoreForTests(): void {
  handleByPrincipal.clear()
  principalByHandle.clear()
}
