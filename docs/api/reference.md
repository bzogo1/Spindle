# Spindle API reference

Reference for every route handler under `src/app/api/` (56 route files).
All shapes below were derived from the route handlers and their zod schemas —
they mirror, but do not import, the server-side validators (see
[contract-testing.md](./contract-testing.md)).

Machine-readable spec: [openapi.yaml](./openapi.yaml) (OpenAPI 3.1).

## Conventions

### Envelopes

Two response envelopes exist:

- **Auth family** — `/api/auth/*`, `/api/profile`, `/api/cohorts`,
  `/api/communication-preferences`, `/api/analytics*`, `/api/notifications*`,
  `/api/activity*`, `/api/onboarding`, `/api/email-series*`:
  - Success: `{ "ok": true, ...payload }` (produced by `ok()` in
    `src/lib/auth/http.ts`)
  - Failure: `{ "ok": false, "code": "<machine_code>", "message": "<human>", ...extra }`
    with an appropriate HTTP status (produced by `fail()`)
- **Public site forms** — `/api/contact`, `/api/newsletter`, `/api/feedback`,
  `/api/nps`, `/api/email/unsubscribe`:
  - Success: `{ "ok": true, "message": "...", ... }`
  - Failure: `{ "ok": false, "message": "...", "errors?": { "<field>": "<msg>" } }`
    — **no `code` field**.

### Authentication

Cookie-based session auth. Mutating endpoints on the auth family enforce a
same-origin check (`isSameOriginRequest`): a cross-origin `Origin` or
`Sec-Fetch-Site` header yields `403 { ok:false, code:"forbidden" }`.

| Cookie                 | Contents                                                    | Scope                              |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `spindle_at`           | Signed JWT access token                                     | `Path=/`, httpOnly, session cookie |
| `spindle_rt`           | Opaque refresh token (rotated on every use)                 | `Path=/api/auth`, httpOnly         |
| `spindle_mock_session` | Unsigned mock session (dev only, `NEXT_PUBLIC_MOCK_AUTH=1`) | dev/test                           |

`remember: true` (default) gives `spindle_rt` a 30-day Max-Age; `false` makes it
a session cookie. Session payload:

```json
{
  "session": {
    "user": {
      "id": "...",
      "email": "...",
      "name": "...|null",
      "emailVerified": true,
      "createdAt": "ISO"
    },
    "workspace": { "name": "...", "slug": "..." },
    "sessionId": "...",
    "expiresAt": "ISO"
  }
}
```

### Rate limiting

All limits are per-client-IP (`x-forwarded-for` first hop), in-memory,
per-instance (`createRateLimiter` in `src/lib/site-forms.ts`). Exceeding a
limit returns `429`; auth-family routes use `code: "rate_limited"`, site forms
return a plain `{ ok:false, message }`.

### Shared request fields

- `email`: trimmed, lowercased, valid email, ≤320 chars.
- Honeypot field `website` on all public forms: must be empty/absent; a filled
  value returns a silent success (bots learn nothing).

---

## Auth — `/api/auth/*`

All auth routes return the auth-family envelope. Mutating routes are
same-origin-checked and most carry a per-IP rate limit.

### `POST /api/auth/signup`

Create account + workspace, send verification email, sign in immediately.
Rate limit: 5/hour per IP.

Request (`signUpSchema`, `src/lib/auth/schemas.ts`):

```json
{
  "workspaceName": "string 2–60, [a-zA-Z0-9][a-zA-Z0-9 _-]*",
  "email": "email",
  "password": "8–1024 chars",
  "remember": "bool, default true"
}
```

Responses:

- `200 { ok:true, status:"ok", session }` + `spindle_at`/`spindle_rt` cookies
- `400 invalid_request` — schema failure
- `401/500 unknown` — account created but immediate sign-in failed
- `409 email_taken`
- `429 rate_limited`

### `POST /api/auth/signin`

Email + password sign-in. Rate limit: 10/min per IP.

Request (`signInSchema`): `{ "email", "password": "1–1024", "remember": "bool, default true" }`

Responses:

