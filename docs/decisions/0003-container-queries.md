# ADR 0003 — Container queries for app layout responsiveness

- **Status:** Accepted
- **Date:** 2026-11-19
- **Issues:** layout responsiveness migration

## Decision

Layout-level responsive rules in `src/app/styles/app.css` use named CSS container
queries (`app-main` on `.app-body-col`, `app-content` on `.app-content`) instead of
viewport media queries, so dashboard/project/chat/files grids respond to the width
a page actually gets after the sidebar — not the window width.

Viewport `@media` rules are kept for app chrome (sidebar/drawer/topbar), portaled
overlays (dialogs, bulkbars), leaf components owned by screen-level work, and the
marketing site.

## Safari < 16 fallback

Container queries need Safari 16. A consolidated
`@supports not (container-type: inline-size)` block at the end of `app.css`
re-declares the converted rules as viewport media queries — the pre-migration
behavior — for older engines. See `docs/container-queries.md` for the test matrix
and removal criteria.
