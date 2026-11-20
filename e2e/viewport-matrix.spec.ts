import { expect, test, type Page } from "playwright/test"

import { signInToMockApp } from "./visual/visual-helpers"

/**
 * Responsive viewport-matrix smoke test (issue 055).
 *
 * Loads a curated route set at each audit width and asserts the document does
 * not scroll horizontally: `document.documentElement.scrollWidth` must not
 * exceed `window.innerWidth` once the page has settled (networkidle +
 * `document.fonts.ready`). This is the automated counterpart of the manual
 * "no route scrolls horizontally" acceptance criterion — element-level fixes
 * belong to the layout work, this spec only catches regressions.
 *
 * App-shell routes need the mock-session cookie; `signInToMockApp` comes from
 * `e2e/visual/visual-helpers.ts`, which is test-ignored for the visual config
 * but safe to import (it only depends on `playwright/test`).
 */

const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1440] as const
const VIEWPORT_HEIGHT = 800

/** Marketing surface: all special pages plus docs index/guide and spot-checked legal pages. */
const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/platform",
  "/docs",
  "/docs/quickstart",
  "/changelog",
  "/contact",
  "/lab",
  "/collaboration",
  "/infrastructure",
  "/solutions",
  "/agent",
  "/automations",
  "/about",
  // Legal spot-checks (full set lives in route-smoke.spec.ts).
  "/terms",
  "/privacy",
  "/cookies",
] as const

/** Auth surface reachable signed-out. */
const AUTH_ROUTES = ["/reset-password"] as const

/** `(app)` shell routes; guarded by the mock-session cookie under NEXT_PUBLIC_MOCK_AUTH=1. */
const APP_ROUTES = [
  "/dashboard",
  "/projects",
  "/dashboard/usage",
  "/dashboard/members",
  "/app/settings",
] as const

/**
 * Pre-decides cookie consent so the marketing consent banner never mounts —
 * same payload shape as src/lib/consent.ts and e2e/visual/visual-helpers.ts.
 */
async function suppressConsentBanner(page: Page) {
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
      // Cookie may be unavailable this early; the banner is cosmetic for this test.
    }
  })
}

/**
 * Navigates, waits for the page to settle (load → best-effort networkidle →
 * fonts ready), then asserts there is no horizontal overflow. Returns the
 * measured widths so failures report concrete numbers.
 */
async function expectNoHorizontalOverflow(page: Page, path: string) {
  await suppressConsentBanner(page)

  const response = await page.goto(path, { waitUntil: "load" })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // HMR/analytics can hold a connection open in dev; fonts below are the
    // real settle signal for layout.
  })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // Lazy sections and images without intrinsic size keep shifting layout
  // after networkidle; wait for them, then for scrollWidth to stop changing
  // so the measurement reflects the settled page, not a mid-load frame.
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, {
      timeout: 10_000,
    })
    .catch(() => {})
  let lastScrollWidth = -1
  for (let i = 0; i < 10; i++) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    if (width === lastScrollWidth) break
    lastScrollWidth = width
    await page.waitForTimeout(400)
  }

  expect(response?.status(), `${path} returned HTTP ${response?.status()}`).toBe(200)

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    scrollWidth,
    `${path} @ ${page.viewportSize()?.width}px overflows horizontally: ` +
      `scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`,
  ).toBeLessThanOrEqual(innerWidth)
}

test.describe("viewport matrix — public routes", () => {
  for (const path of PUBLIC_ROUTES) {
    for (const width of WIDTHS) {
      test(`${path} has no horizontal overflow @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
        await expectNoHorizontalOverflow(page, path)
      })
    }
  }
})

test.describe("viewport matrix — auth routes", () => {
  for (const path of AUTH_ROUTES) {
    for (const width of WIDTHS) {
      test(`${path} has no horizontal overflow @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
        await expectNoHorizontalOverflow(page, path)
      })
    }
  }
})

test.describe("viewport matrix — app routes", () => {
  for (const path of APP_ROUTES) {
    for (const width of WIDTHS) {
      test(`${path} has no horizontal overflow @ ${width}px`, async ({
        page,
        context,
      }, testInfo) => {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
        await signInToMockApp(context, testInfo.project.use.baseURL as string | undefined)
        await expectNoHorizontalOverflow(page, path)
      })
    }
  }
})
