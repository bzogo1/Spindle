---
title: "Add copy buttons and syntax highlighting to docs code blocks"
priority: Medium
estimate: 3
labels:
  - frontend
  - docs
project: Spindle Website
status: Todo
---

## Summary

The docs show a project tree and a cron example in `.code-card` blocks with no copy affordance and no
syntax highlighting. Users copy these by hand; the changelog already has a copy pattern to reuse.

## Context

- `src/app/(site)/docs/page.tsx` contains two `<pre>` blocks inside `.code-card` with `.code-card-head`
  / `.code-card-foot` labels.
- `src/app/(changelog)/changelog/page.tsx` renders `.cl-code` with a `.cl-code-copy` button, but only
  some blocks have it and the handler lives in `src/lib/interactions/changelog.js`.
- `src/lib/interactions/` holds the DOM-driven behaviors; `src/components/site/page-interactions.tsx`
  lazy-loads a route's script.

## Scope

- `CodeBlock` component (client) taking `code`, `language`, optional `title`, `meta`, and `filename`.
- Copy button with "Copy" → "Copied" confirmation, `aria-live` feedback, and a timeout reset.
- Graceful failure when the clipboard API is unavailable (select the text and prompt manual copy).
- Lightweight highlighting for the languages the docs use (bash, cron, text/tree). Prefer a small
  local tokenizer over a full editor dependency.
- Preserve whitespace exactly; horizontal scroll inside the block on narrow screens instead of wrapping.
- Use it in `/docs`, `/automations`, and other pages that hand-roll `<pre>`.

## Acceptance criteria

- Copy works with keyboard only and announces success.
- Copied text matches the rendered text exactly (no zero-width characters, no trailing newline surprises).
- Highlighting adds no layout shift and respects the dark palette in `src/app/styles/styles.css`.
- No new heavy dependency; bundle impact is noted in the PR.
