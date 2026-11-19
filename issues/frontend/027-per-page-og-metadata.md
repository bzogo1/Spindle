---
title: "Add per-page Open Graph metadata and share images"
priority: Medium
estimate: 3
labels:
  - frontend
  - seo
  - design
project: Spindle Website
status: Todo
---

## Summary

Most routes set only `title` and `description`. There is no OG image, no Twitter card, and no social
preview for the homepage, docs, lab, or pricing, so every share renders as a bare link.

## Context

- Metadata exports exist in `src/app/(site)/*/page.tsx`, e.g. `pricing/page.tsx` and `docs/page.tsx`
  define title + description only.
- `src/app/(changelog)/changelog/page.tsx` sets `title: "Changelog"` with no description.
- Brand assets live only as inline SVG in `src/components/site/site-header.tsx` and
  `src/components/site/site-footer.tsx`; `public/assets/` has product imagery but no social card.
- No `opengraph-image`/`twitter-image` files exist.

## Scope

- Static `src/app/opengraph-image.png` (1200×630) plus per-section OG images for Home, Platform, Lab,
  Automations, Agent, Infrastructure, Collaboration, Pricing, Docs, About, Changelog.
- Metadata helper (`src/lib/seo.ts`) to avoid copy-pasting `openGraph`/`twitter` blocks across 12 pages.
- Give every page a unique title, description, and OG title/description — including `/changelog` and the
  legal pages.
- Fix the homepage title pattern so it is not just the root default on every route.
- Ensure `metadataBase` is set before OG images resolve (see sitemap issue).
- Alt text on generated images and a readable fallback at small sizes.

## Acceptance criteria

- Every public route has `og:title`, `og:description`, `og:image`, `twitter:card=summary_large_image`.
- Images render correctly in a link-preview debugger for home, pricing, docs, and a changelog release.
- No two pages share an identical title/description pair.
- Text in the images is legible at 300 px wide; no text baked into a photo.
- Metadata is statically generated at build (no runtime font fetch failures).
