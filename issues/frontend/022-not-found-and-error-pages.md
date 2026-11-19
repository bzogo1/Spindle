---
title: "Add branded 404 and route error pages"
priority: Medium
estimate: 2
labels:
  - frontend
  - website
project: Spindle Website
status: Todo
---

## Summary

The site has no `not-found.tsx` anywhere and no per-route `error.tsx`. Bad links render Next's default
page without the header, footer, or a way back, and a client error in a preview leaves a blank page.

## Context

- `src/app/global-error.tsx` exists (Sentry-aware) but is the last-resort boundary only.
- Route folders: `src/app/(site)/*` (12 routes) and `src/app/(changelog)/`.
- `src/app/(site)/layout.tsx` supplies header/footer; a 404 inside the group can reuse them.

## Scope

- `src/app/(site)/not-found.tsx`: 404 heading, one sentence, links to Home, Docs, Changelog, and a search
  entry point, plus the sign-in CTA. Keep the site shell.
- `src/app/(site)/error.tsx` (client) with reset button and a "copy error reference" affordance that does
  not leak stack traces; report to Sentry via the existing config.
- Changelog-scoped `not-found`/`error` that keeps the changelog theme toggle and "Back to Spindle" link.
- Root `not-found.tsx` for URLs outside both groups.
- Verify status code is 404 (not 200) for unknown paths.

## Acceptance criteria

- Unknown URL returns HTTP 404 and shows the branded page with working navigation.
- Error page offers "Try again" and "Back to home"; retry actually re-renders.
- No internal error detail or stack trace visible in production.
- Pages pass the keyboard and contrast checks; no layout shift on load.
