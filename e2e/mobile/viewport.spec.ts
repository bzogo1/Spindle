import { test } from "playwright/test"

import { expectNoHorizontalOverflow, gotoAppPage, isMobileViewport } from "./helpers"

/**
 * Viewport rendering smoke at real device widths (playwright.mobile.config.ts).
 *
 * Complements e2e/viewport-matrix.spec.ts — that spec sweeps fixed CSS widths
 * on desktop emulation; this one asserts the same "no horizontal overflow"
 * invariant on actual Pixel 7 / iPhone 13 device descriptors (viewport, DPR,
 * touch, mobile UA) for the routes a phone user hits first.
 *
 * Specs skip on wide viewports (see helpers.ts) so the desktop chromium
 * project in playwright.config.ts reports skips, not failures.
 */

test.beforeEach(async ({ page }) => {
  test.skip(!isMobileViewport(page), "requires a phone-sized viewport (≤900px)")
})

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
  "/solutions",
  "/about",
  "/sign-in",
  "/reset-password",
] as const

const APP_ROUTES = ["/dashboard", "/projects", "/dashboard/usage", "/app/settings"] as const

test.describe("mobile viewport — public routes", () => {
  for (const path of PUBLIC_ROUTES) {
    test(`${path} renders without horizontal overflow`, async ({ page }) => {
      await expectNoHorizontalOverflow(page, path)
    })
  }
})

test.describe("mobile viewport — app routes", () => {
  for (const path of APP_ROUTES) {
    test(`${path} renders without horizontal overflow`, async ({ page, request, baseURL }) => {
      // App routes may fall back to a real UI sign-in (see gotoAppPage).
      test.setTimeout(120_000)
      // gotoAppPage leaves the signed-in session in the context; the
      // overflow check re-navigates (gotoSettled) and re-measures.
      await gotoAppPage(page, request, baseURL, path)
      await expectNoHorizontalOverflow(page, path)
    })
  }
})
