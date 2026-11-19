import { expect, test } from "playwright/test"

test.describe("password recovery", () => {
  test("requests a link and completes the reset with a valid token", async ({ page }) => {
    await page.goto("/reset-password")
    await page.getByLabel("Work email").fill("researcher@lab.edu")
    await page.getByRole("button", { name: "Send reset link" }).click()

    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled()

    await page.goto("/reset-password/demo-token")
    await page.locator("#new-password").fill("correct-horse-battery")
    await page.locator("#confirm-password").fill("correct-horse-battery")
    await page.getByRole("button", { name: "Update password" }).click()

    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/")
  })

  test("completes both flows from the keyboard", async ({ page }) => {
    await page.goto("/reset-password")
    await page.getByLabel("Work email").focus()
    await page.keyboard.type("researcher@lab.edu")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()

    await page.goto("/reset-password/demo-token")
    await page.locator("#new-password").focus()
    await page.keyboard.type("correct-horse-battery")
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await page.keyboard.type("correct-horse-battery")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible()

    await page.goto("/verify-email")
    await page.getByLabel("Work email").focus()
    await page.keyboard.type("researcher@lab.edu")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
  })

  test("shows an expired-link state with a way forward", async ({ page }) => {
    await page.goto("/reset-password/expired-token")

    await expect(page.getByRole("heading", { name: "This reset link has expired" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/reset-password",
    )
    await expect(
      page.locator(".auth-card").getByRole("link", { name: "Contact support" }),
    ).toBeVisible()
  })
})
