import { defineConfig, devices } from "playwright/test"

/**
 * Cross-browser config. Mirrors playwright.config.ts (same mock-auth dev
 * server, same baseURL/PLAYWRIGHT_BASE_URL override) but runs the focused
 * specs in `e2e/crossbrowser/` across Chromium, Firefox, WebKit and the
 * mobile Safari/Chrome device profiles.
 *
 *   npx playwright test -c playwright.crossbrowser.config.ts
 *   npx playwright test -c playwright.crossbrowser.config.ts --project=webkit
 *
 * Uses its own port (CROSSBROWSER_PORT, default 3200) so a developer's
 * `npm run dev` on :3000 is never picked up by `reuseExistingServer` — the
 * mock-auth `(app)` guard requires NEXT_PUBLIC_MOCK_AUTH=1, which a plain dev
 * server does not have.
 */

const port = Number(process.env.CROSSBROWSER_PORT ?? 3200)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e/crossbrowser",
  testMatch: "**/*.spec.ts",
  // Dev-server compiles and the mock-auth latency make 30s tight on cold runs.
  timeout: 60_000,
  expect: { timeout: 5000 },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "Mobile Chrome", use: { ...devices["Pixel 7"] } },
    { name: "Mobile Safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Same env as playwright.config.ts: the (app) shell and mock auth are
        // gated on NEXT_PUBLIC_MOCK_AUTH=1; the API adapter defaults to mock.
        command: `NEXT_PUBLIC_MOCK_AUTH=1 npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
