---
title: "Add security headers and a Content Security Policy"
priority: High
estimate: 3
labels:
  - frontend
  - security
  - infrastructure
project: Spindle Website
status: Todo
---

## Summary

The production site ships no security headers. `next.config.ts` contains only `reactStrictMode`, so
there is no CSP, HSTS, clickjacking protection, or referrer policy — despite the site handling auth
and token-bearing invite/reset URLs.

## Context

- `next.config.ts` has no `headers()`, `redirects()`, or `images` configuration.
- `src/app/(changelog)/layout.tsx` renders an inline pre-paint theme script; the site layout will gain
  one with 045. A CSP must account for it without breaking the no-flash behavior.
- External origins in use: Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) in
  `src/app/(site)/layout.tsx`, and Sentry ingest endpoints used by the three Sentry configs.
- `/invite/[token]`, `/reset-password/[token]`, and `/verify-email` must not leak tokens through the
  `Referer` header.
- 028 (analytics) will add another origin; 051 must land before or with it.

## Scope

- Add a single headers configuration in `next.config.ts` (or middleware if path-specific behavior
  requires it — check the installed Next 16 docs first):
  - `Content-Security-Policy` in Report-Only first, then enforce. Start from `default-src 'self'`;
    allow the font stylesheet/font files, Sentry ingest (`connect-src`/`script-src` as required), and
    `img-src` for `self`, `data:`, and any approved asset host. Avoid `unsafe-eval` in production;
    document any `unsafe-inline` that Next's injected styles genuinely require.
  - Give the inline theme script a stable hash or a nonce. Prefer a hash so static prerendering and
    the no-flash guarantee are preserved; nonces force dynamic rendering in Next.
  - `Strict-Transport-Security` (production only), `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin` globally and `no-referrer` on token routes,
    `Permissions-Policy` denying camera/microphone/geolocation, and `frame-ancestors 'none'` plus
    `X-Frame-Options: DENY`.
  - Do not add `Cross-Origin-Opener-Policy: same-origin` unless the auth flow is verified not to rely
    on popups.
- Add a report-only rollout note: how to read violations, which browser devtools report, and when to
  flip to enforce.
- Document the policy and the approved origins next to the config so the next integration does not
  silently break it.

## Acceptance criteria

- Every route loads with zero CSP violations in Chromium and Firefox, including `/changelog` and its
  theme toggle, the auth dialog, and a canvas-heavy page.
- `curl -I` against `npm run build && npm start` shows every header on `/`, `/docs`, `/changelog`, and
  an invite route.
- The changelog theme applies before paint with the policy enforced (no flash, no inline-script
  error).
- No `unsafe-eval` in the production policy; each `unsafe-inline` has a written justification.
- `Referrer-Policy: no-referrer` is present on token routes and the invite token is absent from
  `Referer` in a cross-origin test request.
- Static prerendering still succeeds for all marketing routes.

## Notes

Coordinate with 045 (inline theme script), 028 (analytics origin), 056 (Sentry ingest), and 026
(metadata). Follow the CSP guidance for the installed Next version rather than copying a policy from
an older release.