- `200 { ok:true, status:"ok", session }` + auth cookies
- `200 { ok:true, status:"totp_required", challenge }` — 2FA enabled; follow
  with `POST /api/auth/2fa/verify-login` (challenge is single-purpose, 5 min)
- `400 invalid_request`
- `401 invalid_credentials` — unknown email and wrong password are
  indistinguishable (no enumeration)
- `429 rate_limited`

### `GET /api/auth/session`

Current session. Resolution order: valid `spindle_at` → session JSON; else
`spindle_rt` → rotate and return new session; else `{ session: null }`.

- `200 { ok:true, session }` or `200 { ok:true, session:null }`

### `POST /api/auth/refresh`

Rotate the refresh token, issue a new access token. Refresh tokens are
single-use; a lost rotation race returns 401.

- `200 { ok:true, session }` + fresh cookies
- `401 invalid_token` — no cookie or expired/revoked session (cookies cleared)
- `403 forbidden` — cross-origin

### `POST /api/auth/logout`

Revokes the refresh-token session server-side and clears both cookies.
Idempotent — always `ok`. Cross-origin POSTs still clear cookies.

- `200 { ok:true }` + cleared cookies

### `GET /api/auth/audit?limit=N`

The caller's own auth audit events, newest first. `limit` clamped to 1–200,
default 50.

- `200 { ok:true, events: AuthAuditEvent[], limit }` where each event is
  `{ timestamp, type, userId, email, ip, userAgent, metadata }`.
  `type` ∈ `signin.success | signin.failure | signin.totp_challenge |
signup | logout | password.reset | passwordless.signin | oauth.signin |
email.verify | totp.enroll | totp.disable | totp.recovery.* |
account.recovery.*`
- `401 unauthorized` — no valid session

### Passwordless (magic link)

#### `POST /api/auth/passwordless/request`

Emails a single-use sign-in or verification link. Always `sent:true` for
valid input — cannot enumerate accounts. Rate limit: 5/10min per IP.

Request (`passwordlessRequestSchema`):
`{ "email", "purpose": "signin"|"verify-email" (default "signin"), "next": "app path, optional ≤2048" }`
`next` is sanitized to same-origin paths (`/...`, not `//...`).

- `200 { ok:true, sent:true }`
- `400 invalid_request`, `403 forbidden`, `429 rate_limited`

#### `POST /api/auth/passwordless/verify`

Consumes a `magic` token and sets session cookies (remember=true).
Rate limit: 10/min per IP.

Request (`tokenSchema`): `{ "token": "1–512" }`

- `200 { ok:true, session }` + auth cookies
- `401 invalid_token` with `reason: "expired"|"used"|"invalid"`
- `400 invalid_request`, `429 rate_limited`

### Password reset

#### `POST /api/auth/password/reset/request`

Emails a single-use reset link. Always `sent:true` (no enumeration).
Rate limit: 5/10min per IP.

Request: `{ "email" }`

- `200 { ok:true, sent:true }`; `400/403/429` as above.

#### `POST /api/auth/password/reset/confirm`

Consumes a `reset` token, sets the new password, revokes all sessions.
Rate limit: 10/10min per IP.

Request (`passwordResetConfirmSchema`): `{ "token": "1–512", "password": "8–1024" }`

- `200 { ok:true, reset:true }`
- `400 invalid_request` (incl. password <8)
- `401 invalid_token` — invalid/expired/used
- `429 rate_limited`

### Email verification

#### `POST /api/auth/verify-email`

Consumes a `verify` token, marks the account verified. Rate limit:
10/10min per IP.

Request (`tokenSchema`): `{ "token" }`

- `200 { ok:true, verified:true }`
- `401 invalid_token` with `reason: "expired"|"used"|"invalid"`

#### `POST /api/auth/verify-email/resend`

Emails a fresh verification link. Per-email cooldown (uniform for
registered/unregistered/verified — no enumeration oracle); on cooldown:
`429 rate_limited` with `retryAfter` (seconds) in the body **and** a
`Retry-After` header. Rate limit: 5/10min per IP.

Request: `{ "email" }`

- `200 { ok:true, sent:true, retryAfter:<seconds> }`
- `400/403/429` as above

### OAuth (PKCE, client-driven)

