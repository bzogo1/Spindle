---
title: "Add the signed-in account menu, sign-out, and protected-route handling"
priority: High
estimate: 5
labels:
  - frontend
  - auth
  - app-shell
project: Spindle Website
status: Todo
---

## Summary

Third slice of 009. After sign-in succeeds there is still no signed-in UI: the header keeps showing
"Sign in", sign-out does not exist, and an authenticated route cannot know whether to redirect. Build
that shell before the app pages in 038–041.

## Context

- `src/components/site/site-header.tsx` always renders `AuthDialog` and the "Start free" CTA.
- `src/components/site/site-nav.tsx` owns desktop and mobile navigation; any account entry must appear
  in both.
- No `(app)` route group exists yet, so there is no place to enforce authentication.
- `src/components/ui/dropdown-menu.tsx` and `avatar.tsx` are already installed and reskinned.

## Scope

- Header account menu (desktop dropdown, mobile panel section): workspace name and switcher, links to
  settings/members/usage (038–041), and "Sign out". Show the user's name/email and avatar fallback.
- Replace "Sign in" with the account menu only when `status === "authenticated"`; reserve the space so
  the header does not shift while the session resolves.
- Sign-out: call the client, clear client caches, redirect to the current public page or `/`, and
  restore the signed-in trigger. Broadcast sign-out to other tabs so they do not keep a stale menu.
- Safe return-path helper: accept only same-origin relative paths, reject protocol-relative and
  absolute URLs, preserve query/hash, and fall back to `/`. Use it from 036, 013, and 019.
- Route protection for the future `(app)` group: redirect anonymous visitors to the sign-in dialog
  with the requested path as the return path; handle an expired session on navigation by reopening the
  dialog instead of showing a broken page.
- Route header "Start free" and pricing CTAs into the dialog with the create tab preselected, replacing
  the `/#get-started` scroll for signed-out users.

## Acceptance criteria

- Signed-in header state persists across route changes and hard reloads, and never flashes for
  anonymous visitors.
- Sign-out works from desktop and mobile, clears the session, and is reflected in a second open tab.
- A protected deep link survives sign-in and lands on the requested page; `//evil.com` and
  `https://evil.com` return paths are rejected.
- Account menu is fully keyboard operable, has a labelled trigger, and closes on Escape with focus
  returned.
- No workspace data is rendered for an anonymous visitor.
- `npm run typecheck`, `npm run lint`, and the auth Playwright spec pass.

## Notes

Depends on 035; 036 supplies the successful sign-in. 038 uses the guard for the `(app)` layout. Still
part of the 009 definition of done.
