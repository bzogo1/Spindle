---
title: "Add billing period toggle and plan comparison to /pricing"
priority: Medium
estimate: 5
labels:
  - frontend
  - pricing
project: Spindle Website
status: Todo
---

## Summary

`/pricing` is a two-card page (Hobby $0, Enterprise "talk to us") with a stats grid. It has no billing
period, no feature comparison, and no answer to "what happens at the storage limit?" — the most common
pricing questions.

## Context

- `src/app/(site)/pricing/page.tsx` (67 lines) renders `.stats-grid`, `.plan-cards` with
  `.plan-card--free` and a second `.plan-card`, then `.referral-note`.
- Plan facts live as ad hoc `<ul>` items: 5 GB, 20 agent requests/day, 50 extra by referral.
- `src/app/(site)/docs/page.tsx` describes the free allowance; the FAQ lives on the homepage (`/#faq`)
  using `src/components/ui/accordion.tsx`.

## Scope

- Monthly/annual (or monthly/prepaid) toggle only if a paid self-serve tier exists; otherwise a
  "compare plans" table covering Hobby vs Enterprise with rows for storage, agent requests, lab hours,
  members, SSO, audit logs, SLA, support, and data region — and honest "—" cells.
- Single `plans` config (`src/lib/pricing.ts`) driving card copy, comparison rows, and the stats grid so
  numbers cannot drift between sections.
- FAQ block under the cards: what counts against storage, how agent requests reset, what happens at the
  limit, refunds/cancellation, referral bonus rules. Reuse Accordion.
- Sticky comparison header on desktop; stacked comparison cards on mobile with row labels preserved.
- Keep the referral note, but link it to the referral page instead of `/docs#quickstart`.

## Acceptance criteria

- All numbers on the page come from the config file; no duplicated literals in JSX.
- Comparison table is operable by keyboard, with row/column headers announced.
- Toggle state (if present) is reflected in the URL so a plan link can be shared.
- Enterprise CTA still goes to `/about#contact`.
- No prices are invented — confirm with the pricing owner before launch.

## Notes

Blocks on pricing decisions; the config + table structure can land first with current values.
