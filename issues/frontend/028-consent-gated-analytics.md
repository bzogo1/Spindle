---
title: "Add consent-gated product analytics"
priority: Medium
estimate: 5
labels:
  - frontend
  - analytics
  - privacy
project: Spindle Website
status: Todo
---

## Summary

There is no product analytics at all: no way to know which CTA, docs page, or pricing card converts. Add
privacy-respecting, consent-gated analytics rather than dropping a tracker in the root layout.

## Context

- `src/components/site/providers.tsx` wraps all site pages — the only sensible mount point.
- `src/app/(site)/layout.tsx` and `src/app/(changelog)/layout.tsx` are separate roots; analytics must
  cover both if the changelog is tracked.
- Consent UI is proposed in the cookie-consent issue; this depends on it.
- Sentry is already initialised (error monitoring only), and `README.md` documents aggressive masking.

## Scope

- Event schema in `src/lib/analytics.ts`: page view, CTA click (with `location`), pricing plan click,
  docs guide view, search-open, sign-in open (with tab), signup success, contact submit, referral visit,
  changelog view.
- Analytics module no-ops until `consent.analytics` is true; listens for consent changes and starts
  immediately on opt-in.
- Cookieless or first-party-cookie mode preferred; no cross-site identifiers, no ad networks, no session
  recording (Sentry Replay already exists and is masked).
- Respect Do Not Track / Global Privacy Control where feasible.
- Document the event list in the repo for whoever reads the dashboard.
- Do not send free-text fields, emails, tokens, or workspace content.

## Acceptance criteria

- Zero analytics requests before consent; verified in the network tab on a fresh profile.
- No PII in any event payload; event names match the documented schema.
- Opting out stops collection without a reload.
- Analytics failure never blocks rendering or navigation.
- Typecheck/lint pass; a unit test covers the no-consent no-op.
