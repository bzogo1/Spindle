---
title: "Audit responsive layout from 320 px to 1440 px"
priority: Medium
estimate: 3
labels:
  - frontend
  - design
  - accessibility
project: Spindle Website
status: Todo
---

## Summary

Several issues mention "readable at 360 px", but no issue owns the global responsive check. The site
has dense product windows, a five-column footer, comparison tables, a lab toolbar, and long code
blocks — all likely to overflow somewhere between 320 and 1440 px.

## Context

- Layout rules are spread across `src/app/styles/styles.css`, `pages.css`, and one stylesheet per
  special page (`lab.css`, `agent.css`, `automations.css`, `collaboration.css`,
  `infrastructure.css`).
- `src/components/site/site-footer.tsx` renders four link columns plus a brand block;
  008 adds a fifth legal column.
- The lab toolbar (`.lab-toolbar` in `src/app/(site)/lab/page.tsx`) is a horizontal strip of eight
  tools; the automations studio and infrastructure topology use fixed-aspect product windows.
- 016 adds a comparison table, 029 adds Playwright route coverage, 031 covers keyboard/motion.
- No viewport-specific test exists today; `README.md` claims responsive behavior without evidence.

## Scope

- Audit at 320, 360, 390, 768, 1024, 1280, and 1440 px (portrait and landscape where relevant) across
  all 12 marketing routes plus docs guides and the app shell from 038.
- Fix horizontal overflow at the source; do not add `overflow-x: hidden` to `body` as a blanket fix.
- Check: header nav and mobile panel, hero grids, product-window previews, lab toolbar (horizontal
  scroll needs a visible affordance and keyboard access), pricing cards and comparison table, docs
  layout, footer legal column, forms and dialogs, changelog media, and code blocks.
- Touch targets at least 44×44 px for primary controls on mobile; no hover-only actions; no text
  smaller than 14 px for body copy.
- Verify 200% zoom at 1280 px and landscape phone height (forms and dialogs must remain usable).
- Produce a short matrix in the PR listing each route and viewport with pass/fix notes.

## Acceptance criteria

- No route scrolls horizontally at any listed width (verify `scrollWidth <= clientWidth` on
  `document.documentElement`, not by eye alone).
- Footer, comparison table, lab toolbar, and code blocks have deliberate narrow-screen behavior
  (stack, scroll with affordance, or collapse) rather than clipped content.
- Dialogs fit inside the viewport with the keyboard open at 390 px and keep their submit action
  reachable.
- All primary actions meet the 44 px target and remain reachable by keyboard.
- No content is lost when the viewport narrows (nothing `display: none` that is the only copy).
- Once 029 lands, add the viewport matrix to the Playwright suite.

## Notes

This is layout verification, not a redesign. 031 covers keyboard and reduced motion; 046 covers light
mode. Keep fixes scoped to breakage found in the audit and list anything deferred.
