import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * DEV-246: Shiki plus its grammars is the largest optional server dependency.
 * These source-level guards keep it out of the browser bundle; the build-time
 * counterpart that scans emitted chunks lives in
 * `scripts/check-client-bundle.mjs` (`npm run check:client-bundle`).
 */

const SRC_DIR = path.join(__dirname, "..")
const TEST_FILE = /\.test\.[tj]sx?$/
const SHIKI_IMPORT =
  /from\s+["'](?:shiki|@shikijs\/)[^"']*["']|import\s*\(\s*["'](?:shiki|@shikijs\/)/
// `import type` is erased at compile time and cannot pull Shiki into a bundle.
const SHIKI_TYPE_IMPORT = /import\s+type\s+[^;]*?from\s+["'](?:shiki|@shikijs\/)[^"']*["']/g

// Only files allowed to pull in Shiki at runtime. `import type` references
// (e.g. ThemedToken in code-block.tsx and the cron-snippet types) are erased
// at compile time and permitted anywhere.
const ALLOWED_SHIKI_FILES = new Set(["lib/code-highlight.ts"])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue
      yield* walk(full)
    } else if (/\.[tj]sx?$/.test(entry)) {
      yield full
    }
  }
}

function relative(file: string) {
  return path.relative(SRC_DIR, file).split(path.sep).join("/")
}

function shikiImporters() {
  const importers: string[] = []
  for (const file of walk(SRC_DIR)) {
    if (TEST_FILE.test(file)) continue
    const source = readFileSync(file, "utf8").replace(SHIKI_TYPE_IMPORT, "")
    if (SHIKI_IMPORT.test(source)) importers.push(relative(file))
  }
  return importers
}

describe("server-only code highlighting boundary", () => {
  it("only allows code-highlight.ts to import Shiki at runtime", () => {
    expect(shikiImporters().sort()).toEqual([...ALLOWED_SHIKI_FILES].sort())
  })

  it("code-block.tsx stays a Server Component with a type-only shiki import", () => {
    const source = readFileSync(path.join(SRC_DIR, "components/site/code-block.tsx"), "utf8")

    expect(source).not.toMatch(/^\s*["']use client["']/m)
    expect(source).toMatch(/^import type \{[^}]*\} from "shiki\/types"$/m)
    expect(source).not.toMatch(/^import\s*\{[^}]*\}\s*from "shiki/m)
  })

  it("docs shell, MDX component map, and doc blocks stay server-rendered", () => {
    for (const file of [
      "components/docs/docs-shell.tsx",
      "components/docs/doc-blocks.tsx",
      "mdx-components.tsx",
    ]) {
      const source = readFileSync(path.join(SRC_DIR, file), "utf8")
      expect(source, file).not.toMatch(/^\s*["']use client["']/m)
    }
  })

  it("no client component under src/components/docs imports Shiki", () => {
    const docsDir = path.join(SRC_DIR, "components", "docs")
    for (const file of walk(docsDir)) {
      const source = readFileSync(file, "utf8")
      if (!/^\s*["']use client["']/m.test(source)) continue
      expect(SHIKI_IMPORT.test(source), relative(file)).toBe(false)
    }
  })
})
