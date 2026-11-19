---
title: "Add sitemap, robots.txt, and canonical URLs"
priority: High
estimate: 2
labels:
  - frontend
  - seo
project: Spindle Website
status: Todo
---

## Summary

The site has no `sitemap.xml`, no `robots.txt`, and no canonical URLs. `/changelog` duplicates marketing
content under a second root layout, and hashed sections (`/docs#quickstart`, `/#platform`) are the
primary navigation targets, so search engines see a thin set of duplicate-ish URLs.

## Context

- `src/app/(site)/*` and `src/app/(changelog)/changelog/page.tsx`; no `sitemap.ts` or `robots.ts` exists
  anywhere in `src/app/`.
- Metadata is per page via `export const metadata`; none sets `alternates.canonical`.
- `src/app/(site)/layout.tsx` sets the root title/description but no `metadataBase`.
- `public/` contains only `assets/`.

## Scope

- `src/app/sitemap.ts` enumerating every public route with `lastModified`, `changeFrequency`, and
  `priority`; include changelog release permalinks once they exist, exclude auth/token routes.
- `src/app/robots.ts` allowing the marketing site and docs, disallowing `/invite/*`, `/reset-password/*`,
  `/verify-email/*`, and app routes; reference the sitemap.
- Add `metadataBase` to both layouts using an env-configurable production origin (no hardcoded localhost).
- Canonical URL on every page; `/changelog` gets its own canonical, not the homepage.
- Consistent trailing-slash policy across nav, footer, and canonicals.
- Set `alternates.types` for the changelog RSS feed once available.

## Acceptance criteria

- `/sitemap.xml` and `/robots.txt` return 200 with correct content types in `npm run build && npm start`.
- Sitemap contains no 404s and no private routes; validated against the file's route list.
- Canonical tags are absolute URLs on the production origin, matching the sitemap entries.
- Auth/token routes are `noindex` in addition to the robots disallow.
- No preview/staging origin leaks into production metadata.
