---
title: "Design and ship transactional email templates"
priority: Medium
estimate: 3
labels:
  - frontend
  - email
  - auth
  - design
project: Spindle Website
status: Todo
---

## Summary

Auth verification, password reset, team invites, contact auto-replies, and newsletter double opt-in
all require email, but there is no template source, no preview, and no plain-text fallback anywhere in
the repo. The screens in 011/013/021 cannot be completed without this.

## Context

- No email code or dependency exists in `package.json`; 011 explicitly scopes email sending out.
- The product uses a dark graphite + green brand; emails must still be readable in light and dark
  clients without relying on background images.
- 013 masks the invite field in Sentry replays, and 002 promises no tracking in email; templates must
  not include pixels or link-wrapping trackers.
- Provider selection is part of the backend work; this issue owns template source and rendering, not
  deliverability.

## Scope

- `src/emails/` templates with a shared layout (brand mark, 600 px max width, plain background,
  readable fallback stack, footer with legal/privacy links):
  - verify email address (expiry, resend guidance, "if this wasn't you" line);
  - reset password (single-use expiry, no password in the email);
  - team invitation (workspace, inviter, role, accept link, expiry, ignore instructions);
  - contact-form auto-reply (what happens next, response window, security/DPA links);
  - newsletter double opt-in confirmation and a one-click unsubscribe footer.
- Every template returns `{ subject, html, text }`. Plain text is a first-class rendering, not a
  stripped tag soup.
- Use absolute URLs from the configured site origin (052); include the token only in the link, never
  in copy, subject, or a query string that logs.
- No remote images, no tracking pixel, no third-party link wrapping. Buttons must be real links and
  readable when images are blocked.
- Dev-only preview route or script to render all templates with sample data; excluded from production
  routes and search indexing.
- Copy approved by whoever owns product/legal; placeholders clearly marked until then.

## Acceptance criteria

- Each template renders valid HTML and a complete plain-text version with the same information.
- Links work with images blocked, in a narrow mobile client, and in dark mode (no dark-on-dark text).
- Expiry and security copy is present and matches the flow's actual behavior.
- No tracking pixel, remote font, or remote image is present.
- A token containing quotes or angle brackets is escaped correctly in HTML and text.
- Preview output can be generated without sending email.
- `npm run typecheck` and `npm run lint` pass; rendering tests use 057's harness.

## Notes

Consumers: 011 (verify/reset), 013 (invite), 020 (auto-reply), 021 (newsletter). Provider integration
and unsubscribe state live with those flows; do not hardcode a vendor in the templates.
