import { z } from "zod"

/**
 * Per-principal login security policies.
 *
 * A policy is a small set of account-security preferences owned by one
 * principal (user id). Policies are *effective* when merged over the global
 * policy and then over {@link DEFAULT_SECURITY_POLICIES}; see
 * {@link MemorySecurityPolicyStore.getPolicies}.
 *
 * Fields and their enforcement status:
 *
 *  - `requireTwoFactor` — ENFORCED (planned). `checkPolicy` returns a
 *    `two_factor_required` violation when a sign-in is attempted on a
 *    password/OAuth/magic-link channel by an account without TOTP. The
 *    signin/2fa routes are NOT wired yet — integration point: call
 *    `checkPolicy` in `/api/auth/signin`, `/api/auth/2fa/verify-login`,
 *    OAuth callback, and passwordless verify, and route violators to a
 *    forced-enrollment flow rather than a hard denial (hard denial would
 *    lock the user out of the account that must enroll).
 *  - `allowedSignInWindow` — ENFORCED (planned). `checkPolicy` returns
 *    `outside_sign_in_window` for any sign-in attempted outside the
 *    configured UTC `HH:MM` window (overnight windows like 22:00–06:00
 *    are supported). Integration point: same sign-in routes as above;
 *    recommended response is 403 `sign_in_window` so the UI can explain
 *    the restriction.
 *  - `sessionMaxAgeHours` — ADVISORY at check time. When the caller passes
 *    `requestedSessionHours` (e.g. "remember me" → 720h) `checkPolicy`
 *    returns `session_max_age_exceeded`. Enforcement belongs to the
 *    session/refresh issuance path (`/api/auth/refresh`, token TTLs),
 *    which should clamp the refresh-token lifetime to this value.
 *  - `minPasswordLength` — ADVISORY at sign-in; ENFORCED at credential
 *    writes. When `passwordLength` is supplied `checkPolicy` returns
 *    `password_below_minimum`. Real enforcement belongs to signup and
 *    password-reset/confirm routes, which should reject passwords shorter
 *    than the effective minimum (existing floor is 8 chars).
 *
 * STORE SEAM: like {@link MemoryAuthBackend} and the login-alert store,
 * policies live in a bounded in-memory map inside one process and are lost
 * on restart. `getSecurityPolicyStore`/`setSecurityPolicyStoreForTests` is
 * the single seam where a durable backend (Prisma) plugs in — see
 * prisma/AUTH-SCHEMA.md. The global policy (`GLOBAL_POLICY_KEY`) is the
 * future admin/default layer; per-principal entries override it.
 */

/** `"HH:MM"` 24-hour wall-clock time, evaluated in UTC. */
export interface SignInWindow {
  start: string
  end: string
}

export interface SecurityPolicies {
  /** Require TOTP 2FA before issuing a session. */
  requireTwoFactor: boolean
  /**
   * Maximum session lifetime in hours; `null` means no policy cap (the
   * backend's own refresh-token TTL still applies).
   */
  sessionMaxAgeHours: number | null
  /** Allowed sign-in window in UTC; `null` means any time. */
  allowedSignInWindow: SignInWindow | null
  /** Minimum password length for credential writes; `null` = backend default. */
  minPasswordLength: number | null
}

export const DEFAULT_SECURITY_POLICIES: SecurityPolicies = {
  requireTwoFactor: false,
  sessionMaxAgeHours: null,
  allowedSignInWindow: null,
  minPasswordLength: null,
}

/** Store key for the global (admin/default) policy layer. */
export const GLOBAL_POLICY_KEY = "*"

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h).")

const signInWindowSchema = z
  .object({ start: hhmmSchema, end: hhmmSchema })
  .refine((window) => window.start !== window.end, {
    message: "Start and end must differ.",
  })

/**
 * zod schema for a full policy object (PUT body). Kept here — not in
 * `schemas.ts` — because this module owns the policy contract.
 */
export const securityPoliciesSchema = z
  .object({
    requireTwoFactor: z.boolean(),
    sessionMaxAgeHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .nullable(),
    allowedSignInWindow: signInWindowSchema.nullable(),
    minPasswordLength: z.number().int().min(8).max(128).nullable(),
  })
  .strict()

export type SignInMethod = "password" | "totp" | "oauth" | "magic_link" | "passwordless"

export interface PolicyCheckContext {
  /** Sign-in channel being attempted. */
  method: SignInMethod
  /** Evaluation instant; defaults to `new Date()`. */
  now?: Date
  /**
   * Whether the account already has TOTP enrolled. `undefined` means the
   * caller does not know yet — the `requireTwoFactor` check is skipped.
   */
  twoFactorEnabled?: boolean
  /** Length of the password being submitted (credential methods only). */
  passwordLength?: number
  /** Requested session lifetime in hours (e.g. remember-me → 720). */
  requestedSessionHours?: number
}

export type PolicyViolationCode =
  | "two_factor_required"
  | "outside_sign_in_window"
  | "session_max_age_exceeded"
  | "password_below_minimum"

export interface PolicyViolation {
  code: PolicyViolationCode
  message: string
  /**
   * `enforced` — the sign-in route should block or reroute the attempt.
   * `advisory` — surfaced for callers/UI; real enforcement lives at the
   * session-issuance or credential-write path (see module docs).
   */
  severity: "enforced" | "advisory"
}

