---
title: "Add validation and field-level errors to the auth forms"
priority: High
estimate: 3
labels:
  - frontend
  - auth
  - accessibility
project: Spindle Website
status: Todo
---

## Summary

Both auth tabs rely on native `required` only. There is no inline validation, no password rules, no
workspace-name rules, and the single notice line is the only error surface.

## Context

- `src/components/site/auth-dialog.tsx`: `Input` fields for work email, password, workspace name, new
  email; a `Checkbox` for "Keep me signed in"; one `{notice && <p className="ui-form-notice">}`.
- Styling lives in `src/app/styles/ui.css` (`ui-field`, `ui-form-notice`, `ui-dialog-*`).

## Scope

- Client-side validation for: email shape, password minimum length and strength hint, workspace slug
  rules (lowercase, dashes, length, reserved names like `admin`), and required consent where applicable.
- Inline error text under each field, tied with `aria-describedby` and `aria-invalid`.
- Disable submit until the form is dirty and valid; keep the server as the source of truth for
  uniqueness ("that workspace name is taken").
- Show server field errors mapped back onto the matching input; keep the general notice for
  non-field errors.
- Announce the first invalid field on submit and move focus to it.
- Clear errors when the user edits a field.

## Acceptance criteria

- Invalid submit never reaches the network.
- Error text is visible at 200% zoom and has 4.5:1 contrast in the dark theme.
- Screen reader announces field errors once, not on every keystroke.
- No layout shift when an error appears (reserve space).
- Typecheck/lint pass; component test covers the validation matrix.
