#!/usr/bin/env node
/**
 * Alias for the API deprecation checker.
 *
 * The implementation lives next to the deprecations registry at
 * `scripts/api/deprecation/check.mjs`; this file exists so the check is
 * discoverable from `docs/api/` alongside the policy it enforces
 * (`docs/api/deprecation.md`).
 *
 * Usage: `node docs/api/deprecation-check.mjs [--json] [--demo]`
 * Exit codes: 0 = clean, 1 = violations, 2 = usage/config error.
 */

import { runCheck, printText } from "../../scripts/api/deprecation/check.mjs"

// Re-implement the CLI surface here so flags behave identically to the
// canonical script (the canonical script only self-executes when invoked
// directly).
const argv = process.argv.slice(2)
const opts = { json: false, demo: false, root: null, registry: null, minNoticeDays: 90 }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--json") opts.json = true
  else if (a === "--demo") opts.demo = true
  else if (a === "--root") opts.root = argv[++i]
  else if (a === "--registry") opts.registry = argv[++i]
  else if (a === "--min-notice-days") opts.minNoticeDays = Number(argv[++i])
  else if (a === "-h" || a === "--help") {
    console.log(
      "Usage: deprecation-check.mjs [--json] [--demo] [--root dir] [--registry file] [--min-notice-days N]",
    )
    process.exit(0)
  } else {
    console.error(`deprecation-check.mjs: unknown argument ${a}`)
    process.exit(2)
  }
}

const result = runCheck(opts)
if (opts.json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  if (opts.demo) console.log("=== DEMO MODE (fixture tree in tmpdir) ===")
  printText(result)
  if (opts.demo && !result.fatal) console.log(`Demo root: ${result.root}`)
}
process.exit(result.fatal ? 2 : result.ok ? 0 : 1)
