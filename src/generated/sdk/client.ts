// GENERATED FILE — do not edit by hand.
// Regenerate with: npx tsx scripts/generate-sdk.ts
// Source of truth: src/app/api/**/route.ts

import { ApiError, type EndpointMeta, type RequestOptions, type SdkConfig } from "./types"

let config: SdkConfig = {}

/**
 * Configure the generated client (base URL, default headers, fetch
 * implementation). Call once at app startup, or pass per-request overrides
 * via RequestOptions.
 */
export function configureSdk(next: SdkConfig): void {
  config = { ...config, ...next }
}

/** Returns a snapshot of the current SDK configuration. */
export function getSdkConfig(): Readonly<SdkConfig> {
  return { ...config }
}

type RequestArgs = {
  pathParams?: Record<string, string>
  body?: unknown
  options?: RequestOptions
}

function resolveUrl(path: string, args: RequestArgs): string {
  let url = path
  if (args.pathParams) {
    // Substitute per path segment so ":id" can never corrupt a longer param
    // like ":idFoo" — segment starts are the only valid param boundaries.
    url = url
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment
        const value = args.pathParams?.[segment.slice(1)]
        return value === undefined ? segment : encodeURIComponent(value)
      })
      .join("/")
  }

  const query = args.options?.query
  if (query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value))
    }
    const qs = params.toString()
    if (qs) url += (url.includes("?") ? "&" : "?") + qs
  }

  const baseUrl = config.baseUrl?.replace(/\/+$/, "")
  return baseUrl ? baseUrl + url : url
}

async function request(
  method: string,
  path: string,
  args: RequestArgs = {},
): Promise<unknown> {
  const fetchImpl = config.fetch ?? fetch
  const hasBody = args.body !== undefined
  const headers = new Headers({ accept: "application/json" })
  if (hasBody) headers.set("content-type", "application/json")
  new Headers(config.headers).forEach((value, key) => headers.set(key, value))
  if (args.options?.headers) {
    new Headers(args.options.headers).forEach((value, key) => headers.set(key, value))
  }

  const response = await fetchImpl(resolveUrl(path, args), {
    method,
    headers,
    body: hasBody ? JSON.stringify(args.body) : undefined,
    signal: args.options?.signal ?? null,
  })

  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON response body; keep the raw text.
  }

  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Request failed with status ${response.status}`
    throw new ApiError(response.status, message, parsed)
  }

  return parsed
}

/**
 * POST /api/activity — publish a realtime activity event.
 * 
 * Body is a single `ActivityStreamEvent` (`{ type: "activity", activity }`;
 * see `src/lib/activity/events.ts`). The event is fanned out through the
 * in-memory hub to every stream connection held by the caller's principal —
 * other tabs and devices of the same user. Events can only ever reach the
 * publisher's own channel, so no cross-user targeting is possible.
 * 
 * This mirrors `POST /api/notifications`. The session-principal resolver is
 * shared (`notificationPrincipalFromRequest` is a generic session → channel
 * key mapping, not notification-specific). Server-side producers (agent
 * runs, automations, …) should call `publishActivityEvent` directly once a
 * backend exists; this route is the client-side entry point used by
 * `pushActivityEvent` in `src/lib/activity/client.ts`.
 */
export function postActivity(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/activity", { body, options })
}

export function getActivityStream(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/activity/stream", { options })
}

export function postAnalytics(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/analytics", { body, options })
}

export function getAnalyticsSummary(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/analytics/summary", { options })
}

/**
 * GET /api/auth/2fa/backup-codes — status for the signed-in user: whether
 * TOTP two-factor is enabled, whether an API-managed code set exists, and how
 * many unused codes remain. Codes are stored hashed only, so plaintext can
 * never be listed — the count is all there is. `managed: false` means the
 * active set (if any) is the one issued at enrollment.
 */
export function getAuth2faBackupCodes(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/2fa/backup-codes", { options })
}

/**
 * POST /api/auth/2fa/backup-codes — issues a fresh set of one-time backup
 * codes and returns the plaintext exactly once. Requires two-factor
 * authentication to be enabled. Every previously issued code (including the
 * enrollment set) stops working immediately.
 */
export function postAuth2faBackupCodes(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/backup-codes", { body, options })
}

/**
 * POST /api/auth/2fa/confirm — activates TOTP after a valid code and returns
 * the backup codes exactly once. Re-enrolling later rotates both secret and
 * backup codes.
 */
export function postAuth2faConfirm(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/confirm", { body, options })
}

/**
 * POST /api/auth/2fa/disable — requires the account password as re-auth.
 */
export function postAuth2faDisable(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/disable", { body, options })
}

/**
 * POST /api/auth/2fa/enroll — starts TOTP enrollment for the signed-in user.
 * Returns the base32 secret and an `otpauth://` provisioning URI. Nothing is
 * activated until `/api/auth/2fa/confirm` accepts a valid code.
 */
