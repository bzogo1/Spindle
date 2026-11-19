---
title: "Replace placeholder changelog content with real releases and RSS"
priority: Medium
estimate: 5
labels:
  - frontend
  - changelog
project: Spindle Website
status: In Review
---

## Summary

The changelog is copied from another product's demo: three releases dated May–June 2025, "Kimi K2
support", "AIAgent" code samples, and empty accordions. It misrepresents Spindle and cannot be
subscribed to.

## Context

- `src/app/(changelog)/changelog/page.tsx` hardcodes three `.cl-release` articles, including
  `/assets/changelog/demo.mp4` and an empty Features/Bug Fixes accordion (`hidden` with no content).
- `src/app/styles/changelog.css` and `src/lib/interactions/changelog.js` own the theme toggle, accordions,
  and copy button.
- The footer links to `/changelog`, and `/docs` references it as "What shipped and what changed".

## Scope

- Content source for releases (typed array in `src/lib/changelog.ts` or MDX files with `date`, `version`,
  `title`, `tags`, `body`). Ship 3–5 real Spindle entries based on what has actually shipped.
- Render entries from data: date, version, title, tags, body (rich text/markdown), optional media.
- Remove the dead accordions or populate them from structured `features` / `fixes` data.
- RSS/Atom feed at `/changelog/feed.xml` (or `/feed.xml`) built from the same source, linked with
  `<link rel="alternate" type="application/rss+xml">` in the changelog layout.
- Empty-state and single-entry behavior.
- Copy for each release should match actual product history — no feature names from other products.

## Acceptance criteria

- No reference to Kimi K2, other vendors, or placeholder dates remains.
- Feed validates as RSS 2.0/Atom, includes permalinks, and updates from the same data.
- Accordions are either real content or gone; no `hidden` empty panels.
- Images/video below the fold are lazy-loaded; media has dimensions to avoid layout shift.
- `npm run build` prerenders the changelog and the feed with no dynamic server requirement.

## Notes

Coordinate with product on real release dates before publishing. If none are ready, ship one "Initial
release" entry rather than fake history.

## Comment

Implemented and ready for review.

- Added `src/lib/changelog.ts` as the single typed content source. It ships one honest "Spindle 1.0"
  initial-release entry based on the product that exists today, as the Notes section allows; no
  third-party or placeholder release history was invented.
- Rebuilt `/changelog` to render releases from that data: date/version/title/tags, structured rich
  body, optional lazily loaded media with intrinsic dimensions, a stable `#release-1-0` anchor, and
  an empty state for when there are no entries.
- Removed the empty Features/Bug Fixes accordions and their interaction code; the copied code-block
  sample and media are gone too.
- Added a statically generated RSS 2.0 feed at `/changelog/feed.xml` from the same data, with
  per-release links, `guid`, `pubDate`, descriptions, and categories. The changelog layout advertises
  it with `<link rel="alternate" type="application/rss+xml">`.
- Updated the changelog stylesheet and README, and documented `NEXT_PUBLIC_SITE_URL` in
  `.env.example` for absolute feed links (defaults to `https://spindle.app`).

Verification: `npm run typecheck` and `npm run build` pass. The build prerenders `/changelog` and
`/changelog/feed.xml` as static routes, and the generated feed parses as valid RSS with the required
item fields. ESLint reports no errors (one pre-existing unused `Sentry` import warning in the
changelog layout).