#### `GET /api/auth/oauth/{provider}`

Public provider configuration. Providers: `github`, `google`, `gitlab`
(built-ins, configurable via `OAUTH_PROVIDERS_JSON`), plus synthetic mock
providers when `NEXT_PUBLIC_MOCK_AUTH=1`.

- `200 { ok:true, provider, clientId, authorizeUrl, scopes[], redirectUri }`
  — `authorizeUrl` is same-origin `/api/auth/oauth/callback?mock_authorize=…`
  for mock providers.
- `404 unknown_provider`

#### `GET /api/auth/oauth/callback?mock_authorize=<p>&state=<s>`

Mock-mode bounce only (404 `unknown_provider` when mock auth is off).
302-redirects to `/oauth/callback?code=mock-<p>&state=<s>&provider=<p>`.

- `302` redirect; `400 invalid_request`; `404 unknown_provider`

#### `POST /api/auth/oauth/callback`

Exchanges the authorization `code` (+ client-held PKCE `codeVerifier`) for a
session. Rate limit: 10/min per IP. Always `remember: true`.

Request (`oauthCallbackSchema`):
`{ "provider": "^[a-z0-9-]{2,32}$", "code": "1–2048", "redirectUri": "url ≤2048", "codeVerifier": "43–128" }`

- `200 { ok:true, session }` + auth cookies
- `400 invalid_request`; `401 oauth_failed` (exchange failed or no email);
  `404 unknown_provider`; `429 rate_limited`

### Two-factor authentication (TOTP)

All 2FA management routes require a valid `spindle_at` session
(`401 unauthenticated` otherwise) and are same-origin-checked.

#### `POST /api/auth/2fa/enroll`

Starts TOTP enrollment. Returns the base32 secret + `otpauth://` URI; nothing
is active until `confirm`. Response: `{ ok:true, secret, otpauthUrl, digits:6,
periodSeconds:30 }`.

#### `POST /api/auth/2fa/confirm`

Activates TOTP after a valid code.

Request (`totpCodeSchema`): `{ "code": "6–16" }`

- `200 { ok:true, enabled:true, backupCodes: string[] }` — plaintext shown once
- `400 invalid_request`; `401 totp_invalid`

#### `GET /api/auth/2fa/backup-codes`

Backup-code status: `{ ok:true, enabled, managed, remaining }`
(`remaining: null` when 2FA is off).

#### `POST /api/auth/2fa/backup-codes`

Issues a fresh set of one-time backup codes (requires 2FA enabled; replaces
all previous codes).

- `200 { ok:true, backupCodes: string[], remaining: number }`
- `403 totp_not_enabled`; `401 unauthenticated`

#### `POST /api/auth/2fa/verify-login`

Second sign-in step when `signin` returned `totp_required`. Accepts a 6-digit
TOTP or a backup code. Rate limit: 10/min per IP.

Request (`totpVerifyLoginSchema`):
`{ "challenge": "1–2048", "code": "6–16", "remember": "bool, default true" }`

- `200 { ok:true, session }` + auth cookies
- `400 invalid_request`; `401 totp_invalid`; `429 rate_limited`

#### `POST /api/auth/2fa/disable`

Requires the account password as re-auth.

Request (`disableTotpSchema`): `{ "password": "1–1024" }`

- `200 { ok:true, disabled:true }`
- `400 invalid_request` (missing password) / `400 totp_invalid` (wrong
  password or 2FA not enabled)

#### `POST /api/auth/2fa/recovery/request`

Starts/resends a two-factor recovery for the signed-in user: emails a
single-use token link; 2FA stays enabled through a 72h cooldown. Requires
TOTP enabled. Rate limit: 5/10min per IP.

- `200 { ok:true, state:"awaiting_token", emailSent: bool, retryAfterSeconds?: number }`
- `200 { ok:true, state:"cooldown", executeAt }` — cooldown already running
- `403 totp_not_enabled`; `401/429` as usual

#### `POST /api/auth/2fa/recovery/confirm`

Consumes the emailed token; moves recovery into cooldown (2FA NOT disabled
yet). Optional `backupCode` adds proof-of-possession. Rate limit: 10/min.

