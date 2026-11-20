#!/usr/bin/env node
/**
 * Demo / inspection script for the tiered rate-limit model.
 *
 * Usage:
 *   npx tsx scripts/rate-limit/tiers.mjs          # print the tier matrix
 *   npx tsx scripts/rate-limit/tiers.mjs --demo   # also walk sample requests
 *
 * Read-only: prints the effective limits a request would get. See
 * docs/api/rate-limit-tiers.md for the full design.
 */
import {
  ENDPOINT_LIMIT_OVERRIDES,
  RATE_LIMIT_MATRIX,
  rateLimitBucketKey,
  rateLimitHeaders,
  resolveLimit,
  resolveTier,
} from "../../src/lib/rate-limit/tiers.ts"

const MINUTE = 60_000

function fmt(window) {
  const { limit, windowMs } = window
  const unit = (n, name) => (n === 1 ? `/${name}` : `/${n}${name}`)
  if (windowMs % (60 * MINUTE) === 0) return `${limit}${unit(windowMs / (60 * MINUTE), "hour")}`
  if (windowMs % MINUTE === 0) return `${limit}${unit(windowMs / MINUTE, "min")}`
  return `${limit}/${windowMs}ms`
}

console.log("Rate-limit tiers × endpoint classes (per instance, per bucket key)\n")
for (const [tier, classes] of Object.entries(RATE_LIMIT_MATRIX)) {
  const row = Object.entries(classes)
    .map(([cls, w]) => `${cls}=${fmt(w)}`)
    .join("  ")
  console.log(`  ${tier.padEnd(13)} ${row}`)
}

console.log(`\nPer-route overrides (${Object.keys(ENDPOINT_LIMIT_OVERRIDES).length} routes)`)
for (const [route, w] of Object.entries(ENDPOINT_LIMIT_OVERRIDES)) {
  console.log(`  ${route.padEnd(42)} ${fmt(w)}`)
}

if (process.argv.includes("--demo")) {
  const samples = [
    {
      label: "anonymous POST /api/auth/signin",
      path: "/api/auth/signin",
      principal: {},
      cls: "auth",
      ip: "203.0.113.7",
    },
    {
      label: "anonymous GET /api/docs (no override)",
      path: "/api/docs",
      principal: {},
      cls: "read",
      ip: "203.0.113.7",
    },
    {
      label: "anonymous POST /api/contact",
      path: "/api/contact",
      principal: {},
      cls: "write",
      ip: "203.0.113.7",
    },
    {
      label: "authenticated GET /api/profile",
      path: "/api/profile",
      principal: { userId: "u_42" },
      cls: "read",
      ip: "198.51.100.9",
    },
    {
      label: "authenticated GET /api/analytics/summary",
      path: "/api/analytics/summary",
      principal: { userId: "u_42" },
      cls: "expensive",
      ip: "198.51.100.9",
    },
    {
      label: "api-key GET /api/widgets (future)",
      path: "/api/widgets",
      principal: { apiKeyId: "k_live_1" },
      cls: "read",
      ip: "192.0.2.4",
    },
  ]

  console.log("\nSample resolutions")
  for (const s of samples) {
    const tier = resolveTier(s.principal)
    const limit = resolveLimit(tier, s.cls, s.path)
    const bucket = rateLimitBucketKey(tier, { ...s.principal, ip: s.ip })
    const headers = rateLimitHeaders({
      limit: limit.limit,
      remaining: limit.limit - 1,
      resetAt: Date.now() + limit.windowMs,
    })
    console.log(`  ${s.label}`)
    console.log(`    tier=${tier} class=${s.cls} bucket=${bucket} limit=${fmt(limit)}`)
    console.log(`    headers: ${JSON.stringify(headers)}`)
  }
}
