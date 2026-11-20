import { expect, test } from "playwright/test"

import { expectVisual, gotoVisual } from "./visual-helpers"

/**
 * Content-heavy marketing surfaces not covered by site-pages.spec.ts: docs,
 * changelog, contact, and solutions. All are public and render from committed
 * content (content/docs/*.mdx, src/lib/changelog.ts), so the fixed clock keeps
 * every frame identical. The contact form is static until submitted.
 */
test.describe("content pages", () => {
  test("docs index", async ({ page }) => {
    await gotoVisual(page, "/docs")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "docs.png")
  })

  test("docs guide", async ({ page }) => {
    // Real published slug (content/docs/quickstart.mdx).
    await gotoVisual(page, "/docs/quickstart")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "docs-guide.png")
  })

  test("changelog", async ({ page }) => {
    await gotoVisual(page, "/changelog")
    await expect(page.getByRole("main")).toBeVisible()
    await expectVisual(page, "changelog.png")
  })

  test("contact", async ({ page }) => {
    await gotoVisual(page, "/contact")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "contact.png")
  })

  test("solutions", async ({ page }) => {
    await gotoVisual(page, "/solutions")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectVisual(page, "solutions.png")
  })
})
