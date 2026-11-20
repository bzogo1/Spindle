import { expect, test } from "playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

import { signInToMockApp } from "./visual/visual-helpers"

/**
 * axe-core accessibility audit for the Lab snapshot-intelligence surfaces.
 *
 * Complements the static checker in `src/lib/lab-snapshots/a11y.ts` (which
 * runs on stored snapshot markup) with a real-browser audit:
 *  - /lab                 public marketing page
 *  - /app/lab/snapshots   authenticated snapshot-intelligence demo page
 *    (mock-session cookie via signInToMockApp, same as app-a11y.spec.ts)
 *
 * Fails on any `serious`/`critical` violation; moderate/minor findings are
 * logged. `color-contrast` is excluded for the same known decorative
 * mockup issues documented in e2e/a11y.spec.ts / e2e/app-a11y.spec.ts.
 */

const KNOWN_ISSUE_RULES: string[] = ["color-contrast"]

const PUBLIC_ROUTES = [{ path: "/lab", name: "lab marketing" }] as const

const APP_ROUTES = [{ path: "/app/lab/snapshots", name: "lab snapshots" }] as const

test.describe("axe audit — lab public routes", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} (${route.path}) has no serious axe violations`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})

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
        console.log(`[axe ${route.path}] ${advisory.length} moderate/minor finding(s)`)
      }
      expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toHaveLength(0)
    })
  }
})

test.describe("axe audit — lab app routes", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInToMockApp(context, baseURL)
  })

  for (const route of APP_ROUTES) {
    test(`${route.name} (${route.path}) has no serious axe violations`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})

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
        console.log(`[axe ${route.path}] ${advisory.length} moderate/minor finding(s)`)
      }
      expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toHaveLength(0)
    })
  }
})
