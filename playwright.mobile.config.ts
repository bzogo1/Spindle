import { defineConfig, devices } from "playwright/test"

/**
 * Mobile device matrix config.
 *
 * Runs the functional specs under `e2e/mobile/` on real device descriptors
 * (viewport, device scale factor, touch, mobile UA) instead of the desktop
 * chromium project in playwright.config.ts:
 *
 * - `chromium-mobile` — Pixel 7 (Chromium, Android, 412×915 @2.625x)
 * - `webkit-mobile`  — iPhone 13 (WebKit, iOS Safari, 390×844 @3x)
 *
 * Same dev-server bootstrap as playwright.config.ts: NEXT_PUBLIC_MOCK_AUTH=1
 * gives the `(app)` shell its in-memory mock auth, so no backend is needed.
 * Set PLAYWRIGHT_BASE_URL to point at an already-running server.
 */

const port = Number(process.env.PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e/mobile",
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
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `NEXT_PUBLIC_MOCK_AUTH=1 npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
