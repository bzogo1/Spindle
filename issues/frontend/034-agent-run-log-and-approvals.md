---
title: "Make the agent run preview a real interactive run log"
priority: Medium
estimate: 5
labels:
  - frontend
  - agent
  - app
project: Spindle Website
status: Todo
---

## Summary

`/agent` advertises autonomous runs that "edit files, move them, and run on a schedule", but the page is
a set of static example cards. There is no run view showing what the agent actually did, which is the
main trust requirement for an autonomous tool.

## Context

- `src/app/(site)/agent/page.tsx` (372 lines) renders run previews and examples with
  `src/lib/interactions/agent`-style behavior (agent examples are handled in the interactions bundle).
- `/pricing` and `/docs#guides` reference "20 agent requests per day" and "what the daily request
  allowance covers".
- `src/app/(site)/automations/page.tsx` shares the "agent proposes, you approve" narrative.
- No run, approval, or history routes exist.

## Scope

- Agent run page (in-app or `/agent/run/[id]` demo mode) with a chronological log: plan step, tool call
  (read file / write file / move file / run command), diff preview, and final summary.
- Streaming states: pending, running, waiting for approval, succeeded, failed, cancelled — each with a
  distinct visual treatment and plain-language explanation.
- Approval gates for destructive actions (delete/move outside project) with a diff and an "Allow once /
  Always allow for this project / Deny" control.
- Show remaining daily allowance and what a run consumed; block new runs at the limit with a clear
  message and the referral path.
- Cancel a running task with confirmation and a visible cancelled state.
- Keep the marketing examples on `/agent` but label them as examples and link into the run view.

## Acceptance criteria

- Every state is reachable in the demo and is distinguishable without colour alone.
- Log entries are ordered, timestamped, and readable by a screen reader (`ol` with `aria-live` for new
  entries, throttled).
- Approval is required before any destructive step executes; denying leaves files untouched and records
  the decision.
- No file content or secrets are logged in the marketing page's demo data.
- Playwright: run → approve → success, and run → limit reached.
