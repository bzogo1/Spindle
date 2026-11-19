---
title: "Add light theme tokens and a no-flash theme script to the site shell"
priority: Medium
estimate: 5
labels:
  - frontend
  - design
project: Spindle Website
status: Todo
---

## Summary

First slice of 023. The changelog already has a working light/dark theme; the marketing site is
dark-only and switches jarringly when navigating from `/changelog`. Add a real light theme at the
token layer and the shell controls, leaving per-page visual fixes to 046.

## Context

- `src/app/(changelog)/layout.tsx` contains the pre-paint script and reads `changelog-theme` from
  `localStorage`; `src/lib/interactions/changelog.js` owns its toggle.
- Site tokens live in `src/app/styles/styles.css` (`:root`) and `--ui-*` in
  `src/app/styles/index.css`; pages import their own stylesheets on top.
- `src/app/(site)/layout.tsx` hardcodes `themeColor: "#0d0f0e"` and has no theme script.
- `src/components/site/site-header.tsx` has no theme control in the desktop header or mobile panel.

## Scope

- Define a light palette by overriding semantic tokens (surface, elevated surface, text, muted text,
  border, accent, focus ring, shadow), not by duplicating per-component rules. Keep the green accent
  at 4.5:1 on text in both modes.
- Add `color-scheme: light dark` and a `.light`/`.dark` root class strategy consistent with the
  changelog.
- Pre-paint script in `src/app/(site)/layout.tsx`: stored preference first, then
  `prefers-color-scheme`, applied before first paint and tolerant of `localStorage` being unavailable.
- Header and mobile-panel toggle: System → Light → Dark cycle with a labelled control, `aria-pressed`
  or an accessible name that states the next action, and persistence. Include a "Use system" option.
- Consolidate the storage key with the changelog where possible so the two roots agree; if a separate
  key is kept, document the mapping and keep both in sync on navigation.
- Update `themeColor` in the viewport export to the media-query form the changelog already uses.
- Keep the default appearance identical to today for users with no preference (dark).

## Acceptance criteria

- No flash of the wrong theme on first paint in either mode, on a cold load and on a hard reload.
- Toggle cycles all three modes, persists, and is operable by keyboard on desktop and mobile.
- With no stored preference, `prefers-color-scheme` decides; changing the OS setting updates the page
  when the mode is "System".
- `themeColor` matches the active background in both modes.
- Changelog and site do not disagree after navigating between them.
- No page-specific stylesheet is edited in this issue.

## Notes

Part of 023. 046 audits every page stylesheet and canvas demo in light mode. Coordinate the inline
script with the CSP work in 051 — it needs a hash or nonce.
