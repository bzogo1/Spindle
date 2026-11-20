# Container queries migration

Layout-level responsive rules in the authenticated app (`src/app/styles/app.css`)
now use CSS container queries instead of viewport media queries, so grids respond
to the space actually available to content rather than the window width.

## Containers

| Container     | Element                                     | Named | Purpose                                      |
| ------------- | ------------------------------------------- | ----- | -------------------------------------------- |
| `app-main`    | `.app-body-col` (column beside the sidebar) | yes   | Width of the main column after the sidebar   |
| `app-content` | `.app-content` (`<main>`)                   | yes   | Width available to page content (max 1200px) |

Every app page renders inside `.app-content`, so `@container app-content (...)`
rules track real content width — e.g. the dashboard collapses its columns when
the sidebar is expanded even on a wide viewport.

## What was converted

- Dashboard/project/stat/chat/agent grid collapses (`@container app-content`, 1100px / 640px)
- Toolbar, search/sort fields, project actions, chat composer, file/run rows (640px)
- Two-pane screen layouts: files, chat, lab split pane, agent diff grid (`@container app-content`, 900px)
- `.app-content` padding (`@container app-main`, 640px) and `.app-page-head h1` (`@container app-content`, 640px)
- `.app-quick-actions` grid (`@container app-content`, 640px)
- Files list grids and column hiding: `.fm-columns`/`.fm-row` (900px),
  `.app-fm-columns`/`.app-fm-row`, `.app-col-*`, `.fm-type`/`.fm-owner`/`.fm-date`/`.fm-size` (640px)
- `.app-agent-step`, `.app-chat-input-row`, `.app-chat-message`, `.fm-list`/`.fm-breadcrumb`/
  `.fm-toolbar`/`.fm-upload-queue`/`.fm-storage`/`.fm-preview` spacing (640px)
- `.app-stream-row` grid + hidden cells, `.app-recovery-codes`, `.uq-item`,
  `.app-lab-cols` (900px), `.app-lab-detail-meta` (640px)

## What intentionally stays on viewport media queries

- **App chrome**: `.app-shell` grid columns, `.app-sidebar` show/hide, `.app-drawer-trigger`,
  topbar compaction (900px / 640px blocks near the top of `app.css`). The sidebar is
  fixed navigation — its visibility is a viewport concern, and querying it against a
  container it helps size would risk a layout feedback loop.
- **Portaled overlays and dialog-scoped rules**: `.app-dialog`,
  `[data-slot="dialog-content"]`, bulkbars, `.app-form-grid` (shared with the
  portaled New Automation dialog), `.fm-details-grid`/`.fm-version` (file preview
  drawer) — Radix portals render outside `.app-content`, so container queries
  cannot reach them; viewport media is correct there.
- **Leaf components that only make sense at viewport scale**: invite lists,
  project rows, run-log step details keep their existing `@media` rules.
- **Marketing site** (`styles.css`, `ui.css`): fixed header/nav and landing sections
  are genuinely viewport-dependent.

## Safari < 16 fallback

Container queries require Safari 16. The `@supports not (container-type: inline-size)`
block at the end of `app.css` re-declares the converted rules as viewport `@media`
queries, preserving the pre-migration behavior on older engines. Browsers that
support container queries skip the block entirely. Remove it once the supported-
browser floor passes Safari 16.

Note: `container-type` also establishes an independent formatting context. Modern
browsers (Chrome ≥129, Firefox, Safari) no longer treat the container as the
containing block for absolutely positioned descendants; older engines may, so
leaf components should keep positioning contexts explicit (`position: relative`
on the intended parent) inside `.app-content`.

## Test matrix

Run against the mock-auth app shell (`NEXT_PUBLIC_MOCK_AUTH=1`) on `/dashboard`,
`/projects`, a project detail page (tabs + files/chat layouts), and `/app/settings`.

| Browser | Versions                                                            | Themes      | Widths to check      |
| ------- | ------------------------------------------------------------------- | ----------- | -------------------- |
| Chrome  | latest, latest-1                                                    | light, dark | 1440, 1024, 768, 390 |
| Firefox | latest, latest-1                                                    | light, dark | 1440, 1024, 768, 390 |
| Safari  | latest (26.x), 17.x, **16.0** (fallback path), 15.x (fallback path) | light, dark | 1440, 1024, 768, 390 |
| Edge    | latest                                                              | light, dark | 1440, 768, 390       |

Widths are viewport px; the interesting cases are where viewport and content width
diverge — e.g. 1280px viewport with the sidebar expanded leaves ~950px of content,
which must already show collapsed grids.

### Assertions per cell

- Sidebar visible ≥900px viewport, drawer trigger + hidden sidebar <900px.
- Dashboard `.app-dashboard-columns` / `.app-stat-grid` / `.app-project-grid` collapse
  at the container breakpoints, not the viewport ones (verify by toggling the sidebar
  collapse at a fixed viewport width).
- Project tabs remain horizontally scrollable, never clipped.
- No horizontal overflow (`document.scrollingElement.scrollWidth <= innerWidth`).
- Dialogs, dropdowns, toasts still portal and position correctly.
- On Safari 15.x / `@supports` fallback: identical collapse behavior via viewport media.

### Suggested e2e stub

```ts
// e2e/container-queries.spec.ts (stub — implement with the app's auth fixture)
import { expect, test } from "playwright/test"

for (const width of [1440, 1024, 768, 390]) {
  test(`dashboard grids respond to content width @ ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/dashboard")
    // sidebar collapse toggles content width without changing viewport
    await page.getByRole("button", { name: /collapse sidebar/i }).click()
    await expect(page.locator(".app-dashboard-columns")).toBeVisible()
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
  })
}
```
