---
title: "Add cookie policy and a consent banner for non-essential cookies"
priority: High
estimate: 5
labels:
  - frontend
  - legal
  - privacy
project: Spindle Website
status: Todo
---

## Summary

The site sets no essential cookies today beyond what Next.js and Sentry do, but the moment analytics or
marketing tags land they must be gated. Ship a small, honest consent banner plus a cookie policy page so
consent is actually recorded before anything non-essential runs.

## Context

- No consent UI exists in `src/components/site/` (shell is `site-header.tsx`, `site-footer.tsx`,
  `providers.tsx`, `site-interactions.tsx`).
- `src/components/site/providers.tsx` is the natural mount point — it already wraps every site page.
- `src/sentry.server.config.ts` / `src/instrumentation-client.ts` initialise Sentry unconditionally.
- There is no `/cookies` route.

## Scope

- `src/components/site/cookie-consent.tsx`: bottom banner with "Accept all", "Essential only", and a
  link to settings; persists choice (cookie or `localStorage`) and exposes it via a context/hook so
  analytics can check `consent.analytics === true` before initialising.
- Settings dialog grouping cookies into Essential / Analytics / Diagnostics, with individual toggles and
  a "Save choices" action. Re-openable from a footer "Cookie settings" link.
- Route `src/app/(site)/cookies/page.tsx` listing each cookie/localStorage key, its purpose, provider,
  and lifetime, generated from the same config the banner uses.
- No banner on `/changelog` (separate layout) unless it also loads analytics — decide and document.

## Acceptance criteria

- Banner does not block the page, is keyboard operable, and traps no focus when closed.
- Choice survives reload; changing settings re-applies without a full reload.
- Nothing non-essential loads before consent (verify in DevTools network tab).
- Banner respects `prefers-reduced-motion` if animated.
- Cookie table and actual keys agree — add a unit test over the shared config.

## Notes

Keep the design restrained and Linear-like; do not use a modal overlay that hides the hero on first load.
