# Light-theme audit

Scope: `src/app/styles/*.css` (15 files + `view-transitions.css`), Tailwind/shadcn
token definitions in `index.css`, `src/components/ui|app|auth|dashboard`, and the
`(site)` / `(app)` / `(auth)` route groups. Tracked against
`issues/frontend/046-light-mode-page-audit.md`.

## Theming mechanism (as found)

- `.dark` on `<html>` is the only theme switch. Light = absence of the class
  (`:root:not(.dark)` selectors everywhere).
- `(site)` + `(auth)` layouts inline `SITE_THEME_SCRIPT`
  (`src/components/site/site-theme.ts`): `spindle-site-theme` =
  light | dark | system (default system → `prefers-color-scheme`).
- `(app)` layout inlines its own script: `spindle-app-theme`, defaults to dark,
  `"light"` is the only override. `app-theme.ts` / `use-app-theme.ts` toggle the
  same class.
- `(changelog)` has its own `changelog-theme` key + `cl-*` tokens (already
  dual-theme).
- Token layers:
  - `styles.css` `:root` / `:root:not(.dark)`: marketing tokens `--bg`,
    `--surface*`, `--border*`, `--text*`, `--accent*`, `--mint`, `--amber`,
    `--on-accent`.
  - `index.css` `:root` / `:root:not(.dark)`: shadcn `--ui-*` tokens mapped into
    Tailwind `@theme inline` (`bg-background`, `text-foreground`, `border-border`,
    `ring-ring`, …) with `@custom-variant dark (&:is(.dark *))`.
  - `app.css` `:root` / `:root.dark`: app-shell tokens `--app-*` (light base,
    dark override — note the inverted selector order vs the other files).
  - `automations.css` / `agent.css`: extra `--teal`, `--panel`, `--panel-hover`
    with `:root:not(.dark)` counterparts.
- `ui.css` is shared by `(site)`, `(auth)` **and** `(app)`, but `(app)` never
  loads `styles.css`, so `ui-*` classes there would see undefined `var(--*)`
  tokens. Verified no `ui-*` classes are used inside `(app)` — inert, not a bug.

## Contrast check (WCAG 2.x relative-luminance formula)

Key pairs measured:

