---
title: "Give /docs real navigation, search, and multi-page structure"
priority: High
estimate: 8
labels:
  - frontend
  - docs
project: Spindle Website
status: Todo
---

## Summary

`/docs` is one 102-line page with six inline sections and a six-item "On this page" list. It has no
search, no previous/next, and no per-page URLs, so nothing can be linked to or maintained.

## Context

- `src/app/(site)/docs/page.tsx` renders `.doc-layout` with an `.doc-toc` aside and `.doc-content`
  sections: `#quickstart`, `#workspaces`, `#lab`, `#search`, `#automations`, `#guides`.
- Nav and footer both link to `/docs#quickstart` and `/docs#guides`.
- `src/app/styles/pages.css` contains `.doc-*` styles.
- No markdown/content pipeline exists in the repo; pages are hand-written TSX.

## Scope

- Move guide content into a typed content source (MDX or a `src/content/docs/*.mdx` folder with a loader)
  so a page is data, not layout.
- Route structure: `/docs` (index), `/docs/[slug]` for each guide, with breadcrumbs.
- Persistent left sidebar grouped by section (Getting started, Workspace, Lab, Search, Automations,
  Reference), current-page highlight, and a collapsible mobile drawer.
- Right-hand "On this page" nav generated from headings, with scroll-spy.
- Previous/next footer links in reading order.
- Sticky search box that filters the sidebar and jumps to matching guides (client-side over the content
  index; no backend required).
- Keep existing anchor URLs working: `/docs#quickstart` should scroll or redirect to `/docs/quickstart`.

## Acceptance criteria

- Every guide has its own URL and `metadata` title/description.
- Old anchors `/docs#quickstart` and `/docs#guides` resolve without 404 and land on the right content.
- Sidebar and scroll-spy work with keyboard; current item has `aria-current="page"`.
- Content pages are statically prerendered.
- Search returns results with a keyboard-selectable list and a no-results state.

## Notes

`src/app/(site)/docs/page.tsx` can keep owning the layout while content moves out. Coordinate with whoever
writes docs copy — this issue builds the shell.

Decomposed into 042 (MDX content source and per-guide routes), 043 (sidebar, breadcrumbs,
previous/next), and 044 (search and scroll-spy). 015 remains the code-block follow-up. This issue
stays open as the definition of done for the docs experience.
