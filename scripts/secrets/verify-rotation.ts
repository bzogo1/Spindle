import { loadEnvConfig } from "@next/env"

import type { EnvSource } from "../../src/lib/env"
import { getServerEnv } from "../../src/lib/env.server"
import { checkRotationOverlap } from "../../src/lib/secrets"

// Run this after both the current and previous values are in place and before
// the previous value is removed. It proves the running code accepts both keys
// without printing either one.
//
// Pass --expect-previous-removed after cleanup instead: the run then fails if
// any *_PREVIOUS value is still set, proving the overlap window has closed.
loadEnvConfig(process.cwd())

const expectPreviousRemoved = process.argv.includes("--expect-previous-removed")

const checks = checkRotationOverlap(getServerEnv() as EnvSource)
let failed = false
let previousStillSet = false

for (const check of checks) {
  const current = check.currentAccepted ? "ok" : "missing"
  const previous = !check.hasPrevious ? "not set" : check.previousAccepted ? "ok" : "rejected"

  console.log(`${check.key.padEnd(22)}  current=${current}  previous=${previous}`)

  if (expectPreviousRemoved && check.hasPrevious) previousStillSet = true
  if (
    !check.currentAccepted ||
    (!expectPreviousRemoved && check.hasPrevious && !check.previousAccepted)
  ) {
    failed = true
  }
}

if (failed || previousStillSet) {
  console.error("")
  if (previousStillSet) {
    console.error(
      "A previous secret value is still set. Remove it before recording the rotation as complete.",
    )
  }
  if (failed) {
    console.error(
      "A dual-key secret is missing or does not accept both keys. Do not remove the previous value.",
    )
  }
  process.exitCode = 1
}
