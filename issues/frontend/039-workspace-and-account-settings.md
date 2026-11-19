---
title: "Build workspace and account settings forms"
priority: Medium
estimate: 5
labels:
  - frontend
  - app-shell
project: Spindle Website
status: Todo
---

## Summary

Second slice of 012. Signed-in users need to rename a workspace, manage their own profile, change
email/password, and delete an account with a clear consequence. Today none of that surface exists.

## Context

- 038 provides the `(app)` layout and navigation.
- No settings routes exist under `src/app/`.
- `src/components/ui/` provides `input`, `label`, `switch`, `tabs`, `separator`, and `dialog`, but no
  select component — use a native `<select>` reskinned in `ui.css` rather than adding a dependency.
- Email-change re-verification depends on 058's email templates and 011's verification states.

## Scope

- `/settings/workspace`: workspace name, slug with an explicit "this changes links" confirmation,
  timezone (IANA list), and default sharing policy. Show the current member/seat count read-only.
- `/settings/account`: display name, email change (requires re-verification; show pending state and
  cancel), password change (current + new + confirm), theme preference (delegates to 045 when
  available), and account deletion.
- Deletion: typed workspace/account confirmation, explanation of what is removed and what is retained
  for legal/backup windows, and a link to the data-export flow (065). Never delete on a single click.
- Shared form behavior: dirty tracking, inline field errors from the server, pending/disabled submit,
  success toast with `aria-live`, and an "unsaved changes" guard when navigating away.
- Slug validation mirrors the server rules; show availability feedback without blocking typing.
- Leave the page usable at 360 px and at 200% zoom; no two-column form that cannot stack.

## Acceptance criteria

- Every save round-trips through the API and survives a reload; failed saves keep the typed values.
- A duplicate slug shows a field-level error and does not change the URL.
- Email change does not take effect until verified, and the pending state is visible.
- Delete requires typing the exact confirmation phrase and cannot be triggered by Enter alone on a
  focused button.
- Forms are keyboard operable, labels are programmatically associated, and errors are announced once.
- `npm run typecheck` and `npm run lint` pass; validation rules are unit tested (057).

## Notes

Part of 012. Depends on 038. Account deletion and export need the backend contract; do not fake either
in the UI. 058 supplies the verification email.
