import { expect, test } from "playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

import { signInToMockApp } from "./visual/visual-helpers"

/**
 * axe-core accessibility audit for the authenticated `(app)` surfaces.
 *
 * Runs against the mock-auth dev server (NEXT_PUBLIC_MOCK_AUTH=1 — wired in
 * playwright.config.ts), so it belongs to the same CI job as
 * critical-flows.spec.ts, NOT the production-build job. The mock-session
 * cookie is planted via the shared visual-helpers helper; the mock API
 * adapter serves deterministic data without a backend.
 *
 * Fails on any `serious` or `critical` violation; `moderate`/`minor` findings
 * are logged, matching e2e/a11y.spec.ts.
 */

const SEEDED_PROJECT_ID = "prj_01"

const ROUTES = [
  { path: "/dashboard", name: "dashboard" },
  { path: "/projects", name: "projects" },
  { path: `/projects/${SEEDED_PROJECT_ID}/files`, name: "project files" },
  { path: `/projects/${SEEDED_PROJECT_ID}/lab`, name: "project lab" },
  { path: `/projects/${SEEDED_PROJECT_ID}/chat`, name: "project chat" },
  { path: `/projects/${SEEDED_PROJECT_ID}/agent`, name: "project agent" },
  { path: "/app/settings", name: "app settings" },
] as const

// Known pre-existing violations in the app shell that need src/ fixes (this
// spec only gates CI; the fixes belong to the components, not the test).
// Remove entries as the underlying issues are fixed.
const KNOWN_ISSUE_RULES: string[] = [
  // color-contrast: the offline presence-member failure (3.33:1, #646c66 on
  // #141715 in .app-chat-presence-member) is FIXED — offline members now use
  // --app-text-dim via .app-chat-presence-member--offline (≥4.5:1 both themes)
  // and project chat passes this rule un-excluded. The rule stays excluded for
  // the remaining decorative product-window mockups embedded in /projects and
  // /projects/[id]/files (.tok-com ~3.7:1, .fm-type/.fm-date/.fm-size ~3.9:1,
  // .mini-avatar ~3.8–4.5:1, #routeStrip ~2.1:1) — the same known issues
  // documented in e2e/a11y.spec.ts for the marketing routes.
  "color-contrast",
]

test.describe("axe accessibility audit (app shell)", () => {
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
