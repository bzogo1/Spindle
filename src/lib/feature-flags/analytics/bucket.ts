/**
 * Deterministic bucketing helpers for flag analytics.
 *
 * Uses cyrb53 (a 53-bit non-cryptographic hash) — dependency-free, synchronous,
 * and identical in browser and Node. This is a *diagnostic* bucket space for
 * analytics events; the flag system's own assignment buckets (FNV-1a based,
 * see `../evaluate.ts` `hashToBucket` and `../rollout/hash.ts` `hashBucket`)
 * should be passed through `recordFlagExposure({ bucket })` when available so
 * reported buckets match rollout decisions exactly.
 */

/** cyrb53 — public-domain-style string hash returning an unsigned 53-bit int. */
function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Stable bucket for (flag, userKey) in `[0, bucketCount)`.
 *
 * Namespacing by flag means the same user gets independent buckets per flag —
 * required so rollouts don't correlate across features.
 */
export function bucketIndex(flag: string, userKey: string, bucketCount = 100): number {
  const count = Math.max(1, Math.floor(bucketCount))
  const hash = cyrb53(`${flag}\n${userKey}`)
  return hash % count
}

/**
 * Non-identifying subject identifier stored on analytics events.
 *
 * Two independent cyrb53 passes (different seeds) produce 16 hex chars —
 * enough to count unique subjects and measure stickiness, not enough to be
 * reversed or joined back to a person. Scoped per flag so the same subject
 * hash differs across flags.
 */
export function subjectHash(flag: string, userKey: string): string {
  const scoped = `${flag}\n${userKey}`
  const a = cyrb53(scoped, 0x9e3779b9) >>> 0
  const b = cyrb53(scoped, 0x85ebca6b) >>> 0
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}
