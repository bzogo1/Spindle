/**
 * Curated catalog of same-origin `/api/*` routes for the API playground.
 *
 * The list mirrors the real route handlers under `src/app/api/`. When routes
 * change, update this file — the playground cannot scan the filesystem at
 * runtime.
 */

export type PlaygroundMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export interface PlaygroundEndpoint {
  id: string
  method: PlaygroundMethod
  /** Path template; `{param}` segments become path-param inputs. */
  path: string
  group: string
  summary: string
  auth?: "none" | "session" | "token"
  /** Example JSON body prefilled into the editor. */
  bodyExample?: unknown
  /** Documented query parameters. */
  queryParams?: { name: string; required?: boolean; description?: string }[]
}

export const API_GROUPS = [
  "Authentication",
  "Profile & preferences",
  "Notifications & activity",
  "Feedback & surveys",
  "Analytics",
  "Misc",
] as const

export const API_ENDPOINTS: readonly PlaygroundEndpoint[] = [
  // Authentication
  {
    id: "auth-signin",
    method: "POST",
    path: "/api/auth/signin",
    group: "Authentication",
    summary: "Sign in with email and password.",
    auth: "none",
    bodyExample: { email: "you@example.com", password: "correct horse battery staple" },
  },
  {
    id: "auth-signup",
    method: "POST",
    path: "/api/auth/signup",
    group: "Authentication",
    summary: "Create a new account and workspace, then sign in.",
    auth: "none",
    bodyExample: {
      workspaceName: "Adas Lab",
      email: "you@example.com",
      password: "correct horse battery staple",
      remember: true,
    },
  },
  {
    id: "auth-session",
    method: "GET",
    path: "/api/auth/session",
    group: "Authentication",
    summary: "Return the current session, or 401 when signed out.",
    auth: "session",
  },
  {
    id: "auth-refresh",
    method: "POST",
    path: "/api/auth/refresh",
    group: "Authentication",
    summary: "Rotate the session refresh token.",
    auth: "session",
  },
  {
    id: "auth-logout",
    method: "POST",
    path: "/api/auth/logout",
    group: "Authentication",
    summary: "End the current session.",
    auth: "session",
  },
  {
    id: "auth-passwordless-request",
    method: "POST",
    path: "/api/auth/passwordless/request",
    group: "Authentication",
    summary: "Email a one-time sign-in code.",
    auth: "none",
    bodyExample: { email: "you@example.com" },
  },
  {
    id: "auth-passwordless-verify",
    method: "POST",
    path: "/api/auth/passwordless/verify",
    group: "Authentication",
    summary: "Exchange a one-time sign-in token for a session.",
    auth: "none",
    bodyExample: { token: "one-time-code-from-email" },
  },
  {
    id: "auth-password-reset-request",
    method: "POST",
    path: "/api/auth/password/reset/request",
    group: "Authentication",
    summary: "Email a password reset link.",
    auth: "none",
    bodyExample: { email: "you@example.com" },
  },
  {
    id: "auth-password-reset-confirm",
    method: "POST",
    path: "/api/auth/password/reset/confirm",
    group: "Authentication",
    summary: "Set a new password using a reset token.",
    auth: "none",
    bodyExample: { token: "reset-token", password: "new password" },
  },
  {
    id: "auth-verify-email",
    method: "POST",
    path: "/api/auth/verify-email",
    group: "Authentication",
    summary: "Confirm an email address with a verification token.",
    auth: "none",
    bodyExample: { token: "verify-token" },
  },
  {
    id: "auth-verify-email-resend",
    method: "POST",
    path: "/api/auth/verify-email/resend",
    group: "Authentication",
    summary:
      "Email a fresh verification link. Public endpoint — always answers ok for well-formed addresses; per-email cooldown applies.",
    auth: "none",
    bodyExample: { email: "you@example.com" },
  },
  {
    id: "auth-2fa-enroll",
    method: "POST",
    path: "/api/auth/2fa/enroll",
    group: "Authentication",
    summary: "Start TOTP two-factor enrollment.",
    auth: "session",
  },
  {
    id: "auth-2fa-confirm",
    method: "POST",
    path: "/api/auth/2fa/confirm",
    group: "Authentication",
    summary: "Confirm TOTP enrollment with a code.",
    auth: "session",
    bodyExample: { code: "123456" },
  },
  {
    id: "auth-2fa-disable",
    method: "POST",
    path: "/api/auth/2fa/disable",
    group: "Authentication",
    summary: "Disable two-factor authentication.",
    auth: "session",
    bodyExample: { password: "current password" },
  },
  {
    id: "auth-2fa-verify-login",
    method: "POST",
    path: "/api/auth/2fa/verify-login",
    group: "Authentication",
    summary: "Complete sign-in with a TOTP code.",
    auth: "none",
    bodyExample: { challenge: "login-challenge", code: "123456" },
  },
  {
    id: "auth-2fa-backup-codes",
    method: "GET",
    path: "/api/auth/2fa/backup-codes",
    group: "Authentication",
    summary: "List remaining two-factor backup codes.",
    auth: "session",
  },
  {
    id: "auth-2fa-recovery-status",
    method: "GET",
    path: "/api/auth/2fa/recovery/status",
    group: "Authentication",
    summary: "Check account-recovery status.",
    auth: "session",
  },
  {
    id: "auth-oauth-provider",
    method: "GET",
    path: "/api/auth/oauth/{provider}",
    group: "Authentication",
    summary: "Start an OAuth sign-in flow for a provider.",
    auth: "none",
  },
  {
    id: "auth-oauth-callback",
    method: "GET",
    path: "/api/auth/oauth/callback",
    group: "Authentication",
    summary: "OAuth redirect target; exchanges the code for a session.",
    auth: "none",
    queryParams: [
      { name: "code", required: true, description: "Authorization code from the provider" },
      { name: "state", description: "CSRF state echoed by the provider" },
    ],
  },
  {
    id: "auth-audit",
    method: "GET",
    path: "/api/auth/audit",
    group: "Authentication",
    summary: "Recent authentication events for the current user.",
    auth: "session",
  },

  // Profile & preferences
  {
    id: "profile-get",
    method: "GET",
    path: "/api/profile",
    group: "Profile & preferences",
    summary: "Fetch the current user's profile.",
    auth: "session",
  },
  {
    id: "profile-put",
    method: "PUT",
    path: "/api/profile",
    group: "Profile & preferences",
    summary: "Update the current user's display name (the only writable field).",
    auth: "session",
    bodyExample: { name: "Ada Lovelace" },
  },
  {
    id: "comm-prefs-get",
    method: "GET",
    path: "/api/communication-preferences",
    group: "Profile & preferences",
    summary: "Fetch notification and email preferences.",
    auth: "session",
  },
  {
    id: "comm-prefs-put",
    method: "PUT",
    path: "/api/communication-preferences",
    group: "Profile & preferences",
    summary:
      "Update communication preferences. Body is { preferences: {...} } — a strict object; unknown keys are rejected.",
    auth: "session",
    bodyExample: {
      preferences: {
        digestFrequency: "weekly",
        productUpdates: true,
        feedbackRequests: false,
      },
    },
  },

  // Notifications & activity
  {
    id: "notifications-list",
    method: "POST",
    path: "/api/notifications",
    group: "Notifications & activity",
    summary:
      "Publish a realtime notification event to your own feed (notification / read / unread / read_all / dismiss). This does not list notifications.",
    auth: "session",
    bodyExample: { type: "read_all" },
  },
  {
    id: "notifications-stream",
    method: "GET",
    path: "/api/notifications/stream",
    group: "Notifications & activity",
    summary: "Server-sent event stream of new notifications.",
    auth: "session",
  },
  {
    id: "notifications-digest",
    method: "POST",
    path: "/api/notifications/digest",
    group: "Notifications & activity",
    summary: "Send a digest of recent notifications.",
    auth: "session",
  },
  {
    id: "activity-track",
    method: "POST",
    path: "/api/activity",
    group: "Notifications & activity",
    summary:
      'Publish a realtime activity event to your own channel. Body is { type: "activity", activity: {...} }.',
    auth: "session",
    bodyExample: {
      type: "activity",
      activity: {
        id: "act_1",
        kind: "project",
        actor: { id: "user_1", name: "Ada" },
        summary: "Opened the lab notebook",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  },
  {
    id: "activity-stream",
    method: "GET",
    path: "/api/activity/stream",
    group: "Notifications & activity",
    summary: "Server-sent event stream of workspace activity.",
    auth: "session",
  },

  // Feedback & surveys
  {
    id: "feedback-submit",
    method: "POST",
    path: "/api/feedback",
    group: "Feedback & surveys",
    summary: "Submit product feedback (public form; category is required).",
    auth: "none",
    bodyExample: {
      category: "bug",
      message: "The lab is great, but export drops the last figure.",
      email: "you@example.com",
    },
  },
  {
    id: "nps-submit",
    method: "POST",
    path: "/api/nps",
    group: "Feedback & surveys",
    summary: "Submit an NPS score (0–10). Public form — no session required.",
    auth: "none",
    bodyExample: { score: 9, comment: "Would recommend" },
  },
  {
    id: "contact-submit",
    method: "POST",
    path: "/api/contact",
    group: "Feedback & surveys",
    summary: "Send a contact message (public form; topic and subject required).",
    auth: "none",
    bodyExample: {
      name: "Ada",
      email: "ada@example.com",
      topic: "general",
      subject: "Question about exports",
      message: "Hi — could you tell me more about the export options?",
    },
  },

  // Analytics
  {
    id: "analytics-track",
    method: "POST",
    path: "/api/analytics",
    group: "Analytics",
    summary:
      "Ingest a batch of analytics events ({ events: [...] }, 1–20). Requires the analytics consent cookie; a session only adds attribution.",
    auth: "none",
    bodyExample: {
      events: [
        {
          type: "page_view",
          name: "developers_playground",
          path: "/developers/playground",
          feature: null,
          endpoint: null,
          props: {},
          timestamp: 1735689600000,
          anonymousId: "anon_123",
        },
      ],
    },
  },
  {
    id: "analytics-summary",
    method: "GET",
    path: "/api/analytics/summary",
    group: "Analytics",
    summary: "Aggregated analytics summary for the signed-in principal.",
    auth: "session",
    queryParams: [{ name: "days", description: "Integer 1–90 (default 30)" }],
  },
  {
    id: "cohorts-list",
    method: "GET",
    path: "/api/cohorts",
    group: "Analytics",
    summary: "List analytics cohorts.",
    auth: "session",
  },

  // Misc
  {
    id: "newsletter-subscribe",
    method: "POST",
    path: "/api/newsletter",
    group: "Misc",
    summary: "Subscribe an email to the newsletter (consent: true is required).",
    auth: "none",
    bodyExample: { email: "you@example.com", consent: true },
  },
  {
    id: "email-unsubscribe",
    method: "POST",
    path: "/api/email/unsubscribe",
    group: "Misc",
    summary:
      "Unsubscribe an email address (RFC 8058 one-click or JSON { token }). GET on the same path is a read-only status check and never mutates.",
    auth: "none",
    bodyExample: { token: "signed-unsubscribe-token" },
  },
] as const

export function getEndpoint(id: string): PlaygroundEndpoint | undefined {
  return API_ENDPOINTS.find((endpoint) => endpoint.id === id)
}

export function endpointsByGroup(): { group: string; endpoints: PlaygroundEndpoint[] }[] {
  const groups = new Map<string, PlaygroundEndpoint[]>()
  for (const endpoint of API_ENDPOINTS) {
    const list = groups.get(endpoint.group) ?? []
    list.push(endpoint)
    groups.set(endpoint.group, list)
  }
  return [...groups.entries()].map(([group, endpoints]) => ({ group, endpoints }))
}
