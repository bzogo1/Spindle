---
title: "Create the authenticated app shell and workspace navigation"
priority: High
estimate: 5
labels:
  - frontend
  - app-shell
project: Spindle Website
status: Todo
---

## Summary

First slice of 012. Every settings, files, lab, automation, agent, and chat route needs a shared
authenticated frame. Build that frame once instead of letting each page invent its own header and nav.

## Context

- Every current route lives under `src/app/(site)/` and inherits the marketing header/footer.
  There is no `(app)` group and no authenticated layout.
- `src/components/site/providers.tsx` will expose the session from 035.
- `src/components/ui/` already has `dropdown-menu`, `avatar`, `separator`, and `tooltip`, so the shell
  needs no new primitives.
- The marketing shell must stay untouched: `/` through `/changelog` continue to render as today.

## Scope

- New route group `src/app/(app)/` with its own layout: compact top bar (brand, workspace switcher,
  command-menu trigger from 024, account menu from 037) and a left nav.
- Nav items: Overview, Files, Documents, Lab, Automations, Agent, Chat, Members, Usage, Settings.
  Link only to routes that exist; disabled items get a "coming soon" tooltip rather than a dead link.
- Workspace switcher lists the user's workspaces, shows the current one, and navigates to the same
  section in the selected workspace where possible.
- Responsive behavior: nav collapses to a drawer below 900 px, with focus moved into the drawer,
  Escape to close, and focus returned to the trigger. No hover-only navigation.
- Active state from the pathname, `aria-current="page"` on the current item, and a single `h1` per
  page. Add a skip link to main content.
- Loading skeleton for the shell while the session resolves; a route-level error boundary with retry.
- Apply the 037 guard here. Add `noindex` metadata for the whole group and do not render marketing
  footer links inside the app.
- Keep page content in a consistent container so 039–041 and 047–063 do not re-implement spacing.

## Acceptance criteria

- An anonymous visitor to any `(app)` route is redirected to sign-in with a return path.
- The shell renders at 360 px with a usable drawer and no horizontal scroll.
- Nav, switcher, and account menu are keyboard operable and have visible focus.
- Marketing pages are unchanged, including the existing header, footer, and interaction scripts.
- App routes return `noindex` and are excluded from the sitemap (026).
- `npm run typecheck` and `npm run lint` pass.

## Notes

Part of 012. Depends on 035 and 037. 039 (settings), 040 (members), 041 (usage), and the files, shared
documents, lab, automations, agent, and chat issues all hang off this layout.
