---
title: "Build the usage and plan overview page"
priority: Medium
estimate: 3
labels:
  - frontend
  - app-shell
  - pricing
project: Spindle Website
status: Todo
---

## Summary

Fourth slice of 012. Pricing promises 5 GB storage, 20 agent requests per day, and +50 by referral,
but a signed-in user cannot see any of it. `/settings/usage` is where those promises become visible
and actionable.

## Context

- `src/app/(site)/pricing/page.tsx` hardcodes the allowance numbers; 016 moves them into
  `src/lib/pricing.ts`.
- The homepage file-manager preview uses `src/components/ui/progress.tsx` for a storage meter, so the
  visual pattern exists.
- 019 owns referral attribution; 050 owns the file-storage meter inside `/files`. This page is the
  workspace-level summary.
- No usage API exists yet; the contract is part of the backend dependency in 012.

## Scope

- `/settings/usage`: storage used/total with a progress meter, agent requests used today with reset
  time in the workspace timezone, lab runtime if the API exposes it, and referral bonus credit with a
  link to 019.
- Plan card: current plan, renewal/next reset date, seat count, and a link to `/pricing` for upgrades.
  Enterprise workspaces see "managed by your institution" instead of a self-serve upgrade.
- States: loading skeleton, unknown/unavailable (render "—" with an explanation, not 0%), and a
  fetch error with retry.
- Thresholds: neutral below 80%, warning at 80%, blocking copy at 100% with the action that resolves
  it (delete files, upgrade, wait for reset). Never colour-only.
- No invented forecasts or "days remaining" projections unless the API computes them.
- Link from the footer of every app page? No — link from the usage nav item and the storage meter.

## Acceptance criteria

- Numbers match the API response; a manual refresh reflects a changed value.
- Reset time is rendered in the workspace timezone with the timezone name, not the browser's guess.
- 80% and 100% states are distinguishable without colour and are announced to screen readers.
- Unknown/error states never show a false healthy meter.
- Works at 360 px; the meter and labels stack without overflow.
- `npm run typecheck` and `npm run lint` pass.

## Notes

Part of 012. Depends on 038 and the usage API; 016 is the source of plan copy, 050 owns per-file
storage actions, 019 owns the referral bonus.
