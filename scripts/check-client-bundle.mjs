/**
 * Fails the build if Shiki (or its grammar/TextMate runtime) leaks into the
 * client bundle under `.next/static`. Docs code highlighting must stay
 * server-side: `src/lib/code-highlight.ts` is only reachable from async
 * Server Components, and `src/components/site/code-block.tsx` imports
 * `shiki/types` with `import type`.
 *
 * Run after `next build` (wired as `postbuild`). To check an existing build
 * manually: `npm run check:client-bundle`.
 */

import fs from "node:fs"
import path from "node:path"

const staticDir = path.join(process.cwd(), ".next", "static")

if (!fs.existsSync(staticDir)) {
  console.error("check-client-bundle: .next/static not found — run `npm run build` first.")
  process.exit(1)
}

// Strings that only appear in Shiki, @shikijs grammar, or TextMate/oniguruma
// runtime code. They survive minification because they live in shipped string
// literals, grammar scopes, and package identifiers.
const MARKERS = [
  /shiki/i,
  /@shikijs/,
  /vscode-textmate/,
  /vscode-oniguruma/,
  /oniguruma\.wasm/,
  /createHighlighterCore/,
]

const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".css", ".html", ".json", ".map"])

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) yield full
  }
}

const offenders = []
let scanned = 0
let totalBytes = 0

for (const file of walk(staticDir)) {
  scanned += 1
  totalBytes += fs.statSync(file).size
  const content = fs.readFileSync(file, "utf8")
  const hit = MARKERS.find((marker) => marker.test(content))
  if (hit) offenders.push({ file: path.relative(process.cwd(), file), marker: hit.source })
}

if (offenders.length > 0) {
  console.error("check-client-bundle: FAIL — Shiki/TextMate code found in client chunks:")
  for (const { file, marker } of offenders) {
    console.error(`  ${file}  (matched /${marker}/)`)
  }
  console.error(
    "Keep highlighting server-side: do not import `code-highlight` from a client component, and keep `shiki/types` as `import type`.",
  )
  process.exit(1)
}

console.log(
  `check-client-bundle: OK — scanned ${scanned} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB) in .next/static; no Shiki markers found.`,
)
