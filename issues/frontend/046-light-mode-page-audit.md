---
title: "Audit every page and canvas demo in light mode"
priority: Low
estimate: 5
labels:
  - frontend
  - design
  - accessibility
project: Spindle Website
status: Todo
---

## Summary

Second slice of 023. Token overrides alone will not make the site usable in light mode: ten
hand-written page stylesheets and several canvas/WebGL demos assume dark surfaces. Audit and fix them
page by page.

## Context

- Page styles: `src/app/styles/pages.css`, `lab.css`, `agent.css`, `automations.css`,
  `collaboration.css`, `infrastructure.css`, `ui.css`, and `changelog.css` (already dual-theme).
- Canvas demos: `src/components/ui/dither-field.tsx`, `src/components/ui/globe.tsx`, and the
  infrastructure topology driven by `src/lib/interactions/infrastructure.js`.
- Product-window previews, code blocks, charts, and the planet/Nym images use colours chosen for dark
  backgrounds.
- 045 provides the tokens and toggle; this issue does not change the token contract unless a token is
  missing.

## Scope

- Page-by-page audit at desktop and 360 px in light mode: `/`, `/platform`, `/solutions`, `/pricing`,
  `/docs`, `/about`, `/lab`, `/automations`, `/agent`, `/infrastructure`, `/collaboration`,
  `/changelog`, plus the header, footer, dialogs, and forms.
- Fix contrast for body text, muted text, borders, buttons, badges, status pills, table rows, code
  blocks, focus rings, disabled controls, and error/success notices.
- Canvas/WebGL: pass theme-aware colours to the dither field and globe, adjust glow/blend modes, and
  ensure the topology trace remains visible. Do not simply hide the demos in light mode — keep the
  information.
- Images and diagrams: add light variants or a neutral backing surface where the asset only works on
  dark. Keep dimensions to avoid layout shift.
- Re-check hover, focus, active, and selected states, not just resting colours.
- Record any deliberate dark-only surface (e.g. a code editor) with a rationale in the PR, and make
  sure its text still meets contrast inside that surface.

## Acceptance criteria

- Every route passes an automated contrast check in light mode; remaining serious violations are
  fixed or filed with a linked issue.
- No text becomes unreadable on hover, focus, disabled, or selected states.
- Canvas demos are legible and do not render a dark rectangle on a light page.
- No layout shift introduced by swapping images or backgrounds.
- Dark mode is unchanged except where a shared fix improves both.
- Screenshots for each route in both modes are attached to the PR for review.

## Notes

Part of 023. Depends on 045. Bulk of the work is the hand-written CSS, not the toggle. Consider
splitting marketing routes from app routes if this grows past the estimate.
