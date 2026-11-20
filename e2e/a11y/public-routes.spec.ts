import { expect, test, type Page } from "playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/**
 * axe-core accessibility audit for the public routes NOT covered by
 * e2e/a11y.spec.ts: the remaining `(site)` marketing/legal pages, a real
 * docs guide, the changelog, the referral landing, the `(auth)` account
 * pages, and the 404 page.
 *
 * Runs against whatever server PLAYWRIGHT_BASE_URL / the playwright webServer
 * config points at — all of these routes are public, so the production build
 * works (the CI job in .github/workflows/a11y.yml uses `npm start`).
 *
 * Fails on any `serious` or `critical` violation; `moderate`/`minor` findings
 * are logged, matching e2e/a11y.spec.ts.
 */

const SITE_ROUTES = [
  { path: "/about", name: "about" },
  { path: "/platform", name: "platform" },
  { path: "/solutions", name: "solutions" },
  { path: "/agent", name: "agent marketing" },
  { path: "/automations", name: "automations marketing" },
  { path: "/security", name: "security" },
  { path: "/contact", name: "contact" },
  { path: "/terms", name: "terms" },
  { path: "/privacy", name: "privacy" },
  { path: "/cookies", name: "cookies" },
  { path: "/dpa", name: "dpa" },
  { path: "/acceptable-use", name: "acceptable use" },
  { path: "/unsubscribe", name: "unsubscribe" },
  { path: "/changelog", name: "changelog" },
  // Real published guide slug (content/docs/quickstart.mdx, generated manifest).
  { path: "/docs/quickstart", name: "docs guide" },
  // Matches the `SPN-XXXX-XXXX` shape (src/lib/referral.ts REFERRAL_CODE_PATTERN).
  { path: "/r/SPN-ABCD-EFGH", name: "referral landing (valid code)" },
] as const

const AUTH_ROUTES = [
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
  { path: "/reset-password", name: "reset password" },
  { path: "/verify-email", name: "verify email" },
] as const

// A route that does not exist must render the site's 404 page, not a bare error.
const MISSING_ROUTE = "/e2e-a11y-missing-route"

// Same carve-out as e2e/a11y.spec.ts: decorative product-window mockups embed
// low-contrast pairs that need a dedicated design pass (tracked under
// issues/frontend/031-reduced-motion-keyboard-audit.md). The rule stays
// excluded so the gate still catches NEW violations of every other rule;
// remove entries as the underlying issues are fixed.
const KNOWN_ISSUE_RULES: string[] = ["color-contrast"]

async function auditPage(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()

  const blocking = results.violations.filter(
    (v) => (v.impact === "serious" || v.impact === "critical") && !KNOWN_ISSUE_RULES.includes(v.id),
  )
  const advisory = results.violations.filter(
    (v) => v.impact !== "serious" && v.impact !== "critical",
  )

  if (advisory.length > 0) {
    console.log(
      `[axe] ${advisory.length} moderate/minor finding(s):`,
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
}

test.describe("axe accessibility audit (extended public routes)", () => {
  for (const route of SITE_ROUTES) {
    test(`site: ${route.name} (${route.path}) has no serious axe violations`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})
      await auditPage(page)
    })
  }

  for (const route of AUTH_ROUTES) {
    test(`auth: ${route.name} (${route.path}) has no serious axe violations`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})
      await auditPage(page)
    })
  }

  test(`site: 404 page (${MISSING_ROUTE}) has no serious axe violations`, async ({ page }) => {
    test.setTimeout(90_000)
    const response = await page.goto(MISSING_ROUTE, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    expect(response?.status(), "missing route should return HTTP 404").toBe(404)
    await expect(page.getByRole("main")).toBeVisible()
    await auditPage(page)
  })
})
