---
title: "Add storage usage, file selection, and bulk actions"
priority: Medium
estimate: 5
labels:
  - frontend
  - files
  - app
project: Spindle Website
status: Todo
---

## Summary

Fourth slice of 032. The storage meter is a hardcoded 5 GB bar and there is no way to act on more than
one file. Add real usage, selection, and the bulk operations users expect from a file manager.

## Context

- 047 provides the file list; 048 uploads; 049 previews.
- `src/components/ui/progress.tsx` is already used for the mock meter.
- 041 owns the workspace-level usage page; this issue owns the meter and actions inside `/files`.
- Delete and move are destructive and need the same confirmation discipline as 012.

## Scope

- Storage meter in the file toolbar: used/total from the API, exact values in the tooltip/label, 80%
  warning, 100% state that disables uploads with a link to 041/`/pricing`.
- Selection: checkboxes on rows, select-all for the current folder, Shift-click range selection, and
  ⌘/Ctrl-click toggling. Show a count and total selected size in the bulk bar.
- Bulk actions: move to folder (tree picker, no cycles), download (individual files; a zip only if the
  API supports it), and delete.
- Delete: confirmation naming the number of files and whether folders are recursive; type-to-confirm
  only for folders or large batches. Optimistic removal with rollback and a visible error on failure.
- Single-file row actions: rename, move, download, delete, reusing the same dialogs.
- Selection state must not survive a folder change or a refresh in a surprising way; clear it and
  announce the new count.
- Keyboard: Space toggles, Shift+Arrow extends, Escape clears, and the bulk bar is reachable without a
  pointer.
- Meter and actions update after upload/delete without a full reload.

## Acceptance criteria

- Meter matches the API within rounding and updates after upload, delete, and move.
- 100% state blocks new uploads in the UI and explains what to do; the server remains the final gate.
- Shift and ⌘/Ctrl selection behave correctly across a folder, including after sorting.
- Bulk delete shows the right count, rolls back on failure, and restores focus sensibly.
- Moving a folder into itself or a descendant is blocked with an explanation.
- Works at 360 px: bulk bar wraps or becomes a bottom sheet without covering the last row.
- No destructive action is reachable by a single Enter press on a focused button.

## Notes

Part of 032. Depends on 047–049 and the files API. 041 shows the same storage numbers at the workspace
level; keep one formatting helper.
