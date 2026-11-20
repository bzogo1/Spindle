# API gateway evaluation

## Topology today

Per ADR 0001 (`docs/decisions/0001-container-host-topology.md`) and the hosting
runbook (`docs/runbooks/hosting.md`), the only ingress path is:

```
client → Cloudflare edge (TLS, WAF, cache rules, rate limiting — Pro plan)
       → outbound cloudflared connector (QUIC tunnel, no public ports)
       → http://app:8080 (Next.js standalone server, PORT=8080)
```

A second hostname, `lab.spindle.app`, terminates at `lab-proxy:7000` for
WebSocket notebook/terminal/dev-server sessions. The ingress rules live in
`infra/origin/cloudflared/config.yml` (production) and
`infra/staging/cloudflared/config.yml` (staging); they are cloudflared
`ingress:` blocks, not a separate gateway process. TLS is terminated at the
Cloudflare edge; `cloudflared` speaks plaintext HTTP to the origin inside the
tunnel.

In-app middleware (`src/proxy.ts`, Next.js `proxy`) is a coarse page guard for
`/dashboard`, `/app`, `/projects` only — it checks for a plausible session
(a `spindle_rt` refresh cookie or a signed `spindle_at` access token) and
redirects to `/sign-in`. It does no
rate limiting, routing, or authZ, and it never runs for `/api/*` or public
pages.

## Does a dedicated gateway add value?

A "gateway" layer would sit between cloudflared and `app:8080`, or replace
cloudflared's plain `service: http://app:8080` with routing/rewriting rules.
What each function would buy, honestly:

| Function                   | Where it already lives                                                                                                              | Marginal value of adding nginx/Caddy/Envoy                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TLS termination            | Cloudflare edge (always-on HTTPS, Pro plan)                                                                                         | None — the tunnel leg is already plaintext inside an encrypted tunnel. Terminating TLS twice adds cert plumbing for zero benefit.                                                                                                |
| Hostname routing           | `cloudflared` ingress rules                                                                                                         | None for the current two hostnames. Caddy/nginx would only matter if path-based routing or a third service were added.                                                                                                           |
| Rate limiting              | Cloudflare WAF rate-limiting rules (dashboard)                                                                                      | Cloudflare rules are edge-wide and free with the plan. Origin-side rate limiting would be a _second_ layer for API endpoints Cloudflare cannot fingerprint (per-user buckets keyed on `spindle_at`) — see the Caddyfile example. |
| WebSocket/SSE pass-through | cloudflared `originRequest` already sets `tcpKeepAlive`, no buffering                                                               | Caddy/nginx add buffering-tuning footguns for SSE (`X-Accel-Buffering`) that the current path avoids. Lab WebSockets must NOT transit a gateway that buffers.                                                                    |
| Auth headers / IP trust    | App reads cookies; there is no client-IP ACL in app code                                                                            | If the app ever needs `CF-Connecting-IP` or mTLS client certs, cloudflared already passes Cloudflare headers through; a gateway would only re-forward them.                                                                      |
| Response headers / CSP     | `next.config.ts` → `securityHeaders()` (`src/lib/security-headers.ts`) — CSP, HSTS, X-Frame-Options, Referrer-Policy on every route | None. A gateway must _not_ duplicate or override these; do not set CSP in Caddy/nginx or you will fight Next.js.                                                                                                                 |

**Conclusion: a dedicated gateway process is not justified for the current
two-hostname single-origin topology.** Every capability it would provide is
either already at the Cloudflare edge (TLS, rate limiting, WAF) or already in
the app (headers, page guard). Adding nginx/Caddy/Envoy introduces a container
to patch, a config surface to keep in sync, and a new failure domain between
the tunnel and the app — for no functional gain.

The exception worth keeping in the pocket: **per-user API rate limiting**
keyed on the `spindle_at` cookie or a per-account bucket, which Cloudflare's
IP-based rules cannot express. If abuse appears on `/api/auth/*` (sign-in,
password reset, passwordless/magic-link), the cheapest correct fix is a
small rate-limit middleware inside Next.js, not a gateway. The Caddyfile
below is a reference for that case only.

## Reference configs

- `infra/gateway/cloudflared-config.example.yml` — annotated ingress example
  showing hostname→service routing, per-route `originRequest` tuning, and
  where rate-limit-oriented `originRequest` flags would go. Mirrors the real
  config; the real file is authoritative.
- `infra/gateway/Caddyfile.example` — Caddy reverse proxy for `app:8080` with
  the header hygiene the app expects (or rather, does _not_ need — the app
  sets its own security headers). Includes optional per-path rate limiting.
- `infra/gateway/nginx.conf.example` — equivalent nginx config for teams that
  prefer it; same caveats.
- `scripts/gateway/verify-gateway.sh` — smoke check that the deployed path
  answers and emits the expected security headers.

## What to adopt vs skip

**Adopt now:**

- Keep TLS termination at the Cloudflare edge. Do not move it.
- Use Cloudflare dashboard rate-limiting rules for coarse edge protection
  (e.g. 100 req/min/IP on `/api/auth/signin*`, `/api/auth/password*`,
  `/api/auth/passwordless*` — the magic-link API lives under
  `passwordless/request|verify`). This is the only gateway-layer feature with real
  value and it needs no code.
- If per-user limiting becomes necessary, implement it in Next.js middleware
  or route handlers backed by Valkey (`infra/origin/compose.yaml` already runs
  it) rather than a proxy.

**Skip:**

- A dedicated nginx/Caddy/Envoy container on the origin. It adds a hop, a
  patch surface, and SSE/WebSocket buffering risk with zero capability gain.
- TLS termination at the origin (the tunnel makes it redundant; it would also
  require public 443, which the firewall deliberately denies).
- Duplicating CSP/security headers at the gateway — `securityHeaders()` is
  the single source of truth and is unit-tested.
- Path-based routing on the gateway — there is exactly one app service;
  `lab.spindle.app` is already a separate hostname.

**Revisit if:** a third service joins the origin, per-tenant routing appears,
or the team needs mTLS / client-cert auth that cloudflared cannot express.
At that point the gateway slot is already shaped: insert it between
cloudflared and `app:8080` and the reference configs apply.
