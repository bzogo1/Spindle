import { expect, test, type Page } from "playwright/test"

import { signInToMockApp } from "../visual/visual-helpers"

/**
 * Cross-browser smoke for browser-sensitive public/app surfaces that the
 * chromium-only e2e suite does not exercise per-engine:
 *
 * - Referral capture (`/referral?ref=`): `ReferralTracker` writes
 *   localStorage in a post-hydration effect — verifies hydration +
 *   localStorage behave identically in every engine.
 * - Sign-in form: keyboard submit and the invalid-credentials path.
 * - Files grid dates: `formatDate` uses `toLocaleDateString`, whose output
 *   is engine/locale dependent — assert it renders a localized (non-ISO)
 *   date in every engine.
 * - Marketing route smoke with console/pageerror collection (the WebGL
 *   globe and vanilla-JS demos are the most likely per-engine failures).
 */

const E2E_PASSWORD = "correct-horse-1"
const SEEDED_PROJECT_ID = "prj_01"

const SMOKE_ROUTES = ["/", "/pricing", "/docs"] as const

// Mirrors the benign-noise list in e2e/route-smoke.spec.ts; keep in sync.
const BENIGN_CONSOLE_PATTERNS: RegExp[] = [
  /favicon/i,
  /Download the React DevTools/i,
  /Encountered a script tag while rendering React component/i,
]
const BENIGN_PAGE_ERROR_PATTERNS: RegExp[] = [/WebGL|webgl|GPU|SwiftShader/i]

function collectPageIssues(page: Page) {
  const issues = { consoleErrors: [] as string[], pageErrors: [] as string[] }
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const text = `${message.text()} ${message.location()?.url ?? ""}`
    if (BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return
    issues.consoleErrors.push(text.trim())
  })
  page.on("pageerror", (error) => {
    const text = String(error)
    if (BENIGN_PAGE_ERROR_PATTERNS.some((pattern) => pattern.test(text))) return
    issues.pageErrors.push(text)
  })
  return issues
}

function expectNoPageIssues(issues: { consoleErrors: string[]; pageErrors: string[] }) {
  expect(
    issues.consoleErrors,
    `unexpected console errors:\n${issues.consoleErrors.join("\n")}`,
  ).toEqual([])
  expect(issues.pageErrors, `unexpected page errors:\n${issues.pageErrors.join("\n")}`).toEqual([])
}

test.describe("hydration-sensitive surfaces", () => {
  test("captures a referral code into localStorage after hydration", async ({ page }) => {
    await page.goto("/referral?ref=SPN-ABCD-EFGH")
    // ReferralTracker runs in useEffect — the write only happens once React
    // has hydrated, which is exactly what differs across engines.
    await page.waitForFunction(() => localStorage.getItem("spindle.referral-invite") !== null)
    const stored = await page.evaluate(() => localStorage.getItem("spindle.referral-invite"))
    expect(stored).toBe("SPN-ABCD-EFGH")
  })

  test("sign-in form submits from the keyboard in every engine", async ({ page, request }) => {
    // Provision the account through the real auth API (in-memory backend).
    await request.post("/api/auth/signup", {
      data: {
        workspaceName: "Cross-browser Workspace",
        email: "researcher@lab.edu",
        password: E2E_PASSWORD,
      },
    })

    await page.goto("/sign-in")
    await page.locator("#auth-email").focus()
    await page.keyboard.type("researcher@lab.edu")
    await page.keyboard.press("Tab")
    await page.keyboard.type(E2E_PASSWORD)
    await page.keyboard.press("Enter")

    await page.waitForURL("**/dashboard", { timeout: 15_000 })
    await expect(page.locator(".app-shell, main").first()).toBeVisible()
  })

  test("rejects bad credentials without leaving the sign-in page", async ({ page }) => {
    await page.goto("/sign-in")
    await page.locator("#auth-email").fill("researcher@lab.edu")
    await page.locator("#auth-password").fill("incorrect")
    await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()

    await expect(page.getByText("Invalid email or password")).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe("locale-sensitive rendering", () => {
  test("files grid renders localized (non-ISO) dates", async ({ page, context, baseURL }) => {
    await signInToMockApp(context, baseURL)
    await page.goto(`/projects/${SEEDED_PROJECT_ID}/files`)
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible({
      timeout: 15_000,
    })

    // formatDate() -> toLocaleDateString(undefined, { month: "short", day: "numeric" }).
    // Whatever the engine's locale, the output must not be the raw ISO string
    // and must contain a day number.
    const dates = page.locator(".fm-date")
    await expect(dates.first()).toBeVisible({ timeout: 15_000 })
    const count = await dates.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = (await dates.nth(i).textContent())?.trim() ?? ""
      expect(text, "file date cell is empty").not.toBe("")
      expect(text, `file date looks like raw ISO: "${text}"`).not.toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(text, `file date has no day number: "${text}"`).toMatch(/\d/)
    }
  })
})

test.describe("marketing smoke", () => {
  for (const path of SMOKE_ROUTES) {
    test(`${path} renders without console or page errors`, async ({ page }) => {
      const issues = collectPageIssues(page)
      const response = await page.goto(path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})

      expect(response?.status(), `${path} returned HTTP ${response?.status()}`).toBe(200)
      await expect(page.getByRole("main")).toBeVisible()
      expectNoPageIssues(issues)
    })
  }
})
