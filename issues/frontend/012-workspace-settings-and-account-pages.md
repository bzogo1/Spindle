---
title: "Add workspace settings and account pages"
priority: Medium
estimate: 8
labels:
  - frontend
  - app-shell
project: Spindle Website
status: Todo
---

## Summary

Signed-in users have nowhere to manage anything: no workspace name, members, storage usage, agent
request allowance, or account deletion. The site only brands itself as a workspace product.

## Context

- `src/app/(site)/layout.tsx` is the marketing shell with `SiteHeader`/`SiteFooter`.
- There is no authenticated app area in `src/app/`; every route is a marketing page.
- Pricing promises 5 GB storage, 20 agent requests/day, +50 by referral — none of it is visible anywhere
  after signup.
- `src/components/ui/` already includes `progress.tsx` (storage meter in the file manager demo),
  `separator.tsx`, `avatar.tsx`, `tabs.tsx`.

## Scope

- New route group `(app)` with an authenticated layout: compact top bar, workspace switcher, and a
  left nav covering projects, files, lab, automations, agent, chat, members, usage, and settings.
- `/settings/workspace`: rename, slug (with confirmation), timezone, default sharing policy.
- `/settings/account`: display name, email change (re-verify), password change, theme, delete account
  with typed confirmation.
- `/settings/members`: list with roles, pending invites, invite dialog (email + role), remove/role change.
- `/settings/usage`: storage meter, agent requests today, reset time, referral bonus line.
- Guard the group so unauthenticated visitors are redirected to sign-in with a return path.

## Acceptance criteria

- All destructive actions require confirmation and explain the consequence.
- Usage numbers match the API, with a sensible unknown/loading state.
- Empty states for a new workspace (no members beyond owner, no invites).
- Deep links survive sign-in and land on the requested settings tab.
- Responsive down to 360 px: nav collapses, tables become stacked rows.
- No raw API errors surfaced; map to human messages.

## Notes

Decomposed into 038 (authenticated app shell), 039 (workspace and account settings), 040 (members and
invites), and 041 (usage and plan overview). This issue stays open as the definition of done for the
complete area.
