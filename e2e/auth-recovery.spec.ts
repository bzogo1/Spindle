import { expect, test } from "playwright/test"

/**
 * Password recovery + email verification request flows.
 *
 * These are public `(auth)` routes backed by the in-memory auth backend
 * (src/lib/auth/backend.ts) — no database and no NEXT_PUBLIC_MOCK_AUTH — so
 * they run against both the mock-auth dev server and the production build in
 * CI (PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm start).
 *
 * A full reset *confirm* cannot be driven end-to-end: the one-time token is
 * only delivered by email (or the dev-server log), never exposed to the test.
 * The confirm route's rejection of unknown tokens is asserted instead.
 */

test.describe("password recovery", () => {
  test("requests a reset link and shows the sent state", async ({ page }) => {
    await page.goto("/reset-password")
    await page.getByLabel("Work email").fill("researcher@lab.edu")
    await page.getByRole("button", { name: "Send reset link" }).click()

    // First hit compiles the API route on the dev server; prod is instant.
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled()
  })

  test("rejects an unknown reset token with a recoverable error", async ({ page }) => {
    // "demo-token" classifies as a usable link client-side, but the API has no
    // such one-time token, so confirm must surface the invalid-link error and
    // leave the form usable.
    await page.goto("/reset-password/demo-token")
    await page.locator("#new-password").fill("correct-horse-battery")
    await page.locator("#confirm-password").fill("correct-horse-battery")
    await page.getByRole("button", { name: "Update password" }).click()

    // Next.js renders an empty route-announcer div with role="alert" too, so
    // scope to the field error rather than getByRole("alert").
    await expect(page.locator(".auth-error")).toContainText("invalid or has expired")
    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible()
  })

  test("completes the request flows from the keyboard", async ({ page }) => {
    await page.goto("/reset-password")
    await page.getByLabel("Work email").focus()
    await page.keyboard.type("researcher@lab.edu")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()

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