export function postAuth2faEnroll(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/enroll", { body, options })
}

/**
 * POST /api/auth/2fa/recovery/cancel — aborts a pending or cooling-down
 * recovery. This is the safety hatch for an unauthorized request: cancelling
 * during the 72h cooldown keeps 2FA fully enabled.
 */
export function postAuth2faRecoveryCancel(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/recovery/cancel", { body, options })
}

/**
 * POST /api/auth/2fa/recovery/confirm — consumes the emailed recovery token
 * and moves the recovery into the cooldown phase. 2FA is NOT disabled here:
 * it stays on until `executeAt` (72h) so the account owner can cancel an
 * unauthorized request. An optional backup code adds proof-of-possession on
 * top of the email token; a wrong code aborts the confirmation.
 */
export function postAuth2faRecoveryConfirm(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/recovery/confirm", { body, options })
}

/**
 * POST /api/auth/2fa/recovery/request — starts (or resends) a two-factor
 * recovery for the signed-in user. Emails a single-use token link; the
 * account's 2FA stays enabled until the token is confirmed AND the
 * {@link RECOVERY_COOLDOWN_MS} delay elapses, so an unauthorized request is
 * visible and cancellable long before it takes effect.
 * 
 * Requires an authenticated session: the requester must already be signed in
 * (e.g. a remembered session on another device). Truly locked-out users with
 * no session are out of scope for this endpoint — see the recovery docs.
 */
export function postAuth2faRecoveryRequest(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/recovery/request", { body, options })
}

/**
 * GET /api/auth/2fa/recovery/status — recovery state for the signed-in user.
 * 
 * When a cooldown recovery reaches `executeAt` this GET finalizes it
 * lazily (idempotent): the TOTP secret is cleared via
 * `startTotpEnrollment` — the backend seam that resets secret, enabled flag,
 * and enrollment backup codes without needing the account password — the
 * API-managed backup-code set is dropped, and the user is emailed. A
 * dedicated `AuthBackend.disableTotpForRecovery` is the cleaner follow-up.
 */
export function getAuth2faRecoveryStatus(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/2fa/recovery/status", { options })
}

/**
 * POST /api/auth/2fa/verify-login — second step of password sign-in when the
 * account has TOTP enabled. Accepts a 6-digit code or a backup code; the
 * challenge token is single-purpose and expires after 5 minutes.
 */
export function postAuth2faVerifyLogin(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/2fa/verify-login", { body, options })
}

/**
 * GET /api/auth/audit?limit=N — returns the signed-in user's own auth audit
 * events, newest first. There is no cross-user admin view yet: workspace roles
 * (owner/admin/member) live at the membership layer and are not carried in the
 * auth session, so every caller sees only events attributed to their userId.
 * 
 * Auth: requires a valid `spindle_at` access cookie whose user still exists.
 */
export function getAuthAudit(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/audit", { options })
}

/**
 * GET /api/auth/email-change — effective sign-in email plus any pending
 * change (new address, timestamps, resend cooldown) for the session.
 */
export function getAuthEmailChange(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/email-change", { options })
}

/**
 * POST /api/auth/email-change/cancel — drops the pending change so its
 * emailed link stops working. Idempotent: returns `cancelled: false` when
 * nothing was pending rather than an error.
 */
export function postAuthEmailChangeCancel(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/email-change/cancel", { body, options })
}

export function getAuthEmailChangeConfirm(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/email-change/confirm", { options })
}

export function postAuthEmailChangeConfirm(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/email-change/confirm", { body, options })
}

/**
 * POST /api/auth/email-change/request — starts (or restarts) an email change.
 * A signed single-use link is emailed to the NEW address; the old address is
 * notified only after the change is confirmed.
 * 
 * The per-principal cooldown mirrors `verify-email/resend`: it is checked
 * and marked before the email send so request rate — not delivery — is
 * limited, and concurrent requests dedupe through the same window.
 */
