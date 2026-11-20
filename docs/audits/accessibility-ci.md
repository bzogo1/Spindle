# Accessibility CI — axe coverage, how to run, triage

This document covers the **automated** accessibility gates: the axe-core
Playwright specs and the GitHub Actions workflow that runs them. For the
manual/semantic audit (focus management, ARIA patterns, live regions, known
remaining issues) see `accessibility.md` in this directory; for colour
contrast see `light-theme.md`.

## What runs where

| Suite                         | File(s)                                                                            | Routes covered                                                                                                                                                                                                                                                                                                                                                                                    | Server                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Marketing axe (existing)      | `e2e/a11y.spec.ts` (`npm run test:e2e:a11y`)                                       | `/`, `/pricing`, `/docs`, `/lab`, `/collaboration`, `/infrastructure`, `/accessibility`                                                                                                                                                                                                                                                                                                           | Production build (`PLAYWRIGHT_BASE_URL`) in `ci.yml` build-and-test job; dev server locally |
| App-shell axe (existing)      | `e2e/app-a11y.spec.ts`                                                             | `/dashboard`, `/projects`, project files/lab/chat/agent, `/app/settings`                                                                                                                                                                                                                                                                                                                          | Mock-auth dev server in `ci.yml` e2e job                                                    |
| **Extended public axe (new)** | `e2e/a11y/public-routes.spec.ts`                                                   | 16 `(site)`/`(changelog)` routes (`/about`, `/platform`, `/solutions`, `/agent`, `/automations`, `/security`, `/contact`, legal pages, `/unsubscribe`, `/changelog`, `/docs/quickstart`, `/r/SPN-ABCD-EFGH`), four `(auth)` pages (`/sign-in`, `/sign-up`, `/reset-password`, `/verify-email` — `/magic-link`, `/oauth/callback` and `/reset-password/[token]` are not covered), and the 404 page | Production build in `.github/workflows/a11y.yml`                                            |
| **Extended app axe (new)**    | `e2e/a11y/app-routes.spec.ts`                                                      | `/app/chat`, `/app/agent`, `/app/account`, `/app/account/notifications`, `/app/automations`, `/app/cohorts`, `/app/feedback`, `/app/files`, `/app/lab`, `/app/nps`, `/app/profile`, `/dashboard/members`, `/dashboard/notifications`, `/dashboard/usage`, project home/activity/settings for `prj_01`                                                                                             | Mock-auth dev server in `a11y.yml`                                                          |
| **Keyboard/landmarks (new)**  | `e2e/a11y/keyboard.spec.ts` (public) + app-shell tests inside `app-routes.spec.ts` | Skip-to-content links (site `#top`, changelog/auth/app `#main-content`) and banner/main/contentinfo landmark presence                                                                                                                                                                                                                                                                             | Same split as above                                                                         |

Every axe scan uses `@axe-core/playwright` with the
`wcag2a, wcag2aa, wcag21a, wcag21aa` tag set and **fails on `serious` or
`critical` violations only**. `moderate`/`minor` findings are printed to the
test log (`[axe <path>] N moderate/minor finding(s): …`) so regressions are
visible without blocking CI.

## CI workflow

`.github/workflows/a11y.yml` ("Accessibility") runs on pushes to `main`, on
PRs that touch `src/**`, `e2e/a11y/**`, `e2e/visual/visual-helpers.ts`,
`content/**`, `package.json`, `package-lock.json`, or the workflow itself,
and on `workflow_dispatch`. It has two jobs:

- **`a11y-public`** — `npm run build`, `npm start`, then
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test
e2e/a11y/public-routes.spec.ts e2e/a11y/keyboard.spec.ts`. Mirrors the
  Lighthouse/production-build convention: public routes need no mock auth.
- **`a11y-app`** — `npx playwright test e2e/a11y/app-routes.spec.ts` with
  `PLAYWRIGHT_BASE_URL` unset, so `playwright.config.ts` boots its own dev
  server with `NEXT_PUBLIC_MOCK_AUTH=1`. The mock-session cookie is planted
  by `signInToMockApp` (`e2e/visual/visual-helpers.ts`) and the in-memory
  mock API serves deterministic data — no database or backend required.

Both jobs upload `test-results/` and `playwright-report/` as artifacts on
failure (14-day retention).

## Running locally

```bash
# Everything under e2e/a11y/ — boots the mock-auth dev server automatically
# (PLAYWRIGHT_BASE_URL unset). First hit on each route compiles lazily.
npx playwright test e2e/a11y/

# Public-only specs against a production build (matches CI):
npm run build && npm start &
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
  npx playwright test e2e/a11y/public-routes.spec.ts e2e/a11y/keyboard.spec.ts

# Just list what would run (no server needed):
npx playwright test e2e/a11y/ --list
```

Note: `package.json`'s `test:e2e:a11y` script still points at the original
`e2e/a11y.spec.ts` only; the `e2e/a11y/` directory is intentionally invoked
by path (as `ci.yml` already does for other specs) so no package.json change
was needed.

## Triage guide

When a spec fails, the assertion message prints each blocking violation's
rule id, impact, help text, and up to three failing node targets with
`failureSummary`.

1. **Check whether it is a known carve-out.** All four axe specs exclude
   `color-contrast` (`KNOWN_ISSUE_RULES`) because decorative product-window
   mockups embed low-contrast pairs that need a dedicated design pass —
   see `issues/frontend/031-reduced-motion-keyboard-audit.md` and the
   comments in each spec. New contrast findings on _real_ UI will not be
   caught until that rule is re-enabled per route; treat contrast work as
   tracked by the light-theme audit, not this gate.
2. **New serious/critical violation on a route that used to pass** — a
   real regression. The node target + `failureSummary` identifies the
   element; fix the markup/component, do not add the rule to
   `KNOWN_ISSUE_RULES`.
3. **Pre-existing violation discovered on a newly added route** (this
   suite's first runs may surface some) — triage like any audit finding:
   fix in `src/`, or if it needs a design pass, add the rule id to that
   spec's `KNOWN_ISSUE_RULES` with a dated comment linking the tracking
   issue, exactly as `color-contrast` is handled today.
4. **`moderate`/`minor` findings** never fail the build; they are logged
   per route. Use them as a backlog signal — recurring ids across routes
   usually indicate a shared component (`src/components/ui/*`) problem.
5. **Flaky-looking failures** — app routes compile lazily on the dev server
   and the mock adapter adds latency; specs already allow 90 s per test and
   `CI` gives one retry via `playwright.config.ts`. If a route consistently
   times out, check whether it client-side redirects (e.g. `/app` →
   `/dashboard`) and drop it from the route list rather than raising
   timeouts further.

When you fix a known issue, remove its entry from `KNOWN_ISSUE_RULES` in
the relevant spec(s) so the gate tightens automatically.
