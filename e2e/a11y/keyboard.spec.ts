import { expect, test, type Page } from "playwright/test"

/**
 * Keyboard and landmark checks that axe's WCAG rule set does not cover:
 * the "skip to content" links in the public layout groups (WCAG 2.4.1
 * Bypass Blocks) and the presence of banner/main/contentinfo landmarks
 * (WCAG 1.3.1 / best-practice `region` rule, which is not in the wcag2a/aa
 * tag set used by the axe specs).
 *
 * Public routes only — the authenticated app-shell equivalents live in
 * e2e/a11y/app-routes.spec.ts because they need the mock-auth dev server.
 * Complements e2e/a11y.spec.ts and e2e/a11y/public-routes.spec.ts.
 */

/**
 * Pre-decide cookie consent so the marketing banner never intercepts the
 * first Tab press (same payload shape as src/lib/consent.ts).
 */
async function suppressConsentBanner(page: Page) {
  await page.addInitScript(() => {
    try {
      const consent = encodeURIComponent(
        JSON.stringify({
          version: "1.0",
          timestamp: "2026-01-15T12:00:00.000Z",
          analytics: false,
          replay: false,
        }),
      )
      document.cookie = `spindle_consent=${consent}; path=/`
    } catch {
      // localStorage/cookie may be unavailable very early; banner may appear.
    }
  })
}

test.describe("skip links (public layouts)", () => {
  test("site layout: Tab reaches skip link and it jumps to #top", async ({ page }) => {
    test.setTimeout(90_000)
    await suppressConsentBanner(page)
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const skipLink = page.getByRole("link", { name: "Skip to content" })
    await page.keyboard.press("Tab")
    await expect(skipLink).toBeFocused()

    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/#top$/)
    await expect(page.locator("main#top")).toBeFocused()
  })

  test("changelog layout: skip link jumps to #main-content", async ({ page }) => {
    test.setTimeout(90_000)
    await suppressConsentBanner(page)
    await page.goto("/changelog", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const skipLink = page.getByRole("link", { name: "Skip to content" })
    await page.keyboard.press("Tab")
    await expect(skipLink).toBeFocused()

    await page.keyboard.press("Enter")
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("auth layout: skip link jumps to #main-content", async ({ page }) => {
    test.setTimeout(90_000)
    // /verify-email is used instead of /sign-in because the sign-in form
    // auto-focuses its email field on load, so the first Tab would land
    // mid-form rather than on the skip link. The skip link lives in the
    // shared (auth) layout, so any auth page exercises it.
    await page.goto("/verify-email", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const skipLink = page.getByRole("link", { name: "Skip to content" })
    await page.keyboard.press("Tab")
    await expect(skipLink).toBeFocused()

    await page.keyboard.press("Enter")
    await expect(page.locator("main#main-content")).toBeFocused()
  })
})

test.describe("landmarks (public layouts)", () => {
  test("site pages expose banner, main and contentinfo landmarks", async ({ page }) => {
    test.setTimeout(90_000)
    await suppressConsentBanner(page)
    await page.goto("/pricing", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    await expect(page.getByRole("banner")).toBeVisible()
    await expect(page.getByRole("main")).toBeVisible()
    await expect(page.getByRole("contentinfo")).toBeVisible()
  })

  test("auth pages expose a main landmark", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    await expect(page.getByRole("main")).toBeVisible()
  })
})
