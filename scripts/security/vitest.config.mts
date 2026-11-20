import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

/**
 * Standalone vitest config for the security-headers audit suite.
 *
 * The repo-root `vitest.config.mts` only includes tests under `src/`, so
 * this suite runs separately:
 *
 *   npx vitest run --config scripts/security/vitest.config.mts
 *
 * Node environment (no jsdom) — these tests exercise pure audit functions
 * and the policy file, not components.
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
