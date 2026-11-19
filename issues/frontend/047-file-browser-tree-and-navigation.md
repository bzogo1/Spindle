---
title: "Build the project file browser with tree navigation and deep links"
priority: High
estimate: 3
labels:
  - frontend
  - files
  - app
project: Spindle Website
status: Todo
---

## Summary

First slice of 032. Uploads, previews, and bulk actions all need a real file tree to act on. Today the
homepage "Files" section is a static mock and there is no `/files` route.

## Context

- `src/components/home-islands.tsx` renders the mock tree, toolbar, and "New" dropdown; it is demo
  state only.
- `src/lib/interactions/site.js` has a preview handler for the homepage demo.
- 038 provides the authenticated `(app)` shell; the file route lives there.
- `/docs#workspaces` promises uploads and inline previews; 048–050 deliver those.

## Scope

- `/files` and `/files/[...path]` under `(app)`: folder tree on the left, breadcrumb path, and file
  list in the main pane. On mobile the tree becomes a drawer.
- Toolbar: New folder, Upload (opens 048's queue), sort by name/modified/size, list/grid toggle, and a
  local filter. No server-side search in this issue.
- Tree behavior: expand/collapse, lazy-load children on first expand, current folder highlight,
  keyboard Arrow Up/Down/Left/Right/Enter, and `aria-expanded`/`aria-selected` on tree items.
- Empty states: empty folder, no files at all, and a folder that fails to load with retry.
- Deep links: `/files/coastal-resilience/results` restores the same folder after reload and can be
  shared. Unknown paths show a not-found state inside the shell, not a redirect.
- Create folder: inline name field, validation (no slashes, no duplicate, length), pending state, and
  focus moved into the new row on success.
- Do not render file names or paths until the session and folder load successfully.

## Acceptance criteria

- Reloading a deep link lands on the same folder with the tree expanded to it.
- Keyboard-only users can reach every folder and file and open a folder.
- New folder appears without a reload and rolls back on failure.
- Empty and error states are distinct and offer a next action.
- Works at 360 px with no horizontal scroll; the drawer traps no focus when closed.
- `npm run typecheck` and `npm run lint` pass.

## Notes

Part of 032. Depends on 038 and the files API. 048 uploads into the current folder, 049 previews
files, 050 adds selection and bulk actions.
