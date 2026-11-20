import { expect, type APIRequestContext, type Locator, type Page } from "playwright/test"

import { signInToMockApp } from "../visual/visual-helpers"

/**
 * Shared helpers for the mobile device specs (playwright.mobile.config.ts).
 */

/**
 * Pre-decides cookie consent so the marketing consent banner never mounts —
 * same payload shape as src/lib/consent.ts, e2e/viewport-matrix.spec.ts and
 * e2e/visual/visual-helpers.ts.
 */
export async function suppressConsentBanner(page: Page) {
  await page.addInitScript(() => {
    try {
      const consent = encodeURIComponent(
        JSON.stringify({
          version: "1.0",
          timestamp: "2026-01-15T12:00:00.000Z",
          analytics: false,
          replay: false,
        }),
      )
      document.cookie = `spindle_consent=${consent}; path=/`
    } catch {
      // Cookie may be unavailable this early; the banner is cosmetic here.
    }
  })
}

/**
 * Navigates and waits for the page to settle: `load`, best-effort
 * `networkidle`, fonts ready, then a short stability poll on document height
 * (lazy sections keep growing the page after networkidle in dev).
 */
export async function gotoSettled(page: Page, path: string) {
  await suppressConsentBanner(page)
  // ERR_ABORTED happens when a client-side redirect (e.g. the (app) guard
  // bouncing signed-out visitors to /sign-in) interrupts an in-flight goto;
  // retry once on the now-settled URL.
  let response
  try {
    response = await page.goto(path, { waitUntil: "load" })
  } catch (error) {
    if (!String(error).includes("ERR_ABORTED")) throw error
    response = await page.goto(path, { waitUntil: "load" })
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // HMR/analytics can hold a connection open in dev; fonts are the real
    // settle signal for layout.
  })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, {
      timeout: 10_000,
    })
    .catch(() => {})
  let lastHeight = -1
  for (let i = 0; i < 10; i++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    if (height === lastHeight) break
    lastHeight = height
    await page.waitForTimeout(300)
  }
  return response
}

/**
 * Widest viewport (CSS px) that still gets the mobile layout: the app shell
 * collapses to the drawer nav at ≤900px (src/app/styles/app.css) and the
 * marketing hamburger at ≤860px (src/app/styles/styles.css). Specs in this
 * directory skip themselves above this width so the desktop chromium project
 * in playwright.config.ts — which also collects e2e/mobile — reports skips
 * instead of failures.
 */
export const MOBILE_LAYOUT_MAX_WIDTH = 900

/** True when the current project viewport is phone-sized. */
export function isMobileViewport(page: Page) {
  const width = page.viewportSize()?.width ?? 0
  return width > 0 && width <= MOBILE_LAYOUT_MAX_WIDTH
}

/**
 * Asserts the settled page has no horizontal overflow — the mobile-matrix
 * counterpart of the per-width check in e2e/viewport-matrix.spec.ts, run at
 * real device widths instead of emulated ones. Polls scrollWidth until it
 * stops changing so lazy sections don't produce mid-load false positives.
 */
export async function expectNoHorizontalOverflow(page: Page, path: string) {
  const response = await gotoSettled(page, path)
  expect(response?.status(), `${path} returned HTTP ${response?.status()}`).toBe(200)

  let lastWidth = -1
  for (let i = 0; i < 10; i++) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    if (width === lastWidth) break
    lastWidth = width
    await page.waitForTimeout(300)
  }

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    scrollWidth,
    `${path} overflows horizontally on a ${innerWidth}px viewport: ` +
      `scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`,
  ).toBeLessThanOrEqual(innerWidth)
}

const APP_E2E_EMAIL = "mobile-e2e@lab.edu"
const APP_E2E_PASSWORD = "correct-horse-1"

/**
 * The in-memory mock backend starts empty; signup also signs in, and
 * `email_taken` is fine because the backend is shared for the whole run
 * (same provisioning as e2e/critical-flows.spec.ts).
 */
async function ensureAppAccount(request: APIRequestContext) {
  await request.post("/api/auth/signup", {
    data: {
      workspaceName: "E2E Mobile",
      email: APP_E2E_EMAIL,
      password: APP_E2E_PASSWORD,
    },
  })
}

/**
 * Navigates to an `(app)` route signed in. Fast path: the mock-session cookie
 * from `signInToMockApp` — honored when the server runs with
 * `NEXT_PUBLIC_MOCK_AUTH=1` (playwright's own webServer does). Fallback:
 * `PLAYWRIGHT_BASE_URL`/`reuseExistingServer` can point at a dev server
 * without the flag, where the cookie is ignored and `(app)` redirects to
 * `/sign-in`; in that case we sign in through the real UI once per test.
 */
export async function gotoAppPage(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  path: string,
) {
  await signInToMockApp(page.context(), baseURL)
  const response = await gotoSettled(page, path)
  if (!new URL(page.url()).pathname.startsWith("/sign-in")) {
    return response
  }

  await ensureAppAccount(request)
  await gotoSettled(page, "/sign-in")
  await page.locator("#auth-email").fill(APP_E2E_EMAIL)
  await page.locator("#auth-password").fill(APP_E2E_PASSWORD)
  await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()
  await page.waitForURL("**/dashboard", { timeout: 30_000 })
  return gotoSettled(page, path)
}

/** WCAG 2.2 AA minimum pointer target size (CSS px). */
export const MIN_TARGET_SIZE_PX = 24

/**
 * Asserts every locator resolves to a visible box at least
 * {@link MIN_TARGET_SIZE_PX} in both dimensions — the automated floor for
 * "tap targets are big enough" on touch devices.
 */
export async function expectTapTargets(locator: Locator, label: string) {
  const count = await locator.count()
  expect(count, `${label}: expected at least one match`).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox()
    expect(box, `${label}[${i}] has no layout box`).not.toBeNull()
    expect(
      box!.width,
      `${label}[${i}] is ${box!.width}px wide (< ${MIN_TARGET_SIZE_PX}px)`,
    ).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX)
    expect(
      box!.height,
      `${label}[${i}] is ${box!.height}px tall (< ${MIN_TARGET_SIZE_PX}px)`,
    ).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX)
  }
}
