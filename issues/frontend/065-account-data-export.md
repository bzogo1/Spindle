---
title: "Add account and workspace data export"
priority: Medium
estimate: 3
labels:
  - frontend
  - privacy
  - app-shell
project: Spindle Website
status: Todo
---

## Summary

The privacy policy will describe a right of access, and 039 adds account deletion, but there is no way
to get a copy of your data. Add an export flow so the policy is backed by an actual capability rather
than a contact address.

## Context

- 002 covers data-subject rights and must not describe an export that does not exist; this issue makes
  that section honest.
- 038 provides the `(app)` shell and guard; 039 owns `/settings/account`, including the deletion
  confirmation that should link here.
- 058 provides the email templates; the export link must be delivered through the same pipeline.
- 012 lists account management but no export; the backend needs a job that assembles workspace
  content, metadata, and usage records.
- Exports are highly sensitive: they contain project files and personal data.

## Scope

- Entry point from `/settings/account` (and the deletion dialog): a short explanation of what is
  included (profile, workspace metadata, members, files, run logs, usage), the format (ZIP of
  human-readable JSON/CSV plus original files), and how long the link stays valid.
- Request flow: re-authenticate or confirm the password before starting; show queued/processing/ready/
  failed states; prevent duplicate requests while one is pending.
- Delivery: email a single-use, expiring download link (058); do not expose a permanent public URL or
  put the token in a referrer-bearing page.
- Download: expiring signed URL, size shown before download, clear expiry, and a way to request a new
  link. Never cache the archive in the browser or a shared proxy.
- Failure states: job failed with a support reference, link expired with re-request, and partially
  unavailable data explained.
- Audit: record who requested an export and when; do not log the archive contents, download token, or
  personal data.
- Rate limit requests (e.g. one per workspace per day) and state the limit in the UI.

## Acceptance criteria

- A user can request, receive, and download an export without contacting support.
- The download link expires, is single-use, and is invalid for another account or workspace.
- The archive includes the data listed in the UI, and the UI list matches the privacy policy.
- Password confirmation is required before the job starts; an unauthorized request is rejected.
- Pending and failed jobs cannot be started twice and show a clear next action.
- No export contents, tokens, or personal data appear in analytics, Sentry, or server logs.
- Works at 360 px and with keyboard only; status changes are announced.
- Playwright covers request → processing → ready → download with a mocked API.

## Notes

Depends on 038, 039, 058, and the export job API. Coordinate the included-data list with 002 and the
retention rules with 004. Do not build a synchronous export in the request handler; large workspaces
need a job.
