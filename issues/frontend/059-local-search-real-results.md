---
title: "Make the local search preview return real results"
priority: High
estimate: 5
labels:
  - frontend
  - search
  - app
project: Spindle Website
status: Todo
---

## Summary

`/#search` is a headline feature: Academic and Basic modes, a query box, and a button literally
labelled "Run search (preview)". It returns hardcoded demo results. Wire it to the self-hosted search
backend and handle the states a real query produces.

## Context

- `src/app/(site)/page.tsx` `#search` section: `#searchInput`, `#searchGo`, `.segmented` buttons with
  `data-search-mode="academic" | "basic"`, and a static result panel.
- `src/lib/interactions/site.js` owns the preview behavior (mode switch, demo results).
- `/infrastructure` describes a self-hosted SearXNG instance; `/docs#search` and `/platform` describe
  Academic vs Basic modes.
- There is no API route, query client, or result model in the repo. The search contract is the
  backend dependency; do not scrape or call a third-party search API from the browser.
- 028 must not receive query text; searches are private by design.

## Scope

- Search submit (Enter and button) against the agreed endpoint, with the current project/workspace
  context. Trim input, reject empty queries, and abort an in-flight request when a new one starts.
- Results: title, source/domain, year/date when available, snippet with the matched terms emphasised,
  and a safe external link (`rel="noopener noreferrer"`). Deduplicate by URL, keep ranking order.
- Modes: Academic and Basic send the mode to the API and render the shared result shape. If a mode
  returns a different schema, model it explicitly rather than coercing silently.
- States: idle, loading skeleton, results with a count, no results (with query-edit guidance),
  rate-limited (with reset guidance), offline/network error (retry), and a partial-results warning if
  a source fails.
- Keyboard: mode buttons remain a proper group, results are a list with focusable links, and the
  result count is announced via a polite `aria-live` region.
- Privacy: do not put the query in the URL, analytics, Sentry, or logs. Keep a local-only recent-search
  list (last 5, clearable) or omit it; if kept, store it in `localStorage` with a clear action.
- Keep the existing privacy note and make it accurate for the real request path.

## Acceptance criteria

- A real query returns real results from the backend, with no hardcoded fallback data.
- Submitting a second query cancels the first; no stale results replace newer ones.
- Empty, no-results, rate-limited, and error states are distinct and offer a next action.
- Every external link opens safely and shows its destination domain.
- No query text or result content is sent to analytics/Sentry or persisted server-side.
- Works at 360 px and with keyboard only; count changes are announced once per completed search.
- Playwright covers a successful search and a no-results search with a mocked API.

## Notes

Depends on the search API contract and the self-hosted backend. Do not claim "100+ sources" or
invent result metadata the API does not return. 024 is site navigation search, not this.
