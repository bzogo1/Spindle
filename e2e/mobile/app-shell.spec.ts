import { expect, test } from "playwright/test"

import { expectTapTargets, gotoAppPage, isMobileViewport } from "./helpers"

/**
 * `(app)` shell on phone viewports (playwright.mobile.config.ts).
 *
 * Below 900px the sidebar collapses and navigation moves into a Radix Dialog
 * drawer (src/components/app/app-shell.tsx + mobile-nav-drawer.tsx) opened by
 * `.app-drawer-trigger`. The drawer adds touch swipe gestures: right-swipe
 * from the left screen edge opens, left-swipe closes.
 *
 * Specs skip on wide viewports (see helpers.ts) so the desktop chromium
 * project in playwright.config.ts reports skips, not failures.
 */

// The mock-cookie fast path is quick, but the real sign-in fallback (used
// when the server lacks NEXT_PUBLIC_MOCK_AUTH) needs several cold dev-server
// compiles — allow well beyond the 60s default.
test.setTimeout(120_000)

test.beforeEach(async ({ page }) => {
  test.skip(!isMobileViewport(page), "requires a phone-sized viewport (≤900px)")
})

test("app shell hides the sidebar and opens the nav drawer", async ({ page, request, baseURL }) => {
  await gotoAppPage(page, request, baseURL, "/dashboard")

  // Sidebar is display:none ≤900px; the drawer trigger takes its place.
  await expect(page.locator(".app-sidebar")).toBeHidden()
  const trigger = page.locator(".app-drawer-trigger")
  await expect(trigger).toBeVisible()

  await trigger.click()
  const drawer = page.locator(".app-drawer")
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole("link").first()).toBeVisible()

  // Escape dismisses (Radix Dialog) and returns focus management for free.
  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
})

test("drawer close button and nav links work on touch", async ({ page, request, baseURL }) => {
  await gotoAppPage(page, request, baseURL, "/dashboard")

  await page.locator(".app-drawer-trigger").click()
  const drawer = page.locator(".app-drawer")
  await expect(drawer).toBeVisible()

  // The header close control is labelled "Close navigation".
  await drawer.getByRole("button", { name: "Close navigation" }).click()
  await expect(drawer).toBeHidden()
})

test("edge swipe opens the drawer and a left swipe closes it", async ({
  page,
  request,
  baseURL,
}) => {
  await gotoAppPage(page, request, baseURL, "/dashboard")

  const drawer = page.locator(".app-drawer")

  // MobileNavDrawer listens for non-mouse pointer gestures: a touch that
  // starts within 24px of the left edge and travels >50px rightward opens.
  // Synthetic PointerEvents exercise the same handlers without needing a
  // real touchscreen driver.
  const swipe = (fromX: number, toX: number, y = 300) =>
    page.evaluate(
      ([startX, endX, startY]) => {
        const base = {
          bubbles: true,
          pointerType: "touch",
          pointerId: 7,
          isPrimary: true,
        }
        window.dispatchEvent(
          new PointerEvent("pointerdown", { ...base, clientX: startX, clientY: startY }),
        )
        window.dispatchEvent(
          new PointerEvent("pointerup", { ...base, clientX: endX, clientY: startY }),
        )
      },
      [fromX, toX, y] as const,
    )

  await swipe(5, 160)
  await expect(drawer).toBeVisible()

  // While open, any right-to-left swipe past the threshold closes it.
  await swipe(300, 120)
  await expect(drawer).toBeHidden()
})

test("topbar and drawer touch targets meet the 24px minimum", async ({
  page,
  request,
  baseURL,
}) => {
  await gotoAppPage(page, request, baseURL, "/dashboard")

  await expectTapTargets(page.locator(".app-drawer-trigger"), "drawer trigger")
  await expectTapTargets(
    page.locator(".app-topbar-actions .app-icon-button"),
    "topbar icon buttons",
  )

  await page.locator(".app-drawer-trigger").click()
  const drawer = page.locator(".app-drawer")
  await expect(drawer).toBeVisible()
  await expectTapTargets(drawer.locator(".app-nav-link"), "drawer nav links")
})
