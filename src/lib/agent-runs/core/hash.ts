/**
 * Deterministic hashing + canonical serialization for run inputs.
 *
 * Used by the run cache (task 82) to key cached results by input hash, and by
 * the merge module (task 88) to compare event payloads for conflicts.
 * FNV-1a is used — it is fast, dependency-free, and stable across runs,
 * which is what a cache key needs (it is not a security boundary).
 */

/** Canonical JSON: object keys sorted recursively so equal values hash equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const v = record[key]
      if (v === undefined) continue
      out[key] = canonicalize(v)
    }
    return out
  }
  return value
}

/** FNV-1a 32-bit hash rendered as 8-char hex. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** Hash of a canonicalized JSON value. */
export function hashValue(value: unknown): string {
  return hashString(stableStringify(value))
}

/**
 * The cache identity of a run request: prompt + model + any caller-supplied
 * parameters. Two runs with the same input hash are cache-equivalent.
 */
export function runInputHash(input: {
  prompt: string
  model: string
  params?: Record<string, unknown>
}): string {
  return hashValue({ prompt: input.prompt, model: input.model, params: input.params ?? {} })
}

/** Hash of a single event's content, ignoring volatile fields (seq, id). */
export function eventContentHash(event: {
  type: string
  name: string
  payload?: Record<string, unknown>
  status?: string
}): string {
  return hashValue({
    type: event.type,
    name: event.name,
    payload: event.payload ?? {},
    status: event.status ?? null,
  })
}
