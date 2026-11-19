---
title: "Wire the sign-in dialog to real authentication"
priority: Urgent
estimate: 8
labels:
  - frontend
  - auth
  - website
project: Spindle Website
status: Todo
---

## Summary

`AuthDialog` currently intercepts submit and prints "Preview only — no account is created." Every
"Sign in", "Start free", and "Create free workspace" path on the marketing site depends on it, so the
whole acquisition funnel dead-ends here.

## Context

- `src/components/site/auth-dialog.tsx` implements both tabs (sign-in, create workspace) with
  `handleSubmit` calling `event.preventDefault()` and setting a notice.
- The dialog opens programmatically through a `spindle:open-auth` `CustomEvent` with
  `detail.tab === "create" | "signin"`; other components dispatch it. Keep that contract intact.
- `src/components/site/providers.tsx` wraps the site and is the place for an auth/session provider.
- Header CTAs (`src/components/site/site-header.tsx`, `src/app/(site)/pricing/page.tsx`) link to
  `/#get-started` rather than the dialog.

## Scope

- Real submit handlers: sign-in (email + password), create workspace (workspace name + email).
- Session provider: store the session, expose `useSession()`, and reflect signed-in state in the header
  (replace "Sign in" with an account menu: workspace switcher, settings, sign out).
- Post-auth redirect back to the page the user came from, with a safe allowlist of internal paths.
- Loading and disabled states during submit; optimistic "Opening your workspace…" transition.
- Route the header "Start free" and pricing "Create your workspace" CTAs into the dialog with the
  create tab preselected instead of scrolling to the homepage CTA.
- Keep "Keep me signed in" meaningful: persistent vs session-only cookie.
- Error mapping for wrong credentials, unverified email, rate limited, and network failure.

## Acceptance criteria

- A real account can be created and signed into from `/`, `/pricing`, `/docs`, and `/solutions`.
- Signed-in header state persists across route changes and a hard reload.
- Sign-out clears the session and restores the sign-in trigger.
- No credentials are logged, stored in `localStorage`, or sent anywhere except auth endpoints.
- Dialog is fully keyboard operable; focus returns to the trigger on close; errors announced via
  `role="alert"` / `aria-live`.
- Playwright covers: open dialog → create workspace → header shows account → sign out.

## Notes

Backend contract must be agreed first. Keep the preview-only path available behind a flag for static
demos if the API isn't reachable in local development.

Decomposed into shippable slices: 035 (typed auth client and session provider), 036 (wire the forms),
and 037 (signed-in header, sign-out, protected routes). This issue stays open as the definition of
done for the complete flow.
