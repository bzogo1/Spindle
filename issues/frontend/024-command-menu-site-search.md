---
title: "Add a command-menu (⌘K) search across pages and docs"
priority: Low
estimate: 5
labels:
  - frontend
  - navigation
project: Spindle Website
status: Todo
---

## Summary

The header navigation has 22 links across five dropdowns. There is no quick way to reach a page, section,
or doc by typing, and the mobile panel is a long scroll.

## Context

- All navigation data lives in `src/components/site/site-nav.tsx` (`productLinks`, `solutionLinks`,
  `resourceLinks`, `companyLinks`) plus the direct Pricing link.
- `src/components/ui/` has no command/dialog primitive beyond `dialog.tsx`.
- Search entry points exist only inside product previews (homepage local search demo, `/lab`).

## Scope

- ⌘K / Ctrl-K command menu with: page navigation (derived from the nav config, one source of truth),
  in-page sections (from a small index), docs guides (from the docs content source once that exists), and
  quick actions (Sign in / Create workspace / Theme toggle / Contact).
- Keyboard: open, arrow navigation, Enter to go, Escape to close, focus restoration.
- Header trigger with a visible ⌘K hint on desktop and a search icon on mobile.
- Fuzzy matching with result grouping and a highlighted match; empty-query shows top pages.
- Announce open/close and result counts via `aria-live`; mark as `role="dialog"` with a proper label.
- No external search service; the index is static and small.

## Acceptance criteria

- Works on every site route, including pages that currently mount their own interaction scripts.
- No duplicate results for the same destination; hash links land on the right section.
- Mobile: full-screen sheet, no keyboard-obscuring layout, close button reachable.
- `prefers-reduced-motion` respected for the open/close animation.
- Adds no meaningful bundle weight to the initial page (lazy-load the menu).
