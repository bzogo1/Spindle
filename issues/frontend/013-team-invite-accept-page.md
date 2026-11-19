---
title: "Add team invite landing and accept-invite pages"
priority: Medium
estimate: 5
labels:
  - frontend
  - auth
  - collaboration
project: Spindle Website
status: Todo
---

## Summary

Collaboration is a headline feature, but an invite email has nowhere to land. There is no
`/invite/[token]` route and no invite UI on the marketing site.

## Context

- `src/app/(site)/collaboration/page.tsx` sells roles, presence, and shared documents.
- `src/app/(site)/solutions/page.tsx` sells lab/team onboarding.
- `README.md` notes the invite field is masked in Sentry replays; the invite UI itself is only a mock in
  the homepage chat/collaboration previews.
- No invite-related route exists under `src/app/`.

## Scope

- `/invite/[token]` page: shows workspace name, inviter, role, and what they get access to, then:
  - signed out → "Sign in" / "Create an account" buttons that preserve the token through auth;
  - signed in with matching email → "Join {workspace}";
  - signed in with a different email → explain the mismatch and offer to switch account;
  - invalid, expired, already-used, and already-a-member states.
- Post-join redirect into the new workspace with a welcome toast.
- Invite dialog on `/settings/members` (from the settings issue) links to this page's flow for re-sending.
- Keep tokens out of analytics, logs, and referrers (`Referrer-Policy: no-referrer` on the route).

## Acceptance criteria

- The token survives the whole auth round-trip and lands back on the accept action.
- Every failure state has a recovery action (request a new invite / contact the owner).
- Page is usable signed-out in an incognito window and does not leak workspace data before acceptance.
- Playwright: invite link → sign in → joined → redirected.
