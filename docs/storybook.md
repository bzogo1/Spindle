# Storybook

Component workshop + design-token documentation for the `src/components/ui/*`
primitives and `src/components/data-grid`. Built with **Storybook 10**
(`@storybook/react-vite`) — the framework is Vite-based rather than
`@storybook/nextjs` because the components are plain React/Radix with no
Next.js runtime dependencies, which keeps the workshop fast and independent of
the app router.

## Commands

```bash
npm run storybook          # dev server on http://localhost:6006
npm run build-storybook    # static build → storybook-static/ (gitignored)
npm run test:storybook     # run every story + play() in headless Chromium
```

`test:storybook` uses `@storybook/addon-vitest` + `@vitest/browser-playwright`
(see `vitest.storybook.config.mts`). It needs Playwright browsers once:

```bash
npx playwright install chromium
```

The first run may print a Vite "new dependencies optimized" warning and need a
re-run; subsequent runs are stable.

## Layout

| Path                                             | Purpose                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `.storybook/main.ts`                             | Story glob (`src/**/*.stories.*`), `@` → `src` Vite alias, a11y + vitest addons                                      |
| `.storybook/preview.tsx`                         | Imports `index.css` + `app.css` + `ui.css` (same cascade as `(app)/layout.tsx`), theme toolbar global, padded layout |
| `.storybook/preview-head.html`                   | Google Fonts (Inter + IBM Plex Mono), matching the app layouts                                                       |
| `vitest.storybook.config.mts`                    | Vitest browser-mode project that executes stories                                                                    |
| `src/components/ui/*.stories.tsx`                | Playground stories (button, card, forms, feedback, overlays, design tokens)                                          |
| `src/components/data-grid/data-grid.stories.tsx` | DataGrid stories                                                                                                     |

## Theming

Token overrides key off a `.dark` class on `<html>` — identical to the app's
pre-paint script (`src/components/app/app-theme.ts`,
`use-app-theme.ts`). The preview registers a **Dark/Light toolbar global**
(default: dark) whose decorator toggles that class, so every story and the
Design Tokens page respond live. There is no separate "provider" to mount;
the class is the whole mechanism.

## Design tokens

Tokens are defined in CSS, not in Storybook, so the docs can never drift:

- `src/app/styles/index.css` — Tailwind v4 theme + shadcn tokens. Raw values
  live in `--ui-*` custom properties on `:root` (dark) and
  `:root:not(.dark)` (light); `@theme inline` maps them to utilities
  (`bg-primary`, `text-muted-foreground`, `rounded-lg`, …). `--ui-radius`
  seeds `--radius-sm/md/lg/xl`.
- `src/app/styles/app.css` — app-shell tokens `--app-*` (surfaces, text,
  accent, `--font`, `--mono`), flipped by `:root.dark`.
- `src/app/styles/ui.css` — reskin rules for `shadcn`-style components.

The **Design Tokens** story (`src/components/ui/design-tokens.stories.tsx`)
reads the live custom properties via `var(--…)`, so swatches always match the
running theme. It covers colors (`--ui-*` and `--app-*`), the spacing scale
(Tailwind v4's `--spacing` base × step), the type scale, font families, and
corner radii.

### Token → Figma workflow

Storybook cannot sync with Figma by itself — that needs a Figma-side plugin.
Recommended setup:

1. **Figma Tokens Studio** (Figma Community plugin) is the de-facto standard:
   it imports/exports token JSON (W3C Design Tokens format or its own) as
   Figma variables, and can run on a schedule or on demand.
2. Keep a small export script (e.g. `scripts/export-design-tokens.mjs`) that
   parses `src/app/styles/index.css` + `app.css` `:root` blocks into the
   plugin's JSON format, so Figma stays a _consumer_ of the CSS source of
   truth — never edit tokens in Figma and expect them to flow back.
3. Naming: mirror the CSS names (`--ui-primary` → `ui/primary`,
   `--app-accent` → `app/accent`) so designers and engineers can grep both
   sides.
4. Light/dark: export both `:root` and `:root:not(.dark)` / `:root.dark`
   blocks as Figma variable modes (or collections) named `dark`/`light`.

## Versioning

Storybook surfaces the package version (`package.json` → `"version"`,
currently `1.0.0`) in the manager UI, and published static builds can be
hosted (e.g. Chromatic, GitHub Pages, or any static host pointed at
`storybook-static/`). Bump `version` at release time; there is no separate
Storybook version file.

## Testing paths

- **Component interactions**: `play` functions in stories (see
  `forms.stories.tsx` → `Switches`) run under `npm run test:storybook` in real
  Chromium — the same assertions work in `@storybook/test-runner` if a
  Storybook-UI-driven runner is preferred later.
- **Accessibility**: `@storybook/addon-a11y` is enabled in `main.ts`; the
  Accessibility panel runs axe on every story automatically.
- **Visual regression**: every story is screenshotted in both dark and light
  themes by the dedicated Playwright suite — see
  `docs/visual-testing.md` (`npm run test:storybook:visual`,
  `playwright.storybook.visual.config.ts`, `e2e/storybook-visual/`). It serves
  the static `storybook-static/` build via `scripts/serve-static.mjs` and
  diffs `iframe.html?id=<story>&viewMode=story&globals=theme:<theme>` frames
  against committed baselines. Page/surface screenshots stay in
  `e2e/visual/` (`npm run test:visual`). Chromatic remains an optional
  cloud-review upgrade on top of this self-contained pipeline.
