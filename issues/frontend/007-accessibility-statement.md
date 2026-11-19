---
title: "Add an accessibility statement page"
priority: Low
estimate: 2
labels:
  - frontend
  - accessibility
  - legal
project: Spindle Website
status: Todo
---

## Summary

The marketing site animates heavily (dither fields, globes, topology traces) and has a custom navigation
menu. Publish an accessibility statement with the conformance target, known gaps, and a feedback route.

## Context

- Motion is used in `src/components/ui/dither-field.tsx`, `src/components/ui/globe.tsx`, and the
  infrastructure trace; `README.md` claims all motion respects `prefers-reduced-motion`.
- Navigation is Radix-based in `src/components/ui/navigation-menu.tsx`, with a hand-rolled mobile panel
  in `src/components/site/site-nav.tsx`.
- No `/accessibility` route; footer has no accessibility link.

## Scope

- Route `src/app/(site)/accessibility/page.tsx`: commitment, target level (WCAG 2.2 AA), what has been
  tested and how, known limitations (list them honestly — e.g. canvas/WebGL previews, animated demos),
  alternative ways to get the same information, feedback contact, and review date.
- Footer legal column link.
- Add a short "Accessibility" line to `/docs` or `/about` if the footer runs out of room.

## Acceptance criteria

- Statement does not claim full conformance before an audit exists.
- Feedback contact is monitored and stated response time is realistic.
- Page itself passes keyboard and screen-reader checks in the same pass as the audit issue.