export function postAuthEmailChangeRequest(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/email-change/request", { body, options })
}

/**
 * POST /api/auth/email-change/resend — emails a fresh confirmation link for
 * the pending change. Resending rotates the pending record id, so links
 * from earlier sends stop working (single active link per change).
 * 
 * Shares the per-principal cooldown with `request` so the two endpoints
 * cannot be alternated to bypass the window.
 */
export function postAuthEmailChangeResend(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/email-change/resend", { body, options })
}

/**
 * POST /api/auth/logout — revokes the refresh-token session server-side and
 * clears both auth cookies. Idempotent: always returns ok.
 */
export function postAuthLogout(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/logout", { body, options })
}

/**
 * GET /api/auth/oauth/[provider] — public provider configuration for the
 * client-side PKCE flow. Returns only non-secret values; the client builds
 * the authorize URL and keeps the code verifier in sessionStorage.
 * 
 * For synthetic mock providers (NEXT_PUBLIC_MOCK_AUTH dev mode) the
 * authorize URL is a same-origin bounce on /api/auth/oauth/callback that
 * immediately redirects back to /oauth/callback with a mock code — the rest
 * of the flow (PKCE state check, session cookies) runs unchanged.
 */
export function getAuthOauthProvider(params: { provider: string }, options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/oauth/:provider", { pathParams: params, options })
}

/**
 * GET /api/auth/oauth/callback?mock_authorize=<provider> — mock-mode bounce.
 * 
 * Only reachable for synthetic providers injected when NEXT_PUBLIC_MOCK_AUTH=1
 * (see oauth-providers.ts). GET /api/auth/oauth/[provider] points the
 * authorize URL here; the browser lands on this route carrying the PKCE
 * `state` the client generated, and we bounce straight back to
 * /oauth/callback with a fixture `code`. State validation still happens
 * client-side in `consumePendingOAuthFlow` — this route never sees a real
 * provider redirect, so there is nothing to verify server-side.
 */
export function getAuthOauthCallback(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/oauth/callback", { options })
}

/**
 * POST /api/auth/oauth/callback — exchanges the authorization code (with the
 * client-held PKCE verifier) for tokens, resolves the provider profile, and
 * issues a session. `redirectUri` must match the value used at authorize time
 * (enforced by the provider).
 * 
 * Mock providers skip the exchange/profile calls entirely and resolve a
 * fixture identity, so the whole sign-in works in dev without registering an
 * OAuth app.
 */
export function postAuthOauthCallback(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/oauth/callback", { body, options })
}

/**
 * POST /api/auth/password/reset/confirm — consumes a reset token, sets the new
 * password, and revokes all existing sessions so a stolen session cannot
 * survive the recovery.
 */
export function postAuthPasswordResetConfirm(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/password/reset/confirm", { body, options })
}

/**
 * POST /api/auth/password/reset/request — emails a single-use reset link.
 * Always returns ok for valid input so registered addresses are not
 * enumerable; unknown addresses simply get no email.
 */
export function postAuthPasswordResetRequest(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/password/reset/request", { body, options })
}

/**
 * POST /api/auth/passwordless/request — emails a single-use sign-in or
 * verification link. Always returns ok so the endpoint cannot be used to
 * enumerate registered addresses.
 */
export function postAuthPasswordlessRequest(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/passwordless/request", { body, options })
}

/**
 * POST /api/auth/passwordless/verify — consumes a magic-link token and sets
 * the session cookies. Single-use. All failures share the 401
 * `invalid_token` code, but the `reason` field distinguishes expired /
 * already-used / invalid links so the UI can offer a targeted resend flow
 * (same contract as `/api/auth/verify-email`).
 */
export function postAuthPasswordlessVerify(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/passwordless/verify", { body, options })
}

/**
 * POST /api/auth/refresh — rotates the refresh token and issues a new access
 * token. The client calls this single-flight; the backend treats each refresh
 * token as single-use, so a lost rotation race surfaces as 401 and the client
 * signs out cleanly.
 */
export function postAuthRefresh(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/refresh", { body, options })
}

/**
 * GET /api/auth/session — returns the current session description.
 * 
 * Resolution order:
 *  1. Valid `spindle_at` access cookie -> user lookup -> session JSON.
 *  2. Otherwise a `spindle_rt` refresh cookie -> rotate the pair, set fresh
 *     cookies, and return the new session.
 *  3. Neither -> `{ session: null }`.
 */
