---
title: "Turn the file-manager preview into a real upload flow"
priority: High
estimate: 8
labels:
  - frontend
  - files
  - app
project: Spindle Website
status: Todo
---

## Summary

The homepage "Files" section is a static mock: it shows a tree, a 5 GB progress meter, and a "New"
dropdown but uploads nothing and previews nothing. `/docs#workspaces` promises "upload a CSV, a notebook,
or a PDF; Spindle detects common formats and previews them in place."

## Context

- `src/components/home-islands.tsx` renders the file manager island using `progress.tsx`,
  `dropdown-menu.tsx`, and `button.tsx`.
- `src/lib/interactions/site.js` has a file preview handler for the homepage demo.
- `src/app/(site)/platform/page.tsx` and `/#files` both advertise 5 GB free and 100+ inline formats.
- There is no upload route under `src/app/` and no real file state anywhere.

## Scope

- `/files` (or the in-app file view from the settings issue) with a real tree, breadcrumbs, and a
  toolbar: New folder, Upload, sort, view toggle.
- Drag-and-drop plus file picker; multi-file queue with per-file progress, pause/cancel, and retry.
- Type handling: preview images, PDFs, CSV/TSV tables (first N rows), plain text/markdown, and fall back
  to a download card for unknown types. Show a clear "preview not available" state rather than a blank.
- Storage usage from the API: used/total, warning at 90%, and an actionable block at the limit.
- Selection model: checkboxes, shift/⌘-select, and a bulk action bar (move, download, delete).
- Keyboard-first: arrow-key tree navigation, Enter to open, Delete with confirmation.
- Optimistic updates with rollback on failure; never show a file that wasn't created.

## Acceptance criteria

- Upload a 100 MB file and a 0-byte file: both produce correct states (success / rejected with reason).
- Reloading preserves the tree; deep links to a folder work.
- Deleted files disappear immediately and reappear only if the server confirms.
- Storage meter matches the API value within a rounding bound.
- Accessible names on every icon-only control; progress announced via `aria-live` (throttled).
- Playwright: upload → preview → rename → delete.

## Notes

Decomposed into 047 (file browser tree and deep links), 048 (upload queue and progress), 049 (inline
previews), and 050 (storage, selection, and bulk actions). This issue stays open as the definition of
done for the file manager.
