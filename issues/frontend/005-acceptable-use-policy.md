---
title: "Add Acceptable Use Policy page at /acceptable-use"
priority: Medium
estimate: 2
labels:
  - frontend
  - legal
  - website
project: Spindle Website
status: In Review
---

## Summary

The agent "runs autonomously" and automations can execute cron jobs against project files. That needs an
Acceptable Use Policy covering prohibited automation, scraping, and shared-resource abuse.

## Context

- `src/app/(site)/agent/page.tsx` advertises autonomous runs.
- `src/app/(site)/automations/page.tsx` advertises raw cron entry.
- `src/app/(site)/infrastructure/page.tsx` advertises shared, self-hosted search infrastructure —
  abuse of which has real cost.

## Scope

- Route `src/app/(site)/acceptable-use/page.tsx` on the shared legal layout.
- Sections: prohibited content, prohibited automation (crypto mining, outbound spam, credential
  stuffing, circumventing allowances), search and scraping limits, shared infrastructure fairness,
  agent and automation responsibilities, enforcement and suspension, reporting abuse, appeals.
- Cross-link from Terms, footer legal column, and the automations page (short note near the cron editor
  preview explaining that automations run under the AUP).
- Include a "report abuse" mail link with a `mailto:` subject prefilled.

## Acceptance criteria

- Page prerendered and in the sitemap.
- Links from Terms and footer resolve.
- Copy reviewed by legal; enforcement wording matches what support can actually do today.

## Comment

Implemented and ready for review.

- Added `/acceptable-use` (`src/app/(site)/acceptable-use/page.tsx`) rendering
  `src/content/legal/acceptable-use.ts` on the shared legal layout. The route is statically
  prerendered and has a sticky table of contents, version, and effective date.
- Covered prohibited content, prohibited activity (unauthorised access, malware, harness, sandbox
  and quota bypass), search/scraping and resale, shared-infrastructure fairness, automations and
  agent responsibilities, enforcement (warning, throttling, feature limits, suspension,
  termination), reporting, appeals, and changes.
- Linked from Terms, the footer, the automations cron studio, the lab CTA, the agent guardrails
  section, and the security trust centre. `/security` now lists `abuse@spindle.example` in Incident
  response and Contact.
- Reporting uses `abuse@spindle.example` (abuse) and `security@spindle.example` (vulnerabilities)
  with prefilled `mailto:` subjects, plus acknowledgement expectations.

Verification: `npm run typecheck` passes; `npm run lint` passes with 5 pre-existing warnings and 0
errors; `npm run build` lists `/acceptable-use` as static; the production server serves the expected
page and the AUP link appears on `/`, `/terms`, `/automations`, `/lab`, `/agent`, and `/security`.

Notes: There is no sitemap route in the project yet (issue 026), so the page cannot be listed in one
until that lands. Monitoring the abuse inbox is an operational responsibility.
