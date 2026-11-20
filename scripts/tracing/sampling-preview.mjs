#!/usr/bin/env node
/**
 * Simulates trace-sampling decisions from src/lib/tracing/sampling/policy.ts
 * against sample transaction names — no Sentry init, no network.
 *
 * Usage:
 *   npx tsx scripts/tracing/sampling-preview.mjs --demo
 *   npx tsx scripts/tracing/sampling-preview.mjs "GET /api/projects" "/pricing" ...
 *
 * Requires tsx (already a devDependency) because the policy module is TS:
 *   npx tsx scripts/tracing/sampling-preview.mjs --demo
 */

import { decideTraceSample, recommendedPolicy } from "../../src/lib/tracing/sampling/policy.ts"

const DEMO_NAMES = [
  // Marketing / docs
  "/",
  "/pricing",
  "/docs/getting-started",
  "/blog/introducing-spindle",
  // App routes
  "/projects",
  "/projects/abc-123",
  "/settings/billing",
  // API routes
  "GET /api/projects",
  "GET /api/projects/abc-123/runs",
  "POST /api/agent-runs",
  "GET /api/notifications",
  // Static / noise
  "/_next/static/chunks/main.js",
  // Error-biased cases (simulated via attributes where supported)
]

const TRACES_PER_NAME = 20

function run(names) {
  const policy = recommendedPolicy()
  let kept = 0
  let total = 0
  for (const name of names) {
    // Deterministic pseudo trace ids per name so repeat runs are stable and
    // each route shows its realized keep ratio, not a single coin flip.
    const decisions = Array.from({ length: TRACES_PER_NAME }, (_, i) =>
      decideTraceSample({ transactionName: name, traceId: `preview:${name}:${i}` }, policy),
    )
    const n = decisions.filter((d) => d.sample).length
    kept += n
    total += decisions.length
    const d0 = decisions[0]
    console.log(
      `keep ${String(n).padStart(2)}/${TRACES_PER_NAME}  rate=${d0.rate.toFixed(2).padStart(4)}  ${d0.source.padEnd(18)} ${name}`,
    )
    const forced = decisions.find((d) => d.forcedBy)
    if (forced) console.log(`      ↳ forced keep example: ${forced.reason}`)
  }
  console.log(`\n${kept}/${total} kept (${Math.round((kept / total) * 100)}%)`)
}

const args = process.argv.slice(2)
if (args.includes("--demo") || args.length === 0) {
  run(DEMO_NAMES)

  // Also demonstrate error bias and a slow-trace forced keep.
  console.log("\n--- error / tail-based signals ---")
  const policy = recommendedPolicy()
  for (const [label, ctx] of [
    [
      "GET /api/projects (500 error tag)",
      { transactionName: "GET /api/projects", traceId: "e1", tags: { "http.status_code": "500" } },
    ],
    [
      "GET /api/slow (9s duration)",
      { transactionName: "GET /api/slow", traceId: "e2", durationMs: 9000 },
    ],
  ]) {
    const d = decideTraceSample(ctx, policy)
    console.log(
      `${d.sample ? "KEEP " : "drop "} rate=${d.rate.toFixed(2)}  ${d.source.padEnd(22)} ${label}`,
    )
  }
} else {
  run(args)
}
