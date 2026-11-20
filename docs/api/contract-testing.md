# API contract testing

Playwright contract specs covering **39 of the 56 route handlers** under
`src/app/api/` (the remaining 17 are listed under "Coverage gaps" below).
They assert the **wire contract** — HTTP method, status codes, and JSON envelope
shape — against a real running server, using zod schemas that deliberately
mirror (but do not import) the server-side validators. A server-side contract
change fails these specs loudly instead of being re-validated by the same
code that produced it.

- Framework: `contract.ts` (zod schemas + shared constants) and `helpers.ts`
  (cookie forging, SSE reader, JSON helper).
- Specs: `e2e/api/*.spec.ts` — picked up automatically by `testDir: "./e2e"`
  in `playwright.config.ts` (only `visual/**` and `storybook-visual/**` are
  ignored).
- Runner: Playwright `APIRequestContext` — **not** vitest. No browser is
  launched for these specs despite the `chromium` project label.

## Running

```bash
# Everything under e2e/api (boots `npm run dev` on :3000 via webServer)
npx playwright test e2e/api

# One file / one test
npx playwright test e2e/api/public-forms.spec.ts
npx playwright test e2e/api -g "signup"

# Against an already-running server (skips webServer)
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test e2e/api
```

## Coverage matrix

| Route                              | Methods covered                                                                                               | Spec file                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `/api/contact`                     | POST valid/invalid/honeypot, GET→405                                                                          | `public-forms.spec.ts`      |
| `/api/newsletter`                  | POST valid/missing-consent/malformed JSON                                                                     | `public-forms.spec.ts`      |
| `/api/feedback`                    | POST valid/unknown-category                                                                                   | `public-forms.spec.ts`      |
| `/api/nps`                         | POST valid/out-of-range score                                                                                 | `public-forms.spec.ts`      |
| `/api/email/unsubscribe`           | GET status (missing/forged/valid/mismatched email), POST JSON + RFC 8058 one-click + invalid/malformed        | `email-unsubscribe.spec.ts` |
| `/api/auth/signin`                 | POST malformed body, unknown credentials → 401                                                                | `auth.spec.ts`              |
| `/api/auth/signup`                 | POST malformed body; full lifecycle (signup→session→audit→refresh→logout)                                     | `auth.spec.ts`              |
| `/api/auth/session`                | GET anonymous → `session:null`; GET signed-in via lifecycle                                                   | `auth.spec.ts`              |
| `/api/auth/refresh`                | POST no cookie → 401; rotation in lifecycle                                                                   | `auth.spec.ts`              |
| `/api/auth/logout`                 | POST anonymous idempotent; cookie clearing in lifecycle                                                       | `auth.spec.ts`              |
| `/api/auth/audit`                  | GET `?limit=` shape in lifecycle                                                                              | `auth.spec.ts`              |
| `/api/auth/verify-email`           | POST bogus token → 401 `invalid_token`                                                                        | `auth.spec.ts`              |
| `/api/auth/verify-email/resend`    | POST ok + `retryAfter`, per-email cooldown → 429                                                              | `auth.spec.ts`              |
| `/api/auth/passwordless/request`   | POST → `{ ok, sent: true }` (anti-enumeration)                                                                | `auth.spec.ts`              |
| `/api/auth/passwordless/verify`    | POST bogus token → 401 + `reason`                                                                             | `auth.spec.ts`              |
| `/api/auth/password/reset/request` | POST valid email → `sent:true`; malformed → 400                                                               | `auth.spec.ts`              |
| `/api/auth/password/reset/confirm` | POST bogus token → 401                                                                                        | `auth.spec.ts`              |
| `/api/auth/oauth/[provider]`       | GET config (mock or 404 branch), unknown provider → 404                                                       | `oauth.spec.ts`             |
| `/api/auth/oauth/callback`         | GET mock bounce → 302; POST malformed/unknown/mock session                                                    | `oauth.spec.ts`             |
| `/api/auth/2fa/enroll`             | POST 401 unauthenticated; enroll in lifecycle                                                                 | `auth-2fa.spec.ts`          |
| `/api/auth/2fa/confirm`            | POST 401 unauthenticated; wrong code → 401; real TOTP → 200                                                   | `auth-2fa.spec.ts`          |
| `/api/auth/2fa/verify-login`       | `totp_required` challenge → session in lifecycle                                                              | `auth-2fa.spec.ts`          |
| `/api/auth/2fa/backup-codes`       | GET/POST 401 unauthenticated; status + issue in lifecycle                                                     | `auth-2fa.spec.ts`          |
| `/api/auth/2fa/disable`            | POST 401 unauthenticated; wrong password → 400; success in lifecycle                                          | `auth-2fa.spec.ts`          |
| `/api/auth/2fa/recovery/request`   | POST 401 unauthenticated; cross-origin → 403; lifecycle (awaiting_token, resend throttle, `totp_not_enabled`) | `auth-2fa-recovery.spec.ts` |
| `/api/auth/2fa/recovery/confirm`   | POST 401 unauthenticated; malformed body → 400; bogus token → 401 `invalid_token`                             | `auth-2fa-recovery.spec.ts` |
| `/api/auth/2fa/recovery/status`    | GET 401 unauthenticated; `none`/`awaiting_token` states in lifecycle                                          | `auth-2fa-recovery.spec.ts` |
| `/api/auth/2fa/recovery/cancel`    | POST 401 unauthenticated; cancel → 200, repeat → 404 `no_active_recovery`                                     | `auth-2fa-recovery.spec.ts` |
| `/api/csp-report`                  | POST legacy/report-to/malformed → 204 empty; GET → 405                                                        | `csp-report.spec.ts`        |
| `/api/profile`                     | GET/PUT mock session, 422 `invalid_name`, 401 unauth                                                          | `account.spec.ts`           |
| `/api/communication-preferences`   | GET/PUT mock session, 422 `invalid_preferences`, 401 unauth                                                   | `account.spec.ts`           |
| `/api/cohorts`                     | GET demo report, 401 unauth                                                                                   | `account.spec.ts`           |
| `/api/analytics`                   | POST consent-gated ingest (`accepted` count), 403 `consent_required`                                          | `account.spec.ts`           |
| `/api/analytics/summary`           | GET `?days=` shape, 400 `invalid_days`, 401 unauth                                                            | `account.spec.ts`           |
| `/api/notifications`               | POST publish + `invalid_event` 400, 401 unauth                                                                | `account.spec.ts`           |
| `/api/notifications/stream`        | GET SSE `: connected` frame, 401 unauth                                                                       | `account.spec.ts`           |
| `/api/notifications/digest`        | POST delivery contract (`disabled`), 400 malformed, 401 unauth                                                | `account.spec.ts`           |
| `/api/activity`                    | POST publish + `invalid_event` 400, 401 unauth                                                                | `account.spec.ts`           |
| `/api/activity/stream`             | GET SSE `: connected` frame, 401 unauth                                                                       | `account.spec.ts`           |

