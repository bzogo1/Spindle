/**
 * Share-click counters for `POST /api/share/track`.
 *
 * DEVELOPMENT SEAM: process-local `Map`, same interim-store pattern as
 * `referral-program.ts` / `affiliate.ts`. Counts are lost on restart and are
 * per-instance on serverless — fine for the current dev/analytics seam; the
 * upgrade path is a `share_clicks` table keyed by `(platform, code, day)`.
 *
 * The map is bounded: at most {@link MAX_KEYS} distinct `platform[:code]`
 * keys are kept, evicting the oldest entry on overflow so hostile input
 * cannot grow memory without bound.
 *
 * Server-only in practice: imported by the route handler and its tests.
 */

const MAX_KEYS = 256
const MAX_KEY_LENGTH = 96

const counts = new Map<string, number>()

function keyFor(platform: string, code?: string | null): string {
  const base = code ? `${platform}:${code}` : platform
  return base.slice(0, MAX_KEY_LENGTH)
}

/** Increments the counter for a share platform (optionally per referral code). */
export function recordShareClick(platform: string, code?: string | null): void {
  const key = keyFor(platform, code)
  if (!counts.has(key) && counts.size >= MAX_KEYS) {
    // Map iterates in insertion order — drop the oldest key.
    const oldest = counts.keys().next().value
    if (oldest !== undefined) counts.delete(oldest)
  }
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/** Snapshot of all recorded counts, keyed `platform` or `platform:code`. */
export function shareClickCounts(): Record<string, number> {
  return Object.fromEntries(counts)
}

/** Count for a single key; 0 when never recorded. */
export function shareClickCount(platform: string, code?: string | null): number {
  return counts.get(keyFor(platform, code)) ?? 0
}

/** Test hook — clears all counters. */
export function resetShareTrackingForTests(): void {
  counts.clear()
}
