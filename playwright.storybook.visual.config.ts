import { defineConfig, devices } from "playwright/test"

/**
 * Storybook visual regression config. Separate from playwright.visual.config.ts
 * because Storybook is a static build (`storybook-static/`), not the Next.js
 * dev server — no app env, auth, or mock session needed.
 *
 *   npm run build-storybook
 *   npm run test:storybook:visual          # compare against committed baselines
 *   npm run test:storybook:visual:update   # regenerate baselines
 *
 * The webServer serves `storybook-static/` with the dependency-free
 * `scripts/serve-static.mjs` on port 3200 (override with
 * STORYBOOK_VISUAL_PORT). Set STORYBOOK_VISUAL_BASE_URL to point at an
 * already-running static server instead (the config then skips spawning one).
 *
 * Baselines are platform-specific (`-linux`, `-darwin`, …) and live in
 * `e2e/storybook-visual/baselines/stories.spec/`.
 */

const port = Number(process.env.STORYBOOK_VISUAL_PORT ?? 3200)
const baseURL = process.env.STORYBOOK_VISUAL_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e/storybook-visual",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-storybook" }]]
    : "list",
  // e.g. e2e/storybook-visual/baselines/stories.spec/ui-button--primary-dark-chromium-linux.png
  snapshotPathTemplate:
    "{testDir}/baselines/{testFileBaseName}/{arg}{-projectName}{-platform}{ext}",
  use: {
    baseURL,
    trace: "retain-on-failure",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.STORYBOOK_VISUAL_BASE_URL
    ? undefined
    : {
        command: `node scripts/serve-static.mjs storybook-static --port ${port}`,
        url: `${baseURL}/index.json`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
})
