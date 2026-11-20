import { readFileSync } from "node:fs"
import path from "node:path"

import { test } from "playwright/test"

import { expectVisual, gotoVisual } from "../visual/visual-helpers"

/**
 * Component-level visual regression for every Storybook story.
 *
 * Reads the built index (`storybook-static/index.json`, produced by
 * `npm run build-storybook`) and generates one test per story per theme
 * (dark + light, driven by the `theme` toolbar global). Each test loads the
 * story directly through `iframe.html?id=<story-id>&viewMode=story` — the
 * same URL the Storybook UI iframe uses — so no manager chrome is captured.
 *
 * Determinism comes from the shared helpers in `e2e/visual/visual-helpers.ts`
 * (fixed clock, reduced motion, fonts/networkidle settle, canvas masking).
 * Baselines: `e2e/storybook-visual/baselines/stories.spec/<story-id>-<theme>-chromium-linux.png`.
 */

type StorybookIndexEntry = {
  id?: string
  title: string
  name: string
  type?: string
  subtype?: string
}

type StorybookIndex = {
  v: number
  entries: Record<string, StorybookIndexEntry>
}

const THEMES = ["dark", "light"] as const

const indexPath = path.resolve(process.cwd(), "storybook-static", "index.json")
const index = JSON.parse(readFileSync(indexPath, "utf8")) as StorybookIndex

// Only renderable stories — skip docs pages, autodocs, and test-only entries.
const stories = Object.entries(index.entries).filter(
  ([, entry]) => entry.type === "story" && entry.subtype !== "test",
)

if (stories.length === 0) {
  throw new Error(`No stories found in ${indexPath}. Run \`npm run build-storybook\` first.`)
}

for (const [storyId, entry] of stories) {
  for (const theme of THEMES) {
    test(`${entry.title} / ${entry.name} (${theme})`, async ({ page }) => {
      await gotoVisual(
        page,
        `/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story&globals=theme:${theme}`,
      )
      // Wait until the story has actually rendered into the preview root —
      // networkidle can fire before the lazy story chunk mounts.
      await page
        .waitForFunction(
          () => {
            const root = document.querySelector("#storybook-root, #root")
            return root !== null && root.childElementCount > 0
          },
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => {})
      await expectVisual(page, `${storyId}-${theme}.png`)
    })
  }
}