Request (`recoveryConfirmSchema`): `{ "token": "1–512", "backupCode": "1–32, optional" }`

- `200 { ok:true, state:"cooldown", executeAt: ISO }`
- `400 invalid_request` / `400 invalid_backup_code`
- `401 invalid_token` with `reason: "expired"|"used"|"invalid"`
- `409 no_pending_recovery`

#### `GET /api/auth/2fa/recovery/status`

Recovery state for the caller. When a cooldown reaches `executeAt` this GET
finalizes it lazily (clears TOTP, emails the user) and returns
`state:"completed"`.

- `200 { ok:true, state:"none"|"awaiting_token"|"cooldown"|"completed" }`
  — `cooldown` adds `executeAt`, `secondsRemaining`; `completed` adds
  `enabled:false`.

#### `POST /api/auth/2fa/recovery/cancel`

Aborts a pending/cooling-down recovery — the safety hatch for an
unauthorized request. Rate limit: 10/min per IP.

- `200 { ok:true, state:"cancelled" }`
- `404 no_active_recovery`; `401/403/429` as usual

### Email change

Changing the account email is a two-step flow: `request` emails a signed
single-use link to the **new** address; `confirm` consumes it. The old
address is notified only after a successful confirm. Auth resolves via
`spindle_at` (expiry enforced) or `spindle_mock_session`
(`resolveEmailChangeIdentity`). All mutating routes are same-origin-checked.

#### `GET /api/auth/email-change`

Effective sign-in email plus any pending change.

- `200 { ok:true, emailChange: { email, pending: { newEmail, requestedAt,
expiresAt } | null, resendCooldownSeconds } }`
- `401 unauthenticated`

#### `POST /api/auth/email-change/request`

Starts (or restarts) a change. Rate limit: 5/10min per IP **plus** a
per-principal resend cooldown shared with `resend` — on cooldown the route
returns `429 rate_limited` with `retryAfter` in the body and a
`Retry-After` header.

Request: `{ "newEmail": "email ≤320 (trimmed, lowercased)" }`

- `200 { ok:true, pending: { newEmail, requestedAt, expiresAt },
retryAfter }`
- `400 invalid_request`; `401 unauthenticated`; `403 forbidden`
- `422 invalid_email` — target address rejected (e.g. already in use)
- `429 rate_limited`

#### `POST /api/auth/email-change/resend`

Emails a fresh confirmation link for the pending change; resending rotates
the pending record id so earlier links stop working. Same rate limits and
cooldown as `request`.

- `200` — same shape as `request`
- `404 no_pending` — nothing pending to resend
- `400/401/403/422/429` as above

#### `POST /api/auth/email-change/cancel`

Drops the pending change so its emailed link stops working. Idempotent.

- `200 { ok:true, cancelled: bool }` (`false` when nothing was pending)
- `401/403`

#### `GET|POST /api/auth/email-change/confirm`

Consumes the emailed token and applies the change. **No session required** —
the signed token is the credential; sessions stay valid (the access token
keeps its original claims until refresh).

- `GET ?token=…` — emailed-link entry point: verifies then 302-redirects to
  `/app/account?email-change=confirmed` or
  `/app/account?email-change=failed&reason=<invalid|expired|no_pending|
email_unavailable|rate_limited>`. Rate limit: 10/10min per IP.
- `POST` — JSON variant for API clients; same-origin checked.
  Request: `{ "token": "1–2048" }`.
  - `200 { ok:true, email: "<new address>" }`
  - `400 invalid_request`; `403 forbidden`; `429 rate_limited`
  - `410 confirm_failed` with `reason: "expired"|"invalid"|"no_pending"|
"email_unavailable"`

On success an `email.verify` audit event is recorded and the OLD address
gets a security-notification email (fire-and-forget).

### Account recovery

Guided account-recovery flow (`src/lib/auth/recovery-store.ts`): an emailed
single-use token is exchanged for a short-lived **recovery session token**,
which then authorises the verified-phase steps (set password, confirm
email, review activity, complete). Recovery session tokens travel in the
JSON body — never a cookie or URL param. All routes are same-origin-checked
and rate-limited per IP.

