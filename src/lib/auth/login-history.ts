import type { AuthAuditEventType } from "@/lib/auth/audit"

/**
 * Shared constants for the login-history feature (`/app/security/login-history`
 * and `GET /api/auth/login-history`).
 *
 * Kept in a leaf module so the client screen can import the event-type list
 * without pulling the audit store (and its `site-forms`/zod graph) into the
 * browser bundle — `audit.ts` is only imported here as a type.
 */

/** Every event type the auth audit log can record, in display order. */
export const LOGIN_HISTORY_EVENT_TYPES = [
  "signin.success",
  "signin.failure",
  "signin.totp_challenge",
  "logout",
  "token.refresh",
  "session.revoked",
  "password.reset",
  "email.verify",
  "totp.enroll",
  "totp.disable",
] as const satisfies readonly AuthAuditEventType[]

export function isLoginHistoryEventType(value: string): value is AuthAuditEventType {
  return (LOGIN_HISTORY_EVENT_TYPES as readonly string[]).includes(value)
}
