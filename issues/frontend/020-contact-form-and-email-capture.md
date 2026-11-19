---
title: "Replace mailto contact with a real contact form"
priority: Medium
estimate: 5
labels:
  - frontend
  - website
  - growth
project: Spindle Website
status: Todo
---

## Summary

`/about#contact` currently only offers a `mailto:` link. Enterprise and institution enquiries — the
highest-value traffic on the site — have no form, no routing, and no confirmation.

## Context

- `src/app/(site)/about/page.tsx` has `<section id="contact">` (line ~111) with contact details.
- `/pricing` Enterprise card links to `/about#contact`.
- No `src/app/api/` route exists in the repo (all routes are static), so this introduces the first
  server endpoint — or a hosted form provider.
- `public/assets/` holds static assets only.

## Scope

- Contact form on `/about#contact` (or a dedicated `/contact` page linked from the footer): name, work
  email, institution, role, team size, interest (Hobby / Lab / Institution / Security review), message,
  and a consent checkbox with a policy link.
- Server action or `POST /api/contact`: validation, spam protection (honeypot + rate limit; no visual
  CAPTCHA unless necessary), and delivery to the sales inbox. Do not expose the destination address in
  client code.
- Success state with expected response time; inline errors for invalid fields; network failure state that
  preserves typed input.
- Store nothing sensitive server-side beyond what's needed to deliver the message; log no PII.
- Optional: auto-responder with the security/trust and DPA links for institution enquiries.

## Acceptance criteria

- Form submits without JS disabled (progressive enhancement) or clearly degrades to a mailto fallback.
- Double submission is prevented; button shows a pending state.
- Spam protection blocks obvious bots without blocking keyboard-only users.
- No secrets in the client bundle; endpoint validates on the server and rejects oversized payloads.
- `npm run typecheck`, `npm run lint`, `npm run build` pass; add a focused test for the validation schema.
- Confirmation is announced to screen readers.