#### `POST /api/auth/recovery/request`

Starts (or resends) a recovery: emails a single-use token link
(`/account-recovery?token=…`, expires in 30 minutes). Anti-enumeration —
the response is identical whether or not the address is registered; known
addresses get a throttled, single-active recovery per user. Rate limit:
5/10min per IP.

Request (`recoveryRequestSchema`): `{ "email" }`

- `200 { ok:true, sent:true }` (always, for valid input)
- `400 invalid_request`; `403 forbidden`; `429 rate_limited`

#### `POST /api/auth/recovery/verify`

Consumes the emailed token (single-use — a successful exchange burns it)
and returns the recovery session token. Rate limit: 20/10min per IP.

Request (`recoveryTokenSchema`): `{ "token": "1–512" }`

- `200 { ok:true, sessionToken, sessionExpiresAt: ISO, email }`
- `400 invalid_request`; `401 invalid_token` with
  `reason: "expired"|"used"|"invalid"`; `429 rate_limited`

#### `POST /api/auth/recovery/status`

Recovery-session state: current `phase`, the account email,
`sessionExpiresAt`, completed `actions`, and the account's 10 most recent
auth audit events (`{ timestamp, type, metadata }`) for security review.
Rate limit: 60/10min per IP.

Request (`recoverySessionSchema`): `{ "sessionToken": "1–512" }`

- `200 { ok:true, phase, email, sessionExpiresAt: ISO|null, actions,
events: [{ timestamp, type, metadata }] }`
- `400 invalid_request`; `401 invalid_token` (expired/unknown session);
  `429 rate_limited`

#### `POST /api/auth/recovery/password`

Sets a new password during the verified phase. The password is never
logged or audited. Rate limit: 10/10min per IP.

Request (`recoveryPasswordSchema`):
`{ "sessionToken": "1–512", "password": "8–1024" }`

- `200 { ok:true, reset:true }`
- `400 invalid_request` (bad body or password <8); `401 invalid_token`;
  `429 rate_limited`

#### `POST /api/auth/recovery/email-verified`

Marks the account email verified during the verified phase — token
possession already proves inbox control. Rate limit: 10/10min per IP.

Request: `{ "sessionToken" }`

- `200 { ok:true, verified:true }`; `400/401/429` as above

#### `POST /api/auth/recovery/complete`

Finishes recovery: revokes **every** auth session for the account (a
stolen session cannot survive), burns both the emailed-token hash and the
recovery session token, records `account.recovery.completed`, and sends a
best-effort confirmation email. Rate limit: 10/10min per IP.

Request: `{ "sessionToken" }`

- `200 { ok:true, completed:true }`; `400/401/429` as above

### Device fingerprint

#### `POST /api/auth/fingerprint`

Registers the caller's device fingerprint for the current session. Body:
`{ "fingerprint": "<version>:<hex-digest>" }` — e.g. `fp1:<16–128 hex>`
(`parseDeviceFingerprint`); only the hash is stored, never raw device
signals. Requires a valid `spindle_at` whose user still exists; records are
keyed by (userId, sessionId) so one user can hold fingerprints for multiple
concurrent sessions/devices. No rate limit today.

- `200 { ok:true, match: "new"|"known"|"changed", fingerprint: { version,
hash, seenCount, lastSeenAt } }` — `match` is a soft signal only; clients
  must not treat `changed` as an error.
- `400 invalid_request`; `401 unauthorized`; `403 forbidden`

### Login alerts

Suspicious-login alerts for the caller (newest first), unread count, and
delivery preferences. Auth: valid `spindle_at` with an existing user.
Store is in-memory (`src/lib/auth/login-alerts.ts`).

#### `GET /api/auth/login-alerts`

- `200 { ok:true, alerts: LoginAlert[], unreadCount: int,
preferences: { inAppNotifications: bool, emailNotifications: bool } }`
  where `LoginAlert` = `{ id, userId, kind: "new_device"|"new_ip"|"velocity"|
"brute_force", severity: "info"|"warning"|"critical", title, detail,
ip: string|null, userAgent: string|null, createdAt: ISO, read: bool }`.
- `401 unauthenticated`

