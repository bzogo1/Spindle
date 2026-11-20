import { expect, test } from "playwright/test"

import { expectVisual, gotoVisual } from "./visual-helpers"

/**
 * Marketing surfaces from the `(site)` route group. All are public, static
 * content; the fixed clock + reduced motion keep demos in their final state.
 */
test.describe("marketing pages", () => {
  test("home page", async ({ page }) => {
    await gotoVisual(page, "/")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "home.png")
  })

  test("pricing page", async ({ page }) => {
    await gotoVisual(page, "/pricing")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "pricing.png")
  })

  test("platform page", async ({ page }) => {
    await gotoVisual(page, "/platform")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "platform.png")
  })
})
