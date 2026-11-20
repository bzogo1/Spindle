/**
 * Deterministic hashing for experiment assignment and analytics.
 *
 * The assignment hash is FNV-1a 32-bit — the same algorithm used by
 * `src/lib/feature-flags/rollout/hash.ts` — fast, dependency-free and stable
 * across runtimes. It is NOT cryptographic; it only needs to distribute
 * identities evenly enough for traffic splits and variant weights.
 *
 * DO NOT change the algorithm or the input format without re-keying every
 * running experiment — assignments would reshuffle mid-flight.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
/** Bucket space: 0–9999, i.e. 0.01% resolution. */
const BUCKET_SPACE = 10_000

/** Hash an arbitrary string into a stable bucket in [0, 9999]. */
export function hashBucket(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0) % BUCKET_SPACE
}

/**
 * Enrollment/traffic bucket for (experiment, subject). Salt is mixed in so
 * experiments can re-randomise the same population independently.
 */
export function enrollmentBucket(experimentKey: string, subjectId: string, salt?: string): number {
  return hashBucket([salt ?? "", "enroll", experimentKey, subjectId].join("|"))
}

/**
 * Variant-assignment bucket for (experiment, subject). Uses a different
 * namespace ("assign") than enrollment so traffic inclusion and variant
 * choice are statistically independent.
 */
export function variantBucket(experimentKey: string, subjectId: string, salt?: string): number {
  return hashBucket([salt ?? "", "assign", experimentKey, subjectId].join("|"))
}

/** Clamp a percentage config value into [0, 100]. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** cyrb53 — dependency-free 53-bit string hash, identical in browser and Node. */
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
 * Non-identifying subject identifier stored on analytics events.
 *
 * Two independent cyrb53 passes (different seeds) produce 16 hex chars —
 * enough to count unique subjects and measure stickiness, not enough to be
 * reversed or joined back to a person. Scoped per experiment so the same
 * subject hash differs across experiments.
 */
export function subjectHash(experiment: string, subjectId: string): string {
  const scoped = `${experiment}\n${subjectId}`
  const a = cyrb53(scoped, 0x9e3779b9) >>> 0
  const b = cyrb53(scoped, 0x85ebca6b) >>> 0
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}