export function getAuthSession(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/auth/session", { options })
}

/**
 * POST /api/auth/signin — email + password. Returns either a session (auth
 * cookies are set) or `{ status: "totp_required", challenge }` when the
 * account has 2FA enabled; the client then calls `/api/auth/2fa/verify-login`.
 */
export function postAuthSignin(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/signin", { body, options })
}

/**
 * POST /api/auth/signup — creates the account + workspace, sends a verification
 * email, and signs the user in immediately (session cookies set). The account
 * is flagged `emailVerified: false` until the link is consumed.
 */
export function postAuthSignup(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/signup", { body, options })
}

/**
 * POST /api/auth/verify-email — consumes a verification token and marks the
 * account verified. Single-use; all failures return the same 401.
 */
export function postAuthVerifyEmail(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/verify-email", { body, options })
}

/**
 * POST /api/auth/verify-email/resend — emails a fresh single-use verification
 * link.
 * 
 * Cooldown semantics (per syntactically valid email, applied uniformly):
 *  - The per-email cooldown is checked and marked for EVERY well-formed
 *    address — before any account lookup — so the response cannot reveal
 *    whether the address is registered or verified (no enumeration oracle).
 *  - `markSent` runs synchronously before the first `await`, which doubles
 *    as in-flight dedupe: a concurrent request for the same email observes
 *    the cooldown and gets 429 instead of double-sending.
 *  - The cooldown therefore limits request *rate*, not deliveries: a failed
 *    send still consumes the window, which is the desired anti-retry-storm
 *    behaviour.
 *  - Unknown or already-verified addresses still get `ok({ sent: true })`;
 *    the success body carries `retryAfter` so clients can sync their
 *    countdown to the server window.
 *  - The email send itself is fire-and-forget: awaiting the provider HTTP
 *    call only for registered-unverified addresses would make response
 *    latency a side-channel for account existence. Token issuance stays
 *    awaited (cheap, local), but delivery is floated with `.catch` logging
 *    so the response neither waits on nor depends on the send outcome.
 */
export function postAuthVerifyEmailResend(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/auth/verify-email/resend", { body, options })
}

export function getCohorts(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/cohorts", { options })
}

export function getCommunicationPreferences(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/communication-preferences", { options })
}

export function putCommunicationPreferences(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("PUT", "/api/communication-preferences", { body, options })
}

export function postContact(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/contact", { body, options })
}

export function getCspReport(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/csp-report", { options })
}

/**
 * CSP violation collector (see docs/security/csp-reporting.md).
 * 
 * Browsers POST here when the policy carries `report-uri` (legacy
 * `application/csp-report`, `{"csp-report": {...}}`) or `report-to`
 * (`application/reports+json`, array of `{type:"csp-violation", body:{…}}`).
 * 
 * Violations are emitted as structured `csp.violation` log events — the log
 * pipeline (stdout → collector → JSONL/analysis) is the store; no DB writes.
 * Always answers 204 so browsers neither retry nor surface errors.
 */
export function postCspReport(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/csp-report", { body, options })
}

/**
 * POST /api/email-series/enroll — { email, name? }
 * 
 * Public enrollment hook for the welcome drip series. The signup route is the
 * primary caller (it should invoke `enrollEmailSeries` directly with the new
 * user's id as `principal`); this endpoint exists for flows that only know an
 * email address. Idempotent — repeat calls return the existing enrollment.
 * 
 * The day-0 step is sent by the next `processEmailSeriesQueue()` tick (cron or
 * `POST /api/email-series/tick`), not inline.
 */
export function postEmailSeriesEnroll(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/email-series/enroll", { body, options })
}

/**
 * GET /api/email-series/status?email=...&series=welcome
 * 
 * Read-only enrollment status for support/debugging. Exposes step ids and
 * timestamps only — no message content.
 */
export function getEmailSeriesStatus(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/email-series/status", { options })
}

/**
 * POST /api/email-series/tick — dispatch due drip-series emails.
 * 
 * This is the cron entry point for `processEmailSeriesQueue()`. Auth:
 *  - `SESSION_SECRET` set → requires `Authorization: Bearer <secret>`.
 *    Point the scheduler at this route with the same secret.
 *  - `SESSION_SECRET` unset → allowed only outside production (local dev /
 *    tests); in production the route fails closed with 503.
 * 
 * Alternatively, a scheduler can call `processEmailSeriesQueue()` directly
 * in-process; this route just exposes it over HTTP.
 */
