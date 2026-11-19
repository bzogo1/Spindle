---
title: "Make chat Anonymous mode real and persist message history"
priority: Medium
estimate: 5
labels:
  - frontend
  - chat
  - app
project: Spindle Website
status: Todo
---

## Summary

The homepage and `/collaboration#chat` chat previews have an Anonymous switch wired to local UI state
only. Messages vanish on reload, and "anonymous" changes nothing about what is sent.

## Context

- `src/components/home-islands.tsx` includes a chat island with `Switch` (labeled Anonymous) and a
  composer.
- `src/lib/interactions/site.js` and `src/lib/interactions/collaboration.js` drive the preview chat.
- `README.md` notes chat composers are masked in Sentry replays and that interactions are prototypes.
- `src/app/(site)/collaboration/page.tsx` sells "project channels, optional anonymity".

## Scope

- `/collaboration#chat` becomes a working channel view: channel list, message list with author/time,
  composer with Enter-to-send and Shift+Enter for newline, editing/deleting your own message, and a link
  preview for pasted URLs.
- Anonymous mode must be explicit: an explanatory popover about what anonymity hides (display name shows
  as a stable pseudonym, admins can still moderate), a persistent per-workspace preference, and a visible
  indicator on messages sent anonymously.
- Persistence: fetch recent history, paginate older messages, optimistic send with failure retry, and a
  "new messages" jump-to-bottom control when scrolled up.
- Empty states per channel, unread divider, and a typing indicator only if the backend supports it.
- Composer: @mention autocomplete from members, draft preserved per channel, disabled state when offline.

## Acceptance criteria

- Reloading keeps history; a failed send shows the message with a retry affordance, not silent loss.
- Anonymous messages never render the author's real name, avatar, or email in the DOM or API payload.
- Composer is keyboard-usable, has a visible label, and announces send failure.
- No message content is sent to analytics or Sentry.
- Playwright: send a message, reload, message persists; toggle Anonymous and verify the indicator.
