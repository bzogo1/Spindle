/**
 * Demo / smoke check for the sliding-window rate limiter.
 *
 *   pnpm tsx scripts/rate-limit/demo.ts
 *
 * Exercises the limiter directly (deterministic, no server needed) and prints
 * the decisions. For end-to-end verification against a running app, see
 * docs/security/edge-rate-limiting.md § Testing.
 */
import {
  createSlidingWindowLimiter,
  rateLimitKey,
  RATE_LIMIT_TIERS,
} from "../../src/lib/rate-limit"

const limiter = createSlidingWindowLimiter({
  ...RATE_LIMIT_TIERS.auth,
  now: () => Date.now(),
})

const ip = "203.0.113.7"
console.log(
  `tier=auth limit=${RATE_LIMIT_TIERS.auth.limit} window=${RATE_LIMIT_TIERS.auth.windowMs}ms key=${rateLimitKey(new Request("https://app.spindle.app/", { headers: { "cf-connecting-ip": ip } }))}`,
)

for (let i = 1; i <= RATE_LIMIT_TIERS.auth.limit + 2; i += 1) {
  const d = limiter.check(`ip:${ip}`)
  console.log(
    `request ${String(i).padStart(2)}: allowed=${d.allowed} remaining=${d.remaining}` +
      (d.allowed ? "" : ` retryAfter=${d.retryAfterMs}ms`),
  )
}
