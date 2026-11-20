import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

/**
 * Standalone vitest config for the webhook delivery-monitoring suite.
 *
 * The repo-root `vitest.config.mts` only includes tests under `src/`, so this
 * suite runs separately:
 *
 *   npx vitest run --config scripts/webhooks/monitoring/vitest.config.mts
 *
 * Node environment — pure log-analysis tests, no DOM.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 15000,
    hookTimeout: 15000,
    restoreMocks: true,
  },
})
