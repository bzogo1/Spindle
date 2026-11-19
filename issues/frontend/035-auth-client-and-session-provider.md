---
title: "Add a typed auth client and session provider"
priority: High
estimate: 5
labels:
  - frontend
  - auth
project: Spindle Website
status: Todo
---

## Summary

First slice of the real-auth work in 009. The UI currently has no session concept at all, so every
component that needs to know "is this person signed in?" would otherwise grow its own fetch. Add one
typed client and one provider that every auth surface consumes.

## Context

- `src/components/site/providers.tsx` only wraps `TooltipProvider`; it is the single mount point for
  app-wide client state.
- `src/components/site/auth-dialog.tsx` has local tab/notice state and no session awareness.
- There is no `src/lib/auth/` directory and no server endpoint in the repo yet; the backend contract is
  the open dependency from 009.
- Cookies must be httpOnly, so the session cannot be reconstructed from `localStorage` on the client.

## Scope

- Create `src/lib/auth/client.ts`: typed `signIn`, `signUp`, `signOut`, `getSession`, and `refresh`
  functions over the agreed API contract, with `credentials: "include"`, request timeouts, and abort
  support.
- Define `AuthError` with stable codes (`invalid_credentials`, `email_unverified`, `rate_limited`,
  `workspace_taken`, `network`, `unknown`) and a single mapping from HTTP status/body to those codes.
  Components must never read raw response bodies.
- Add `SessionProvider` to `src/components/site/providers.tsx`, exposing `useSession()` with
  `status: "loading" | "authenticated" | "anonymous"`, `user`, `workspace`, and `refresh()`.
- Seed initial session state from the server (layout/server component or an initial fetch) so the
  header does not flash "Sign in" for an authenticated user.
- Add an explicit preview mode (env flag) that keeps 009's current demo behavior when no auth API is
  configured. No silent fallback from a failing API to preview mode.
- Document the CSRF strategy for mutating endpoints (same-site cookie plus token/header, per the
  backend's decision) and keep auth tokens out of JavaScript and `localStorage`.

## Acceptance criteria

- No component fetches an auth endpoint directly; all access goes through `src/lib/auth/client.ts`.
- `useSession()` has a discriminated-union type, and every state is handled without optional chaining
  on `user`.
- A hard reload preserves the session through the httpOnly cookie with no signed-out flash.
- The preview flag is off by default in production builds; a missing API URL in production produces a
  clear error rather than a fake sign-in.
- Error mapping has unit tests covering each code (see 057).
- `npm run typecheck` and `npm run lint` pass.

## Notes

Part of 009. 036 wires the forms to this client; 037 builds the signed-in shell on top of
`useSession()`. Do not change the `spindle:open-auth` event contract while doing this.