| Pair                                              | Ratio                   | Verdict                                                                   |
| ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| dark `--text` #e9ede8 / `--bg` #0d0f0e            | 16.25                   | pass                                                                      |
| dark `--text-muted` #9aa49c / `--bg`              | 7.48                    | pass                                                                      |
| dark `--text-dim` (was #6d766e) / `--bg`          | 4.09                    | **fixed → #7d877e (5.16)**                                                |
| dark `--accent` #c8f083 / `--bg`                  | 14.88                   | pass                                                                      |
| light `--text` #1a201b / `--bg` #f6f7f5           | 15.43                   | pass                                                                      |
| light `--text-muted` #5d6960 / `--bg`             | 5.35                    | pass                                                                      |
| light `--text-dim` (was #7d877e) / `--bg`         | 3.47                    | **fixed → #68736a (4.60)**                                                |
| light `--accent` #4c7a1f / `--bg`                 | 4.75                    | pass (UI/accent)                                                          |
| `--ui-primary-foreground` / `--ui-primary`        | 5.11 light / 14.16 dark | pass                                                                      |
| `text-white` / `--ui-destructive` #c0392b (light) | 5.44                    | pass                                                                      |
| `.auth-error` #eab4a4 / light surfaces            | **1.69–1.82**           | **fixed → #b3261e**                                                       |
| `legal-download-action:hover` ink / `--accent`    | was 3.59                | already fixed by concurrent agent → `var(--ui-primary-foreground)` (5.11) |

Focus rings use `var(--accent)` / `var(--app-accent)` / `var(--ring)` — all flip
per theme and stay ≥3:1 against both backgrounds.

## Issues found & fixed

### `styles.css`

- `--text-dim` failed AA for small text in **both** themes (4.09 dark /
  3.47 light). Swapped values: dark → `#7d877e` (5.16), light → `#68736a` (4.60).
- White-alpha row separators (`border-top: 1px solid rgba(255,255,255,.025)`)
  on `.activity-row`, `.mini-file`, `.notebook-cell`, `.mini-result`,
  `.result-item`, `.trace-row` and `.vscode-breadcrumb` were invisible in
  light mode → routed to `var(--border)`.
- White-alpha hover washes on `.result-item:hover`, `.vscode-tabs
.vscode-tab.is-active`, `.suggestion*` → dark-ink washes / `var(--accent-soft)`.

### `app.css` (bug, both themes)

- `.app-lab-code`, `.app-agent-diff-col pre` used `var(--bg)`, `var(--text)`;
  `.app-lab-terminal` used `var(--accent)`; `.app-diff-line--after` used
  `var(--accent-hover)` — **none of these vars exist in `(app)`** (styles.css is
  not imported there), so declarations were invalid and fell back. Repointed
  to `--app-panel-alt`, `--app-text`, `--app-accent`, `--mint`.

### `auth.css`

- `.auth-error` hardcoded `#eab4a4` (1.7:1 on light) → `#b3261e` in light.
- `.auth-secondary-btn:hover`, `.auth-password-toggle:hover` white-alpha wash →
  `rgba(15,25,18,.05)`.

### `accessibility.css`

- `.a11y-status--open`, `.a11y-content code` white-alpha fills → dark-ink tints.

### `security.css`

- `.security-status--na` chip fill (the `.security-flow li` panel was already
  fixed by a concurrent agent).

### `ui.css` (shared header/nav/pricing primitives)

- `.ui-switch[data-state=unchecked]` track `rgba(255,255,255,.14)` was nearly
  invisible on light → `rgba(15,25,18,.18)`.
- Hover washes on `.ui-nav-trigger`, `.ui-nav-card`, `.ui-btn-quiet` → dark-ink.
- `.ui-nav-card-icon`, `.ui-feature-card`, `.ui-plan-card` white-alpha fills →
  dark-ink tints.

### `pages.css`

- White-alpha fills/hovers on `.doc-nav-link`, `.doc-pager-link`,
  `.doc-index-card`, `.contact-card`, `.doc-drawer-trigger`, `.doc-search-field`,
  `.doc-hero-search`, `.doc-search-clear` → dark-ink equivalents.
  (`.error-reference button:hover` border was already fixed concurrently.)

### `lab.css`

- Inset "well" panels inside the demo windows (`.lab-demo-toolbar`,
  `.lab-notebook`, `.r-console`, `.runner-list`, `.runner-logs`, `.sql-editor`,
  `.canvas-toolbar`, `.graph-expressions`, `.graph-plot`, `.math-body`,
  `.math-result`, `.viz-body`, `.viz-preview`, `.stage-rail`) used
  `rgba(0,0,0,.12–.22)` fills that read as muddy patches behind light-theme
  text → `rgba(15,25,18,.045)`.
- `.canvas-board` dot-grid, `.canvas-lines` strokes (pale greens), `.r-grid`/
  `.r-trend`/`.r-dots` (already partly fixed concurrently) → dark-ink/green
  equivalents.
- `.canvas-note--c` (amber sticky note) needs dark ink `#241a08` in light —
  the shared `--ui-primary-foreground` is white, which fails on `#a86f24`.
- `.graph-slider` track, `.graph-grid`, `.graph-axis`, `.viz-bar` gradient,
  `.viz-table` hairlines, `.math-steps` separators → light equivalents.
- `.lab-tool-link span` `rgba(200,240,131,.55)` → `rgba(76,122,31,.8)`;
  `.stage-window` border → `rgba(76,122,31,.3)`; `.stage-orbit--three` border →
  `var(--border)`.

### `infrastructure.css`

- SVG topology strokes: `.infra-route` (white, invisible), `.infra-route--flow`
  (pale green, ~1.6:1) → `rgba(15,25,18,.16)` / `rgba(76,122,31,.55)`.
- `.infra-seal-ring--inner` white border → `rgba(15,25,18,.12)`.
- `.infra-map-stage` / `.infra-vault-grid` white grid hairlines → dark-ink.
- `.infra-node-icon`, `.infra-defense-card` white-alpha fills → dark-ink.
- (Panel backgrounds `.infra-seal-core`, `.infra-node`, `.infra-vault-core`,
  `.infra-seal-satellite`, `.infra-vault-file`, `.infra-map-toolbar`,
  `.infra-trace`, `.infra-defense-flow span` were already fixed concurrently.)

### `agent.css`

- `.agent-run-progress` track, `.agent-run-row` separator, `.agent-run-footer`,
  `.agent-use-prompt`, `.agent-run-note`, `.allowance-card--*` white/black-alpha
  fills → light tints; `.agent-hero-grid-bg` grid lines → dark-ink;
  `.referral-step` fill → `var(--panel)`.
  (`.agent-float` was already fixed concurrently.)

### `automations.css`

- `.digest-window` pale-green border → `var(--border-strong)`; `.digest-body`
  and `.auto-window::before` pale-green washes → light-green equivalents.
  (The bulk — `.auto-window`, `.floating-note`, `.mode-tabs`, `.field`,
  `.chat-form`, `.cron-*`, `.digest-stat`, `.run-list`, `.clock-strip`,
  `.chat-side`, `.draft-preview`, `.flow-card`, `.next-card`, `.cron-editor`,
  `.terminal-card`, hover washes — was already fixed concurrently.)

### `collaboration.css`

- `.collab-orbit-line--soft` white stroke → `rgba(15,25,18,.12)`.
  (Everything else — floats, chips, chat rail, inputs, pills, nym SVG palette —
  was already fixed concurrently, including attribute-level SVG remaps.)

## Components (`src/components/**`)

- `ui/*` (button, badge, card, input, dialog, toast, table, switch, checkbox,
  tabs, select, …) use semantic tokens (`bg-primary`, `text-foreground`,
  `border-border`, `ring-ring`) with `dark:` variants — dual-theme by
  construction. `toast.tsx` variants carry explicit light+dark palette pairs.
- `text-white` on `bg-destructive` (button/badge): light `#c0392b` → 5.44:1 ✓.
- `app/*`, `auth/*`, `dashboard/*`: no hardcoded hex/rgb or non-semantic
  Tailwind palette classes found (only `dialog` overlay `bg-black/50`, a
  scrim — fine in both themes).
- `dither-field.tsx` already observes `.dark`/`data-theme`/`prefers-color-scheme`
  and re-resolves its ramp; ramps supplied by `lab-islands.tsx` are
  mid-tone greens readable on both.

## Remaining / out of scope

- **`globe.tsx`** always renders `dark: 1` (dark sphere). Reads as a deliberate
  "product visual" on light pages; making it theme-reactive needs a cobe
  `update()` path — left as a follow-up.
- `labRamp` in `lab-islands.tsx` tops out at `#dcf7ab` (very pale) — decorative
  dither, low risk.
- Translucent-white _decorative_ washes at ≤4% alpha that remain in a few page
  CSS files are invisible-but-harmless on light; borders/text all route through
  tokens.
- `.legal-version-*` chip fill and a few `rgba(255,255,255,0.02–0.03)` card
  fills remain as subtle no-ops in light mode (borders still delineate).
- `(app)` viewport/themeColor and `index.css` tokens verified; no changes
  needed there.

## Verification

- WCAG contrast computed programmatically for all token pairs above.
- Brace balance checked on every edited CSS file.
- No TS/TSX files were modified, so no typecheck surface added; CSS-only diff.
- Concurrent agents were actively editing the same files; all edits were
  appended as new `:root:not(.dark)` blocks or token-value swaps to minimize
  collision risk.
