import { expect, test } from "playwright/test"

import { expectVisual, gotoVisual } from "./visual-helpers"

/**
 * Public auth surfaces from the `(auth)` route group: the standalone
 * sign-in and sign-up pages plus the account-recovery pages. The
 * reset/verify flows are exercised functionally in
 * e2e/auth-recovery.spec.ts; here we only pin their visuals.
 */
test.describe("auth pages", () => {
  test("reset password request form", async ({ page }) => {
    await gotoVisual(page, "/reset-password")
    await expect(page.getByLabel("Work email")).toBeVisible()
    await expectVisual(page, "reset-password.png")
  })

  test("reset password with token", async ({ page }) => {
    await gotoVisual(page, "/reset-password/demo-token")
    await expect(page.locator("#new-password")).toBeVisible()
    await expectVisual(page, "reset-password-token.png")
  })

  test("verify email", async ({ page }) => {
    await gotoVisual(page, "/verify-email")
    await expect(page.getByLabel("Work email")).toBeVisible()
    await expectVisual(page, "verify-email.png")
  })

  test("sign-in page", async ({ page }) => {
    await gotoVisual(page, "/sign-in")
    await expect(page.getByLabel("Work email")).toBeVisible()
    await expectVisual(page, "sign-in.png", { fullPage: true })
  })

  test("sign-up page", async ({ page }) => {
    await gotoVisual(page, "/sign-up")
    await expect(page.getByLabel("Work email")).toBeVisible()
    await expectVisual(page, "sign-up.png", { fullPage: true })
  })
})
