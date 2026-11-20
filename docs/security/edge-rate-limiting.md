# Edge rate limiting

Spindle sits behind a Cloudflare Tunnel (`infra/origin/cloudflared/config.yml`):
`cloudflared` forwards `app.spindle.app` → `app:8080` and `lab.spindle.app` →
`lab-proxy:7000` over the internal compose network. Nothing publishes a public
port, so **the edge is the only place volumetric abuse can be stopped cheaply**
— every request that passes it costs an origin round-trip.

Rate limiting therefore runs in three layers, coarsest first:

| Layer           | Where                                              | Scope                                 | Mechanism                                    |
| --------------- | -------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| 1. Edge         | Cloudflare dashboard/Terraform (`infra/edge/`)     | Per-IP, per-hostname, per-path-prefix | Rate Limiting rules (`http_ratelimit` phase) |
| 2. Origin proxy | nginx `limit_req` — _reference only, not deployed_ | Per-IP leaky bucket                   | `infra/edge/nginx-rate-limit.conf.example`   |
| 3. App          | `src/lib/rate-limit/`                              | Per-route, per-key, exact windows     | Sliding-window limiter, per route handler    |

The layers are complementary: the edge drops floods before they reach the
origin; the app limiter expresses limits the edge cannot (per-user, per-API-key,
healthcheck-aware logic).

## Current state

- **App limiter exists**: `src/lib/rate-limit/` contains
  `sliding-window.ts` (`createSlidingWindowLimiter`, `rateLimitKey`,
  `RATE_LIMIT_TIERS`) plus `tiers.ts`, a pure tier × endpoint-class limit
  matrix (`RATE_LIMIT_MATRIX`, `ENDPOINT_LIMIT_OVERRIDES`, `resolveTier`,
  `resolveLimit`, `rateLimitBucketKey`, `rateLimitHeaders`) that maps the
  limits already hard-coded across `src/app/api` routes onto anonymous /
  authenticated / apiKey tiers.
  `sliding-window.ts` is a true sliding window (timestamp log per key), unlike
  the older fixed-window `createRateLimiter` in `src/lib/site-forms.ts`, which
  remains in use by auth routes. State is **per-process** — on multi-instance
  deploys the effective limit is `limit × instances`.
- **Edge rules are examples, not applied**: `infra/edge/cloudflare-rate-limiting.rules.json`
  (dashboard/Rulesets-API-shaped) and `infra/edge/cloudflare-rate-limiting.tf.example`
  document the intended rules. Whoever owns the Cloudflare zone applies them.
- **No nginx in the request path today**: cloudflared talks straight to the app
  container. The nginx file is a fallback reference for a future proxy.
- **`src/proxy.ts` does no rate limiting** — it is only a coarse session gate
  for `/dashboard`, `/app`, `/projects`. Rate limiting belongs in route
  handlers and edge rules, not the proxy matcher.

## Tiers

### Tier 1 — per-IP volumetric (edge)

A single broad rule per hostname caps total request rate per client IP:

- `app.spindle.app`: ~300 req / 10 s per IP (per colo). Generous for browsers,
  fatal for scrapers.
- `lab.spindle.app`: ~120 req / 60 s per IP on the WebSocket-upgrade path.
  Session reconnect storms after a deploy are legitimate — **do not tighten
  this**; the lab proxy owns session lifecycle.

Keying: Cloudflare's `ip.src` is already the true client IP (the tunnel does
not change it). `cf.colo.id` in `characteristics` makes the bucket per-PoP;
omit it for a stricter global per-IP cap.

### Tier 2 — per-route auth surfaces (edge + app)

Credential-guessing endpoints get a tighter cap at both layers:

- Edge: `starts_with(http.request.uri.path, "/api/auth/")` → 30 req / 60 s per IP.
- App: routes already using `createRateLimiter` from `@/lib/site-forms`
  (verify-email resend, magic-link, OAuth callback, 2FA verify-login) keep
  their fixed-window limits; new auth-adjacent routes should use
  `RATE_LIMIT_TIERS.auth` (10 req / 60 s) with the sliding-window limiter.

### Tier 3 — public forms (edge + app)

Contact/newsletter submissions: 5 req / 600 s per IP at the edge with
`managed_challenge` (not `block`) — humans behind CGNAT trip this occasionally
and a challenge is cheaper than a support ticket. The app honeypot
(`HONEYPOT_FIELD`) remains the second line.

### Tier 4 — per-API-key (placeholder)

No API keys are issued yet. The edge rule keys on the raw `x-api-key` header
(600 req / 60 s) purely to stop header spraying. **When keys ship**, the real
limit must live in the app keyed on the _verified_ key id — an edge rule on an
unvalidated header is trivially evaded by rotating values. Suggested app-side
keying: `api:${keyId}` via a limiter instance per tier, checked after
authentication.

### Tier 5 — healthchecks (bypass everywhere)

Health/readiness probes must never be throttled:

- Edge: a `skip` rule on `/api/health`, `/api/ready`, `/healthz`, `/readyz`
  (or simply exclude those paths from rule expressions).
- nginx: no `limit_req` inside the health `location` blocks.
- App: use `RATE_LIMIT_TIERS.health` (600 req / 60 s) or bypass entirely.
- Note on what actually gets probed today: the compose healthcheck hits
  `http://127.0.0.1:8080/` on loopback (never traverses the tunnel), and the
  observability stack exposes `/healthz` on `127.0.0.1:9100`. Neither can be
  affected by edge rules. The exemption paths above are forward-looking — if a
  public `/api/health` route is added later, it inherits the bypass.

## App-level usage

```ts
import { createSlidingWindowLimiter, rateLimitKey, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

const limiter = createSlidingWindowLimiter(RATE_LIMIT_TIERS.apiPublic)

export async function POST(request: Request) {
  const decision = limiter.check(rateLimitKey(request))
  if (!decision.allowed) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)) } },
    )
  }
  // ...
}
```

`rateLimitKey` prefers `cf-connecting-ip` (set by Cloudflare on every proxied
request), falls back to the first `x-forwarded-for` hop, then a shared
`"unknown"` bucket. Per-user limiting should key on the authenticated user id
instead — call `limiter.check(`user:${userId}`)` after auth.

## Testing approach

1. **Unit**: `src/lib/rate-limit/sliding-window.test.ts` — window sliding,
   boundary behavior (no fixed-window burst), key isolation, `maxKeys`
   eviction, header precedence. Run: `pnpm vitest run src/lib/rate-limit`.
2. **Demo**: `pnpm tsx scripts/rate-limit/demo.ts` prints limiter decisions
   for the auth tier.
3. **Edge rules**: apply to a staging zone first (`staging.spindle.app`),
   then `curl`-loop a protected path and confirm 429s; check
   `cf-ray`/`server: cloudflare` headers and the Cloudflare Security Events
   log for `rate_limit` events.
4. **App routes**: hit an authenticated route in a loop with a fixed
   `cf-connecting-ip`/`x-forwarded-for` and verify `429` + `Retry-After`.
5. **Healthcheck regression**: confirm `/api/health` (or whatever the probe
   path is) returns 200 throughout a rate-limit test.

## Tuning

- Start with the values in `infra/edge/cloudflare-rate-limiting.rules.json`;
  they are deliberately generous. Tighten after a week of Security Events
  data shows the p99 legitimate rate per path.
- `mitigation_timeout` is the block duration; `0` blocks for the remainder of
  the counting `period`. Short timeouts + counting approximate a sliding
  window at the edge.
- If per-instance app limits prove too loose (effective limit = limit ×
  replica count), the upgrade path is a shared store — Valkey is already in
  the compose stack.
