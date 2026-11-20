# API docs

Documentation for the route handlers under `src/app/api/` (56 route files).

| Document                                     | Contents                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [reference.md](./reference.md)               | Full API reference: every endpoint, methods, auth requirements, request/response shapes, error codes, and rate limits — derived from the actual route handlers and zod schemas. |
| [openapi.yaml](./openapi.yaml)               | OpenAPI 3.1 spec covering all 56 route handlers. Validate/serve with any OpenAPI toolchain (e.g. `npx @redocly/cli lint docs/api/openapi.yaml`, Swagger UI, Stoplight).         |
| [contract-testing.md](./contract-testing.md) | Playwright contract specs that assert the wire contract (methods, status codes, JSON envelopes) against a running server.                                                       |

## Route groups at a glance

- **Auth** (`/api/auth/*`) — signup, signin, session, refresh, logout, audit,
  passwordless magic links, password reset, email verification, OAuth PKCE,
  TOTP two-factor (enroll/confirm/disable/backup-codes/verify-login/
  recovery request-confirm-status-cancel), email change
  (request/resend/cancel/confirm), guided account recovery
  (`/api/auth/recovery/*`), device fingerprints, and login alerts.
- **Account** (`/api/profile`, `/api/communication-preferences`,
  `/api/cohorts`, `/api/onboarding`) — session-required profile, outbound
  communication opt-ins, a demo-data cohort retention report, and the
  onboarding wizard progress store.
- **Analytics** (`/api/analytics`, `/api/analytics/summary`) — consent-gated
  event ingest and per-principal aggregates.
- **Realtime** (`/api/notifications*`, `/api/activity*`) — SSE streams plus
  same-origin publish endpoints and the notification email digest.
- **Email series** (`/api/email-series/*`) — drip-email enrollment, status,
  and the cron tick that dispatches due sends.
- **Public forms** (`/api/contact`, `/api/newsletter`, `/api/feedback`,
  `/api/nps`, `/api/email/unsubscribe`) — unauthenticated marketing-site
  endpoints with per-IP rate limits and a `website` honeypot.
- **Infrastructure** (`/api/csp-report`) — CSP violation collector (always 204).

There is no `/api/health` route; liveness is handled outside the API surface.

## Conventions (summary)

- **Auth family** routes answer `{ ok: true, ... }` /
  `{ ok: false, code, message, ... }`; **public forms** answer
  `{ ok: true, message }` / `{ ok: false, message, errors? }` (no `code`).
- Session auth via httpOnly cookies `spindle_at` (access) and `spindle_rt`
  (refresh, `Path=/api/auth`, single-use rotation). Cookie-authenticated
  mutations are same-origin checked (`403 forbidden` on mismatch).
- All rate limits are per-client-IP, in-memory, per instance — see the
  rate-limit table in `contract-testing.md` and per-endpoint notes in
  `reference.md`.
