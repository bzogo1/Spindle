import { loadEnvConfig } from "@next/env"

import type { EnvSource } from "../../src/lib/env"
import { getServerEnv } from "../../src/lib/env.server"
import { checkRotationOverlap } from "../../src/lib/secrets"

// Run this after both the current and previous values are in place and before
// the previous value is removed. It proves the running code accepts both keys
// without printing either one.
loadEnvConfig(process.cwd())

const checks = checkRotationOverlap(getServerEnv() as EnvSource)
let failed = false

for (const check of checks) {
  const current = check.currentAccepted ? "ok" : "missing"
  const previous = !check.hasPrevious ? "not set" : check.previousAccepted ? "ok" : "rejected"

  console.log(`${check.key.padEnd(22)}  current=${current}  previous=${previous}`)

  if (!check.currentAccepted || (check.hasPrevious && !check.previousAccepted)) failed = true
}

if (failed) {
  console.error("")
  console.error(
    "A dual-key secret is missing or does not accept both keys. Do not remove the previous value.",
  )
  process.exitCode = 1
}
