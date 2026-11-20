import { defineConfig, devices } from "playwright/test"

/**
 * Visual regression config. Separate from playwright.config.ts so the e2e
 * suite keeps its own server/env; this one always boots the dev server with
 * NEXT_PUBLIC_MOCK_AUTH=1 (required for the `(app)` route group) on its own
 * port to avoid clashing with a developer's `npm run dev`.
 *
 *   npm run test:visual          # compare against committed baselines
 *   npm run test:visual:update   # regenerate baselines (--update-snapshots)
 *
 * Baselines are platform-specific (`-linux`, `-darwin`, …). Generate/commit
 * them on Linux (CI runners) or on the same OS you compare on.
 */

const port = Number(process.env.VISUAL_PORT ?? 3100)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e/visual",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-visual" }]]
    : "list",
  // e.g. e2e/visual/baselines/site-pages.spec/home-chromium-linux.png
  snapshotPathTemplate:
    "{testDir}/baselines/{testFileBaseName}/{arg}{-projectName}{-platform}{ext}",
  use: {
    baseURL,
    // "retain-on-failure" records a trace for every test and deletes it on
    // pass, which races with browserContext.close and intermittently fails
    // passing tests with ENOENT on the trace chunks. Recording only on the
    // first retry keeps traces for real failures (CI retries once) without
    // the race on the happy path.
    trace: "on-first-retry",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `NEXT_PUBLIC_MOCK_AUTH=1 npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