### Coverage gaps (no contract spec yet)

The following 17 routes have **no** Playwright contract coverage. Most do
have colocated `route.test.ts` unit tests (except
`/api/auth/recovery/email-verified`, `/api/auth/recovery/password`, and
`/api/auth/recovery/status`), but nothing asserts their wire contract
e2e:

- `/api/auth/email-change` (GET), `/api/auth/email-change/request`,
  `/api/auth/email-change/resend`, `/api/auth/email-change/cancel`,
  `/api/auth/email-change/confirm` (GET + POST)
- `/api/auth/recovery/request`, `/api/auth/recovery/verify`,
  `/api/auth/recovery/status`, `/api/auth/recovery/password`,
  `/api/auth/recovery/email-verified`, `/api/auth/recovery/complete`
- `/api/auth/fingerprint`, `/api/auth/login-alerts` (GET + POST)
- `/api/email-series/enroll`, `/api/email-series/status`,
  `/api/email-series/tick`
- `/api/onboarding` (GET + PUT + POST)

Token-consuming happy paths that
require a real emailed token (verify-email success, passwordless verify
success, reset confirm success, and the 2FA recovery confirm success path —
its token is issued inside `recovery/request` but only delivered by email)
are covered only at the rejection boundary — the in-memory backend does not
expose token minting to specs. The recovery lifecycle is otherwise exercised
end to end: signup → TOTP enroll/confirm → request → resend throttle →
status → confirm rejection → cancel.

## Envelope conventions

Two envelopes exist (documented at the top of `contract.ts`):

- **Auth family** (`/api/auth/*`, `/api/profile`, `/api/cohorts`,
  `/api/communication-preferences`, `/api/notifications*`, `/api/activity*`,
  `/api/analytics*`, `/api/onboarding`, `/api/email-series*`) goes through
  `ok()`/`fail()`:
  `{ ok: true, ...payload }` / `{ ok: false, code, message, ...extra }`.
- **Public site forms** (`/api/contact`, `/api/newsletter`, `/api/feedback`,
  `/api/nps`) and `/api/email/unsubscribe` use a local envelope **without**
  `code`: `{ ok: true, message, ... }` / `{ ok: false, message, errors? }`.

## Mock vs real auth mode

The default `playwright.config.ts` webServer starts `npm run dev` with
`NEXT_PUBLIC_MOCK_AUTH=1` and the API adapter defaults to the **in-memory**
auth backend — no external services needed:

