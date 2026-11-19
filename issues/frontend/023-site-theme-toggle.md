---
title: "Add a light/dark theme toggle to the marketing site"
priority: Low
estimate: 5
labels:
  - frontend
  - design
project: Spindle Website
status: Todo
---

## Summary

The changelog has a polished light/dark toggle with a pre-paint theme script; the marketing site is
dark-only. Users coming from the changelog hit a jarring switch, and "light mode" is a common request for
docs reading.

## Context

- `src/app/(changelog)/layout.tsx` contains the pre-paint theme script; `src/lib/interactions/changelog.js`
  owns the toggle; `src/app/styles/changelog.css` defines both themes.
- The site palette lives in `src/app/styles/styles.css` (`:root`) and `--ui-*` in
  `src/app/styles/index.css`; `README.md` documents this.
- `src/components/site/site-header.tsx` has no theme control (only auth and "Start free").
- `src/components/ui/` components are reskinned in `src/app/styles/ui.css`.

## Scope

- Define a light theme by overriding tokens (surfaces, text, borders, accent, shadows) rather than
  duplicating rules; every page-specific stylesheet (`pages.css`, `lab.css`, `agent.css`,
  `automations.css`, `collaboration.css`, `infrastructure.css`) must be audited.
- Pre-paint script in `src/app/(site)/layout.tsx` reading stored preference then
  `prefers-color-scheme`, with no flash of wrong theme.
- Toggle in the header (and mobile panel): Sun/Moon icons, `aria-pressed` or a labelled switch, cycles
  System → Light → Dark or toggles with a reset-to-system option.
- Persist choice; keep `themeColor` in the viewport export in sync (currently hardcoded `#0d0f0e`).
- Generate dark assets for any image that only works on dark (planet texture, diagrams, dither fields).

## Acceptance criteria

- No flash of incorrect theme on first paint in either mode.
- Every route passes a contrast check in both themes; the green accent keeps 4.5:1 on text.
- `prefers-color-scheme` respected on first visit, with no stored choice.
- Charts/canvas demos (globe, topology, dither field) remain legible in light mode.
- Changelog and site toggles agree when navigating between them.

## Notes

Bigger than it looks — the hand-written per-page CSS is the bulk of the work. Split into 045 (light
tokens, no-flash script, and the header/mobile toggle) and 046 (audit of every page stylesheet and
canvas demo in light mode). This issue stays open as the definition of done for both themes.
