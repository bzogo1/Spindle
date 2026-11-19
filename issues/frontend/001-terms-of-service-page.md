---
title: "Add Terms of Service page at /terms"
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

Ship a real Terms of Service page and link it from the footer and the auth dialog. The site currently
promises a free workspace ("5 GB free. No credit card.") without any terms behind it.

## Context

- `src/components/site/site-footer.tsx` has Product / Workspace / Resources / Company columns. There is
  no legal column and no Terms link anywhere.
- `src/components/site/auth-dialog.tsx` submits a preview form with no consent copy or policy links.
- Routes live in `src/app/(site)/<route>/page.tsx` with their own `metadata` export.

## Scope

- New route `src/app/(site)/terms/page.tsx` with `title: "Terms of Service — Spindle"` and a description.
- Shared long-form legal layout (prose column, sticky "on this page" nav, last-updated date, contact
  block) that the privacy policy can reuse.
- Sections at minimum: acceptance, accounts and workspace ownership, acceptable use (link to AUP),
  storage and agent request allowances, paid/institution plans, content ownership and licence,
  availability and support, termination, disclaimers and liability, governing law, changes to terms.
- Show an effective date and a "previous versions" note.
- Footer: add a `Legal` column linking Terms, Privacy, Cookies, DPA, AUP, Accessibility.
- Auth dialog: add "By continuing you agree to the Terms of Service and Privacy Policy" with links.

## Acceptance criteria

- `/terms` is statically prerendered and appears in the sitemap.
- Every legal link resolves (no `#` placeholders).
- Readable at 360 px wide; document order and headings are logical (`h1` then `h2`s).
- Copy is reviewed by whoever owns legal; no invented company address or registration numbers.

## Notes

Legal copy must be supplied or approved by the company, not authored from scratch by the frontend.
Blocked on that review, but layout and linking can ship first.
