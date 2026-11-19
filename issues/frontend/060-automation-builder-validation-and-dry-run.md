---
title: "Add validation and a dry-run preview to the automation studio"
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

The automations studio looks complete — Ask AI, visual builder, raw cron — but every panel is demo
state and "Approve & schedule" does nothing. The most trust-sensitive part is the preview: users need
to see exactly when and what will run before anything is saved.

## Context

- `src/app/(site)/automations/page.tsx` has three `data-mode` tabs (`ask`, `build`, `cron`) and a
  hardcoded ask flow (`#askTrigger`, `#askAction1`, `#askAction2`, `#askDelivery`).
- `src/lib/interactions/automations.js` owns the mode switch, the cron humanizer, and the "next run"
  clock. It does not validate anything.
- The page promises "a preview you approve, a history you can trust, and logs you can actually read."
  061 owns history/logs; this issue owns the draft and preview.
- The real builder belongs behind auth in the `(app)` shell (038); the marketing page keeps a preview
  and links into it.
- 034 establishes the approval language for agent runs; reuse it for destructive automation steps.

## Scope

- A typed draft model shared by all three modes: trigger/schedule, one or more actions, delivery
  target, timezone, and enabled state. Switching modes preserves compatible values or warns before
  discarding them.
- Validation: required fields, schedule syntax, timezone, action parameters, and delivery target.
  Inline errors with `aria-describedby`, a summary at submit, and focus moved to the first invalid
  field.
- Cron: parse and humanize with the existing helper, show the next 5 occurrences in the workspace
  timezone including a DST transition, and reject impossible/imprecise expressions with a specific
  message.
- Dry-run preview: plain-language summary ("Every day at 17:00, scan /results and post a digest to
  #study-updates"), warnings for actions that write/move/delete files, and an explicit approval step.
- "Approve & schedule" creates a draft/scheduled automation only when the API confirms; show pending,
  success, and server-error states. Never display a scheduled state that was not persisted.
- Unsaved-changes guard when changing tabs or leaving; draft survives a reload if the API supports it.
- Keyboard and screen-reader operable tabs and form; no mode-specific trap.

## Acceptance criteria

- Invalid input blocks the preview and identifies every invalid field, not just the first.
- The next-run list matches the cron expression across a DST boundary in the chosen timezone.
- A destructive action shows a warning and requires explicit approval before save.
- A failed save leaves the form populated and shows a retryable error; no false "Scheduled" state.
- Switching modes does not silently drop entered data.
- No automation executes from the preview; this issue only creates a schedule/draft.
- Works at 360 px with the builder stacked, and keyboard-only end to end.
- Playwright covers invalid cron → error, valid draft → approve → scheduled (mocked API).

## Notes

Depends on 038 and the automations API. 061 implements runs/logs; 034 shares the approval vocabulary.
Do not invent cron capabilities the scheduler does not support.
