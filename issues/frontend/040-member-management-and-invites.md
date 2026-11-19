---
title: "Build member management and pending invite UI"
priority: Medium
estimate: 5
labels:
  - frontend
  - collaboration
  - app-shell
project: Spindle Website
status: Todo
---

## Summary

Third slice of 012. `/collaboration` sells roles and shared workspaces, but there is no member list,
no invite dialog, and no way to revoke an invite. Without this, team features cannot be used even
after auth lands.

## Context

- 038 provides the shell and `/settings` section; 013 owns the invite acceptance page.
- The homepage and `/collaboration` show presence avatars and roles as static previews only.
- `src/components/ui/` has `avatar`, `dropdown-menu`, `dialog`, `input`, and `label`; a table is plain
  HTML styled in `ui.css`.
- Invite email delivery belongs to 058; this issue owns the management UI and the API calls.

## Scope

- `/settings/members`: member table with name, email, role, joined date, and last active; sortable by
  name and role; empty state for a workspace with only its owner.
- Roles come from the API contract — do not invent a hierarchy. A change-role menu lists only the
  roles the current user may assign.
- Pending invitations section: email, role, sent date, expiry, "Resend" and "Revoke" with
  confirmation. Resending shows a cooldown.
- Invite dialog: email (single, plus a paste-multiple textarea if the API supports bulk), role, and a
  preview of what the invitee will see. Validate email shape and duplicate/pending invites client-side;
  map server errors back onto the field.
- Guard rails: an owner cannot remove or demote the last owner; users cannot change their own role;
  removing a member requires confirmation naming the member.
- Show seat usage against the plan (from 016's config/API) and link to billing when the limit is hit.
- Responsive: table becomes stacked cards below 640 px; all row actions remain reachable by keyboard.

## Acceptance criteria

- Invite → pending row appears → resend works with cooldown → revoke removes it, all without reload.
- Role change and removal are reflected immediately and roll back on failure with a clear message.
- Last-owner and self-role actions are disabled with an explanation, not just an error on submit.
- Invite dialog and row menus are keyboard operable and announce results via `aria-live`.
- Works at 360 px and with 200% zoom.
- Playwright covers invite → pending → revoke, and a blocked last-owner removal (mocked API).

## Notes

Part of 012. Depends on 038 and the member API; 013 handles the recipient's experience, 058 the email.
Do not store invite tokens in client analytics or logs.
