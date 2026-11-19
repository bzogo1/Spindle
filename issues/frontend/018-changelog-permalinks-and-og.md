---
title: "Add per-release changelog permalinks and social images"
priority: Low
estimate: 3
labels:
  - frontend
  - changelog
  - seo
project: Spindle Website
status: Todo
---

## Summary

Changelog releases share one URL, have no anchors, and no per-release metadata, so a release cannot be
linked from Slack or Twitter with a useful preview.

## Context

- `src/app/(changelog)/changelog/page.tsx` renders a single page with three `<article>` elements and no
  `id` or `time datetime` attributes.
- `src/app/(changelog)/layout.tsx` sets `title: "Changelog"` only; no description, OG, or canonical.
- There is no `src/app/(changelog)/changelog/[slug]/` route.

## Scope

- Add `id`/`slug` anchors per release and an in-page "link to this release" affordance that copies the
  full URL.
- Either a dedicated `/changelog/[slug]` page per release or stable anchors `#release-2-1` (choose one;
  dedicated pages preferred for sharing, with the index linking out).
- Per-release `metadata`: title `Release X.Y — <name>`, description from the first sentence, canonical
  URL, OG title/description/image.
- Static OG image per release (generate at build time with `ImageResponse` or ship one image per release).
- `<time dateTime="...">` on every date.
- Ensure the theme (light/dark) is preserved when landing on a release permalink.

## Acceptance criteria

- Pasting a release URL into a link preview service shows the correct title, description, and image.
- Canonical URLs point at the permalink, not the index.
- Anchor links scroll with offset so the sticky topbar does not cover the title.
- Invalid slugs 404 rather than redirecting silently.
