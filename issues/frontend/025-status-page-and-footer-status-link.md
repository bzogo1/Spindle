---
title: "Add a status page and link the footer status indicator"
priority: Low
estimate: 3
labels:
  - frontend
  - trust
  - website
project: Spindle Website
status: Todo
---

## Summary

The footer permanently claims "All systems operational" with a green dot. That is a hardcoded assertion,
not a status, and it links nowhere. Replace it with a real status source and a status page.

## Context

- `src/components/site/site-footer.tsx`, `.footer-bottom`:
  `<span className="system-status"><i></i> All systems operational</span>`.
- `/infrastructure` describes the request path and is the closest existing "system" content.
- No `/status` route exists and the site has no external status service wired up.

## Scope

- `/status` page listing components (App, Lab sessions, Search, Agent, Automations, Chat, API) with
  current state, 90-day uptime bars, and incident history.
- Data source: either a hosted status provider embed/API or a static JSON built at deploy time. Pick one
  and document the refresh path; do not hardcode "operational" in multiple places.
- Footer indicator becomes a link to `/status` with text derived from the current aggregate state
  ("All systems operational" / "Partial outage" / "Degraded performance"), dot colour changing with
  state.
- Degraded and outage states need copy and colours that pass contrast.
- Add `/status` to the footer legal/company column and to the sitemap.

## Acceptance criteria

- Footer text and colour reflect the fetched state; unknown state renders a neutral "Status unknown"
  rather than a false green.
- Status page loads without JS for the static summary; uptime bars have text equivalents.
- No client secret or provider token in the bundle.
- Page remains readable at 360 px; bars do not overflow.
- Document the incident-update process in the page or a linked runbook.
