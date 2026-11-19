import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import prettier from "eslint-config-prettier"

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  fetch: "readonly",
  HTMLElement: "readonly",
  Element: "readonly",
  Node: "readonly",
  Event: "readonly",
  CustomEvent: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  File: "readonly",
  FileReader: "readonly",
  Blob: "readonly",
  Image: "readonly",
  MutationObserver: "readonly",
  ResizeObserver: "readonly",
  IntersectionObserver: "readonly",
  requestIdleCallback: "readonly",
  process: "readonly",
  performance: "readonly",
  getComputedStyle: "readonly",
}

export default [
  {
    ignores: [
      "node_modules/",
      ".node_modules.original/",
      ".next/",
      "coverage/",
      "dist/",
      "legacy/",
      "Home - Simple_files/",
      "public/",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-irregular-whitespace": "off",
      // Configuration is validated in one place; read it through src/lib/env.ts.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read environment variables through src/lib/env.ts (clientEnv, serverEnv, or getBuildEnv).",
        },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Entrypoints and test tooling read process.env directly; application code
    // must use the accessors in src/lib/env.ts.
    files: [
      "next.config.ts",
      "src/lib/env.ts",
      "src/lib/env.server.ts",
      "scripts/validate-env.ts",
      ".test_infra.mjs",
      "playwright.config.ts",
    ],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    // Screens consume the API through @/lib/api hooks and types only; mock
    // fixtures and adapter internals stay behind the adapter boundary.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/mock", "@/lib/mock/**", "**/lib/mock", "**/lib/mock/**"],
              message: "Do not import mock modules in screens. Use hooks and types from @/lib/api.",
            },
            {
              group: ["@/lib/api/adapters", "@/lib/api/adapters/**", "**/lib/api/adapters/**"],
              message:
                "Adapters are internal to @/lib/api. Import the client, hooks, and types from @/lib/api.",
            },
          ],
        },
      ],
    },
  },
  prettier,
]
