---
title: "Add favicon, app icons, and a web app manifest"
priority: Low
estimate: 2
labels:
  - frontend
  - seo
  - design
project: Spindle Website
status: Todo
---

## Summary

`public/` contains only `assets/`, so `/favicon.ico` 404s and a saved tab or home-screen shortcut has
no Spindle mark. Add the icon set and a manifest instead of relying on the browser's blank page icon.

## Context

- The brand mark is an inline SVG in `src/components/site/site-header.tsx` and `site-footer.tsx`;
  there is no standalone icon file.
- `src/app/(site)/layout.tsx` sets `themeColor: "#0d0f0e"` (045 will make it media-aware);
  `src/app/(changelog)/layout.tsx` already uses a media-query theme colour pair.
- No `icon`, `apple-icon`, `manifest`, or `opengraph-image` file exists in `src/app/` yet (027 owns OG
  images).
- The product is a web app, not an installable offline app; the manifest must not imply offline
  support that does not exist.

## Scope

- `src/app/icon.svg` with the Spindle mark, plus a 32×32 `favicon.ico` fallback if the framework does
  not generate one.
- `src/app/apple-icon.png` (180×180, opaque background) and a 512×512 PNG for the manifest.
- `src/app/manifest.ts` with name, short name, description, `start_url: "/"`, `display:
"browser"` (not `standalone` until there is an app shell), background/theme colours, and 192/512
  icons including a maskable variant with safe padding.
- Confirm the generated `<link rel="icon">` tags on `/` and `/changelog` and that no route 404s for
  `/favicon.ico` or `/icon.svg`.
- Keep the icon legible at 16 px: simplify the mark if the full detail turns to mush.

## Acceptance criteria

- `/favicon.ico`, `/icon.svg`, `/apple-icon.png`, and the manifest all return 200 with correct content
  types in a production build.
- The manifest validates (no missing required fields) and the icons render at 16, 32, 180, and 512 px.
- Installing/saving the site to a home screen shows the mark, not a screenshot or blank square.
- `<meta name="theme-color">` agrees with the active theme in dark and light modes.
- No offline/service-worker claim appears in the manifest.
- No new runtime dependency is added.

## Notes

Coordinate with 045 for theme colours and 027 for the OG image. Source art should come from the brand
owner; do not trace the logo by hand if a vector exists.
