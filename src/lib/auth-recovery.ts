"use client"

import { AuthApiError, type AuthErrorCode } from "@/lib/auth/auth-client"

/** How a reset or verification link behaves on the frontend. */
export type TokenState = "valid" | "expired" | "used" | "invalid"

/** Resend buttons stay disabled for this long after a link is sent. */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * Demo-safe token classification.
 *
 * Email delivery and token storage are not wired up yet, so the screens use
 * recognisable token prefixes to render every state: `expired-…`, `used-…`,
 * `invalid`/`bad-token`, or anything else as a currently valid link.
 */
export function getTokenState(token: string | null | undefined): TokenState {
  const normalized = token?.trim().toLowerCase()
  if (!normalized || normalized === "invalid" || normalized === "bad-token") {
    return "invalid"
  }
  if (normalized.startsWith("expired")) return "expired"
  if (normalized.startsWith("used")) return "used"
  return "valid"
}

// ---------------------------------------------------------------------------
// Account-recovery API client (`/api/auth/recovery/*`)
// ---------------------------------------------------------------------------
//
// The guided account-recovery flow exchanges the emailed one-time token for a
// short-lived *recovery session token* that authorises the follow-up steps
// (new password, email verification, security review, completion). The
// session token is a bearer secret kept in component state only — it is never
// written to cookies, localStorage, or the URL.

export type RecoverySession = {
  /** Bearer token authorising the verified-phase endpoints. */
  sessionToken: string
  /** ISO timestamp when the recovery session expires. */
  sessionExpiresAt: string
  /** Account email the recovery was opened for. */
  email: string
}

export type RecoveryActions = {
  /** ISO timestamp when the password was reset during this recovery. */
  passwordResetAt: string | null
  /** ISO timestamp when the email was marked verified during recovery. */
  emailVerifiedAt: string | null
}

export type RecoveryAuditEvent = {
  timestamp: string
  type: string
  metadata?: Record<string, unknown>
}

export type RecoveryStatus = {
  phase: "pending" | "verified" | "completed"
  email: string
  sessionExpiresAt: string | null
  actions: RecoveryActions
  /** Recent auth audit events for the account (newest first, capped). */
  events: RecoveryAuditEvent[]
}

type ApiEnvelope = { ok?: boolean; code?: string; message?: string } & Record<string, unknown>

async function recoveryApi<T extends ApiEnvelope>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthApiError("network", "Network error. Check your connection and try again.")
  }

  let payload: ApiEnvelope
  try {
    payload = (await response.json()) as ApiEnvelope
  } catch {
    throw new AuthApiError("unknown", "Unexpected response from the server.", response.status)
  }

  if (!response.ok || payload.ok === false) {
    const code = (payload.code as AuthErrorCode | undefined) ?? "unknown"
    const { ok: _ok, code: _code, message: _message, ...data } = payload
    throw new AuthApiError(
      code,
      payload.message ?? "Something went wrong. Please try again.",
      response.status,
      data,
    )
  }
  return payload as T
}

/**
 * Requests an account-recovery email. The server always answers ok for valid
 * input — registered and unknown addresses are indistinguishable — so this
 * resolves void on success.
 */
export async function requestAccountRecovery(email: string): Promise<void> {
  await recoveryApi("/api/auth/recovery/request", { email })
}

/**
 * Exchanges the emailed one-time token for a recovery session token.
 * Throws `AuthApiError` with code `invalid_token` and `data.reason` of
 * `expired` | `used` | `invalid` when the link cannot be consumed.
 */
export async function verifyRecoveryToken(token: string): Promise<RecoverySession> {
  const payload = await recoveryApi<{
    sessionToken?: string
    sessionExpiresAt?: string
    email?: string
  }>("/api/auth/recovery/verify", { token })
  if (!payload.sessionToken || !payload.sessionExpiresAt || !payload.email) {
    throw new AuthApiError("unknown", "Unexpected response from the server.")
  }
  return {
    sessionToken: payload.sessionToken,
    sessionExpiresAt: payload.sessionExpiresAt,
    email: payload.email,
  }
}

/** Recovery state + recent security events for a verified session token. */
export async function getRecoveryStatus(sessionToken: string): Promise<RecoveryStatus> {
  const payload = await recoveryApi<{
    phase?: RecoveryStatus["phase"]
    email?: string
    sessionExpiresAt?: string | null
    actions?: RecoveryActions
    events?: RecoveryAuditEvent[]
  }>("/api/auth/recovery/status", { sessionToken })
  return {
    phase: payload.phase ?? "verified",
    email: payload.email ?? "",
    sessionExpiresAt: payload.sessionExpiresAt ?? null,
    actions: payload.actions ?? { passwordResetAt: null, emailVerifiedAt: null },
    events: payload.events ?? [],
  }
}

/** Sets a new password during the verified recovery phase. */
export async function resetRecoveryPassword(input: {
  sessionToken: string
  password: string
}): Promise<void> {
  await recoveryApi("/api/auth/recovery/password", input)
}

/** Marks the account email as verified during recovery (proof of inbox control). */
export async function markRecoveryEmailVerified(sessionToken: string): Promise<void> {
  await recoveryApi("/api/auth/recovery/email-verified", { sessionToken })
}

/**
 * Finishes the recovery: the server revokes every auth session for the
 * account and burns both tokens, so the emailed link and this session token
 * can never be reused.
 */
export async function completeAccountRecovery(sessionToken: string): Promise<void> {
  await recoveryApi("/api/auth/recovery/complete", { sessionToken })
}
