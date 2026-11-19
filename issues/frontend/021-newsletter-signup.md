---
title: "Add newsletter signup with double opt-in"
priority: Low
estimate: 3
labels:
  - frontend
  - growth
  - privacy
project: Spindle Website
status: Todo
---

## Summary

There is no way to hear about releases except checking `/changelog`. A footer/blog signup is the
smallest growth surface the site is missing, and it must be double opt-in to match the privacy posture.

## Context

- `src/components/site/site-footer.tsx` has brand, four link columns, and the bottom row — no form.
- `/changelog` is the natural content source to announce.
- The cookie/privacy story is handled in the consent and privacy issues; this must not add tracking
  pixels before consent.

## Scope

- Footer signup: email field + "Subscribe" button, one line of copy ("Release notes, roughly monthly").
- Inline validation, pending state, success ("Check your inbox to confirm"), already-subscribed, and
  error states.
- Server endpoint or hosted provider integration with double opt-in, confirmation page, and one-click
  unsubscribe.
- Consent text with a privacy policy link; do not pre-check consent.
- Link from the changelog page as well ("Get new releases by email").
- Keep the form out of pages where it would compete with the primary CTA (agent, lab) — decide placement
  and document it.

## Acceptance criteria

- Unconfirmed addresses are not added to the mailing list.
- Success and failure states are accessible and survive a reload without duplicate submits.
- No third-party tracking script loads before consent.
- Email address is not sent to analytics or placed in the URL.
- Footer layout still fits at 320 px with the form present.
