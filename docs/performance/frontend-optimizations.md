# Frontend performance notes

## Bundle strategy (checklist: chunk splitting, dynamic imports, tree shaking)

- **Per-route code splitting** is provided by the App Router; heavy page
  sections live in their own chunks.
- **`cobe` (WebGL globe)** is loaded with a dynamic `import()` inside
  `src/components/ui/globe.tsx` and only fetched once the canvas scrolls near
  the viewport (IntersectionObserver, 200px root margin). The `motion`
  dependency was removed entirely — drag rotation uses a small exponential
  lerp inside cobe's `onRender`.
- **`shiki`/TextMate** must stay server-side; `npm run check:client-bundle`
  (postbuild) fails the build if Shiki markers leak into `.next/static`.
- **Bundle analysis**: `npm run analyze` performs a webpack build with
  `@next/bundle-analyzer` and `scripts/bundle-report.mjs` writes
  `docs/performance/bundle-report.md` (per-route top modules + duplicate
  package detection).
- Icons use named `lucide-react` imports (tree-shaken); avoid `import * as`
  from large packages in client components.

## Critical CSS

- `src/lib/critical-css.ts` exports `SITE_CRITICAL_CSS`, inlined in the
  `(site)` layout `<head>`: tokens (dark + light), base resets, skip link,
  header, buttons, hero and page-hero chrome — everything in the initial
  viewport.
- `styles.css` + `auth.css` are **not** render-blocking for `(site)` routes:
  `src/components/site/deferred-styles-loader.tsx` loads them through
  `next/dynamic(..., { ssr: false })`, so they arrive as an async chunk right
  after hydration. Keep `critical-css.ts` in sync with `styles.css` tokens
  and above-fold selectors when editing either file.
- `pages.css` remains per-route render-blocking CSS (imported by each page).

## PWA

- `public/manifest.webmanifest`, `public/sw.js` (+ testable core in
  `public/pwa/sw-core.js`), `public/offline.html`, push helpers in
  `src/lib/pwa/`, registration + update prompt + install prompt under
  `src/components/pwa/`.

## Storybook

- `npm run storybook` (dev, port 6006), `npm run build-storybook` (CI gate).
- Config: `.storybook/main.ts` (react-vite, `@` alias), `.storybook/preview.tsx`
  (imports `index.css` design tokens; Dark/Light toolbar toggles `.dark` on
  `<html>`).
- Stories live next to components as `src/**/*.stories.tsx`; the
  `Design Tokens` story renders live `--ui-*` swatches.
