---
title: "Persist Lab runs and show run history"
priority: Medium
estimate: 5
labels:
  - frontend
  - lab
  - app
project: Spindle Website
status: Todo
---

## Summary

`/lab` advertises "Snapshots on every run" and "keep the run history", but the eight tools are static
previews. Without persisted runs there is no way to return to a result, see why a script failed, or
compare an experiment to yesterday's.

## Context

- `src/app/(site)/lab/page.tsx` renders eight tool sections (Python notebook, R console, script
  runner, SQL, canvas, Desmos, math, visualizer) as demos; `src/lib/interactions/lab.js` drives them.
- The script runner copy claims "stream the logs, inspect the diff, keep the run history"; none of it
  exists.
- 038 provides the authenticated app shell; 049 provides file previews that run outputs can reuse.
- The Lab runtime/execution backend is the dependency; do not fake execution in the UI.
- Snapshots and run comparison are explicitly out of scope here (see 064).

## Scope

- Project Lab route under `(app)` (e.g. `/lab/[project]`) with the existing tool set framed as an
  experiment: choose tool, edit input, Run.
- Run record: id, tool, started/finished time, duration, status (queued, running, succeeded, failed,
  cancelled), triggering user, and input summary.
- Run list per project with filters by tool/status and pagination. Empty state for a project with no
  runs.
- Run detail: stdout/stderr or cell outputs in document order, error with the failing line, and
  artifacts (created files) linking to 049. Preserve whitespace and support horizontal scroll for
  wide output.
- Cancel a running run with confirmation; rerun reuses the same input and creates a new attempt
  linked to the original.
- Persist across reload and provide a shareable deep link; stop polling when the tab is hidden or the
  run completes.
- Accessible live status: announce queued → running → done once per transition, not per log line.
- Truncate very long output with an explicit note and a download; never render raw ANSI escapes.

## Acceptance criteria

- Starting a run creates a record that survives a reload and appears in the list.
- A failed run shows its error and failing step; a cancelled run shows cancelled, not failed.
- Rerun creates a distinct attempt and links both ways.
- Output order and whitespace match the runtime; long output is truncated with a clear notice.
- No file contents, environment variables, or secrets are logged or sent to analytics/Sentry.
- Deep links work for authorized users and are denied for others.
- Works at 360 px and with keyboard only.
- Playwright covers run → succeed → reload → still listed (mocked API).

## Notes

Depends on 038 and the Lab runtime API. 064 adds snapshots and comparison. Do not claim "runs in your
browser" once execution is server-side; reconcile that copy with the real architecture.
