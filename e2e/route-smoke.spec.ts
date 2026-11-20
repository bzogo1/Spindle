import { expect, test, type Page } from "playwright/test"

/**
 * Route smoke test for the public marketing surface (issue 029 residual).
 *
 * Visits every public route and asserts it renders its main content without
 * unexpected console errors, page errors, or a wrong HTTP status. The suite
 * runs against whatever server `webServer` / PLAYWRIGHT_BASE_URL points at.
 */

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/docs", name: "docs index" },
  // Real published guide slug (content/docs/quickstart.mdx, generated manifest).
  { path: "/docs/quickstart", name: "docs guide" },
  { path: "/changelog", name: "changelog" },
  { path: "/contact", name: "contact" },
  { path: "/terms", name: "terms" },
  { path: "/privacy", name: "privacy" },
  { path: "/cookies", name: "cookies" },
  { path: "/dpa", name: "dpa" },
  { path: "/acceptable-use", name: "acceptable use" },
  { path: "/security", name: "security" },
  { path: "/accessibility", name: "accessibility statement" },
  // Matches the `SPN-XXXX-XXXX` shape (src/lib/referral.ts REFERRAL_CODE_PATTERN).
  { path: "/r/SPN-ABCD-EFGH", name: "referral landing (valid code)" },
] as const

// A route that does not exist must render the site's 404 page, not a bare error.
const MISSING_ROUTE = "/this-page-does-not-exist-e2e"

/**
 * Console/page errors that are known-benign in dev and CI. Anything else is a
 * real regression and fails the test. Keep this list short and justified:
 * - favicon 404s are cosmetic and not user-visible.
 * - React DevTools suggestion is console.info upstream but some browsers log
 *   it at error level; it is noise, not a defect.
 * - WebGL context failures (headless SwiftShader) are warned, not thrown —
 *   kept here defensively in case a page error surfaces on GPU-less runners.
 */
const BENIGN_CONSOLE_PATTERNS: RegExp[] = [
  /favicon/i,
  /Download the React DevTools/i,
  // Dev-only warning emitted by the Sentry dev chunk when the 404 page loads
  // its instrumentation; third-party noise, not a defect in our markup.
  /Encountered a script tag while rendering React component/i,
]

const BENIGN_PAGE_ERROR_PATTERNS: RegExp[] = [/WebGL|webgl|GPU|SwiftShader/i]

type CollectedIssues = { consoleErrors: string[]; pageErrors: string[] }

function collectPageIssues(page: Page, extraBenignPatterns: RegExp[] = []): CollectedIssues {
  const issues: CollectedIssues = { consoleErrors: [], pageErrors: [] }
  const benign = [...BENIGN_CONSOLE_PATTERNS, ...extraBenignPatterns]

  page.on("console", (message) => {
    if (message.type() !== "error") return
    const location = message.location()?.url ?? ""
    const text = `${message.text()} ${location}`
    if (benign.some((pattern) => pattern.test(text))) return
    issues.consoleErrors.push(text.trim())
  })

  page.on("pageerror", (error) => {
    const text = String(error)
    if (BENIGN_PAGE_ERROR_PATTERNS.some((pattern) => pattern.test(text))) return
    issues.pageErrors.push(text)
  })

  return issues
}

function expectNoPageIssues(issues: CollectedIssues) {
  expect(
    issues.consoleErrors,
    `unexpected console errors:\n${issues.consoleErrors.join("\n")}`,
  ).toEqual([])
  expect(issues.pageErrors, `unexpected page errors:\n${issues.pageErrors.join("\n")}`).toEqual([])
}

test.describe("public route smoke", () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) renders without errors`, async ({ page }) => {
      const issues = collectPageIssues(page)

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})

      expect(response?.status(), `${route.path} returned HTTP ${response?.status()}`).toBe(200)
      await expect(page.getByRole("main")).toBeVisible()
      expectNoPageIssues(issues)
    })
  }

  test(`missing route (${MISSING_ROUTE}) renders the 404 page`, async ({ page }) => {
    // The browser logs "Failed to load resource: ... 404" for the navigation
    // itself — that is the expected outcome of this test, not a regression.
    const issues = collectPageIssues(page, [new RegExp(`status of 404.*${MISSING_ROUTE}`)])

    const response = await page.goto(MISSING_ROUTE, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    expect(response?.status(), "missing route should return HTTP 404").toBe(404)
    await expect(page.getByRole("main")).toBeVisible()
    await expect(page.getByText("page not found")).toBeVisible()
    expectNoPageIssues(issues)
  })
})
