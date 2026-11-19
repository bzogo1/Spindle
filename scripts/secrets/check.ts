import { loadEnvConfig } from "@next/env"

import type { EnvSource } from "../../src/lib/env"
import { getServerEnv } from "../../src/lib/env.server"
import { validateSecretEnvironment } from "../../src/lib/secrets/validate"

// The container entrypoint runs this after the secret store has injected the
// environment and before `next start`. It checks names and shape only; values
// never appear in the output.
loadEnvConfig(process.cwd())

const env = getServerEnv()
const requireAll = env.NODE_ENV === "production" || process.argv.includes("--production")
const result = validateSecretEnvironment(env as EnvSource, { requireAll })

if (result.issues.length > 0) {
  console.error("Invalid secret-store configuration:")

  for (const issue of result.issues) {
    console.error(`  ${issue.key.padEnd(28)}  ${issue.message}`)
  }

  console.error("")
  console.error("See docs/runbooks/secrets-rotation.md and the secret store for this environment.")
  process.exitCode = 1
} else if (requireAll) {
  console.log(`Secret store configuration is valid (${result.present.length} variables present).`)
} else {
  console.log(
    `Secret store configuration is valid (${result.present.length} present, ${result.missing.length} missing; pass --production to require every name).`,
  )
}
