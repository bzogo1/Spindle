import { expect, test } from "playwright/test"

import { gotoSettled, isMobileViewport } from "./helpers"

/**
 * Form usability on phone viewports (playwright.mobile.config.ts).
 *
 * Covers the two public forms a phone user actually touches:
 * - /sign-in — inputmode/autocomplete hints for the on-screen keyboard and
 *   inline validation before any network call.
 * - /contact — the multi-field form with client-side validation summary,
 *   focus-on-first-invalid, and a real POST to /api/contact.
 *
 * Specs skip on wide viewports (see helpers.ts) so the desktop chromium
 * project in playwright.config.ts reports skips, not failures.
 */

const E2E_PASSWORD = "correct-horse-1"

test.beforeEach(async ({ page }) => {
  test.skip(!isMobileViewport(page), "requires a phone-sized viewport (≤900px)")
})

test("sign-in fields carry mobile keyboard hints and validate inline", async ({ page }) => {
  await gotoSettled(page, "/sign-in")

  const email = page.locator("#auth-email")
  const password = page.locator("#auth-password")

  // `inputmode`/`autocomplete` are what make mobile keyboards show the right
  // layout and offer saved credentials.
  await expect(email).toHaveAttribute("type", "email")
  await expect(email).toHaveAttribute("inputmode", "email")
  await expect(email).toHaveAttribute("autocomplete", "email")
  await expect(password).toHaveAttribute("type", "password")
  await expect(password).toHaveAttribute("autocomplete", "current-password")

  // Empty submit runs validateAll: inline .auth-error alerts appear and the
  // user stays on /sign-in without a request leaving the page.
  await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()
  await expect(page.locator(".auth-error").first()).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in/)
})

test("sign-in completes on a phone viewport", async ({ page, request }) => {
  // Signup + form submit + dashboard compile can exceed the 60s default on
  // a cold dev server (observed ~45s).
  test.setTimeout(90_000)
  // Same provisioning as e2e/critical-flows.spec.ts: the in-memory mock
  // backend starts empty, signup also signs in (email_taken is fine).
  const email = "mobile-e2e@lab.edu"
  await request.post("/api/auth/signup", {
    data: { workspaceName: "E2E Mobile", email, password: E2E_PASSWORD },
  })

  await gotoSettled(page, "/sign-in")
  await page.locator("#auth-email").fill(email)
  await page.locator("#auth-password").fill(E2E_PASSWORD)
  await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()

  await page.waitForURL("**/dashboard", { timeout: 30_000 })
  await expect(page.locator(".app-shell, main").first()).toBeVisible()
})

test("contact form validates, focuses the first invalid field, and submits", async ({ page }) => {
  await gotoSettled(page, "/contact")

  await expect(page.locator("#contact-name")).toHaveAttribute("type", "text")
  await expect(page.locator("#contact-email")).toHaveAttribute("type", "email")
  await expect(page.locator("#contact-email")).toHaveAttribute("inputmode", "email")
  await expect(page.locator("#contact-topic")).toHaveJSProperty("tagName", "SELECT")
  await expect(page.locator("#contact-message")).toHaveJSProperty("tagName", "TEXTAREA")

  const submit = page.locator('form.contact-form button[type="submit"]')

  // Empty submit: error summary + per-field alerts, focus lands on #contact-name.
  await submit.click()
  await expect(page.locator(".form-alert--summary")).toBeVisible()
  await expect(page.locator("#contact-name-error")).toBeVisible()
  await expect(page.locator("#contact-name")).toBeFocused()

  // Fill every required field; the topic <select> uses the CONTACT_TOPICS
  // values from src/lib/site-form-constants.ts.
  await page.locator("#contact-name").fill("E2E Mobile")
  await page.locator("#contact-email").fill("mobile-e2e@lab.edu")
  await page.locator("#contact-topic").selectOption("general")
  await page.locator("#contact-subject").fill("Mobile viewport check")
  await page
    .locator("#contact-message")
    .fill("Verifying the contact form submits cleanly on a phone-sized viewport.")

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/contact") && res.request().method() === "POST",
      { timeout: 30_000 },
    ),
    submit.click(),
  ])

  // /api/contact allows 5 submissions/hour per IP (src/app/api/contact/
  // route.ts). Repeated local runs exhaust that budget; the validation half
  // of this test already ran, so treat 429 as "submit covered elsewhere"
  // instead of failing the suite on an environmental limit.
  if (response.status() === 429) {
    test.info().annotations.push({
      type: "note",
      description: "submit assertion skipped: /api/contact rate-limited (5/hour per IP)",
    })
    return
  }
  expect(response.status(), "POST /api/contact").toBe(200)

  // The route returns ok even when Resend is not configured (submission is
  // logged only), so the success panel is reachable in dev/mock mode.
  await expect(page.locator(".form-success")).toBeVisible()
  await expect(page.getByText("Message sent.")).toBeVisible()
})
