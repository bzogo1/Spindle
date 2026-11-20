# API rate-limit tiers

App-level rate limiting for `/api/*` routes, organized as a matrix of
**caller tiers** × **endpoint classes**. This complements — never replaces —
edge rate limiting (Cloudflare rules, see
[docs/security/edge-rate-limiting.md](../security/edge-rate-limiting.md)) and
the WAF rules in [docs/security/waf-rules.md](../security/waf-rules.md).

All limits are **per-instance, per-bucket-key** (in-memory fixed/sliding
windows). On multi-instance deploys the effective limit is
`limit × instances`; a shared store (Valkey/Postgres) is the upgrade path if a
hard global guarantee is needed.

## Tiers

| Tier            | Who                                               | Bucket key  |
| --------------- | ------------------------------------------------- | ----------- |
| `anonymous`     | No session, no API key                            | `ip:<addr>` |
| `authenticated` | Verified `spindle_at` session                     | `user:<id>` |
| `apiKey`        | API key credential (**reserved, not yet issued**) | `key:<id>`  |

Tier resolution precedence (`resolveTier` in
`src/lib/rate-limit/tiers.ts`): `apiKey` > `authenticated` > `anonymous`.
Anonymous callers are keyed by client IP using the same header precedence as
`rateLimitKey` (`cf-connecting-ip` → first `x-forwarded-for` hop → `unknown`).

## Endpoint classes

| Class       | Meaning                                       | Example routes                       |
| ----------- | --------------------------------------------- | ------------------------------------ |
| `auth`      | Credential / session / token endpoints        | `/api/auth/*`                        |
| `read`      | Cheap reads, polling, navigation              | `/api/profile`, `/api/notifications` |
| `write`     | Mutations, form submissions                   | `/api/contact`, `/api/profile` (PUT) |
| `expensive` | Aggregation, digest, summary, anything costly | `/api/analytics/summary`, digest     |

## Limits

Class defaults (`RATE_LIMIT_MATRIX`):

| Tier            | auth     | read      | write     | expensive |
| --------------- | -------- | --------- | --------- | --------- |
| `anonymous`     | 10 / min | 60 / min  | 20 / hour | 5 / min   |
| `authenticated` | 30 / min | 240 / min | 60 / min  | 60 / min  |
| `apiKey`        | 60 / min | 600 / min | 300 / min | 60 / min  |

Per-route overrides (`ENDPOINT_LIMIT_OVERRIDES`) — these are the values
**actually enforced today** and take precedence over the class defaults:

| Route                                   | Limit       | Keyed by  | Notes                                   |
| --------------------------------------- | ----------- | --------- | --------------------------------------- |
| `POST /api/auth/signin`                 | 10 / min    | IP        |                                         |
| `POST /api/auth/signup`                 | 5 / hour    | IP        |                                         |
| `POST /api/auth/passwordless/request`   | 5 / 10 min  | IP        |                                         |
| `POST /api/auth/passwordless/verify`    | 10 / min    | IP        |                                         |
| `POST /api/auth/password/reset/request` | 5 / 10 min  | IP        |                                         |
| `POST /api/auth/password/reset/confirm` | 10 / 10 min | IP        |                                         |
| `POST /api/auth/verify-email`           | 10 / 10 min | IP        |                                         |
| `POST /api/auth/verify-email/resend`    | 5 / 10 min  | IP        | plus a resend cooldown in the route     |
| `POST /api/auth/2fa/verify-login`       | 10 / min    | IP        |                                         |
| `POST /api/auth/2fa/recovery/request`   | 5 / 10 min  | IP        |                                         |
| `POST /api/auth/2fa/recovery/confirm`   | 10 / min    | IP        |                                         |
| `POST /api/auth/2fa/recovery/cancel`    | 10 / min    | IP        |                                         |
| `GET/POST /api/auth/oauth/callback`     | 10 / min    | IP        |                                         |
| `POST /api/contact`                     | 5 / hour    | IP        | honeypot + this limit                   |
| `POST /api/newsletter`                  | 10 / hour   | IP        |                                         |
| `POST /api/nps`                         | 20 / hour   | IP        |                                         |
| `POST /api/feedback`                    | 10 / hour   | IP        |                                         |
| `GET/POST /api/email/unsubscribe`       | 30 / hour   | IP        | one limiter shared by both verbs        |
| `POST /api/notifications/digest`        | 10 / hour   | recipient | **not** IP — keyed by recipient address |
| `POST /api/analytics`                   | 300 / min   | IP        | telemetry ingest (`ingest:` prefix)     |
| `GET /api/analytics/summary`            | 60 / min    | principal | authenticated; `summary:` prefix        |

