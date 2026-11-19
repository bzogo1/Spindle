---
title: "Build a referral landing page and invite link flow"
priority: Medium
estimate: 5
labels:
  - frontend
  - growth
project: Spindle Website
status: Todo
---

## Summary

Pricing promises "+50 agent requests, one time, when they create an account with your link", but there
is no referral page, no link generator, and no landing page to receive a referral.

## Context

- `src/app/(site)/pricing/page.tsx` shows the `.referral-note` and links to `/docs#quickstart`.
- The homepage CTA section (`src/app/(site)/page.tsx`, `#get-started`) is the only signup path.
- No `/referral` or `/r/[code]` route exists.

## Scope

- `/referral` page: how it works, current bonus, your link with a copy button (signed-in), share
  targets (email, copy link), referral status table (pending / joined / credited), and the rules.
- `/r/[code]` landing page: short hero naming the referrer's workspace where allowed, the free
  allowance, and a single "Create free workspace" CTA that carries the code through signup.
- Store the code in a first-party cookie or query param through the auth round-trip; attribute on
  account creation.
- Signed-out visitors on `/referral` see the pitch and a sign-in CTA instead of a broken dashboard.
- Update the pricing referral note to link here.

## Acceptance criteria

- Referral code survives page changes and the auth flow, and is never placed in a third-party referrer.
- Copy button works and announces success; link is also selectable as text.
- Invalid/expired/already-used codes show a friendly state that still allows normal signup.
- Signed-out state never 500s; page is useful without JS.
- Playwright: open referral link → sign up → credited status visible.
