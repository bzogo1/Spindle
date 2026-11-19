---
title: "Audit reduced motion and keyboard access across animated pages"
priority: Medium
estimate: 5
labels:
  - frontend
  - accessibility
project: Spindle Website
status: Todo
---

## Summary

`README.md` claims "All motion respects `prefers-reduced-motion`" and that internal links are plain
anchors. Neither is verified. The heaviest pages (dither fields, globe, topology trace, lab demos) need a
real audit, not a claim.

## Context

- `src/components/ui/dither-field.tsx` (canvas/WebGL), `src/components/ui/globe.tsx` (`cobe`),
  `src/app/(site)/infrastructure/page.tsx` trace driven by `src/lib/interactions/infrastructure.js`.
- `src/app/(site)/lab/page.tsx` and `src/app/styles/lab.css` hold lab demo animations.
- `src/app/styles/styles.css` defines the motion tokens; grep for `prefers-reduced-motion` to see what is
  actually covered.
- Mobile nav toggle is a DOM script (`#menuToggle`, `#mobileNav`) in `src/lib/interactions/site.js`.

## Scope

- Audit every animation: entry transitions, marquees, the topology trace, the dither field, the globe's
  auto-rotation, hover transforms, and the lab demos.
- Under `prefers-reduced-motion: reduce`: stop continuous animation loops (not just CSS transitions),
  freeze the globe, render a static topology, and keep all information available.
- Keyboard pass on every route: skip link, visible focus, logical tab order, no keyboard traps in nav
  dropdowns, dialogs, tabs, and the changelog accordions.
- Fix the mobile menu: focus moves into the panel on open, Escape closes it, focus returns to the toggle,
  `aria-expanded` stays accurate after route changes (currently only a class is toggled).
- Add landmarks and a single `h1` per page; check heading order on `/`, `/lab`, `/collaboration`.
- Run axe (or equivalent) in the Playwright suite for the main routes and record remaining violations.

## Acceptance criteria

- `prefers-reduced-motion` verified in Chromium and Firefox: no continuous canvas/rAF animation.
- Every interactive control reachable and operable with keyboard only, on desktop and at 390 px.
- Mobile nav passes the focus/Escape/aria checks; no orphaned open state after navigation.
- Zero serious/critical axe violations on the audited routes, or each remaining one has a linked issue.
- Findings recorded in the accessibility statement's "known limitations".