#### `POST /api/auth/login-alerts`

Alert mutations — body is a discriminated union on `action`:

- `{ "action": "mark_read", "ids": string[1..200, each ≤100 chars] }`
- `{ "action": "mark_all_read" }`
- `{ "action": "update_preferences", "preferences": { "inAppNotifications"?:
bool, "emailNotifications"?: bool } }` — at least one field required

Same-origin checked. Returns the same payload shape as GET (mutated state
echoed back so clients reconcile without a refetch).

- `200` — `{ ok:true, alerts, unreadCount, preferences }`
- `400 invalid_request` (bad JSON or unsupported action); `401/403`

---

## Account

### `GET /api/profile`

Signed-in user's display profile. Auth: `spindle_at` (expiry enforced) or
mock session.

- `200 { ok:true, profile: { name, email, memberSince: ISO|null } }`
- `401 unauthenticated`

### `PUT /api/profile`

Same-origin checked. Body `{ "name": string }` validated by
`parseDisplayName` (non-empty after trim).

- `200 { ok:true, profile }`
- `400 invalid_request` (non-JSON body); `422 invalid_name`;
  `401/403` as usual

### `GET /api/communication-preferences`

Outbound communication opt-ins. Auth as profile.

- `200 { ok:true, preferences: {
productUpdates: bool, securityAlerts: true (always on),
digestFrequency: "off"|"daily"|"weekly",
feedbackRequests: bool, referralProgram: bool } }`
- `401 unauthenticated`

### `PUT /api/communication-preferences`

Partial update; body `{ "preferences": { ...optional fields } }` validated by
`communicationPreferencesUpdateSchema` (strict object; `securityAlerts` may
only be `true`).

- `200 { ok:true, preferences }` (merged result)
- `400 invalid_request`; `422 invalid_preferences`; `401/403`

### `GET /api/cohorts`

Signup-week cohort retention report. Auth required (access cookie or mock
session). **Data is synthetic demo data** (`dataSource: "demo"`).

- `200 { ok:true, report: { generatedAt, dataSource:"demo", note, weeks,
cohorts: [{ weekStart, label, size, inactiveLatestWeek, avgActiveWeeks,
cells: [{ week, weekStart, activeUsers, retention|null, complete }] }],
totals: { users, excludedUsers, activeThisWeek } } }`
- `401 unauthenticated`

### `/api/onboarding` — GET / PUT / POST

Per-user onboarding wizard progress. Session resolution mirrors
`/api/profile`: `spindle_at` (expiry enforced) falling back to
`spindle_mock_session` when mock auth is enabled. Records live in a
process-local store keyed by session principal (`user:<uid>` /
`mock:<email>`) — the same stopgap as `src/lib/profile.ts`; state is lost
on restart. Mutations are same-origin-checked. No rate limit today.

Wizard steps: `["welcome", "profile", "preferences", "tour"]`;
`ONBOARDING_ROLES` = `["individual", "lab", "team", "institution"]`.

`OnboardingRecord` = `{ stepIndex: int, answers: { displayName?: string,
role?: OnboardingRole }, completedAt: ISO|null, skipped: bool,
updatedAt: ISO }`.

- `GET` → `200 { ok:true, onboarding: OnboardingRecord|null, steps }`
  (`null` when the user has no record yet); `401 unauthenticated`
- `PUT` — saves in-progress state. Body `{ "stepIndex": int 0–3,
"answers"?: { displayName?, role? } }`. When the `answers` key is present
  it **replaces** stored answers wholesale (cleared fields stay deleted);
  omitting `answers` keeps them. `stepIndex` outside 0–3 →
  `422 invalid_step`.
  - `200` — same payload as GET with the saved record
  - `400 invalid_request` (non-JSON body); `401/403`; `422 invalid_step`
- `POST` — finishes the flow. Body optional; `{ "skipped": true }` marks it
  skipped rather than finished (empty body = finished).
  - `200` — same payload as GET; `400/401/403`

---

## Analytics

### `POST /api/analytics`

Consent-gated analytics ingest. Gates in order: same-origin → per-IP rate
limit (300/min) → `spindle_consent` cookie (`{ version:"1.0", analytics:true }`)
→ payload validation.

