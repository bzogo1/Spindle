---
title: "Add a Lighthouse CI budget for the marketing site"
priority: Medium
estimate: 3
labels:
  - frontend
  - performance
  - ci
project: Spindle Website
status: Todo
---

## Summary

No performance budget is enforced. The site ships a WebGL globe, a dither field, an animated topology,
Sentry, and five Google Fonts weights; regressions would go unnoticed.

## Context

- `.github/workflows/ci.yml` runs lint, typecheck, build, then one Playwright test — no perf gate.
- Heavy client deps: `cobe` (globe), `motion`, `@sentry/nextjs`, `lucide-react`.
- Fonts are loaded from Google Fonts `<link>` in `src/app/(site)/layout.tsx`; `next/font` is not used.
- Animated pages: `/lab` (`dither-field.tsx`), `/collaboration` (`globe.tsx`), `/infrastructure`
  (topology trace), homepage hero.

## Scope

- Lighthouse CI config with per-URL assertions: performance ≥ 90, accessibility ≥ 95, best practices ≥ 90,
  SEO ≥ 95 on `/`, `/pricing`, `/docs`, `/lab`, `/collaboration`.
- Budgets: LCP < 2.5 s, CLS < 0.1, TBT < 200 ms (mobile preset), total JS for the homepage hero chunk
  capped at a documented number.
- Run on PRs against `npm run build && npm start`; report a summary and fail on regressions past the
  threshold.
- Verify lazy-loading of below-the-fold islands (`home-islands.tsx`, `lab-islands.tsx`) and `next/dynamic`
  for the WebGL components.
- Document how to run it locally.
- Consider `next/font` for Inter/IBM Plex Mono to remove the render-blocking Google Fonts stylesheet.

## Acceptance criteria

- A deliberately inflated bundle fails the check locally (validate the gate actually works).
- Scores are stable across two consecutive runs on CI (no flaky mobile throttling).
- The report links to the PR and names the failing assertion.
- No thresholds loosened in the same PR that introduces them; raises documented with a reason.
