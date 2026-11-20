import path from "node:path"
import { fileURLToPath } from "node:url"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Runs every Storybook story (including `play` functions) in a real Chromium
// via Vitest browser mode. Requires Playwright browsers:
//   npx playwright install chromium
// See docs/storybook.md for details.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [storybookTest({ configDir: path.join(dirname, ".storybook") })],
        test: {
          name: "storybook",
          // Browser mode defaults to 15s; heavy stories (data-grid, card,
          // design-tokens) exceed that under full-suite load. Give headroom.
          testTimeout: 30000,
          hookTimeout: 30000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
})