export function postEmailSeriesTick(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/email-series/tick", { body, options })
}

/**
 * GET /api/email/unsubscribe?token=...&email=...
 * 
 * Status check only — never mutates. Mail clients and link scanners may GET
 * unsubscribe URLs, so the state change is reserved for POST.
 */
export function getEmailUnsubscribe(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/email/unsubscribe", { options })
}

/**
 * POST /api/email/unsubscribe
 * 
 * Two callers:
 *  - RFC 8058 one-click: `List-Unsubscribe=One-Click` (form or urlencoded) with
 *    the token in the query string or body. Always succeeds silently-ish.
 *  - The /unsubscribe confirmation page: JSON `{ token, email? }`.
 * 
 * Idempotent: unsubscribing an already-unsubscribed address returns ok.
 */
export function postEmailUnsubscribe(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/email/unsubscribe", { body, options })
}

export function postFeedback(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/feedback", { body, options })
}

export function postNewsletter(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/newsletter", { body, options })
}

/**
 * POST /api/notifications — publish a realtime notification event.
 * 
 * Body is a single `NotificationStreamEvent` (`notification`, `read`, or
 * `read_all`; see `src/lib/notifications/events.ts`). The event is fanned out
 * through the in-memory hub to every stream connection held by the caller's
 * principal — other tabs and devices of the same user. Events can only ever
 * reach the publisher's own channel, so no cross-user targeting is possible.
 * 
 * Server-side producers (agent runs, automations, …) should call
 * `publishNotificationEvent` directly once a backend exists; this route is
 * the client-side entry point used by `AppNotificationsProvider`.
 */
export function postNotifications(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/notifications", { body, options })
}

export function postNotificationsDigest(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/notifications/digest", { body, options })
}

export function getNotificationsStream(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/notifications/stream", { options })
}

export function postNps(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/nps", { body, options })
}

export function getOnboarding(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/onboarding", { options })
}

export function postOnboarding(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("POST", "/api/onboarding", { body, options })
}

export function putOnboarding(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("PUT", "/api/onboarding", { body, options })
}

export function getProfile(options: RequestOptions = {}): Promise<unknown> {
  return request("GET", "/api/profile", { options })
}

export function putProfile(body?: unknown, options: RequestOptions = {}): Promise<unknown> {
  return request("PUT", "/api/profile", { body, options })
}

