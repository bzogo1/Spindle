---
title: "Add live presence, cursors, and inline comments to shared documents"
priority: Medium
estimate: 5
labels:
  - frontend
  - collaboration
  - app
project: Spindle Website
status: Todo
---

## Summary

The collaboration page promises sub-40 ms cursors, selections, presence avatars, and comments pinned
to a cell, row, or sentence. 066 makes documents real; this issue adds the live layer that makes them
collaborative.

## Context

- `src/app/(site)/collaboration/page.tsx` shows presence floats, remote cursors, a comment pin, and
  "3 editing now"; all demo markup.
- 066 provides the document editor, roles, and version history.
- The backend must expose awareness/presence and comment storage; without it, show a clear "live
  collaboration unavailable" state rather than fake cursors.
- 031 requires a reduced-motion and keyboard pass; presence animation must respect it.
- 028 must not receive document content, comment text, or collaborator identities.

## Scope

- Presence bar: avatars or initials for everyone in the document, with a "you" marker, an overflow
  count, and a plain-language "N people editing" label. Announce joins/leaves politely, not on every
  cursor move.
- Remote cursors and selections: name label, colour plus pattern/initial (not colour alone), and
  correct positioning for the current editor layout. Hide cursors for idle users after a timeout.
- Awareness lifecycle: connect, reconnect, and disconnect states; stop sending updates when the tab is
  hidden; clear stale presence on reconnect. No ghost cursors after a user leaves.
- Comments: create a thread anchored to a text range or table cell, reply, resolve, and reopen.
  Anchored highlights must degrade gracefully when the text moves (show the thread in a side panel
  with a "position changed" note).
- Comment UI: side panel on desktop, sheet on mobile; unread count; keyboard navigation; resolve
  undo. No comment content in notifications until the user opens it if the backend cannot guarantee
  privacy.
- Reduced motion: no animated cursor trails or pulsing avatars; presence remains legible statically.
- Offline/error state: keep editing against 066's autosave, show collaborators as unavailable, and
  recover presence on reconnect.

## Acceptance criteria

- Two signed-in users in the same document see each other's presence and cursor within a reasonable
  interval; leaving removes the cursor promptly.
- Presence is not announced on every keystroke; only join/leave changes are announced.
- Cursor identity is distinguishable without colour and readable at 200% zoom.
- A comment can be created, replied to, resolved, and reopened, and survives reload.
- A moved anchor shows the thread with a clear position-changed state instead of misplacing it.
- Reconnect/offline states are visible and do not leave ghost collaborators.
- No document text, comment body, or collaborator email is sent to analytics or Sentry.
- Works at 360 px and keyboard only; reduced motion disables cursor animation.

## Notes

Depends on 066 and the realtime/awareness backend. 031 owns the broader motion audit. Do not ship a
simulated cursor demo as if it were live.
