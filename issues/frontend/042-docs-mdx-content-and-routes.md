---
title: "Move docs guides into MDX with per-guide routes"
priority: High
estimate: 5
labels:
  - frontend
  - docs
project: Spindle Website
status: Todo
---

## Summary

First slice of 014. Content is currently hand-written JSX inside one page, so no guide can have its
own URL, metadata, or owner. Move the content into a typed source and give every guide a route before
building navigation around it.

## Context

- `src/app/(site)/docs/page.tsx` is a single page with `.doc-content` sections `#quickstart`,
  `#workspaces`, `#lab`, `#search`, `#automations`, and `#guides`.
- Header, footer, `/pricing`, and `/docs` itself link to `/docs#quickstart` and `/docs#guides`.
- No markdown/MDX tooling exists in the repo; `package.json` has no content pipeline.
- 015 (code blocks) and 043–044 (navigation/search) depend on this content source.

## Scope

- Choose and document one MDX pipeline (`@next/mdx` or a small frontmatter loader with a typed schema);
  do not hand-roll a parser.
- `src/content/docs/*.mdx` with frontmatter: `title`, `description`, `section`, `order`, `updated`,
  and optional `draft`. Validate frontmatter at build time and fail on missing/duplicate order.
- `/docs` becomes the index (still containing quickstart or a short landing section) and
  `/docs/[slug]` renders each guide. Use `generateStaticParams` and per-guide `metadata`.
- Migrate all six existing sections into guides without losing content. Keep `/docs` links that
  currently point at hashes working (see the note below).
- Add a guide not-found state that keeps the docs shell and links to the index.
- Keep the existing `.doc-*` styles; this issue changes where content lives, not how it looks.
- Navigation, sidebar, breadcrumbs, prev/next, search, and scroll-spy are explicitly out of scope.

## Acceptance criteria

- Every guide has its own URL, unique title/description, and is statically prerendered.
- Unknown slugs return a 404 with a docs-specific not-found page, not a blank route.
- `/docs#quickstart` and `/docs#guides` still land on the intended content. Because fragments never
  reach the server, handle this in the `/docs` client entry by mapping known hashes to routes or
  scrolling to a matching anchor; no redirect loop.
- Build fails with a readable error if frontmatter is invalid or two guides share an order.
- No content is duplicated between the index and the guide pages.
- `npm run typecheck`, `npm run lint`, and `npm run build` pass.

## Notes

Part of 014. 043 adds the sidebar/prev-next, 044 adds search and the on-this-page nav, 015 adds code
block affordances. Coordinate copy with whoever writes docs; this issue moves existing copy only.