/** Static metadata for every generated endpoint, in stable sorted order. */
export const ENDPOINTS: readonly EndpointMeta[] = [
  { name: "postActivity", method: "POST", path: "/api/activity", pathParams: [] },
  { name: "getActivityStream", method: "GET", path: "/api/activity/stream", pathParams: [] },
  { name: "postAnalytics", method: "POST", path: "/api/analytics", pathParams: [] },
  { name: "getAnalyticsSummary", method: "GET", path: "/api/analytics/summary", pathParams: [] },
  { name: "getAuth2faBackupCodes", method: "GET", path: "/api/auth/2fa/backup-codes", pathParams: [] },
  { name: "postAuth2faBackupCodes", method: "POST", path: "/api/auth/2fa/backup-codes", pathParams: [] },
  { name: "postAuth2faConfirm", method: "POST", path: "/api/auth/2fa/confirm", pathParams: [] },
  { name: "postAuth2faDisable", method: "POST", path: "/api/auth/2fa/disable", pathParams: [] },
  { name: "postAuth2faEnroll", method: "POST", path: "/api/auth/2fa/enroll", pathParams: [] },
  { name: "postAuth2faRecoveryCancel", method: "POST", path: "/api/auth/2fa/recovery/cancel", pathParams: [] },
  { name: "postAuth2faRecoveryConfirm", method: "POST", path: "/api/auth/2fa/recovery/confirm", pathParams: [] },
  { name: "postAuth2faRecoveryRequest", method: "POST", path: "/api/auth/2fa/recovery/request", pathParams: [] },
  { name: "getAuth2faRecoveryStatus", method: "GET", path: "/api/auth/2fa/recovery/status", pathParams: [] },
  { name: "postAuth2faVerifyLogin", method: "POST", path: "/api/auth/2fa/verify-login", pathParams: [] },
  { name: "getAuthAudit", method: "GET", path: "/api/auth/audit", pathParams: [] },
  { name: "getAuthEmailChange", method: "GET", path: "/api/auth/email-change", pathParams: [] },
  { name: "postAuthEmailChangeCancel", method: "POST", path: "/api/auth/email-change/cancel", pathParams: [] },
  { name: "getAuthEmailChangeConfirm", method: "GET", path: "/api/auth/email-change/confirm", pathParams: [] },
  { name: "postAuthEmailChangeConfirm", method: "POST", path: "/api/auth/email-change/confirm", pathParams: [] },
  { name: "postAuthEmailChangeRequest", method: "POST", path: "/api/auth/email-change/request", pathParams: [] },
  { name: "postAuthEmailChangeResend", method: "POST", path: "/api/auth/email-change/resend", pathParams: [] },
  { name: "postAuthLogout", method: "POST", path: "/api/auth/logout", pathParams: [] },
  { name: "getAuthOauthProvider", method: "GET", path: "/api/auth/oauth/:provider", pathParams: ["provider"] },
  { name: "getAuthOauthCallback", method: "GET", path: "/api/auth/oauth/callback", pathParams: [] },
  { name: "postAuthOauthCallback", method: "POST", path: "/api/auth/oauth/callback", pathParams: [] },
  { name: "postAuthPasswordResetConfirm", method: "POST", path: "/api/auth/password/reset/confirm", pathParams: [] },
  { name: "postAuthPasswordResetRequest", method: "POST", path: "/api/auth/password/reset/request", pathParams: [] },
  { name: "postAuthPasswordlessRequest", method: "POST", path: "/api/auth/passwordless/request", pathParams: [] },
  { name: "postAuthPasswordlessVerify", method: "POST", path: "/api/auth/passwordless/verify", pathParams: [] },
  { name: "postAuthRefresh", method: "POST", path: "/api/auth/refresh", pathParams: [] },
  { name: "getAuthSession", method: "GET", path: "/api/auth/session", pathParams: [] },
  { name: "postAuthSignin", method: "POST", path: "/api/auth/signin", pathParams: [] },
  { name: "postAuthSignup", method: "POST", path: "/api/auth/signup", pathParams: [] },
  { name: "postAuthVerifyEmail", method: "POST", path: "/api/auth/verify-email", pathParams: [] },
  { name: "postAuthVerifyEmailResend", method: "POST", path: "/api/auth/verify-email/resend", pathParams: [] },
  { name: "getCohorts", method: "GET", path: "/api/cohorts", pathParams: [] },
  { name: "getCommunicationPreferences", method: "GET", path: "/api/communication-preferences", pathParams: [] },
  { name: "putCommunicationPreferences", method: "PUT", path: "/api/communication-preferences", pathParams: [] },
  { name: "postContact", method: "POST", path: "/api/contact", pathParams: [] },
  { name: "getCspReport", method: "GET", path: "/api/csp-report", pathParams: [] },
  { name: "postCspReport", method: "POST", path: "/api/csp-report", pathParams: [] },
  { name: "postEmailSeriesEnroll", method: "POST", path: "/api/email-series/enroll", pathParams: [] },
  { name: "getEmailSeriesStatus", method: "GET", path: "/api/email-series/status", pathParams: [] },
  { name: "postEmailSeriesTick", method: "POST", path: "/api/email-series/tick", pathParams: [] },
  { name: "getEmailUnsubscribe", method: "GET", path: "/api/email/unsubscribe", pathParams: [] },
  { name: "postEmailUnsubscribe", method: "POST", path: "/api/email/unsubscribe", pathParams: [] },
  { name: "postFeedback", method: "POST", path: "/api/feedback", pathParams: [] },
  { name: "postNewsletter", method: "POST", path: "/api/newsletter", pathParams: [] },
  { name: "postNotifications", method: "POST", path: "/api/notifications", pathParams: [] },
  { name: "postNotificationsDigest", method: "POST", path: "/api/notifications/digest", pathParams: [] },
  { name: "getNotificationsStream", method: "GET", path: "/api/notifications/stream", pathParams: [] },
  { name: "postNps", method: "POST", path: "/api/nps", pathParams: [] },
  { name: "getOnboarding", method: "GET", path: "/api/onboarding", pathParams: [] },
  { name: "postOnboarding", method: "POST", path: "/api/onboarding", pathParams: [] },
  { name: "putOnboarding", method: "PUT", path: "/api/onboarding", pathParams: [] },
  { name: "getProfile", method: "GET", path: "/api/profile", pathParams: [] },
  { name: "putProfile", method: "PUT", path: "/api/profile", pathParams: [] },
]