### Gaps (routes with no limiter today)

Authenticated read/write routes (`/api/profile`, `/api/notifications`,
`/api/activity`, `/api/cohorts`, `/api/communication-preferences`,
`/api/onboarding`, `/api/auth/fingerprint`, `/api/auth/login-alerts`, SSE
streams) and `/api/csp-report` currently have **no app-level limit**; they
rely on edge rules only. The class defaults above are the recommended
starting point when wiring them up.

Newer routes enforce route-level `createRateLimiter` limits that are **not
yet** in `ENDPOINT_LIMIT_OVERRIDES` (kept in the route files for now):

| Route                                                                                                  | Limit       | Keyed by                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/email-change/request`, `/api/auth/email-change/resend`                                 | 5 / 10 min  | IP, plus a per-principal resend cooldown (shared)                                                       |
| `GET/POST /api/auth/email-change/confirm`                                                              | 10 / 10 min | IP                                                                                                      |
| `POST /api/auth/recovery/request`                                                                      | 5 / 10 min  | IP                                                                                                      |
| `POST /api/auth/recovery/verify`                                                                       | 20 / 10 min | IP                                                                                                      |
| `POST /api/auth/recovery/status`                                                                       | 60 / 10 min | IP                                                                                                      |
| `POST /api/auth/recovery/password`, `/api/auth/recovery/email-verified`, `/api/auth/recovery/complete` | 10 / 10 min | IP                                                                                                      |
| `POST /api/email-series/enroll`                                                                        | 10 / hour   | IP                                                                                                      |
| `GET /api/email-series/status`, `POST /api/email-series/tick`                                          | 30 / hour   | IP (`tick` also requires `Authorization: Bearer <SESSION_SECRET>` when set)                             |
| `GET /api/invitations`, `GET /api/invitations/analytics`, `GET /api/invitations/accept`                | 60 / min    | IP                                                                                                      |
| `POST /api/invitations`, `POST /api/invitations/{id}/resend`, `POST /api/invitations/{id}/remind`      | 5 / 10 min  | IP (create/resend also enforce a per-email cooldown; remind enforces a per-invite 8h reminder interval) |
| `POST /api/invitations/accept`                                                                         | 10 / min    | IP                                                                                                      |
| `POST /api/invitations/tick`                                                                           | 30 / hour   | IP (also requires `Authorization: Bearer <SESSION_SECRET>` when set)                                    |

`DELETE /api/invitations/{id}` (revoke) currently has **no app-level
limit** — it relies on edge rules only; see Gaps above.

## Response headers

Every rate-limited response should carry the IETF `RateLimit` headers
(`rateLimitHeaders()` in `src/lib/rate-limit/tiers.ts`):

- `RateLimit-Limit` — the configured limit for the window
- `RateLimit-Remaining` — requests left after this one (never negative)
- `RateLimit-Reset` — seconds until the window resets
- `Retry-After` — delay-seconds, **only on 429 responses**

Example 429 body used by auth routes today: `{ ok: false, code:
"rate_limited", message: "Too many attempts. Try again later." }`.

## Enforcement points

1. **Edge (first line):** Cloudflare rate-limiting rules / WAF drop volumetric
   abuse before it reaches the origin. Too coarse for per-route or
   authenticated-vs-anonymous distinctions.
2. **Route handlers (current):** each limited route constructs a
   `createRateLimiter({ limit, windowMs })` from `@/lib/site-forms` (fixed
   window) at module scope and calls `limiter.check(clientIp(request))` (or
   `rateLimitKey(request)` for the sliding-window variant) before doing work.
   On denial: `fail(429, "rate_limited", ...)`.
3. **Shared helper (target):** `src/lib/rate-limit/tiers.ts` resolves
   `tier → class → route override → limit`, the bucket key, and the response
   headers so routes stop hard-coding numbers. The sliding-window limiter in
   `src/lib/rate-limit/sliding-window.ts` is the preferred engine for new
   wiring (no fixed-window boundary burst).
4. **Future:** a single middleware/`proxy.ts` hook can enforce the class
   defaults uniformly; per-route overrides stay in route handlers where the
   limiter instance and keying (IP vs principal vs recipient) are known.

## Demo / verification

```bash
npx vitest run src/lib/rate-limit/tiers.test.ts   # unit tests
npx tsx scripts/rate-limit/tiers.mjs --demo       # print matrix + sample resolutions
```
