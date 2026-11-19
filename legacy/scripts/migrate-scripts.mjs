/* One-time migration: turns the original page scripts into importable init
   functions that a client component can run after hydration. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
mkdirSync(path.join(root, "src/lib/interactions"), { recursive: true })

const FILES = [
  { file: "script.js", out: "site.js", fn: "initSite" },
  { file: "automations.js", out: "automations.js", fn: "initAutomations" },
  { file: "lab.js", out: "lab.js", fn: "initLab" },
  { file: "collaboration.js", out: "collaboration.js", fn: "initCollaboration" },
  { file: "infrastructure.js", out: "infrastructure.js", fn: "initInfrastructure" },
  { file: "changelog.js", out: "changelog.js", fn: "initChangelog" },
]

for (const { file, out, fn } of FILES) {
  const source = readFileSync(path.join(root, file), "utf8")

  let body
  const iife = source.match(/\(function \(\) \{([\s\S]*)\}\)\(\);?\s*$/)
  if (iife) {
    body = iife[1]
  } else {
    // changelog.js is a flat script — wrap the whole thing.
    body = source.replace(/^\/\*[\s\S]*?\*\/\s*/, "")
  }

  const header = source.match(/^\/\*[\s\S]*?\*\//)?.[0] ?? ""
  const guard = `let started = false\n\nexport function ${fn}() {\n  if (started) return\n  started = true\n`
  const result = `${header}\n\n/* Runs after hydration from a client component. */\n${guard}${body}\n}\n`

  writeFileSync(path.join(root, "src/lib/interactions", out), result)
  console.log("wrote src/lib/interactions/" + out)
}
