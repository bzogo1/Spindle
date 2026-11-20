import { expect, test } from "playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

import { signInToMockApp } from "../visual/visual-helpers"

/**
 * axe-core accessibility audit for the authenticated `(app)` routes NOT
 * covered by e2e/app-a11y.spec.ts: the global app pages (`/app/*`), the
 * remaining dashboard pages, and the project home/activity/settings pages.
 *
 * Runs against the mock-auth dev server (NEXT_PUBLIC_MOCK_AUTH=1 — wired in
 * playwright.config.ts), same as app-a11y.spec.ts: the mock-session cookie is
 * planted via the shared visual-helpers helper and the mock API adapter
 * serves deterministic data without a backend.
 *
 * Fails on any `serious` or `critical` violation; `moderate`/`minor` findings
 * are logged, matching e2e/a11y.spec.ts.
 */

const SEEDED_PROJECT_ID = "prj_01"

const ROUTES = [
  { path: "/app/chat", name: "app chat" },
  { path: "/app/agent", name: "app agent" },
  { path: "/app/account", name: "account settings" },
  { path: "/app/account/notifications", name: "notification settings" },
  { path: "/app/automations", name: "automations" },
  { path: "/app/cohorts", name: "cohorts" },
  { path: "/app/feedback", name: "feedback" },
  { path: "/app/files", name: "app files" },
  { path: "/app/lab", name: "app lab" },
  { path: "/app/nps", name: "nps" },
  { path: "/app/profile", name: "profile" },
  { path: "/dashboard/members", name: "team members" },
  { path: "/dashboard/notifications", name: "dashboard notifications" },
  { path: "/dashboard/usage", name: "usage" },
  { path: `/projects/${SEEDED_PROJECT_ID}`, name: "project home" },
  { path: `/projects/${SEEDED_PROJECT_ID}/activity`, name: "project activity" },
  { path: `/projects/${SEEDED_PROJECT_ID}/settings`, name: "project settings" },
] as const

// Same carve-out as e2e/app-a11y.spec.ts: decorative product-window mockups
// embed low-contrast pairs that need a dedicated design pass (tracked under
// issues/frontend/031-reduced-motion-keyboard-audit.md). The rule stays
// excluded so the gate still catches NEW violations of every other rule;
// remove entries as the underlying issues are fixed.
const KNOWN_ISSUE_RULES: string[] = ["color-contrast"]

test.describe("axe accessibility audit (app shell, extended)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInToMockApp(context, baseURL)
  })

  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) has no serious axe violations`, async ({ page }) => {
      // App routes compile lazily on the dev server and the mock adapter adds
      // simulated latency; give axe headroom.
      test.setTimeout(90_000)
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      // Prove we got past the (app) guard into the shell before scanning.
      await expect(page.locator(".app-shell, main").first()).toBeVisible()
      await page.waitForLoadState("networkidle").catch(() => {})
      // Some app pages client-side navigate once mock data resolves; let the
      // DOM settle so axe doesn't scan a document mid-navigation.
      await page.waitForTimeout(500)

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()

      const blocking = results.violations.filter(
        (v) =>
          (v.impact === "serious" || v.impact === "critical") && !KNOWN_ISSUE_RULES.includes(v.id),
      )
      const advisory = results.violations.filter(
        (v) => v.impact !== "serious" && v.impact !== "critical",
      )

      if (advisory.length > 0) {
        console.log(
          `[axe ${route.path}] ${advisory.length} moderate/minor finding(s):`,
          advisory.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} node(s))`).join(", "),
        )
      }

      expect(
        blocking,
        blocking
          .map(
            (v) =>
              `${v.id} (${v.impact}): ${v.help}\n` +
              v.nodes
                .slice(0, 3)
                .map((n) => `  - ${n.target.join(" ")}: ${n.failureSummary ?? ""}`)
                .join("\n"),
          )
          .join("\n\n"),
      ).toEqual([])
    })
  }
})

// Keyboard/landmark checks axe's WCAG rule set does not cover: the app-shell
// skip link (WCAG 2.4.1) and the banner/main landmarks (the `region`
// best-practice rule is not in the wcag2a/aa tag set). The app shell has a
// topbar <header> and <main> but no site-wide contentinfo footer.
test.describe("app shell keyboard and landmarks", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInToMockApp(context, baseURL)
  })

  test("skip link jumps to #main-content", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
    await expect(page.locator(".app-shell, main").first()).toBeVisible()
    await page.waitForLoadState("networkidle").catch(() => {})

    const skipLink = page.getByRole("link", { name: "Skip to content" })
    await page.keyboard.press("Tab")
    await expect(skipLink).toBeFocused()

    await page.keyboard.press("Enter")
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("exposes banner and main landmarks", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
    await expect(page.locator(".app-shell, main").first()).toBeVisible()
    await page.waitForLoadState("networkidle").catch(() => {})

    await expect(page.getByRole("banner")).toBeVisible()
    await expect(page.getByRole("main")).toBeVisible()
  })
})
