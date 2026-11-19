---
title: "Add automation run history and readable run logs"
priority: Medium
estimate: 5
labels:
  - frontend
  - automations
  - app
project: Spindle Website
status: Todo
---

## Summary

`/automations` shows a fake "This week's runs" list and claims logs you can actually read. There is no
run list, no run detail, and no way to see why an automation failed. Build that view on top of 060.

## Context

- `src/app/(site)/automations/page.tsx` hardcodes three `.run-row` entries with "Success".
- 060 creates real drafts/schedules and the preview; the run history is the other half of the promise.
- 034 builds a similar chronological run log for the agent; share the status vocabulary and visual
  treatment rather than duplicating it.
- No run/route exists under `src/app/`. The automations API and scheduler are the dependency.

## Scope

- `(app)/automations/[id]/runs`: list of runs with start time (workspace timezone), trigger type
  (scheduled/manual), status (queued, running, succeeded, failed, cancelled, skipped), duration, and
  attempt number. Filter by status and date; paginate without losing filters.
- Run detail: chronological timeline of steps, each with start/duration, status, and log output.
  Separate stdout/stderr or use log levels; keep ordering and timestamps.
- Artifacts: files created/modified with links to 049's preview and a diff summary for edits; approval
  decisions from 034's pattern are shown inline.
- Actions: cancel a running run with confirmation, retry a failed run, and copy a shareable run link.
  Only expose actions the API supports.
- Failure states: show the failed step, its error message, and the next action (retry, edit schedule,
  contact support). Never show a generic "Something went wrong" without the run id.
- Live updates: poll or subscribe while a run is open; stop when the tab is hidden or the run
  completes; show a "reconnecting" state instead of silently stale data.
- Logs: truncate very long output with a clear "showing first/last N lines" and a download; never
  render ANSI escapes raw; monospace with preserved whitespace and horizontal scroll.
- Empty state for an automation that has never run, and an error state with retry.

## Acceptance criteria

- A scheduled or manual run appears in the list and its detail matches the timeline and status.
- A failed run identifies the failing step and error without exposing secrets or file contents.
- Cancel stops a running job and the status updates without a reload; retry creates a new attempt and
  links it to the original.
- Logs preserve order and whitespace, are readable by screen readers, and truncation is announced.
- Deep link to a run survives reload and unauthorized access is denied.
- Works at 360 px; the timeline stacks and log lines scroll horizontally rather than wrapping
  mid-token.
- Playwright covers run list → detail → failed run → retry (mocked API).

## Notes

Depends on 060 and the scheduler API. 034 is the agent equivalent; keep status names and approval copy
consistent. Do not log full file contents or environment variables.
