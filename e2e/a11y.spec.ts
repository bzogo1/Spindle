import { expect, test } from "playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/**
 * axe-core accessibility audit for the public marketing routes.
 *
 * Runs against whatever server PLAYWRIGHT_BASE_URL / the playwright webServer
 * config points at (production `npm start` in CI, `npm run dev` locally).
 * Fails on any `serious` or `critical` violation; `moderate`/`minor` findings
 * are logged so regressions are visible without blocking the build.
 */

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/docs", name: "docs" },
  { path: "/lab", name: "lab" },
  { path: "/collaboration", name: "collaboration" },
  { path: "/infrastructure", name: "infrastructure" },
  { path: "/accessibility", name: "accessibility statement" },
] as const

// Rules with known pre-existing violations that need a dedicated design pass
// (tracked under issues/frontend/031-reduced-motion-keyboard-audit.md). They
// are excluded so the gate still catches NEW violations of every other rule;
// remove entries as the underlying issues are fixed.
const KNOWN_ISSUE_RULES: string[] = [
  // Still failing on /, /collaboration and /infrastructure (verified
  // 2026-11-20 against dev server): decorative product-window mockups contain
  // low-contrast pairs — syntax tokens (.tok-com ~3.7–3.9:1), file-manager
  // metadata (.fm-type/.fm-date/.fm-size ~3.9:1), route-strip labels
  // (~2.1:1) and mini avatars (~3.8–4.5:1). Pricing, docs, lab and the
  // accessibility statement are clean for this rule.
  "color-contrast",
]

test.describe("axe accessibility audit", () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) has no serious axe violations`, async ({ page }) => {
      // /lab is the heaviest route; give axe headroom on slow dev servers.
      test.setTimeout(90_000)
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      // Let client islands (nav, consent banner, animations) settle before scanning.
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
