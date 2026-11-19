---
title: "Add a security and trust centre page"
priority: Medium
estimate: 5
labels:
  - frontend
  - trust
  - security
project: Spindle Website
status: In Review
---

## Summary

`/infrastructure` explains the request path and privacy posture, but there is no single page a security
reviewer can land on: encryption, access control, backups, incident response, vulnerability disclosure,
and current certifications (or the honest absence of them).

## Context

- `src/app/(site)/infrastructure/page.tsx` (313 lines) already owns the topology animation and the
  "private by design" narrative — reuse it rather than duplicating.
- `src/app/styles/infrastructure.css` holds the page-specific styling.
- No `/security`, `/trust`, or `security.txt` exists; `public/` only contains `assets/`.

## Scope

- Route `src/app/(site)/security/page.tsx` with sections: data encryption in transit and at rest, tenant
  isolation, authentication and session handling, backups and recovery targets, logging and monitoring
  (Sentry), vulnerability management, incident response and notification windows, responsible
  disclosure, status and SLA, and a compliance table (SOC 2 / ISO 27001 marked "planned" or "not yet"
  rather than falsely claimed).
- Publish `public/.well-known/security.txt` with a contact and expiry.
- Add a "Security" link in the footer legal or company column and from `/infrastructure`.
- Link the trust page from the Enterprise plan card.

## Acceptance criteria

- Every claim is verifiable by engineering; unverifiable claims are removed or labelled roadmap.
- `security.txt` is served with `Content-Type: text/plain` and a future `Expires`.
- Page passes the same responsive checks as `/infrastructure`.

## Notes

Coordinate with whoever owns infra — do not publish recovery targets or certification status without
sign-off.

## Comment

Implemented and ready for review.

- Added `/security` (`src/app/(site)/security/page.tsx`) covering the production request path,
  encryption in transit and at rest, tenant isolation, authentication and sessions, logging and
  monitoring, backups and retention, agent and lab boundaries, incident response, vulnerability
  disclosure, compliance, availability, and contacts. Copy is limited to claims already made in the
  Privacy Policy, infrastructure page, agent page, and collaboration page; no recovery targets or
  unearned certifications are published.
- Added `src/app/styles/security.css` for the static request-path diagram and compliance status
  labels, responsive down to 320 px (the diagram stacks below 1080 px; the table of contents
  collapses below 900 px).
- Published `public/.well-known/security.txt` with `security@spindle.example`, a 2027-11-01 expiry,
  and canonical and policy URLs. Verified at runtime: 200 with `Content-Type: text/plain`.
- Linked the trust centre from the footer Company column, the infrastructure guarantee section, and
  the Enterprise plan card on `/pricing`.
- Links use the real `/dpa`, `/cookies`, `/privacy`, and `/terms` routes. The public status page does
  not exist yet (issue 025), so availability points to the footer indicator instead of a dead
  `/status` link.

Verification: `npm run typecheck` and `npm run lint` pass (5 pre-existing warnings, 0 errors);
`npm run build` succeeds and lists `/security` as static; `npm start` serves `/security` with the
expected title and `security.txt` with the `text/plain` content type.

Notes: The compliance table marks SOC 2 Type II and ISO/IEC 27001 as "Not certified" and states that
no reports or badges exist. Recovery point/time targets are intentionally withheld pending
infrastructure sign-off, as the issue requires.