- **Real session flow** (`auth.spec.ts`, `auth-2fa.spec.ts`): specs sign up a
  unique user through `POST /api/auth/signup` and let the route-issued
  `spindle_at`/`spindle_rt` cookies drive session, audit, refresh, logout,
  and the full TOTP 2FA lifecycle. The 2FA spec computes real RFC 6238 codes
  in-test (HMAC-SHA1, 30s step, 6 digits, ±1 window — mirrors
  `src/lib/auth/totp.ts`).
- **Mock session** (`account.spec.ts`): routes that only need _a_ principal
  (profile, preferences, cohorts, analytics, notifications, activity,
  digest) are exercised by forging the unsigned `spindle_mock_session`
  cookie — `mockSessionCookieHeader()` in `helpers.ts`. Mock-auth decode is
  intentionally unsigned; no signature is checked server-side.
- **OAuth** (`oauth.spec.ts`): mock mode injects synthetic providers for the
  built-in ids, so `GET /api/auth/oauth/github` returns a same-origin
  authorize bounce and `POST /api/auth/oauth/callback` resolves a fixture
  identity. Specs branch on the response: 200 → full contract, 404/401 →
  the non-mock `unknown_provider`/`oauth_failed` contract.

### Running against a non-mock deployment

`PLAYWRIGHT_BASE_URL` pointing at a server **without** `NEXT_PUBLIC_MOCK_AUTH`
changes expected results:

- `account.spec.ts` authenticated cases will 401 (mock cookie ignored) — the
  unauthenticated 401 assertions remain valid.
- `oauth.spec.ts` and the unsubscribe "valid token" cases still pass in
  their fallback branches, provided `SESSION_SECRET` matches (see below).
- `auth.spec.ts`/`auth-2fa.spec.ts` still work if the target runs the
  in-memory backend; against a real database backend they also work (signup
  creates a real user) but accumulate test users.

### `/api/email/unsubscribe` token caveat

Unsubscribe tokens are HMAC-signed with `SESSION_SECRET` (or a documented dev
fallback). The spec mints tokens via `getServerEnv()` — a `SESSION_SECRET`
exported in the shell is honored, but a secret that exists **only** in
`.env.local` (loaded by `next dev`, invisible to the test runner) will make
the "valid token" cases return 400. Keep the secret in the shell env or run
against the dev default.

## Rate limits to respect

All limits are per-client-IP, in-memory, per instance (`createRateLimiter`
in `src/lib/site-forms.ts`; `clientIp` trusts `x-forwarded-for`). Specs stay
under them by using unique emails, few attempts, and — in
`auth-2fa-recovery.spec.ts` — a unique forwarded IP per test so a long-lived
dev server cannot accumulate hits across runs; CI retries (`retries: 1`) are
accounted for:

| Route                                                                               | Limit                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/api/contact`                                                                      | 5/hour — spec issues exactly 3 POSTs                                  |
| `/api/newsletter`, `/api/feedback`                                                  | 10/hour                                                               |
| `/api/nps`                                                                          | 20/hour                                                               |
| `/api/email/unsubscribe`                                                            | 30/hour                                                               |
| `/api/auth/signin`, `/api/auth/2fa/verify-login`, `/api/auth/oauth/callback`        | 10/minute                                                             |
| `/api/auth/2fa/recovery/request`                                                    | 5 per 10 minutes — spec issues 4 POSTs                                |
| `/api/auth/2fa/recovery/confirm`, `/api/auth/2fa/recovery/cancel`                   | 10/minute                                                             |
| `/api/auth/signup`                                                                  | 5/hour                                                                |
| `/api/auth/verify-email*`, `/api/auth/passwordless/*`, `/api/auth/password/reset/*` | 5–10 per 10 minutes                                                   |
| `/api/analytics`                                                                    | 300/minute                                                            |
| `/api/analytics/summary`                                                            | 60/minute per principal                                               |
| `/api/notifications/digest`                                                         | 10/hour per recipient                                                 |
| `/api/auth/email-change/request`, `/api/auth/email-change/resend`                   | 5 per 10 minutes + shared per-principal cooldown                      |
| `/api/auth/email-change/confirm`                                                    | 10 per 10 minutes                                                     |
| `/api/auth/recovery/*`                                                              | 5–60 per 10 minutes (see `reference.md`)                              |
| `/api/email-series/enroll`                                                          | 10/hour; `/api/email-series/status`, `/api/email-series/tick` 30/hour |

Hitting a limit surfaces as 429 (`rate_limited` on auth routes, plain
`{ ok:false, message }` on site forms) — if a spec flakes with 429, check
for parallel runs against the same dev server.