Request: `{ "events": AnalyticsEventInput[1..20] }` where each event:
`{ type: "page_view"|"feature_use"|"api_call", name: string≤128,
path?|feature?|endpoint?: string|null≤512, props?: object≤4KB,
timestamp?: epoch ms (clamped), anonymousId?: string|null≤64 }`

- `200 { ok:true, accepted: <count> }`
- `400 invalid_request` / `400 invalid_events`
- `403 forbidden` (cross-origin) / `403 consent_required`
- `429 rate_limited`

### `GET /api/analytics/summary?days=N`

Aggregates for the dashboard. Auth required; per-principal rate limit
60/min. `days` integer 1–90, default 30.

- `200 { ok:true, summary: { days, generatedAt, totals:{events,pageViews,
featureUses,apiCalls}, daily:[{date,events,pageViews,featureUses,apiCalls}],
topEvents:[{name,type,count}], topPaths:[{path,count}] } }`
- `400 invalid_days`; `401 unauthenticated`; `429 rate_limited`

---

## Realtime — notifications & activity

Both channels use SSE (`text/event-stream`); the in-memory hub is
per-process. Principal resolution: `spindle_at` (signature checked, expiry
intentionally not enforced for streams) or `spindle_mock_session`.

### `GET /api/notifications/stream`

SSE feed of `NotificationStreamEvent` frames. Immediate `: connected`
comment, `: ping` every 25s. 401 closes the EventSource permanently.

Event shapes (`src/lib/notifications/events.ts`):
`{type:"notification", notification:{type:"info"|"success"|"warning"|"error",
title≤200, body≤2000, id?, href?, createdAt?, read?, demo?, projectId?,
category?, subject?, actions?}}` | `{type:"read"|"unread"|"dismiss", id}` |
`{type:"read_all"}`

### `POST /api/notifications`

Publish one `NotificationStreamEvent` to the caller's own channel (other
tabs/devices of the same principal). Same-origin + auth required.

- `200 { ok:true }`; `400 invalid_request`/`invalid_event`; `401/403`

### `GET /api/activity/stream`

SSE feed of `ActivityStreamEvent`: `{ type:"activity", activity: ActivityEvent }`
where `ActivityEvent` = `{ id≤200, kind:"project"|"file"|"lab"|"chat"|"agent"|
"system", summary≤500, createdAt, projectId?, projectName?, target?,
actor:{id≤200,name≤200,avatarUrl?} }`. Same transport as notifications.

### `POST /api/activity`

Publish one `ActivityStreamEvent` to the caller's own channel.

- `200 { ok:true }`; `400 invalid_request`/`invalid_event`; `401/403`

### `POST /api/notifications/digest`

Sends the caller's notification email digest. Recipient is always the
session's own email — the body cannot redirect it. Rate limit: 10/hour per
recipient. Same-origin + auth required.

Request (`digestSchema`):
`{ frequency:"daily"|"weekly", notifications:[{title 1–200, body?≤2000,
href?≤500, category?≤50, createdAt?}≤200], preferences?: unknown (sanitized:
`{email:bool, categories:{<cat>:{email:bool}}}`, master switch defaults off),
lastSentAt?: string }`

- `200 { ok:true, delivery:"sent"|"unconfigured"|"empty"|"disabled",
itemCount, overflowCount }` or `{ ok:true, delivery:"not-due" }` when
  `lastSentAt` is within the cadence window
- `400 invalid_request`; `401/403/429`; `502 delivery_failed`

---

## Email series

Drip-email series (welcome sequence). Uses the auth-family envelope and
per-IP rate limits; state lives in the in-memory store in
`src/lib/email-series.ts`. Step sends happen on the `tick` schedule, not
inline.

### `POST /api/email-series/enroll`

Public enrollment hook for flows that only know an email address (the
signup route calls `enrollEmailSeries` directly). Same-origin checked.
Rate limit: 10/hour per IP. Idempotent — repeat calls return the existing
enrollment.

Request: `{ "email": "email ≤320", "name"?: "string ≤80" }`

