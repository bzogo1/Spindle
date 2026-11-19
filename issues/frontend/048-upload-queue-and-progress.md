---
title: "Build the upload queue with drag-and-drop and per-file progress"
priority: High
estimate: 5
labels:
  - frontend
  - files
  - app
project: Spindle Website
status: Todo
---

## Summary

Second slice of 032. The file manager's "Upload" action does nothing. Build a queue that handles
multiple files, shows real progress, survives failures, and never leaves a phantom file in the list.

## Context

- 047 provides the browser, current folder, and deep links.
- `src/components/ui/progress.tsx` exists and is used by the mock storage meter.
- No upload endpoint exists; the API contract (multipart or signed URL, size limits, allowed types) is
  part of the dependency.
- `/pricing` and `/docs#workspaces` promise 5 GB free and 100+ inline formats; 049 owns preview
  support, this issue owns transfer.

## Scope

- File picker and drag-and-drop onto the file pane, including folder drops if the browser exposes
  them. Show a full-pane drop target only while dragging, and do not hijack drops elsewhere on the
  page.
- Queue panel: file name, size, progress, status (queued / uploading / paused / failed / done), and
  per-file cancel, pause/resume where the transport supports it, and retry.
- Handle: zero-byte files (reject with a reason), files over the limit (reject before upload), duplicate
  names (ask rename/replace/skip), and network failure (retry without re-selecting).
- Limit concurrent uploads (2–3) and keep the UI responsive with large files.
- Optimistic placeholder row while uploading; replace it with the server record on success and remove
  it on failure. Never show a completed file the server did not confirm.
- Announce aggregate progress politely via `aria-live` (throttled), not on every byte.
- Warn before navigating away with uploads in progress if the browser supports it.
- Refresh the storage meter (050) after the queue drains.

## Acceptance criteria

- Upload multiple files at once; each has independent progress and status.
- Cancel stops the transfer and removes the partial file; retry succeeds without reselecting.
- A 0-byte file and an oversized file are rejected with clear, specific messages.
- A mid-upload failure leaves no row marked complete and offers retry.
- Queue is keyboard operable, and icon-only controls have accessible names.
- No file content is sent to analytics or logs; no credentials are placed in URLs.
- Playwright covers upload → success → refresh → file still present (mocked API).

## Notes

Part of 032. Depends on 047 and the upload contract. 049 handles previews, 050 handles storage and
bulk actions.
