---
title: "Build password reset and email verification screens"
priority: High
estimate: 5
labels:
  - frontend
  - auth
project: Spindle Website
status: In Review
---

## Summary

Once real auth lands there is no way to recover an account or verify an email address. Both flows need
frontend routes and states.

## Context

- `src/components/site/auth-dialog.tsx` has no "Forgot password?" link.
- There are no `src/app/(auth)/` routes; the site layout always renders the marketing header and footer.
- Email sending is out of scope here — this issue covers the screens and their states only.

## Scope

- Add a "Forgot password?" link in the sign-in tab that switches the dialog to a reset-request view
  (email field → "Check your inbox" confirmation, with resend cooldown).
- Routes under a new `(auth)` route group with a minimal centered layout (brand mark, no site nav):
  - `/reset-password` — request form (also reachable directly).
  - `/reset-password/[token]` — new password + confirm, token validity/expired states, success state
    with a "Sign in" CTA.
  - `/verify-email` — verifying, verified, expired, and resend states.
- Loading, success, expired-link, and invalid-token states for each route, with a way forward
  (request a new link / contact support).
- Add these routes to `robots.txt` disallow rules (do not index token-bearing pages).

## Acceptance criteria

- Expired and used tokens show a clear next step, not a raw error.
- Password fields support show/hide and paste; confirm-password mismatch is caught client-side.
- Pages are prerender-safe where possible; token pages read the token from the route param.
- Keyboard-only completion of both flows.
- Playwright covers request → (mocked) token → success, and expired token.
