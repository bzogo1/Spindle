---
title: "Add DPA and subprocessor list page for institutions"
priority: Medium
estimate: 3
labels:
  - frontend
  - legal
  - enterprise
project: Spindle Website
status: Todo
---

## Summary

Institutions evaluating Spindle ask for a Data Processing Agreement and a subprocessor list. Today
`/solutions#institutions` mentions "central billing and easy onboarding" and `/about#contact` is the only
route to ask, with no downloadable commitment.

## Context

- `src/app/(site)/solutions/page.tsx` has an institutions section.
- `src/app/(site)/pricing/page.tsx` sells an Enterprise plan with "dedicated infrastructure and SLA" but
  no links to contractual documents.
- `src/components/ui/` already has `accordion.tsx`, used for the homepage FAQ.

## Scope

- Route `src/app/(site)/dpa/page.tsx`: plain-language summary, downloadable DPA (PDF) with a stable
  filename, "how to sign" steps, security contact, and an accordion of common questions.
- Single source of truth for subprocessors: `src/lib/legal/subprocessors.ts` exporting name, purpose,
  data categories, and location. Render it on `/dpa` (and later `/privacy`).
- Add "Security & legal" links from `/solutions#institutions` and the Enterprise plan card.
- Print stylesheet so the page is usable as a handout.

## Acceptance criteria

- Subprocessor table is responsive (cards below 640 px, table above) and keyboard-scrollable.
- PDF link has `download` semantics and a visible file size/type.
- Page states a review cadence and "last updated" date.
- No legal text invented by the frontend; placeholders clearly marked until counsel supplies copy.
