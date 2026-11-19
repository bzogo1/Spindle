---
title: "Build shared project documents with autosave and version history"
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

`/collaboration` sells "edit the same document with live cursors", "one CRDT document per project
file", comments, and version history. The backlog covers chat (033) and roles (040) but not documents
at all. Build the document surface first; 067 adds presence and comments on top.

## Context

- `src/app/(site)/collaboration/page.tsx` `#editing` section shows a document editor preview with
  avatars, cursors, comments, and a "3 editing now" note; none of it is real.
- 038 provides the app shell and project navigation; 047 provides files that documents can attach to.
- 040 owns roles and permissions; the document editor must respect view/comment/edit.
- The collaboration backend (CRDT/websocket sync, version storage) is the dependency. Do not fake
  multi-user persistence with local state.
- 033 is chat only and does not share a document model.

## Scope

- Project document list: title, type (note / notebook cell / table view), owner, last edited, and
  collaborators. Create, rename, duplicate, and archive with confirmation.
- Editor for Markdown/rich text notes: toolbar with headings, lists, links, code, and tables; keyboard
  shortcuts; paste sanitization; no raw HTML execution.
- Autosave with a visible state (saving / saved / offline / error), debounce, and retry. Never claim
  "saved" before the server acknowledges.
- Version history: list of versions with author and timestamp, read-only preview, and restore with
  confirmation. Versions are retained per the retention policy; state it in the UI.
- Permissions: viewers get a read-only editor, commenters cannot edit, editors can edit. Hide or
  disable actions the role cannot perform and explain why.
- Empty state per project and a not-found/forbidden state for a document URL.
- Keyboard and screen-reader support: labelled toolbar, visible focus, announcements for save state
  and restore results, no keyboard trap in the editor.
- Do not render document content for an unauthorized user or in analytics/Sentry.

## Acceptance criteria

- Create a document, type, reload, and see the same content with a version entry.
- Save state is accurate: a failed save shows an error and keeps the content, with retry.
- Version preview and restore work, and restore creates a new version rather than destroying history.
- Viewer/commenter roles cannot edit in the UI and receive a clear read-only reason.
- Document URLs are shareable and survive reload; unauthorized access shows a forbidden state.
- Rich-text paste cannot inject scripts or remote tracking content.
- Works at 360 px with the toolbar wrapping or collapsing; keyboard-only editing is possible.
- Playwright covers create → edit → reload → version restore (mocked API).

## Notes

Depends on 038, 040, and 047 plus the document/CRDT backend. 067 adds presence, cursors, and inline
comments. Reconcile the marketing copy with what the real editor supports before launch.
