---
title: "Add Lab run snapshots and run comparison"
priority: Low
estimate: 5
labels:
  - frontend
  - lab
  - app
project: Spindle Website
status: Todo
---

## Summary

The Lab page promises "Snapshots on every run" and "roll back any cell, any time". 062 makes runs
persist but does not capture what a run produced or changed. Add snapshots and a comparison view so
results are reproducible.

## Context

- `src/app/(site)/lab/page.tsx` makes the snapshot claims in the hero and notebook sections.
- 062 provides run records, logs, and artifacts; 049 provides file previews and diff-friendly output.
- The Lab runtime must expose the files and outputs associated with a run; without that contract this
  issue cannot start.
- Historical file content may contain sensitive research data, so retention and access need an
  explicit decision with the backend/privacy owners.

## Scope

- Snapshot record per run: input files/versions, produced outputs, and changed files with before/after
  references. Store references, not duplicated blobs, where the API supports it.
- Snapshot panel on the run detail: input summary, outputs, and a changed-files list with per-file
  preview (049) and a text diff for text/code/CSV.
- Comparison: pick two runs of the same tool and show output differences and changed-file differences.
  Side-by-side on desktop, stacked on mobile; no diff for binary files, just size/type/metadata.
- Restore: restoring files from a snapshot is destructive. Require confirmation naming the affected
  files, state that later changes will be replaced or copied to a new folder (choose one and document),
  and show the result. Never restore silently.
- Download a snapshot as an archive only if the API supports it; otherwise link individual artifacts.
- Retention: show when a snapshot will be deleted; do not promise permanent storage.
- Empty state when a run produced no outputs.

## Acceptance criteria

- Every completed run in 062 has a snapshot entry with inputs, outputs, and changed files, or an
  explicit "no changes" state.
- Diff view correctly identifies added, removed, and modified text files without rendering raw HTML.
- Binary files show metadata instead of a broken diff.
- Restore requires confirmation, names the files, and reports success/failure accurately; rollback is
  possible.
- Snapshot access is authorized per workspace, and deep links do not leak another workspace's data.
- Works at 360 px and with keyboard only.
- No snapshot content is sent to analytics or Sentry.

## Notes

Depends on 062 and the runtime's artifact contract. Coordinate retention and deletion with privacy/002
before shipping. If the backend cannot expose historical file versions, split the comparison view from
restore and ship the read-only half first.
