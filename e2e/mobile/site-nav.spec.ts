import { expect, test } from "playwright/test"

import { expectTapTargets, gotoSettled, isMobileViewport } from "./helpers"

/**
 * Marketing-site navigation on phone viewports (playwright.mobile.config.ts).
 *
 * The header swaps the desktop NavigationMenu for a hamburger + slide-down
 * panel at ≤860px (src/app/styles/styles.css); `#menuToggle` and `#mobileNav`
 * are wired by src/lib/interactions/site.js (toggle, Escape, outside-click)
 * and src/components/site/site-nav.tsx (MobileNav links, search, CTA).
 *
 * These specs skip themselves on wide viewports so the desktop chromium
 * project in playwright.config.ts — which also collects e2e/mobile — reports
 * skips instead of failures.
 */

test.beforeEach(async ({ page }) => {
  test.skip(!isMobileViewport(page), "requires a phone-sized viewport (≤900px)")
})

test("hamburger toggle opens and closes the mobile nav panel", async ({ page }) => {
  await gotoSettled(page, "/")

  const toggle = page.locator("#menuToggle")
  const panel = page.locator("#mobileNav")

  // Desktop nav must be gone and the hamburger present at phone widths.
  await expect(page.locator(".nav-desktop-slot")).toBeHidden()
  await expect(toggle).toBeVisible()
  await expect(panel).not.toHaveClass(/open/)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  await toggle.click()
  await expect(panel).toHaveClass(/open/)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  await toggle.click()
  await expect(panel).not.toHaveClass(/open/)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
})

test("Escape and outside taps dismiss the open mobile nav", async ({ page }) => {
  await gotoSettled(page, "/")

  const toggle = page.locator("#menuToggle")
  const panel = page.locator("#mobileNav")

  await toggle.click()
  await expect(panel).toHaveClass(/open/)
  await page.keyboard.press("Escape")
  await expect(panel).not.toHaveClass(/open/)

  await toggle.click()
  await expect(panel).toHaveClass(/open/)
  // Tapping the page body (outside panel and toggle) closes the menu.
  await page
    .locator("main, .page-main, body")
    .first()
    .click({ position: { x: 8, y: 8 } })
  await expect(panel).not.toHaveClass(/open/)
})

test("mobile nav links navigate and the panel closes behind them", async ({ page }) => {
  await gotoSettled(page, "/")

  await page.locator("#menuToggle").click()
  const panel = page.locator("#mobileNav")
  await expect(panel).toHaveClass(/open/)

  // Pricing is a top-level mobile link (MobileNav renders it outside the
  // grouped sections); it also carries aria-current when on /pricing.
  await panel.locator('a.ui-mobile-link[href="/pricing"]').click()

  // Client-side nav (InternalLinkNavigation → router.push) still has to
  // compile the target route on a cold dev server.
  await expect(page).toHaveURL(/\/pricing/, { timeout: 15_000 })
  await expect(panel).not.toHaveClass(/open/)
})

test("mobile search button opens the site command palette", async ({ page }) => {
  await gotoSettled(page, "/")

  await page.locator("#menuToggle").click()
  // The only <button> inside the mobile panel is the "Search site" trigger;
  // it dispatches SITE_SEARCH_OPEN_EVENT which SiteCommandMenu listens for.
  await page.locator("#mobileNav button").click()

  const palette = page.getByRole("dialog")
  await expect(palette).toBeVisible()
  await expect(palette.getByRole("combobox")).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(palette).toBeHidden()
})

test("sign-up CTA is reachable inside the mobile nav", async ({ page }) => {
  await gotoSettled(page, "/")

  await page.locator("#menuToggle").click()
  const cta = page.locator('#mobileNav a.btn--primary[href="/sign-up"]')
  await expect(cta).toBeVisible()
  await cta.click()
  await expect(page).toHaveURL(/\/sign-up/, { timeout: 15_000 })
})

test("primary nav touch targets meet the 24px minimum", async ({ page }) => {
  await gotoSettled(page, "/")

  await page.locator("#menuToggle").click()
  await expect(page.locator("#mobileNav")).toHaveClass(/open/)

  await expectTapTargets(page.locator("#menuToggle"), "#menuToggle")
  await expectTapTargets(page.locator("#mobileNav a.ui-mobile-link"), "mobile nav links")
  await expectTapTargets(
    page.locator('#mobileNav a.btn--primary[href="/sign-up"]'),
    "mobile sign-up CTA",
  )
})
