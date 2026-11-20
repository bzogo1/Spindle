import { expect, test } from "playwright/test"

import { expectVisual, gotoVisual, signInToMockApp } from "./visual-helpers"

/**
 * Authenticated `(app)` surfaces. The mock-session cookie is planted directly
 * (the dev server runs with NEXT_PUBLIC_MOCK_AUTH=1 — see
 * playwright.visual.config.ts) and the mock API store serves deterministic
 * data under the fixed clock installed by gotoVisual.
 */
test.describe("app shell", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInToMockApp(context, baseURL)
  })

  test("dashboard", async ({ page }) => {
    await gotoVisual(page, "/dashboard")
    await expect(page.getByRole("heading", { name: /dashboard/i }).first()).toBeVisible()
    await expectVisual(page, "dashboard.png")
  })

  test("projects", async ({ page }) => {
    await gotoVisual(page, "/projects")
    await expect(page.locator(".app-shell, main").first()).toBeVisible()
    await expectVisual(page, "projects.png")
  })

  test("usage", async ({ page }) => {
    await gotoVisual(page, "/dashboard/usage")
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "usage.png")
  })

  test("settings", async ({ page }) => {
    await gotoVisual(page, "/app/settings")
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "settings.png")
  })

  // Seeded project id served by the mock API store (same constant as
  // e2e/app-a11y.spec.ts / e2e/critical-flows.spec.ts).
  const SEEDED_PROJECT_ID = "prj_01"

  test("project home", async ({ page }) => {
    await gotoVisual(page, `/projects/${SEEDED_PROJECT_ID}`)
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "project-home.png")
  })

  test("project files", async ({ page }) => {
    await gotoVisual(page, `/projects/${SEEDED_PROJECT_ID}/files`)
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "project-files.png")
  })

  test("project lab", async ({ page }) => {
    await gotoVisual(page, `/projects/${SEEDED_PROJECT_ID}/lab`)
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "project-lab.png")
  })

  test("project chat", async ({ page }) => {
    await gotoVisual(page, `/projects/${SEEDED_PROJECT_ID}/chat`)
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "project-chat.png")
  })

  test("project agent", async ({ page }) => {
    await gotoVisual(page, `/projects/${SEEDED_PROJECT_ID}/agent`)
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "project-agent.png")
  })

  test("dashboard members", async ({ page }) => {
    await gotoVisual(page, "/dashboard/members")
    await expect(page.locator("main").first()).toBeVisible()
    await expectVisual(page, "members.png")
  })
})
