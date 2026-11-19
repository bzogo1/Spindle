---
title: "Add legal footer column with company details and policy links"
priority: High
estimate: 2
labels:
  - frontend
  - legal
  - website
project: Spindle Website
status: Todo
---

## Summary

The footer ends at "© 2026 Spindle Labs. Built for curious people." with no legal links, no company
registration details, and no way to reach a privacy contact. Add a legal block without breaking the
existing four-column rhythm.

## Context

`src/components/site/site-footer.tsx` renders `.footer-links` with four `.footer-col` blocks
(Product, Workspace, Resources, Company), then `.footer-bottom` with the copyright and the
"All systems operational" status text.

## Scope

- Add a fifth `Legal` column (or a legal row under `.footer-bottom`, whichever holds the grid at
  1280/1024/768 px) linking: Terms, Privacy, Cookies, Cookie settings (opens consent dialog), DPA,
  Acceptable use, Accessibility, Security.
- Replace the bare status text with a link to the status page (see the status-page issue).
- Add legal entity line: registered name, registered address, company number, VAT/registration where
  applicable, and a `privacy@` / `legal@` contact. Supplied by the company, not invented.
- Update `src/app/styles/styles.css` footer rules so the new column wraps correctly and the columns stay
  left-aligned on mobile; no horizontal scrolling at 320 px.

## Acceptance criteria

- All legal links resolve to real routes (blocked by the respective page issues — this issue can land with
  the links once routes exist).
- Footer remains readable at 320/768/1024/1440 px with no overflow.
- Entity details are exact and approved; no placeholder text left in `main`.
- `npm run typecheck` and `npm run lint` pass.

## Notes

Depends on: Terms, Privacy, Cookies, DPA, AUP, Accessibility, Security page issues.
