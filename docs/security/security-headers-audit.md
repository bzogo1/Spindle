# Security headers audit

Audit tooling and findings for the HTTP security headers the app emits.

## Where the headers come from

All security headers are defined in one place:

- `src/lib/security-headers.ts` — builds the `headers()` rules consumed by
  `next.config.ts` (`async headers()` → `securityHeaders()`). Header policy is
  unit-tested in `src/lib/security-headers.test.ts`.
- `src/lib/env.server.ts` — `CSP_ENFORCE` (literal `"1"`, optional) gates full
  CSP enforcement; `NODE_ENV` gates HSTS. Both are validated by `validateEnv()`
  at `next.config.ts` load time.

Do **not** set these headers again in Caddy/nginx or a gateway — see
`docs/architecture/api-gateway.md` ("Response headers / CSP" row).

## Current header inventory (verified against code + live responses)

Applied to every route via the `/:path*` rule:

| Header                                | Value                                                                                          | Notes                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Content-Security-Policy`             | `frame-ancestors 'self'; base-uri 'self'; object-src 'none'`                                   | Safe subset, always enforced                                                       |
| `Content-Security-Policy`             | Full policy (`default-src 'self'`, `script-src 'self' 'unsafe-inline'`, … `object-src 'none'`) | Only when `NODE_ENV=production` **and** `CSP_ENFORCE=1`                            |
| `Content-Security-Policy-Report-Only` | Same full policy                                                                               | Sent whenever the safe subset is enforced (dev + prod without `CSP_ENFORCE`)       |
| `Strict-Transport-Security`           | `max-age=63072000; includeSubDomains`                                                          | `next start` / `NODE_ENV=production` only; no `preload` (deliberate)               |
| `X-Content-Type-Options`              | `nosniff`                                                                                      |                                                                                    |
| `X-Frame-Options`                     | `SAMEORIGIN`                                                                                   | Pairs with `frame-ancestors 'self'`; `DENY` deferred (same-origin preview iframes) |
| `Referrer-Policy`                     | `strict-origin-when-cross-origin`                                                              | Overridden to `no-referrer` on token routes                                        |
| `Permissions-Policy`                  | `camera=(), microphone=(), geolocation=(), browsing-topics=()`                                 |                                                                                    |

Token-route overrides (`Referrer-Policy: no-referrer`, later rule wins):
`/reset-password/:path*`, `/verify-email/:path*`, `/magic-link/:path*`,
`/invite/:path*`.

Deliberate omissions (from the policy comment in `security-headers.ts`):

- No `Cross-Origin-Opener-Policy` — auth popup/OAuth flows not audited.
- `script-src 'unsafe-inline'` — required by pre-paint theme scripts, inlined
  critical `<style>` blocks, and Next.js inline bootstrap; no nonce/hash
  plumbing yet. `'unsafe-eval'` is never allowed.
- `img-src`/`media-src`/`frame-src` allow `https:` for user-supplied preview
  URLs in the file drawer.
- `connect-src` allows only Sentry ingest origins; issue 028 (analytics) must
  add its origin before shipping.

## The auditor

`scripts/security/headers-audit.mjs` fetches a URL's response headers and
checks them against `scripts/security/policy.headers.json`, which has two
profiles mirroring the runtime modes:

- `development` — `next dev`: HSTS absent (warn if present), safe CSP subset
  enforced, full policy required in `Content-Security-Policy-Report-Only`.
- `production` — `next start`: HSTS required (`max-age` ≥ 8 digits), CSP
  coverage checked against report-only when present, else the enforced header
  (the `CSP_ENFORCE=1` mode).

Checks performed: presence + value match (`equals`/`contains`/`regex`) for
every required header, CSP directive coverage (14 directives), forbidden
sources (`'unsafe-eval'` in _any_ CSP header fails), `frame-ancestors` value,
XFO↔frame-ancestors consistency (warn), and a warn on non-2xx audit targets.

```bash
# Against a running dev server
node scripts/security/headers-audit.mjs --url http://localhost:3000/

# Against a production build
NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run build && npm run start
node scripts/security/headers-audit.mjs --url http://localhost:3000/ --production

# Self-check, no server needed (audits synthetic good/bad responses)
node scripts/security/headers-audit.mjs --demo

# Machine-readable report for CI
node scripts/security/headers-audit.mjs --url "$URL" --json
```

Exit codes: `0` = no error-severity failures, `1` = audit failures,
`2` = usage/fetch/policy error. `--ci` is accepted for explicit CI wiring;
live audits already exit 1 on failures, and `--demo --ci` additionally fails
if the non-compliant fixture unexpectedly passes (auditor self-check).

Unit tests for the pure audit logic:

```bash
npx vitest run --config scripts/security/vitest.config.mts
```

## Audit results (run 2026-11-20, commit ef9e062 tree)

| Target                                                | Profile     | Result                                                                                    |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `next dev` on :3000 (`/`)                             | development | **PASS** — 11/11 checks, 0 warnings                                                       |
| `next start` on :3999 (`/`)                           | production  | **PASS** — 12/12 checks, 0 warnings (HSTS present: `max-age=63072000; includeSubDomains`) |
| `next dev` `/verify-email`, `/reset-password?token=…` | —           | `Referrer-Policy: no-referrer` confirmed via `curl -sI`                                   |
| `--demo` fixtures                                     | development | compliant fixture passes; non-compliant fixture fails 9 checks as expected                |

Note: `next start` requires `NEXT_PUBLIC_SITE_URL` in production
(`validateEnv`); the audit itself does not need it — only the server does.

## Findings & remediation notes

1. **Full CSP is still report-only in production.** The enforced CSP is only
   the safe subset (`frame-ancestors`/`base-uri`/`object-src`). This is
   deliberate: flip `CSP_ENFORCE=1` only after a clean report-only window on
   `/`, `/docs`, `/changelog`, `/lab`, and the auth flows. The auditor's
   production profile accepts both modes.
2. **`script-src 'unsafe-inline'`** is the main residual weakness. Remediation
   path: nonce/hash plumbing for the theme bootstrap scripts and critical
   CSS, then drop `'unsafe-inline'` from `script-src` (style may keep it
   longer via `style-src-attr`/hashes).
3. **No COOP** — deferred until auth popup flows are audited.
4. **`frame-src`/`img-src`/`media-src` allow `https:`** — tighten once preview
   URLs are proxied same-origin.
5. **HSTS has no `preload`** — intentional one-way commitment; revisit only
   if the domain set is final.
6. **Token routes rely on rule ordering** (later `Referrer-Policy` wins). If
   header rules are ever reordered or moved to the edge, re-run the auditor
   against each token route — the audit currently checks `/` only; extend
   `--url` coverage (or add a routes list to the policy) if token-route
   regression becomes a concern.

## CI integration suggestion

The repo has no headers workflow today. Cheapest correct wiring, after the app
is built in `ci.yml`:

```yaml
- name: Security headers audit (production build)
  run: |
    npm run start &            # or reuse the preview server from an earlier step
    npx wait-on http://localhost:3000
    node scripts/security/headers-audit.mjs \
      --url http://localhost:3000/ --production --ci
    node scripts/security/headers-audit.mjs --demo --ci   # auditor self-check
```

A scheduled/external variant can point `--url` at the deployed staging URL
(`https://…` auto-selects the production profile). Do not duplicate or
override these headers in front of the app — the gateway doc explains why.
