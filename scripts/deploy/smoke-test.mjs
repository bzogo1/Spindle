#!/usr/bin/env node
// Post-deploy smoke test for the staging origin. Runs anywhere with Node 22+;
// it needs no cloud credentials, only the public staging URL.
//
//   SPINDLE_SMOKE_BASE_URL=https://staging.spindle.app node scripts/deploy/smoke-test.mjs
//
// Environment:
//   SPINDLE_SMOKE_BASE_URL   Base URL of the deployed app (required).
//   SPINDLE_SMOKE_PATHS       Comma-separated checks (default below). Each entry
//                             is `path` (expects HTTP 200) or `path=status` for
//                             an explicit expected status, e.g. `/api/x=401`.
//   SPINDLE_SMOKE_RETRIES     Attempts per path before failing (default 12).
//   SPINDLE_SMOKE_DELAY_MS    Delay between attempts in ms (default 5000).
//   SPINDLE_SMOKE_TIMEOUT_MS  Per-request timeout in ms (default 10000).
//
// The default paths exercise the surfaces CI already treats as public: the
// marketing home page, the changelog feed page, the infrastructure page, and
// the auth session endpoint (200 with `session: null` when signed out).
import { env } from "node:process"

const DEFAULT_PATHS = "/,/changelog,/infrastructure,/api/auth/session"

function fail(message) {
  console.error(`smoke-test: ${message}`)
  process.exit(1)
}

const baseUrl = (env.SPINDLE_SMOKE_BASE_URL ?? "").replace(/\/+$/, "")
if (!baseUrl) fail("SPINDLE_SMOKE_BASE_URL is required")

const retries = Number(env.SPINDLE_SMOKE_RETRIES ?? 12)
const delayMs = Number(env.SPINDLE_SMOKE_DELAY_MS ?? 5000)
const timeoutMs = Number(env.SPINDLE_SMOKE_TIMEOUT_MS ?? 10_000)

const checks = (env.SPINDLE_SMOKE_PATHS ?? DEFAULT_PATHS)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [path, expected] = entry.split("=")
    if (!path.startsWith("/")) fail(`invalid smoke path: ${entry}`)
    const status = expected === undefined ? 200 : Number(expected)
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      fail(`invalid expected status in: ${entry}`)
    }
    return { path, status }
  })

if (checks.length === 0) fail("SPINDLE_SMOKE_PATHS resolved to no checks")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function probe(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "spindle-deploy-smoke/1.0" },
    })
    // Drain a bounded amount so keep-alive sockets can be reused.
    await response.arrayBuffer().catch(() => {})
    return response.status
  } finally {
    clearTimeout(timer)
  }
}

let failed = false

for (const check of checks) {
  const url = `${baseUrl}${check.path}`
  let lastError = "no attempts made"
  let ok = false

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const status = await probe(url, timeoutMs)
      if (status === check.status) {
        console.log(`ok    ${check.path} -> ${status} (attempt ${attempt})`)
        ok = true
        break
      }
      lastError = `HTTP ${status}, expected ${check.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (attempt < retries) await sleep(delayMs)
  }

  if (!ok) {
    failed = true
    console.error(`FAIL  ${check.path} -> ${lastError} after ${retries} attempts`)
  }
}

if (failed) {
  console.error(`smoke-test: ${baseUrl} did not pass all checks`)
  process.exit(1)
}

console.log(`smoke-test: ${baseUrl} passed ${checks.length} check(s)`)
