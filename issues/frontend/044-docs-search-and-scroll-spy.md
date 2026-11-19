---
title: "Add docs search and a scroll-spy on-this-page nav"
priority: High
estimate: 5
labels:
  - frontend
  - docs
project: Spindle Website
status: In Review
---

## Summary

Third slice of 014. With multiple guides, the six-item "On this page" list and no search make the docs
hard to use. Add a build-time search index and a heading-derived table of contents that tracks
reading position.

## Context

- 042 creates the MDX content source; 043 creates the sidebar layout.
- `src/app/(site)/docs/page.tsx` currently hardcodes the `.doc-toc` items and has no search input.
- Search must stay client-side: the site is statically prerendered and there is no search service for
  docs.
- The header command menu (024) will also consume this index once it exists.

## Scope

- At build time, generate a small JSON/TS index from the MDX: title, description, section, slug,
  headings, and plain-text body. No runtime fetch and no server endpoint.
- Search input in the docs sidebar: filters guides and headings, groups results by guide, highlights
  the match, and supports keyboard Up/Down/Enter/Escape with a labelled combobox/listbox pattern.
- States: empty query (show top guides), no results (with a clear reset), loading only if the index is
  lazy-loaded, and error with a retry if a dynamic import fails.
- Optional `?q=` URL state so a search is shareable, without pushing a history entry per keystroke.
- Right-hand "On this page" nav generated from `h2`/`h3`, with scroll-spy via `IntersectionObserver`
  and an offset that accounts for the sticky header. Active heading gets `aria-current="location"`.
- Heading anchor links with copy affordance, and a "back to top" control.
- Search and TOC are keyboard usable, announce result counts politely, and respect reduced motion when
  scrolling.

## Acceptance criteria

- Every heading in every guide appears in the TOC in document order; clicking scrolls with the title
  fully visible below the header.
- Search returns relevant results for a term that appears only in body text, not just titles.
- No results and empty-query states are distinct and keyboard reachable.
- Search index adds no meaningful first-load bundle weight (lazy-load it, or ship a compact index) and
  builds statically.
- No network request is made when searching.
- Works at 360 px; TOC collapses or moves below the article without duplicating content.
- `npm run typecheck` and `npm run lint` pass.

## Notes

Part of 014. Depends on 042 and 043. Reuse the index shape in 024's command menu rather than building
a second docs crawler.
