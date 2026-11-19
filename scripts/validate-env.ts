import { loadEnvConfig } from "@next/env"

import { EnvValidationError, validateEnv } from "../src/lib/env.server"

// Load .env* files the same way Next.js does, then validate the schema once.
// `next build` and `next start` run the same validation through next.config.ts;
// container entrypoints can also call this with `--production` before starting.
loadEnvConfig(process.cwd())

const mode = process.argv.includes("--production") ? "production" : process.env.NODE_ENV
const source = mode ? { ...process.env, NODE_ENV: mode } : process.env

try {
  const { server } = validateEnv(source)
  console.log(`Environment configuration is valid (${server.NODE_ENV}).`)
} catch (error) {
  if (!(error instanceof EnvValidationError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
