/**
 * Read-replica connection-string resolution.
 *
 * Replica URLs are read straight from the process environment rather than the
 * validated `ServerEnv` schema: the variables are optional, server-only, and
 * owned by this module so adopting them never requires touching the shared
 * env contract (`src/lib/env.server.ts`, `.env.example`). See
 * `docs/database/read-replicas.md` for the full contract.
 */

/** Minimal env shape consumed by this module — a plain record, not `ProcessEnv`. */
export type ReplicaEnvSource = Record<string, string | undefined>

/**
 * Raw `process.env` access for variables intentionally outside the validated
 * `ServerEnv` schema. This is the single `process.env` touchpoint in
 * `src/lib/db/replica/`; everything else takes an injectable env source so
 * tests never mutate the real environment.
 */
export function rawServerEnv(): ReplicaEnvSource {
  // eslint-disable-next-line no-restricted-properties -- replica vars are deliberately not part of ServerEnv; see module docstring
  return process.env
}

/**
 * Parse a comma-separated list of connection strings.
 *
 * Entries are trimmed, empties dropped, and duplicates removed while
 * preserving first-seen order so failover order is deterministic.
 */
export function parseConnectionUrlList(raw: string | undefined): string[] {
  if (!raw) return []

  const seen = new Set<string>()
  const urls: string[] = []
  for (const entry of raw.split(",")) {
    const url = entry.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

/**
 * Ordered list of replica connection strings.
 *
 * `REPLICA_DATABASE_URLS` (comma-separated) is the primary contract and its
 * entries come first, in order. `REPLICA_DATABASE_URL` is a convenience for
 * the single-replica case and is appended after any list entries. Both may
 * be set; the combined list is deduplicated.
 *
 * Returns `[]` when no replica is configured — callers should treat that as
 * "route everything to the primary", not as an error.
 */
export function resolveReplicaDatabaseUrls(env: ReplicaEnvSource = rawServerEnv()): string[] {
  const urls = [
    ...parseConnectionUrlList(env.REPLICA_DATABASE_URLS),
    ...parseConnectionUrlList(env.REPLICA_DATABASE_URL),
  ]

  const seen = new Set<string>()
  return urls.filter((url) => {
    if (seen.has(url)) return false
    seen.add(url)
    return true
  })
}