function clone(policies: SecurityPolicies): SecurityPolicies {
  return {
    ...policies,
    allowedSignInWindow: policies.allowedSignInWindow ? { ...policies.allowedSignInWindow } : null,
  }
}

export interface SecurityPolicyStore {
  /** Effective policy for a principal: per-user entry, else global, else defaults. */
  getPolicies(principalId: string): SecurityPolicies
  /** The principal's own stored policy, or null when unset. */
  getStoredPolicies(principalId: string): SecurityPolicies | null
  /** Replaces the principal's stored policy and returns the effective result. */
  setPolicies(principalId: string, policies: SecurityPolicies): SecurityPolicies
  /** Removes the principal's override so the global/default policy applies. */
  resetPolicies(principalId: string): void
  /** Global default layer (future admin surface). */
  getGlobalPolicies(): SecurityPolicies
  setGlobalPolicies(policies: SecurityPolicies): SecurityPolicies
}

/**
 * In-memory policy store. Per-principal entries live in a Map keyed by user
 * id; {@link GLOBAL_POLICY_KEY} holds the global layer. Bounded by the
 * number of principals that ever save policies — acceptable for the dev
 * seam, and trivially replaceable by a durable backend.
 */
export class MemorySecurityPolicyStore implements SecurityPolicyStore {
  private policies = new Map<string, SecurityPolicies>()
  private global: SecurityPolicies = clone(DEFAULT_SECURITY_POLICIES)

  getPolicies(principalId: string): SecurityPolicies {
    const stored = this.policies.get(principalId) ?? this.global
    return clone(stored)
  }

  getStoredPolicies(principalId: string): SecurityPolicies | null {
    const stored = this.policies.get(principalId)
    return stored ? clone(stored) : null
  }

  setPolicies(principalId: string, policies: SecurityPolicies): SecurityPolicies {
    const stored = clone(policies)
    this.policies.set(principalId, stored)
    return clone(stored)
  }

  resetPolicies(principalId: string): void {
    this.policies.delete(principalId)
  }

  getGlobalPolicies(): SecurityPolicies {
    return clone(this.global)
  }

  setGlobalPolicies(policies: SecurityPolicies): SecurityPolicies {
    this.global = clone(policies)
    return clone(this.global)
  }
}

let policyStore: SecurityPolicyStore = new MemorySecurityPolicyStore()

/** Single seam for the policy store (swap for a durable backend in prod). */
export function getSecurityPolicyStore(): SecurityPolicyStore {
  return policyStore
}

/** Test hook: replaces the policy store. */
export function setSecurityPolicyStoreForTests(next: SecurityPolicyStore | undefined): void {
  policyStore = next ?? new MemorySecurityPolicyStore()
}

function minutesOfDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return hours * 60 + minutes
}

/**
 * True when `date` falls inside the window. Windows may wrap midnight
 * (start > end means "from start through end of day, then start of next").
 * A window where start === end is rejected by the schema.
 */
export function isWithinSignInWindow(window: SignInWindow, date: Date): boolean {
  const now = minutesOfDay(date)
  const start = hhmmToMinutes(window.start)
  const end = hhmmToMinutes(window.end)
  if (start < end) return now >= start && now < end
  // Overnight window: [start, 24:00) ∪ [0:00, end)
  return now >= start || now < end
}

/**
 * Evaluates a principal's effective policy against a sign-in (or credential)
 * context and returns every violation found. Empty array = allowed.
 *
 * Designed to be called by the session-creation routes
 * (`/api/auth/signin`, `/api/auth/2fa/verify-login`, OAuth callback,
 * passwordless verify) once enforcement is wired; today it is exercised by
 * tests and available to any caller via {@link getSecurityPolicyStore}.
 */
export function checkPolicy(
  principalId: string,
  context: PolicyCheckContext,
  store: SecurityPolicyStore = getSecurityPolicyStore(),
): PolicyViolation[] {
  const policies = store.getPolicies(principalId)
  const violations: PolicyViolation[] = []

  if (
    policies.requireTwoFactor &&
    context.twoFactorEnabled === false &&
    context.method !== "totp"
  ) {
    violations.push({
      code: "two_factor_required",
      message: "This account requires two-factor authentication before sign-in.",
      severity: "enforced",
    })
  }

  if (policies.allowedSignInWindow) {
    const now = context.now ?? new Date()
    if (!isWithinSignInWindow(policies.allowedSignInWindow, now)) {
      violations.push({
        code: "outside_sign_in_window",
        message: `Sign-in is only allowed between ${policies.allowedSignInWindow.start} and ${policies.allowedSignInWindow.end} UTC.`,
        severity: "enforced",
      })
    }
  }

  if (
    policies.sessionMaxAgeHours !== null &&
    context.requestedSessionHours !== undefined &&
    context.requestedSessionHours > policies.sessionMaxAgeHours
  ) {
    violations.push({
      code: "session_max_age_exceeded",
      message: `Sessions are limited to ${policies.sessionMaxAgeHours} hours by your security policy.`,
      severity: "advisory",
    })
  }

  if (
    policies.minPasswordLength !== null &&
    context.passwordLength !== undefined &&
    context.passwordLength < policies.minPasswordLength
  ) {
    violations.push({
      code: "password_below_minimum",
      message: `Passwords must be at least ${policies.minPasswordLength} characters.`,
      severity: "advisory",
    })
  }

  return violations
}
