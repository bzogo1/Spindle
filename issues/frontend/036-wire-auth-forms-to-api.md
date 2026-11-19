---
title: "Wire the sign-in and create-workspace forms to the auth API"
priority: High
estimate: 5
labels:
  - frontend
  - auth
project: Spindle Website
status: Todo
---

## Summary

Second slice of 009. Replace the `preventDefault()` preview submit in the auth dialog with real
sign-in and create-workspace calls, including pending, failure, and post-auth states.

## Context

- `src/components/site/auth-dialog.tsx`: one `<form>` wraps both `TabsContent` panels and
  `handleSubmit` only sets "Preview only — no account is created."
- Inputs rely on native `required`; field-level validation is owned by 010 and should not be
  duplicated here.
- The dialog opens via the `spindle:open-auth` custom event with `detail.tab === "create" | "signin"`.
- Password reset and email verification are owned by 011 and are out of scope.

## Scope

- Separate submit handlers for the sign-in tab (email + password, "Keep me signed in") and the create
  tab (workspace name + email), calling `signIn` / `signUp` from 035.
- Derive a workspace slug from the name with the same rules as 010 (preview only; server remains the
  source of truth for uniqueness).
- Pending state on the submit button (`disabled`, `aria-busy`, label change) and prevention of double
  submission.
- Map `AuthError` codes to human copy: wrong credentials, unverified email (link to 011's resend flow),
  rate limited with retry guidance, workspace name taken (map onto the name field), network failure
  that preserves typed input.
- Close the dialog on success, refresh the session, and return the user to the current page. If a
  return path is present, hand it to 037's safe-redirect helper.
- Add correct `autoComplete` values (`email`, `current-password`, `new-password`, `organization`),
  a visible show/hide password control, and no credentials in logs, analytics, or URLs.
- Keep the preview path available only behind 035's flag for static demos.

## Acceptance criteria

- A real account can be created and signed into from `/`, `/pricing`, `/docs`, and `/solutions`.
- The header updates to the signed-in state without a full reload; a hard reload keeps it.
- Each failure mode shows a field-level error or a `role="alert"` notice, never a raw status code.
- Submit is disabled while pending; pressing Enter twice does not create two workspaces.
- Dialog remains keyboard operable and focus returns to the trigger on close.
- Playwright covers: open → create workspace → signed-in header → sign out (mocked API).

## Notes

Depends on 035. 010 owns inline validation, 011 owns reset/verification, 037 owns the account menu and
redirect allowlist.
