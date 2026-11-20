/**
 * Portable share payloads for file-tree selections/state.
 *
 * A `SharePayload` serializes a tree selection (node ids), active filters,
 * expansion state and annotations (bookmarks/favorites/tags) into a compact
 * JSON document. `encodeSharePayload` produces either a JSON string or a
 * URL-safe base64 payload suitable for a `#share=` hash fragment;
 * `decodeSharePayload` restores it.
 */

export interface SharePayload {
  version: 1
  /** Tree node ids included in the shared selection (empty = whole tree). */
  nodeIds: string[]
  /** Active annotation filters at share time. */
  filters?: {
    bookmarkOnly?: boolean
    favoriteOnly?: boolean
    recentOnly?: boolean
    tagIds?: string[]
  }
  /** Expanded dir ids at share time (restorable view state). */
  expandedIds?: string[]
  /** Bookmarked node ids captured at share time. */
  bookmarks?: string[]
  /** Favorited node ids. */
  favorites?: string[]
  /** Tag id -> assigned node ids captured at share time. */
  tags?: Record<string, string[]>
  /** Optional label. */
  name?: string
  createdAt: string
}

export function createSharePayload(input: {
  nodeIds?: string[]
  filters?: SharePayload["filters"]
  expandedIds?: string[]
  bookmarks?: string[]
  favorites?: string[]
  tags?: Record<string, string[]>
  name?: string
  now?: Date
}): SharePayload {
  return {
    version: 1,
    nodeIds: [...(input.nodeIds ?? [])],
    filters: input.filters,
    expandedIds: input.expandedIds ? [...input.expandedIds] : undefined,
    bookmarks: input.bookmarks ? [...input.bookmarks] : undefined,
    favorites: input.favorites ? [...input.favorites] : undefined,
    tags: input.tags ? { ...input.tags } : undefined,
    name: input.name,
    createdAt: (input.now ?? new Date()).toISOString(),
  }
}

export function encodeSharePayload(payload: SharePayload): string {
  return JSON.stringify(payload)
}

/** Encode for a URL hash fragment (base64url, no padding). */
export function encodeSharePayloadForUrl(payload: SharePayload): string {
  const json = encodeSharePayload(payload)
  if (typeof btoa === "function") {
    // base64url
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  }
  // Node fallback: base64 via Buffer when available.
  const buf = (
    globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }
  ).Buffer
  if (buf) {
    return buf.from(json, "utf8").toString("base64url")
  }
  // Last resort: URI-encoded JSON (still portable, just longer).
  return encodeURIComponent(json)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

function isStringRecord(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(isStringArray)
}

const INVALID_FILTERS = Symbol("invalid-filters")

function sanitizeFilters(
  value: unknown,
): SharePayload["filters"] | undefined | typeof INVALID_FILTERS {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object" || Array.isArray(value)) return INVALID_FILTERS
  const f = value as Record<string, unknown>
  const out: NonNullable<SharePayload["filters"]> = {}
  if (f.bookmarkOnly !== undefined) {
    if (typeof f.bookmarkOnly !== "boolean") return INVALID_FILTERS
    out.bookmarkOnly = f.bookmarkOnly
  }
  if (f.favoriteOnly !== undefined) {
    if (typeof f.favoriteOnly !== "boolean") return INVALID_FILTERS
    out.favoriteOnly = f.favoriteOnly
  }
  if (f.recentOnly !== undefined) {
    if (typeof f.recentOnly !== "boolean") return INVALID_FILTERS
    out.recentOnly = f.recentOnly
  }
  if (f.tagIds !== undefined) {
    if (!isStringArray(f.tagIds)) return INVALID_FILTERS
    out.tagIds = f.tagIds
  }
  return out
}

export function decodeSharePayload(raw: string): SharePayload | null {
  try {
    // `raw` is expected to be the JSON document itself — URI-decoding happens
    // only at the transport boundary (decodeSharePayloadFromUrl /
    // sharePayloadFromLocation). Decoding here would corrupt literal "%"
    // sequences (e.g. a name containing "100%" or "%20").
    const payload = JSON.parse(raw) as SharePayload
    if (!payload || typeof payload !== "object" || payload.version !== 1) return null
    if (!isStringArray(payload.nodeIds)) return null
    if (payload.expandedIds !== undefined && !isStringArray(payload.expandedIds)) return null
    if (payload.bookmarks !== undefined && !isStringArray(payload.bookmarks)) return null
    if (payload.favorites !== undefined && !isStringArray(payload.favorites)) return null
    if (payload.tags !== undefined && !isStringRecord(payload.tags)) return null
    if (payload.name !== undefined && typeof payload.name !== "string") return null
    if (payload.createdAt !== undefined && typeof payload.createdAt !== "string") return null
    const filters = sanitizeFilters(payload.filters)
    if (filters === INVALID_FILTERS) return null
    return { ...payload, filters }
  } catch {
    return null
  }
}

/**
 * Decode a payload produced by `encodeSharePayloadForUrl` (base64url) or a
 * URI-encoded JSON string (the encoder's fallback form). This is the ONLY
 * place URI-decoding happens.
 */

export function decodeSharePayloadFromUrl(encoded: string): SharePayload | null {
  try {
    let json: string
    if (typeof atob === "function" && /^[A-Za-z0-9_-]+$/.test(encoded)) {
      const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/")
      json = decodeURIComponent(escape(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))))
    } else {
      // Transport form may be URI-encoded JSON; if it isn't (e.g. a raw JSON
      // document containing a literal "%"), fall back to the raw string.
      try {
        json = decodeURIComponent(encoded)
      } catch {
        json = encoded
      }
    }
    return decodeSharePayload(json)
  } catch {
    return null
  }
}

/** Extract a `#share=` (or `?share=`) payload from a URL string / location hash. */
export function sharePayloadFromLocation(href?: string): SharePayload | null {
  const url = href ?? (typeof window !== "undefined" ? window.location.href : "")
  const hashMatch = url.match(/#share=([^&]+)/)
  if (hashMatch) return decodeSharePayloadFromUrl(hashMatch[1])
  const queryMatch = url.match(/[?&]share=([^&#]+)/)
  if (queryMatch) return decodeSharePayloadFromUrl(queryMatch[1])
  return null
}
