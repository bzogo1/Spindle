---
title: "Add first-run onboarding for a new workspace"
priority: Medium
estimate: 3
labels:
  - frontend
  - app-shell
  - growth
project: Spindle Website
status: Todo
---

## Summary

After creating a workspace, a new user lands in an empty app with no guidance. The marketing site
promises files, lab, search, automations, and chat, but the first session has no path from "empty
workspace" to "first useful result".

## Context

- 036 creates the account/workspace; 037 signs in; 038 provides the app shell and empty pages.
- 047 (files), 040 (invites), 062 (lab), 060 (automations), and 059 (search) give the user something
  to do, but nothing sequences them.
- There is no `/welcome` route, no project-creation flow, and no persisted onboarding state.
- The homepage `#get-started` CTA and pricing CTA both end at workspace creation today.

## Scope

- On first sign-in for a workspace with no projects, route to `/welcome` (inside the app shell) or
  show a dismissible first-run panel on the app overview.
- Step 1: create the first project (name, optional description, template: blank / upload data). This
  must create a real project record, not a demo.
- Checklist after creation: upload a file (047), open the Lab (062), invite a teammate (040), and run
  a search (059). Each item links to the real surface and checks off from real state, not a click.
- Allow "Skip for now" and "Don't show again"; persist the choice server-side so it does not return on
  another device. Provide a way to reopen the checklist from the overview.
- Empty-state copy on Overview should point at the first incomplete step; no fake sample files or
  fabricated activity.
- Announce step completion politely; keyboard operable; works at 360 px.
- Emit one analytics event per completed step through 028 (consent-gated, no content).

## Acceptance criteria

- A brand-new workspace reaches a usable first project in one flow; the project appears in the normal
  project list.
- Checklist state comes from real data (a file exists, a run exists, a member was invited) and
  survives reload and a second device.
- Skipping hides the checklist without blocking any route, and it can be reopened.
- No sample/demo content is created or shown as if it were the user's.
- The flow works with no JS-driven shortcuts: every step is a normal link or form.
- Analytics never receives project names, file names, or query text.
- Playwright covers new workspace → create project → checklist visible → upload checks off (mocked).

## Notes

Depends on 038, 047, 040, and 062. Keep this as orchestration: do not build a second project model or
duplicate the individual empty states.
