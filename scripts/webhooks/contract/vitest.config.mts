import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

/**
 * Standalone vitest config for the webhook contract suite.
 *
 * The repo-root `vitest.config.mts` only includes tests under `src/`, so
 * this suite runs separately:
 *
 *   npx vitest run --config scripts/webhooks/contract/vitest.config.mts
 *
 * Node environment (no jsdom) — these tests exercise HTTP delivery and
 * node:crypto, not components.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 15000,
    hookTimeout: 15000,
    restoreMocks: true,
  },
})