- `200 { ok:true, alreadyEnrolled: bool, status, nextSendAt: ISO|null,
sentSteps }`
- `400 invalid_request`; `403 forbidden`; `429 rate_limited`

### `GET /api/email-series/status?email=&series=`

Read-only enrollment status for support/debugging — step ids and
timestamps only, no message content. Rate limit: 30/hour per IP.
`series` defaults to the welcome series when omitted.

- `200 { ok:true, enrolled:false }` or
  `{ ok:true, enrolled:true, status, nextStepIndex, nextSendAt: ISO|null,
sentSteps, skippedSteps, failedSteps }`
- `400 invalid_request` (missing/malformed `email`); `429 rate_limited`

### `POST /api/email-series/tick`

Cron entry point that dispatches due drip-series emails
(`processEmailSeriesQueue()`). Rate limit: 30/hour per IP.

Auth: when `SESSION_SECRET` is set, requires
`Authorization: Bearer <SESSION_SECRET>` (timing-safe compare). When
`SESSION_SECRET` is unset the route is open **only outside production**;
in production it fails closed.

- `200 { ok:true, ...queueSummary }`
- `401 unauthorized` (bad/missing bearer); `429 rate_limited`;
  `500 tick_failed`; `503 unconfigured` (production without secret)

---

## Public forms (no auth)

All use the site-form envelope `{ ok, message, errors? }`, per-IP rate
limits, and the `website` honeypot.

### `POST /api/contact`

Rate limit: 5/hour. Emails the submission to the contact recipient
(`replyTo` = submitter) and sends a best-effort auto-reply.

Request (`contactSchema`):
`{ name:1–120, email, topic:"general"|"product"|"billing"|"security"|"other",
reference?:≤120, subject:1–200, message:10–5000, website?: honeypot }`

- `200 { ok:true, message, reference:"CT-XXXXXXXX" }`
- `400 { ok:false, message, errors:{field:msg} }` (schema) / `"Invalid request."` (bad JSON)
- `429`; `502` when email delivery throws

### `POST /api/newsletter`

Rate limit: 10/hour. Logs the subscription (consent is audit-only, not
persisted) and sends a confirmation email when configured.

Request (`newsletterSchema`):
`{ email, source?:≤100, consent: true (required literal), website?: honeypot }`

- `200 { ok:true, message:"You're subscribed. Watch your inbox." }`
- `400` schema/JSON; `429`; `502` on delivery failure

### `POST /api/feedback`

Rate limit: 10/hour. Stores in a process-local in-memory store.

Request (`feedbackSchema`):
`{ category:"bug"|"idea"|"general", message:10–5000, email?: valid≤320,
website?: honeypot }`

- `200 { ok:true, message }`; `400`; `429`

### `POST /api/nps`

Rate limit: 20/hour. Anonymous; stores in process memory.

Request (`npsSchema`):
`{ score: int 0–10, comment?:≤2000, source?:"widget"|"page"|"email", website?: honeypot }`

- `200 { ok:true, message:"Thanks for the feedback!" }`; `400`; `429`

### `GET /api/email/unsubscribe?token=&email=`

Status check only — never mutates (mail scanners may GET). Rate limit:
30/hour. `email` param is display-only and must match the token's address.

- `200 { ok:true, email, scope, subscribed: bool, expiresAt: ISO }`
- `400 { ok:false, message }` — invalid/expired/mismatched token
- `429`

### `POST /api/email/unsubscribe`

Two callers: RFC 8058 one-click (`List-Unsubscribe=One-Click` form or
urlencoded body) and the `/unsubscribe` page (`application/json`
`{ token, email? }`). Token may also arrive via `?token=` query param.
Idempotent.

- `200 { ok:true, email, scope, subscribed:false, message }`
- `400` invalid/mismatched token; `429`

---

## Infrastructure

### `POST /api/csp-report`

CSP violation collector. Accepts legacy `application/csp-report`
(`{"csp-report":{…}}`) and `application/reports+json` batches; logs
`csp.violation` events (cap 50/request, body cap 256KB). Always `204` —
browsers must not retry. `GET` → `405`.

### Health

There is **no `/api/health` route** under `src/app/api/`. Liveness is handled
outside the API surface (container/orchestrator probes).
