---
title: "Add docs sidebar, breadcrumbs, and previous/next navigation"
priority: Medium
estimate: 3
labels:
  - frontend
  - docs
project: Spindle Website
status: Todo
---

## Summary

Second slice of 014. Once guides have URLs, readers need to see where they are and move through them
in order. Today `/docs` has a six-item static aside and no previous/next links at all.

## Context

- 042 provides `src/content/docs/*.mdx` with `section` and `order`, plus `/docs/[slug]`.
- `src/app/(site)/docs/page.tsx` renders `.doc-layout` with an `.doc-toc` aside; `src/app/styles/
pages.css` holds the `.doc-*` rules.
- The docs page is inside the marketing shell, so the sticky header offset matters.
- There is no mobile drawer for docs navigation; the aside simply disappears.

## Scope

- Persistent left sidebar grouped by `section`, sorted by `order`, with the current guide highlighted
  and `aria-current="page"`.
- Breadcrumbs: Docs → section → guide, with the section as plain text if no section index exists.
- Previous/next links computed from reading order within the whole docs set, with titles and a
  "you are here" position. No next link on the last guide.
- Mobile: sidebar becomes a collapsible drawer below 900 px with a labelled trigger, focus handling,
  Escape to close, and focus returned to the trigger. The current page must be visible on open.
- Sticky positioning below the site header without covering content; no layout shift when the
  sidebar scrolls.
- Sidebar and breadcrumbs are server-rendered from the same content source; no duplicated link lists.

## Acceptance criteria

- The sidebar is identical on desktop and in the mobile drawer and always reflects the current guide.
- Keyboard-only navigation reaches every guide from any page; skip link jumps to article content.
- Prev/next order matches the sidebar order and never points at a draft guide.
- At 360 px the content column has no horizontal scroll and the drawer does not trap focus when
  closed.
- No `aria-current` on more than one link.
- `npm run typecheck` and `npm run lint` pass.

## Notes

Part of 014. Depends on 042. 044 adds search and the right-hand on-this-page nav, which shares the
scroll-spy infrastructure.
