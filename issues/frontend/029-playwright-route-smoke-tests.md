---
title: "Add Playwright smoke tests for every route"
priority: High
estimate: 5
labels:
  - frontend
  - testing
  - ci
project: Spindle Website
status: Todo
---

## Summary

CI builds the site and runs a single test against `/infrastructure`. The other 11 routes — including the
auth dialog, homepage tabs, and changelog interactions — have no automated coverage.

## Context

- `.github/workflows/ci.yml` starts `npm start`, waits for `/infrastructure`, then runs `npm test`.
- `package.json` `test` runs `node .test_infra.mjs`, which reads `INFRA_URL`
  (default `http://127.0.0.1:3000/infrastructure`).
- Interactive behavior is DOM-driven: `src/components/site/site-interactions.tsx`,
  `page-interactions.tsx`, and `src/lib/interactions/*.js`.

## Scope

- Replace the single-file harness with a Playwright project (`tests/`) that starts the server via
  `webServer` config, so `npm test` works locally without a pre-started server.
- Route smoke matrix: `/`, `/platform`, `/solutions`, `/pricing`, `/docs`, `/about`, `/lab`,
  `/automations`, `/agent`, `/infrastructure`, `/collaboration`, `/changelog`.
  For each: 200 response, `h1` present, header/footer links resolve, no console errors, no hydration
  mismatch warnings.
- Interaction specs: desktop + mobile nav open/close, auth dialog open from header, homepage tabs/search
  mode/file preview, automations mode switch, changelog theme toggle.
- Detect dead internal links: crawl every `a[href^="/"]` on each page and assert 200 (hash links resolve
  to an existing `id`).
- Run against the production build in CI; keep a headed mode for local debugging.
- Preserve the existing infrastructure topology assertion rather than deleting it.

## Acceptance criteria

- `npm test` runs the full suite from a clean checkout with no manual server step.
- CI fails on a broken internal link, a missing `h1`, or a console error on any route.
- Suite runs in under ~3 minutes on the CI runner; tests are independent and parallel-safe.
- Mobile viewport coverage for nav and auth dialog.
- `INFRA_URL` compatibility is either kept or the README is updated with the new command.
