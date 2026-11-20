import { defineConfig, devices } from "playwright/test"

const port = Number(process.env.PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e",
  // e2e/visual/ and e2e/storybook-visual/ belong to the dedicated
  // visual-regression configs (playwright.visual.config.ts,
  // playwright.storybook.visual.config.ts); they need their own servers and
  // snapshot templates, so the functional e2e suite must not pick them up.
  testIgnore: ["visual/**", "storybook-visual/**"],
  // Dev-server compiles and the mock-auth latency make 30s tight on cold runs.
  timeout: 60_000,
  expect: { timeout: 5000 },
  // Dev-server cold compiles make first-hit navigations slow; one retry keeps
  // CI green without hiding real failures.
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // The (app) shell and mock auth are gated on NEXT_PUBLIC_MOCK_AUTH=1;
        // the API adapter defaults to mock mode, so no backend is needed.
        command: `NEXT_PUBLIC_MOCK_AUTH=1 npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
