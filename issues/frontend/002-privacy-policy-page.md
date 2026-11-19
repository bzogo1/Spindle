---
title: "Add Privacy Policy page at /privacy"
priority: High
estimate: 3
labels:
  - frontend
  - legal
  - website
project: Spindle Website
status: Todo
---

## Summary

Add a privacy policy that matches what the product actually does: project-scoped storage, a
self-hosted SearXNG instance, session replays aggressively masked in Sentry, and anonymous team chat.

## Context

- `src/app/(site)/infrastructure/page.tsx` makes specific privacy claims ("privacy-first", TLS to
  storage) that currently have no policy backing them.
- Sentry is configured in `src/sentry.server.config.ts`, `src/sentry.edge.config.ts`, and
  `src/instrumentation-client.ts`. `README.md` documents aggressive masking of text, media, search box,
  chat composers, invite field, and auth dialog.
- The footer has no privacy link, and the sign-in dialog has no policy reference.

## Scope

- Route `src/app/(site)/privacy/page.tsx`, reusing the legal layout from the Terms issue.
- Sections: what we collect (account, workspace content, usage, diagnostics), what we do **not** collect,
  cookies and analytics, subprocessors (link to `/dpa`), Sentry error and replay handling, data
  retention and deletion, storage location, international transfers, your rights, children, contact and
  complaint route.
- Add a plain-language summary box at the top ("the short version").
- Table of subprocessors generated from one data file so it stays in sync with `/dpa`.

## Acceptance criteria

- `/privacy` prerendered, in the sitemap, linked from footer and auth dialog.
- Subprocessor table and retention periods match the DPA page exactly.
- No claims that contradict the current build (e.g. don't describe a data export feature that doesn't exist;
  mark roadmap items as such or omit them).

## Notes

Depends on legal review. Do not copy a generic SaaS policy without reconciling the Sentry replay and
SearXNG details.
