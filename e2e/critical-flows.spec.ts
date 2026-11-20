import { expect, test, type APIRequestContext, type Page } from "playwright/test"

/**
 * Critical flows against the dev server (NEXT_PUBLIC_MOCK_AUTH=1,
 * NEXT_PUBLIC_API_MODE=mock — both wired in playwright.config.ts). Auth is
 * real-first with an in-memory dev backend, so sign-in tests provision the
 * account through /api/auth/signup first; `email_taken` is fine because the
 * backend is shared for the whole dev-server run.
 */

const SEEDED_PROJECT_ID = "prj_01"
const E2E_PASSWORD = "correct-horse-1"

async function ensureAccount(request: APIRequestContext, email: string) {
  // The in-memory backend starts empty; signup also signs in, which is fine.
  await request.post("/api/auth/signup", {
    data: { workspaceName: "E2E Workspace", email, password: E2E_PASSWORD },
  })
}

async function signIn(page: Page, request: APIRequestContext, email = "researcher@lab.edu") {
  await ensureAccount(request, email)
  await page.goto("/sign-in")
  await page.locator("#auth-email").fill(email)
  await page.locator("#auth-password").fill(E2E_PASSWORD)
  await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()
  await page.waitForURL("**/dashboard")
}

/**
 * Signs in without the dialog: writes the same base64url session cookie the
 * mock auth persists, so the `(app)` server guard lets the request through.
 * Used by flow tests that are not themselves about the sign-in UI (which has
 * its own coverage in the auth describe block and auth-recovery.spec.ts).
 */
async function signInWithCookie(page: Page, baseURL: string | undefined) {
  const session = {
    user: { name: "Researcher", email: "researcher@lab.edu" },
    workspace: { name: "Personal workspace", slug: "personal" },
    signedInAt: new Date().toISOString(),
  }
  const value = Buffer.from(JSON.stringify(session), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  // `url` (not `domain`) so the cookie binds to whatever origin baseURL
  // points at — localhost in dev, 127.0.0.1 or a preview host in CI.
  await page
    .context()
    .addCookies([{ name: "spindle_mock_session", value, url: baseURL ?? "http://localhost:3000" }])
}

test.describe("authentication", () => {
  test("signs in through the sign-in page and lands in the app shell", async ({
    page,
    request,
  }) => {
    await signIn(page, request)

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator(".app-shell, main").first()).toBeVisible()
  })

  test("rejects bad credentials without leaving the sign-in page", async ({ page }) => {
    await page.goto("/sign-in")
    await page.locator("#auth-email").fill("researcher@lab.edu")
    await page.locator("#auth-password").fill("incorrect")
    await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()

    // Scope to text: Next.js also renders an empty route-announcer role=alert.
    await expect(page.getByText("Invalid email or password")).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test("carries a referral code through sign-in into the session", async ({ page, request }) => {
    // Extra navigations (/referral → /sign-in → /dashboard) plus cold
    // dev-server compiles can exceed the default 60s on a fresh CI runner.
    test.setTimeout(90_000)
    await ensureAccount(request, "researcher@lab.edu")
    await page.goto("/referral?ref=SPN-ABCD-EFGH")
    // ReferralTracker persists the code in an effect after hydration.
    await page.waitForFunction(() => localStorage.getItem("spindle.referral-invite") !== null)
    await page.goto("/sign-in")
    await page.locator("#auth-email").fill("researcher@lab.edu")
    await page.locator("#auth-password").fill(E2E_PASSWORD)
    await page.locator('form[aria-label="Sign in"] button[type="submit"]').click()
    await page.waitForURL("**/dashboard")

    const cookie = (await page.context().cookies()).find(
      (entry) => entry.name === "spindle_mock_session",
    )
    expect(cookie).toBeTruthy()
    const base64 = cookie!.value.replace(/-/g, "+").replace(/_/g, "/")
    const session = JSON.parse(Buffer.from(base64, "base64").toString("utf8"))
    expect(session.referredBy).toBe("SPN-ABCD-EFGH")
  })

  test("redirects signed-out visitors from app routes back to sign-in", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe("project create", () => {
  test("creates a project and opens its home", async ({ page, baseURL }) => {
    await signInWithCookie(page, baseURL)
    await page.goto("/projects")

    await page.getByRole("button", { name: "New project" }).first().click()
    await page.locator("#new-project-name").fill("E2E tidal survey")
    await page.getByRole("button", { name: "Create project" }).click()

    await page.waitForURL(/\/projects\/prj_\d+/)
    await expect(page.getByRole("heading", { name: "E2E tidal survey" })).toBeVisible()
  })
})

test.describe("file upload", () => {
  test("uploads a file into the project files view", async ({ page, baseURL }) => {
    await signInWithCookie(page, baseURL)
    await page.goto(`/projects/${SEEDED_PROJECT_ID}/files`)

    // The project layout shows "Loading project" until the mock API resolves;
    // cold dev-server compiles can exceed the default 5s expect timeout.
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible({ timeout: 15_000 })

    const fileName = `e2e-upload-${Date.now()}.csv`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/csv",
      buffer: Buffer.from("station,reading\nA1,1.2\n"),
    })

    // The mock upload simulates progress; the row appears once it finishes.
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("lab run", () => {
  test("runs a lab tool and shows it in the run history", async ({ page, baseURL }) => {
    await signInWithCookie(page, baseURL)
    await page.goto(`/projects/${SEEDED_PROJECT_ID}/lab`)

    await expect(page.getByRole("heading", { name: "Lab", exact: true })).toBeVisible({
      timeout: 15_000,
    })

    await page.locator(".app-lab-tool-card", { hasText: "Tide analysis" }).click()
    await page.getByRole("button", { name: "Run tool" }).click()

    // The simulated run completes ~2.4s after queueing; the new run is
    // auto-selected so its log shows the completion line.
    await expect(page.getByText("Run completed successfully.")).toBeVisible({
      timeout: 15_000,
    })
  })
})
